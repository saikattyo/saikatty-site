import {
	bytesToBase64,
	parseJournalMarkdown,
	serializeJournalMarkdown,
	type JournalFrontmatter,
} from './journalCodec';
import {
	deleteGithubBlogEntry,
	getGithubBlogEntry,
	getGithubDeployStatus,
	listGithubBlogFiles,
	putGithubBlogEntry,
	StudioApiError,
	uploadGithubImageAsset,
	verifyGithubRepoAccess,
	type DeployStatusResult,
	type RepoConfig,
	type SaveEntryResult,
	type StudioEntryDetail,
	type StudioEntrySummary,
	type UploadAssetResult,
} from './githubRepoCore';

export type AuthMode = 'local-fs' | 'passphrase' | 'github-token';

export interface StudioCapabilities {
	mode: 'local-fs' | 'cloudflare' | 'static-direct';
	passphraseConfigured: boolean;
	owner: string;
	repo: string;
	branch: string;
}

export interface StoredCredentials {
	authMode: AuthMode;
	passphrase?: string;
	githubToken?: string;
	owner: string;
	repo: string;
	branch: string;
}

const CREDENTIALS_KEY = 'saikattyo_studio_auth_v1';
const INDEX_CACHE_KEY = 'saikattyo_studio_sha_cache_v1';

interface CachedSummary {
	frontmatter: JournalFrontmatter;
	excerpt: string;
}

function readShaCache(): Record<string, CachedSummary> {
	try {
		const raw = window.localStorage.getItem(INDEX_CACHE_KEY);
		return raw ? (JSON.parse(raw) as Record<string, CachedSummary>) : {};
	} catch {
		return {};
	}
}

function writeShaCache(cache: Record<string, CachedSummary>): void {
	try {
		window.localStorage.setItem(INDEX_CACHE_KEY, JSON.stringify(cache));
	} catch {
		// Ignore quota errors
	}
}

export function loadStoredCredentials(): StoredCredentials | null {
	try {
		const raw = window.localStorage.getItem(CREDENTIALS_KEY);
		if (!raw) return null;
		return JSON.parse(raw) as StoredCredentials;
	} catch {
		return null;
	}
}

export function saveStoredCredentials(creds: StoredCredentials): void {
	try {
		window.localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(creds));
	} catch {
		// Ignore storage errors
	}
}

export function clearStoredCredentials(): void {
	try {
		window.localStorage.removeItem(CREDENTIALS_KEY);
	} catch {
		// Ignore
	}
}

export async function detectStudioCapabilities(): Promise<StudioCapabilities> {
	try {
		const res = await fetch('/api/studio?action=capabilities', {
			headers: { Accept: 'application/json' },
		});
		if (res.ok) {
			const ct = res.headers.get('content-type') || '';
			if (ct.includes('application/json')) {
				return (await res.json()) as StudioCapabilities;
			}
		}
	} catch {
		// Fall through to static-direct
	}
	return {
		mode: 'static-direct',
		passphraseConfigured: false,
		owner: 'saikattyo',
		repo: 'saikatty-site',
		branch: 'main',
	};
}

