import {
	base64ToUtf8,
	parseJournalMarkdown,
	utf8ToBase64,
	validateSlug,
	type JournalFrontmatter,
} from './journalCodec';

export interface RepoConfig {
	owner: string;
	repo: string;
	branch: string;
	token: string;
	fetchImpl?: typeof fetch;
}

export interface StudioFileListingItem {
	slug: string;
	name: string;
	path: string;
	sha: string;
	size: number;
}

export interface StudioEntrySummary extends StudioFileListingItem {
	frontmatter: JournalFrontmatter;
	excerpt: string;
}

export interface StudioEntryDetail {
	slug: string;
	path: string;
	sha: string;
	rawMarkdown: string;
	frontmatter: JournalFrontmatter;
	body: string;
	extraLines: string[];
}

export interface SaveEntryResult {
	slug: string;
	path: string;
	sha: string;
	commitSha: string;
	commitUrl?: string;
}

export interface UploadAssetResult {
	path: string;
	publicUrl: string;
	sha: string;
	commitSha: string;
}

export interface DeployStatusResult {
	state: 'idle' | 'in_progress' | 'completed' | 'failed';
	conclusion: string | null;
	detailsUrl: string | null;
	commitSha: string | null;
	commitMessage: string | null;
}

export class StudioApiError extends Error {
	status: number;
	code: string;

	constructor(message: string, status = 500, code = 'STUDIO_ERROR') {
		super(message);
		this.name = 'StudioApiError';
		this.status = status;
		this.code = code;
	}
}

const GITHUB_API = 'https://api.github.com';

function ghHeaders(token: string): Record<string, string> {
	return {
		Accept: 'application/vnd.github+json',
		Authorization: `Bearer ${token}`,
		'X-GitHub-Api-Version': '2022-11-28',
		'User-Agent': 'saikattyo-studio/1.0',
	};
}

async function ghJson<T>(
	cfg: RepoConfig,
	urlPath: string,
	init: RequestInit = {}
): Promise<T> {
	const f = cfg.fetchImpl || fetch;
	const res = await f(`${GITHUB_API}${urlPath}`, {
		...init,
		headers: {
			...ghHeaders(cfg.token),
			...(init.headers || {}),
		},
	});

	if (!res.ok) {
		let detail = '';
		try {
			const errJson = (await res.json()) as { message?: string };
			detail = errJson.message || '';
		} catch {
			detail = res.statusText;
		}

		if (res.status === 401 || res.status === 403) {
			throw new StudioApiError(
				`GitHub認証エラー (${res.status}): トークンの権限（Contents: Read and write）を確認してください。 ${detail}`,
				res.status,
				'AUTH_FAILED'
			);
		}
		if (res.status === 404) {
			throw new StudioApiError(
				`対象ファイルまたはリポジトリが見つかりません (404)。`,
				404,
				'NOT_FOUND'
			);
		}
		if (res.status === 409 || res.status === 422) {
			throw new StudioApiError(
				`他の端末で更新された可能性があります (${res.status})。最新状態を再読み込みしてから保存してください。 ${detail}`,
				409,
				'CONFLICT'
			);
		}
		throw new StudioApiError(
			`GitHub APIエラー (${res.status}): ${detail}`,
			res.status,
			'UPSTREAM_ERROR'
		);
	}

	return (await res.json()) as T;
}

/** Verify token has access to target repository. */
export async function verifyGithubRepoAccess(cfg: RepoConfig): Promise<{
	fullName: string;
	canPush: boolean;
}> {
	const data = await ghJson<{
		full_name: string;
		permissions?: { push?: boolean };
	}>(cfg, `/repos/${cfg.owner}/${cfg.repo}`);

	return {
		fullName: data.full_name,
		canPush: data.permissions?.push !== false,
	};
}

/** List all Markdown files under `src/content/blog`. */
export async function listGithubBlogFiles(cfg: RepoConfig): Promise<StudioFileListingItem[]> {
	const items = await ghJson<
		Array<{
			name: string;
			path: string;
			sha: string;
			size: number;
			type: string;
		}>
	>(
		cfg,
		`/repos/${cfg.owner}/${cfg.repo}/contents/src/content/blog?ref=${encodeURIComponent(cfg.branch)}`
	);

	return items
		.filter((item) => item.type === 'file' && /\.(md|mdx)$/i.test(item.name))
		.map((item) => ({
			slug: item.name.replace(/\.(md|mdx)$/i, ''),
			name: item.name,
			path: item.path,
			sha: item.sha,
			size: item.size,
		}));
}

