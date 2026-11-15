import {
	deleteGithubBlogEntry,
	getGithubBlogEntry,
	getGithubDeployStatus,
	listGithubBlogFiles,
	putGithubBlogEntry,
	StudioApiError,
	uploadGithubImageAsset,
	verifyGithubRepoAccess,
	type RepoConfig,
} from '../../src/lib/githubRepoCore';
import { parseJournalMarkdown, serializeJournalMarkdown } from '../../src/lib/journalCodec';

export interface StudioEnv {
	GITHUB_TOKEN?: string;
	STUDIO_PASSPHRASE?: string;
	GITHUB_OWNER?: string;
	GITHUB_REPO?: string;
	GITHUB_BRANCH?: string;
}

interface PagesContext {
	request: Request;
	env: StudioEnv;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			'Cache-Control': 'no-store',
		},
	});
}

/** Constant-time passphrase comparison via WebCrypto SHA-256 digests. */
async function verifyPassphraseConstantTime(
	provided: string,
	expected: string
): Promise<boolean> {
	if (!provided || !expected) return false;
	const enc = new TextEncoder();
	const [hashA, hashB] = await Promise.all([
		crypto.subtle.digest('SHA-256', enc.encode(provided)),
		crypto.subtle.digest('SHA-256', enc.encode(expected)),
	]);
	const a = new Uint8Array(hashA);
	const b = new Uint8Array(hashB);
	let diff = a.length ^ b.length;
	for (let i = 0; i < a.length; i++) {
		diff |= a[i] ^ b[i];
	}
	return diff === 0;
}

function resolveRepoConfig(env: StudioEnv, overrideToken?: string): RepoConfig {
	return {
		owner: env.GITHUB_OWNER || 'saikattyo',
		repo: env.GITHUB_REPO || 'saikatty-site',
		branch: env.GITHUB_BRANCH || 'main',
		token: overrideToken || env.GITHUB_TOKEN || '',
	};
}