/** Compress oversized camera-roll photos client-side before committing to Git. */
export async function prepareImageForUpload(
	file: File,
	maxDimension = 1600
): Promise<{ filename: string; base64Data: string; byteLength: number }> {
	// Keep GIFs / tiny WebPs untouched so animations or crisp icons stay intact
	if (file.type === 'image/gif' || (file.type === 'image/webp' && file.size < 350_000)) {
		const buf = new Uint8Array(await file.arrayBuffer());
		return {
			filename: file.name || 'image.webp',
			base64Data: bytesToBase64(buf),
			byteLength: buf.byteLength,
		};
	}

	try {
		const bitmap = await createImageBitmap(file);
		let { width, height } = bitmap;
		if (width > maxDimension || height > maxDimension) {
			const ratio = Math.min(maxDimension / width, maxDimension / height);
			width = Math.max(1, Math.round(width * ratio));
			height = Math.max(1, Math.round(height * ratio));
		}

		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Canvas 2D unavailable');
		ctx.drawImage(bitmap, 0, 0, width, height);
		bitmap.close();

		const blob: Blob = await new Promise((resolve, reject) => {
			canvas.toBlob(
				(b) => (b ? resolve(b) : reject(new Error('Blob encode failed'))),
				'image/webp',
				0.84
			);
		});

		const bytes = new Uint8Array(await blob.arrayBuffer());
		const stem = (file.name || 'photo').replace(/\.[^.]+$/, '');
		const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
		return {
			filename: `${stem}.${ext}`,
			base64Data: bytesToBase64(bytes),
			byteLength: bytes.byteLength,
		};
	} catch {
		const fallbackBytes = new Uint8Array(await file.arrayBuffer());
		return {
			filename: file.name || 'photo.jpg',
			base64Data: bytesToBase64(fallbackBytes),
			byteLength: fallbackBytes.byteLength,
		};
	}
}

export class StudioClient {
	private creds: StoredCredentials;

	constructor(creds: StoredCredentials) {
		this.creds = creds;
	}

	private get isDirectGithub(): boolean {
		return this.creds.authMode === 'github-token' && Boolean(this.creds.githubToken);
	}

	private toRepoConfig(): RepoConfig {
		return {
			owner: this.creds.owner || 'saikattyo',
			repo: this.creds.repo || 'saikatty-site',
			branch: this.creds.branch || 'main',
			token: this.creds.githubToken || '',
		};
	}

	private apiHeaders(): Record<string, string> {
		const h: Record<string, string> = {
			Accept: 'application/json',
		};
		if (this.creds.authMode === 'passphrase' && this.creds.passphrase) {
			h['x-studio-passphrase'] = this.creds.passphrase;
		} else if (this.creds.githubToken) {
			h['x-github-token'] = this.creds.githubToken;
		}
		return h;
	}

	private async callServerApi<T>(
		action: string,
		options: { method?: 'GET' | 'POST'; query?: Record<string, string>; body?: unknown } = {}
	): Promise<T> {
		const params = new URLSearchParams({ action, ...(options.query || {}) });
		const res = await fetch(`/api/studio?${params.toString()}`, {
			method: options.method || 'GET',
			headers: {
				...this.apiHeaders(),
				...(options.body ? { 'Content-Type': 'application/json' } : {}),
			},
			body: options.body ? JSON.stringify(options.body) : undefined,
		});

		const data = (await res.json()) as T & { error?: string; code?: string };
		if (!res.ok) {
			throw new StudioApiError(
				data.error || `APIエラー (${res.status})`,
				res.status,
				data.code || 'API_ERROR'
			);
		}
		return data;
	}

	async verify(): Promise<{ fullName: string; canPush: boolean }> {
		if (this.isDirectGithub) {
			return verifyGithubRepoAccess(this.toRepoConfig());
		}
		return this.callServerApi<{ fullName: string; canPush: boolean }>('verify');
	}

	async listEntries(): Promise<StudioEntrySummary[]> {
		if (this.isDirectGithub) {
			const cfg = this.toRepoConfig();
			const files = await listGithubBlogFiles(cfg);
			const cache = readShaCache();
			const nextCache: Record<string, CachedSummary> = {};

			const uncached = files.filter((f) => !cache[f.sha]);
			for (let i = 0; i < uncached.length; i += 6) {
				const batch = uncached.slice(i, i + 6);
				await Promise.all(
					batch.map(async (f) => {
						const detail = await getGithubBlogEntry(cfg, f.slug);
						cache[f.sha] = {
							frontmatter: detail.frontmatter,
							excerpt: detail.frontmatter.description,
						};
					})
				);
			}

			const summaries: StudioEntrySummary[] = files.map((f) => {
				const hit = cache[f.sha];
				nextCache[f.sha] = hit;
				return {
					...f,
					frontmatter: hit.frontmatter,
					excerpt: hit.excerpt,
				};
			});

			writeShaCache(nextCache);
			summaries.sort(
				(a, b) =>
					new Date(b.frontmatter.pubDate).getTime() -
						new Date(a.frontmatter.pubDate).getTime() ||
					b.slug.localeCompare(a.slug)
			);
			return summaries;
		}

		const res = await this.callServerApi<{ entries: StudioEntrySummary[] }>('list');
		return res.entries;
	}