/** Fetch a single journal entry by slug. */
export async function getGithubBlogEntry(
	cfg: RepoConfig,
	rawSlug: string
): Promise<StudioEntryDetail> {
	const valid = validateSlug(rawSlug);
	if (!valid.ok) {
		throw new StudioApiError(valid.error, 400, 'INVALID_SLUG');
	}

	const filePath = `src/content/blog/${valid.slug}.md`;
	const data = await ghJson<{
		path: string;
		sha: string;
		content: string;
		encoding: string;
	}>(
		cfg,
		`/repos/${cfg.owner}/${cfg.repo}/contents/${filePath}?ref=${encodeURIComponent(cfg.branch)}`
	);

	const rawMarkdown = base64ToUtf8(data.content);
	const parsed = parseJournalMarkdown(rawMarkdown, valid.slug);

	return {
		slug: valid.slug,
		path: data.path,
		sha: data.sha,
		rawMarkdown,
		frontmatter: parsed.frontmatter,
		body: parsed.body,
		extraLines: parsed.extraLines,
	};
}

/** Create or update a Markdown journal entry with optional SHA optimistic locking. */
export async function putGithubBlogEntry(
	cfg: RepoConfig,
	params: {
		slug: string;
		markdown: string;
		sha?: string;
		isNew?: boolean;
		commitMessage?: string;
	}
): Promise<SaveEntryResult> {
	const valid = validateSlug(params.slug);
	if (!valid.ok) {
		throw new StudioApiError(valid.error, 400, 'INVALID_SLUG');
	}

	const filePath = `src/content/blog/${valid.slug}.md`;

	// Prevent accidental overwrite when creating a brand-new slug without sha
	if (params.isNew && !params.sha) {
		try {
			await ghJson(
				cfg,
				`/repos/${cfg.owner}/${cfg.repo}/contents/${filePath}?ref=${encodeURIComponent(cfg.branch)}`
			);
			throw new StudioApiError(
				`「${valid.slug}.md」は既に存在します。上書きを防ぐため既存記事を開くか別スラッグを指定してください。`,
				409,
				'ALREADY_EXISTS'
			);
		} catch (err) {
			if (err instanceof StudioApiError && err.code !== 'NOT_FOUND') {
				throw err;
			}
		}
	}

	const actionVerb = params.sha ? 'Update' : 'Add';
	const message =
		params.commitMessage?.trim() || `${actionVerb} journal entry: ${valid.slug}`;

	const payload: Record<string, unknown> = {
		message,
		content: utf8ToBase64(params.markdown),
		branch: cfg.branch,
	};
	if (params.sha) {
		payload.sha = params.sha;
	}

	const res = await ghJson<{
		content: { path: string; sha: string };
		commit: { sha: string; html_url?: string };
	}>(cfg, `/repos/${cfg.owner}/${cfg.repo}/contents/${filePath}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
	});

	return {
		slug: valid.slug,
		path: res.content.path,
		sha: res.content.sha,
		commitSha: res.commit.sha,
		commitUrl: res.commit.html_url,
	};
}

/** Delete a Markdown journal entry (requires exact current file SHA). */
export async function deleteGithubBlogEntry(
	cfg: RepoConfig,
	params: {
		slug: string;
		sha: string;
		commitMessage?: string;
	}
): Promise<{ deletedSlug: string; commitSha: string }> {
	const valid = validateSlug(params.slug);
	if (!valid.ok) {
		throw new StudioApiError(valid.error, 400, 'INVALID_SLUG');
	}
	if (!params.sha) {
		throw new StudioApiError(
			'削除対象のSHAが指定されていません。再読み込みしてから実行してください。',
			400,
			'MISSING_SHA'
		);
	}

	const filePath = `src/content/blog/${valid.slug}.md`;
	const message =
		params.commitMessage?.trim() || `Delete journal entry: ${valid.slug}`;

	const res = await ghJson<{
		commit: { sha: string };
	}>(cfg, `/repos/${cfg.owner}/${cfg.repo}/contents/${filePath}`, {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			message,
			sha: params.sha,
			branch: cfg.branch,
		}),
	});

	return {
		deletedSlug: valid.slug,
		commitSha: res.commit.sha,
	};
}

/** Sanitize uploaded image filename and store under `public/uploads/YYYY/MM/...`. */
export function buildUploadAssetPath(
	originalName: string,
	now: Date = new Date()
): { repoPath: string; publicUrl: string } {
	const extMatch = originalName.toLowerCase().match(/\.(webp|jpg|jpeg|png|gif|avif)$/);
	const ext = extMatch ? extMatch[1] : 'webp';
	const stem = originalName
		.replace(/\.[^.]+$/, '')
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '-')
		.replace(/-{2,}/g, '-')
		.replace(/^[-_]+|[-_]+$/g, '')
		.slice(0, 32) || 'img';

	const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
	const jst = new Date(jstMs);
	const yyyy = jst.getUTCFullYear();
	const mm = String(jst.getUTCMonth() + 1).padStart(2, '0');
	const stamp = `${String(jst.getUTCDate()).padStart(2, '0')}-${String(
		jst.getUTCHours()
	).padStart(2, '0')}${String(jst.getUTCMinutes()).padStart(2, '0')}${String(
		jst.getUTCSeconds()
	).padStart(2, '0')}-${Math.random().toString(36).slice(2, 6)}`;

	const fileName = `${stamp}-${stem}.${ext}`;
	return {
		repoPath: `public/uploads/${yyyy}/${mm}/${fileName}`,
		publicUrl: `/uploads/${yyyy}/${mm}/${fileName}`,
	};
}

/** Upload an image asset (already base64-encoded bytes) into `public/uploads/...`. */
export async function uploadGithubImageAsset(
	cfg: RepoConfig,
	params: {
		filename: string;
		base64Data: string;
		now?: Date;
	}
): Promise<UploadAssetResult> {
	const cleanB64 = params.base64Data.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
	if (!cleanB64) {
		throw new StudioApiError('画像データが空です。', 400, 'EMPTY_IMAGE');
	}
	// ~6MB binary ceiling (~8MB base64) to protect Git repo bloat
	if (cleanB64.length > 8_400_000) {
		throw new StudioApiError(
			'画像サイズが大きすぎます（上限 6MB）。圧縮してからアップロードしてください。',
			413,
			'IMAGE_TOO_LARGE'
		);
	}

	const { repoPath, publicUrl } = buildUploadAssetPath(params.filename, params.now);

	const res = await ghJson<{
		content: { path: string; sha: string };
		commit: { sha: string };
	}>(cfg, `/repos/${cfg.owner}/${cfg.repo}/contents/${repoPath}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			message: `Upload journal image: ${publicUrl}`,
			content: cleanB64,
			branch: cfg.branch,
		}),
	});

	return {
		path: res.content.path,
		publicUrl,
		sha: res.content.sha,
		commitSha: res.commit.sha,
	};
}