export async function handleStudioApiRequest(
	request: Request,
	env: StudioEnv,
	fetchImpl?: typeof fetch
): Promise<Response> {
	const url = new URL(request.url);
	const action = url.searchParams.get('action') || '';

	const passphraseConfigured = Boolean(env.STUDIO_PASSPHRASE && env.GITHUB_TOKEN);
	const owner = env.GITHUB_OWNER || 'saikattyo';
	const repo = env.GITHUB_REPO || 'saikatty-site';
	const branch = env.GITHUB_BRANCH || 'main';

	if (request.method === 'GET' && action === 'capabilities') {
		return jsonResponse({
			mode: 'cloudflare',
			passphraseConfigured,
			owner,
			repo,
			branch,
		});
	}

	// Authenticate either via server STUDIO_PASSPHRASE or client-supplied GitHub PAT header
	const headerPassphrase = request.headers.get('x-studio-passphrase') || '';
	const headerGithubToken = request.headers.get('x-github-token') || '';

	let cfg: RepoConfig;
	if (headerPassphrase && passphraseConfigured && env.STUDIO_PASSPHRASE) {
		const valid = await verifyPassphraseConstantTime(
			headerPassphrase,
			env.STUDIO_PASSPHRASE
		);
		if (!valid) {
			return jsonResponse(
				{ error: 'パスフレーズが正しくありません。', code: 'AUTH_FAILED' },
				401
			);
		}
		cfg = { ...resolveRepoConfig(env), fetchImpl };
	} else if (headerGithubToken) {
		cfg = { ...resolveRepoConfig(env, headerGithubToken), fetchImpl };
	} else {
		return jsonResponse(
			{
				error: '認証情報が必要です。パスフレーズまたはGitHubトークンを設定してください。',
				code: 'AUTH_REQUIRED',
			},
			401
		);
	}

	try {
		if (request.method === 'GET' && action === 'verify') {
			const info = await verifyGithubRepoAccess(cfg);
			return jsonResponse({ ok: true, ...info });
		}

		if (request.method === 'GET' && action === 'list') {
			const files = await listGithubBlogFiles(cfg);
			// Fetch details in bounded parallel batches of 6
			const entries = [];
			for (let i = 0; i < files.length; i += 6) {
				const batch = files.slice(i, i + 6);
				const loaded = await Promise.all(
					batch.map(async (f) => {
						const detail = await getGithubBlogEntry(cfg, f.slug);
						return {
							...f,
							frontmatter: detail.frontmatter,
							excerpt: detail.frontmatter.description,
						};
					})
				);
				entries.push(...loaded);
			}
			entries.sort(
				(a, b) =>
					new Date(b.frontmatter.pubDate).getTime() -
						new Date(a.frontmatter.pubDate).getTime() ||
					b.slug.localeCompare(a.slug)
			);
			return jsonResponse({ entries });
		}

		if (request.method === 'GET' && action === 'get') {
			const slug = url.searchParams.get('slug') || '';
			const entry = await getGithubBlogEntry(cfg, slug);
			return jsonResponse({ entry });
		}

		if (request.method === 'GET' && action === 'deploy-status') {
			const status = await getGithubDeployStatus(cfg);
			return jsonResponse(status);
		}

		if (request.method === 'POST' && action === 'save') {
			const body = (await request.json()) as {
				slug?: string;
				frontmatter?: Record<string, unknown>;
				content?: string;
				rawMarkdown?: string;
				extraLines?: string[];
				sha?: string;
				isNew?: boolean;
				commitMessage?: string;
			};

			let markdownToSave = '';
			if (typeof body.rawMarkdown === 'string') {
				const parsed = parseJournalMarkdown(body.rawMarkdown, body.slug || '');
				const serialized = serializeJournalMarkdown(parsed.frontmatter, parsed.body, {
					allowAutoTitle: true,
					extraLines: parsed.extraLines,
				});
				if (!serialized.ok) {
					return jsonResponse(
						{ error: serialized.errors.join(' '), code: 'VALIDATION_ERROR' },
						400
					);
				}
				markdownToSave = serialized.markdown;
			} else {
				const serialized = serializeJournalMarkdown(
					body.frontmatter || {},
					body.content || '',
					{
						allowAutoTitle: false,
						extraLines: body.extraLines,
					}
				);
				if (!serialized.ok) {
					return jsonResponse(
						{ error: serialized.errors.join(' '), code: 'VALIDATION_ERROR' },
						400
					);
				}
				markdownToSave = serialized.markdown;
			}

			const saved = await putGithubBlogEntry(cfg, {
				slug: body.slug || '',
				markdown: markdownToSave,
				sha: body.sha,
				isNew: body.isNew,
				commitMessage: body.commitMessage,
			});
			return jsonResponse({ ok: true, ...saved });
		}

		if (request.method === 'POST' && action === 'delete') {
			const body = (await request.json()) as {
				slug?: string;
				sha?: string;
				commitMessage?: string;
			};
			const deleted = await deleteGithubBlogEntry(cfg, {
				slug: body.slug || '',
				sha: body.sha || '',
				commitMessage: body.commitMessage,
			});
			return jsonResponse({ ok: true, ...deleted });
		}

		if (request.method === 'POST' && action === 'upload-image') {
			const body = (await request.json()) as {
				filename?: string;
				base64Data?: string;
			};
			const uploaded = await uploadGithubImageAsset(cfg, {
				filename: body.filename || 'image.webp',
				base64Data: body.base64Data || '',
			});
			return jsonResponse({ ok: true, ...uploaded });
		}

		return jsonResponse({ error: 'Unknown studio action', code: 'BAD_ACTION' }, 400);
	} catch (err) {
		if (err instanceof StudioApiError) {
			return jsonResponse({ error: err.message, code: err.code }, err.status);
		}
		const message = err instanceof Error ? err.message : 'Unexpected server error';
		return jsonResponse({ error: message, code: 'INTERNAL_ERROR' }, 500);
	}
}

export const onRequest = async (context: PagesContext): Promise<Response> => {
	return handleStudioApiRequest(context.request, context.env);
};