	async getEntry(slug: string): Promise<StudioEntryDetail> {
		if (this.isDirectGithub) {
			return getGithubBlogEntry(this.toRepoConfig(), slug);
		}
		const res = await this.callServerApi<{ entry: StudioEntryDetail }>('get', {
			query: { slug },
		});
		return res.entry;
	}

	async saveEntry(params: {
		slug: string;
		frontmatter: Partial<JournalFrontmatter>;
		content: string;
		extraLines?: string[];
		sha?: string;
		isNew?: boolean;
		commitMessage?: string;
	}): Promise<SaveEntryResult> {
		const serialized = serializeJournalMarkdown(params.frontmatter, params.content, {
			allowAutoTitle: false,
			extraLines: params.extraLines,
		});
		if (!serialized.ok) {
			throw new StudioApiError(
				serialized.errors.join(' '),
				400,
				'VALIDATION_ERROR'
			);
		}

		if (this.isDirectGithub) {
			const saved = await putGithubBlogEntry(this.toRepoConfig(), {
				slug: params.slug,
				markdown: serialized.markdown,
				sha: params.sha,
				isNew: params.isNew,
				commitMessage: params.commitMessage,
			});
			const cache = readShaCache();
			cache[saved.sha] = {
				frontmatter: serialized.normalized,
				excerpt: serialized.normalized.description,
			};
			writeShaCache(cache);
			return saved;
		}

		return this.callServerApi<SaveEntryResult>('save', {
			method: 'POST',
			body: {
				slug: params.slug,
				frontmatter: serialized.normalized,
				content: params.content,
				extraLines: params.extraLines,
				sha: params.sha,
				isNew: params.isNew,
				commitMessage: params.commitMessage,
			},
		});
	}

	async importRawMarkdown(params: {
		slug: string;
		rawMarkdown: string;
		sha?: string;
		isNew?: boolean;
	}): Promise<{ parsed: ReturnType<typeof parseJournalMarkdown>; saved: SaveEntryResult }> {
		const parsed = parseJournalMarkdown(params.rawMarkdown, params.slug);
		const saved = await this.saveEntry({
			slug: params.slug,
			frontmatter: parsed.frontmatter,
			content: parsed.body,
			extraLines: parsed.extraLines,
			sha: params.sha,
			isNew: params.isNew,
			commitMessage: `Import journal note: ${params.slug}`,
		});
		return { parsed, saved };
	}

	async deleteEntry(params: {
		slug: string;
		sha: string;
	}): Promise<{ deletedSlug: string; commitSha: string }> {
		if (this.isDirectGithub) {
			return deleteGithubBlogEntry(this.toRepoConfig(), params);
		}
		return this.callServerApi<{ deletedSlug: string; commitSha: string }>('delete', {
			method: 'POST',
			body: params,
		});
	}

	async uploadImage(file: File): Promise<UploadAssetResult> {
		const prepared = await prepareImageForUpload(file);
		if (this.isDirectGithub) {
			return uploadGithubImageAsset(this.toRepoConfig(), {
				filename: prepared.filename,
				base64Data: prepared.base64Data,
			});
		}
		return this.callServerApi<UploadAssetResult>('upload-image', {
			method: 'POST',
			body: {
				filename: prepared.filename,
				base64Data: prepared.base64Data,
			},
		});
	}

	async getDeployStatus(): Promise<DeployStatusResult> {
		if (this.isDirectGithub) {
			return getGithubDeployStatus(this.toRepoConfig());
		}
		return this.callServerApi<DeployStatusResult>('deploy-status');
	}
}
