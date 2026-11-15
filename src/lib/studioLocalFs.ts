import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
	base64ToBytes,
	parseJournalMarkdown,
	serializeJournalMarkdown,
	validateSlug,
} from './journalCodec';
import { buildUploadAssetPath, StudioApiError } from './githubRepoCore';

export function computeGitBlobSha(bytes: Uint8Array): string {
	const header = Buffer.from(`blob ${bytes.byteLength}\0`, 'utf8');
	return crypto.createHash('sha1').update(header).update(bytes).digest('hex');
}

export class LocalFsJournalStore {
	private rootDir: string;
	private blogDir: string;

	constructor(rootDir: string) {
		this.rootDir = rootDir;
		this.blogDir = path.join(rootDir, 'src', 'content', 'blog');
	}

	async listEntries() {
		await fs.mkdir(this.blogDir, { recursive: true });
		const names = await fs.readdir(this.blogDir);
		const mdFiles = names.filter((n) => /\.(md|mdx)$/i.test(n));

		const entries = await Promise.all(
			mdFiles.map(async (name) => {
				const slug = name.replace(/\.(md|mdx)$/i, '');
				const fullPath = path.join(this.blogDir, name);
				const buf = await fs.readFile(fullPath);
				const sha = computeGitBlobSha(buf);
				const raw = buf.toString('utf8');
				const parsed = parseJournalMarkdown(raw, slug);
				return {
					slug,
					name,
					path: `src/content/blog/${name}`,
					sha,
					size: buf.byteLength,
					frontmatter: parsed.frontmatter,
					excerpt: parsed.frontmatter.description,
				};
			})
		);

		entries.sort(
			(a, b) =>
				new Date(b.frontmatter.pubDate).getTime() -
					new Date(a.frontmatter.pubDate).getTime() ||
				b.slug.localeCompare(a.slug)
		);
		return entries;
	}

	async getEntry(rawSlug: string) {
		const valid = validateSlug(rawSlug);
		if (!valid.ok) {
			throw new StudioApiError(valid.error, 400, 'INVALID_SLUG');
		}

		const fullPath = path.join(this.blogDir, `${valid.slug}.md`);
		let buf: Buffer;
		try {
			buf = await fs.readFile(fullPath);
		} catch {
			throw new StudioApiError(
				`記事「${valid.slug}.md」が見つかりません。`,
				404,
				'NOT_FOUND'
			);
		}

		const rawMarkdown = buf.toString('utf8');
		const parsed = parseJournalMarkdown(rawMarkdown, valid.slug);
		return {
			slug: valid.slug,
			path: `src/content/blog/${valid.slug}.md`,
			sha: computeGitBlobSha(buf),
			rawMarkdown,
			frontmatter: parsed.frontmatter,
			body: parsed.body,
			extraLines: parsed.extraLines,
		};
	}

	async saveEntry(params: {
		slug: string;
		frontmatter?: Record<string, unknown>;
		content?: string;
		rawMarkdown?: string;
		extraLines?: string[];
		sha?: string;
		isNew?: boolean;
	}) {
		const valid = validateSlug(params.slug);
		if (!valid.ok) {
			throw new StudioApiError(valid.error, 400, 'INVALID_SLUG');
		}

		await fs.mkdir(this.blogDir, { recursive: true });
		const fullPath = path.join(this.blogDir, `${valid.slug}.md`);

		let existingSha: string | null = null;
		try {
			const existingBuf = await fs.readFile(fullPath);
			existingSha = computeGitBlobSha(existingBuf);
		} catch {
			existingSha = null;
		}

		if (params.isNew && !params.sha && existingSha) {
			throw new StudioApiError(
				`「${valid.slug}.md」は既に存在します。上書きを防ぐため既存記事を開くか別スラッグを指定してください。`,
				409,
				'ALREADY_EXISTS'
			);
		}

		if (params.sha && existingSha && params.sha !== existingSha) {
			throw new StudioApiError(
				'他のタブまたは端末で更新されています。再読み込みしてから保存してください。',
				409,
				'CONFLICT'
			);
		}

		let markdownToSave = '';
		if (typeof params.rawMarkdown === 'string') {
			const parsed = parseJournalMarkdown(params.rawMarkdown, valid.slug);
			const serialized = serializeJournalMarkdown(parsed.frontmatter, parsed.body, {
				allowAutoTitle: true,
				extraLines: parsed.extraLines,
			});
			if (!serialized.ok) {
				throw new StudioApiError(
					serialized.errors.join(' '),
					400,
					'VALIDATION_ERROR'
				);
			}
			markdownToSave = serialized.markdown;
		} else {
			const serialized = serializeJournalMarkdown(
				params.frontmatter || {},
				params.content || '',
				{
					allowAutoTitle: false,
					extraLines: params.extraLines,
				}
			);
			if (!serialized.ok) {
				throw new StudioApiError(
					serialized.errors.join(' '),
					400,
					'VALIDATION_ERROR'
				);
			}
			markdownToSave = serialized.markdown;
		}

		const outBuf = Buffer.from(markdownToSave, 'utf8');
		await fs.writeFile(fullPath, outBuf);
		const newSha = computeGitBlobSha(outBuf);

		return {
			ok: true,
			slug: valid.slug,
			path: `src/content/blog/${valid.slug}.md`,
			sha: newSha,
			commitSha: 'local-dev',
		};
	}