/** Poll latest commit & Cloudflare Pages check-run status on `branch`. */
export async function getGithubDeployStatus(cfg: RepoConfig): Promise<DeployStatusResult> {
	const commit = await ghJson<{
		sha: string;
		commit: { message: string };
	}>(cfg, `/repos/${cfg.owner}/${cfg.repo}/commits/${encodeURIComponent(cfg.branch)}`);

	const checks = await ghJson<{
		check_runs: Array<{
			name: string;
			status: string;
			conclusion: string | null;
			details_url: string | null;
		}>;
	}>(cfg, `/repos/${cfg.owner}/${cfg.repo}/commits/${commit.sha}/check-runs`);

	const cfRun =
		checks.check_runs.find((r) => /cloudflare/i.test(r.name)) || checks.check_runs[0];

	if (!cfRun) {
		return {
			state: 'idle',
			conclusion: null,
			detailsUrl: null,
			commitSha: commit.sha.slice(0, 7),
			commitMessage: commit.commit.message.split('\n')[0],
		};
	}

	let state: DeployStatusResult['state'] = 'in_progress';
	if (cfRun.status === 'completed') {
		state = cfRun.conclusion === 'success' ? 'completed' : 'failed';
	}

	return {
		state,
		conclusion: cfRun.conclusion,
		detailsUrl: cfRun.details_url,
		commitSha: commit.sha.slice(0, 7),
		commitMessage: commit.commit.message.split('\n')[0],
	};
}