	async deleteEntry(params: { slug: string; sha: string }) {
		const valid = validateSlug(params.slug);
		if (!valid.ok) {
			throw new StudioApiError(valid.error, 400, 'INVALID_SLUG');
		}
		if (!params.sha) {
			throw new StudioApiError('SHAが指定されていません。', 400, 'MISSING_SHA');
		}

		const fullPath = path.join(this.blogDir, `${valid.slug}.md`);
		let existingBuf: Buffer;
		try {
			existingBuf = await fs.readFile(fullPath);
		} catch {
			throw new StudioApiError(
				`削除対象「${valid.slug}.md」が見つかりません。`,
				404,
				'NOT_FOUND'
			);
		}

		const existingSha = computeGitBlobSha(existingBuf);
		if (existingSha !== params.sha) {
			throw new StudioApiError(
				'削除前にファイルが変更されました。最新状態を確認してください。',
				409,
				'CONFLICT'
			);
		}

		await fs.unlink(fullPath);
		return {
			ok: true,
			deletedSlug: valid.slug,
			commitSha: 'local-dev',
		};
	}

	async uploadImage(params: { filename: string; base64Data: string; now?: Date }) {
		const cleanB64 = params.base64Data
			.replace(/^data:[^;]+;base64,/, '')
			.replace(/\s+/g, '');
		if (!cleanB64) {
			throw new StudioApiError('画像データが空です。', 400, 'EMPTY_IMAGE');
		}
		if (cleanB64.length > 8_400_000) {
			throw new StudioApiError('画像サイズが大きすぎます（上限 6MB）。', 413, 'IMAGE_TOO_LARGE');
		}

		const { repoPath, publicUrl } = buildUploadAssetPath(params.filename, params.now);
		const fullAssetPath = path.join(this.rootDir, repoPath);
		await fs.mkdir(path.dirname(fullAssetPath), { recursive: true });
		const bytes = base64ToBytes(cleanB64);
		await fs.writeFile(fullAssetPath, bytes);

		return {
			ok: true,
			path: repoPath,
			publicUrl,
			sha: computeGitBlobSha(bytes),
			commitSha: 'local-dev',
		};
	}
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
	res.statusCode = status;
	res.setHeader('Content-Type', 'application/json; charset=utf-8');
	res.setHeader('Cache-Control', 'no-store');
	res.end(JSON.stringify(payload));
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
}

/** Vite dev server plugin mounting `/api/studio` backed by local filesystem during `astro dev`. */
export function createStudioLocalVitePlugin(rootDir: string) {
	const store = new LocalFsJournalStore(rootDir);

	return {
		name: 'saikattyo-studio-local-fs',
		configureServer(server: {
			middlewares: {
				use: (
					fn: (
						req: IncomingMessage,
						res: ServerResponse,
						next: () => void
					) => void
				) => void;
			};
		}) {
			server.middlewares.use(async (req, res, next) => {
				if (!req.url || !req.url.startsWith('/api/studio')) {
					next();
					return;
				}

				const parsedUrl = new URL(req.url, 'http://localhost');
				const action = parsedUrl.searchParams.get('action') || '';

				try {
					if (req.method === 'GET' && action === 'capabilities') {
						sendJson(res, 200, {
							mode: 'local-fs',
							passphraseConfigured: false,
							owner: 'saikattyo',
							repo: 'saikatty-site',
							branch: 'local',
						});
						return;
					}

					if (req.method === 'GET' && action === 'verify') {
						sendJson(res, 200, {
							ok: true,
							fullName: 'local/workspace',
							canPush: true,
						});
						return;
					}

					if (req.method === 'GET' && action === 'list') {
						const entries = await store.listEntries();
						sendJson(res, 200, { entries });
						return;
					}

					if (req.method === 'GET' && action === 'get') {
						const slug = parsedUrl.searchParams.get('slug') || '';
						const entry = await store.getEntry(slug);
						sendJson(res, 200, { entry });
						return;
					}

					if (req.method === 'GET' && action === 'deploy-status') {
						sendJson(res, 200, {
							state: 'completed',
							conclusion: 'success',
							detailsUrl: null,
							commitSha: 'local',
							commitMessage: 'Local filesystem live reload active',
						});
						return;
					}

					if (req.method === 'POST') {
						const raw = await readBody(req);
						const body = raw ? JSON.parse(raw) : {};

						if (action === 'save') {
							const saved = await store.saveEntry(body);
							sendJson(res, 200, saved);
							return;
						}
						if (action === 'delete') {
							const deleted = await store.deleteEntry(body);
							sendJson(res, 200, deleted);
							return;
						}
						if (action === 'upload-image') {
							const uploaded = await store.uploadImage(body);
							sendJson(res, 200, uploaded);
							return;
						}
					}

					sendJson(res, 400, { error: 'Unknown studio action', code: 'BAD_ACTION' });
				} catch (err) {
					if (err instanceof StudioApiError) {
						sendJson(res, err.status, { error: err.message, code: err.code });
						return;
					}
					const msg = err instanceof Error ? err.message : 'Internal error';
					sendJson(res, 500, { error: msg, code: 'INTERNAL_ERROR' });
				}
			});
		},
	};
}
