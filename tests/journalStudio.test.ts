import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	base64ToBytes,
	base64ToUtf8,
	bytesToBase64,
	extractDescriptionFromMarkdown,
	formatJstDate,
	formatJstTime,
	isValidCalendarDate,
	parseJournalMarkdown,
	resolveDailyNoteSlug,
	sanitizeSlug,
	serializeJournalMarkdown,
	utf8ToBase64,
	validateSlug,
} from '../src/lib/journalCodec';
import { LocalFsJournalStore } from '../src/lib/studioLocalFs';
import { handleStudioApiRequest, type StudioEnv } from '../functions/api/studio';

describe('journalCodec — JST dates, slugs, and UTF-8 Base64', () => {
	it('computes Asia/Tokyo (UTC+9) date & time accurately across UTC midnight', () => {
		// 2026-11-14 16:05 UTC == 2026-11-15 01:05 JST
		const utcLate = new Date('2026-11-14T16:05:00.000Z');
		expect(formatJstDate(utcLate)).toBe('2026-11-15');
		expect(formatJstTime(utcLate)).toBe('01:05');
	});

	it('validates calendar dates strictly (rejecting Feb 30, etc.)', () => {
		expect(isValidCalendarDate('2026-11-15')).toBe(true);
		expect(isValidCalendarDate('2024-02-29')).toBe(true);
		expect(isValidCalendarDate('2026-02-29')).toBe(false);
		expect(isValidCalendarDate('2026-13-01')).toBe(false);
	});

	it('sanitizes slugs and blocks path traversal attempts', () => {
		expect(sanitizeSlug('2026-11-15.md')).toBe('2026-11-15');
		expect(sanitizeSlug('  My Daily Note!!  ')).toBe('my-daily-note');
		expect(validateSlug('../secret')).toEqual({
			ok: false,
			error: expect.stringContaining('..'),
		});
		expect(validateSlug('nested/slug')).toEqual({
			ok: false,
			error: expect.stringContaining('スラッシュ'),
		});
		expect(validateSlug('2026-11-15')).toEqual({
			ok: true,
			slug: '2026-11-15',
		});
	});

	it('resolves daily note slug without colliding with existing entries', () => {
		const now = new Date('2026-11-15T03:00:00.000Z');
		const first = resolveDailyNoteSlug(['1', '8'], now);
		expect(first.existsToday).toBe(false);
		expect(first.todaySlug).toBe('2026-11-15');
		expect(first.nextFreeSlug).toBe('2026-11-15');

		const second = resolveDailyNoteSlug(['2026-11-15', '2026-11-15-2'], now);
		expect(second.existsToday).toBe(true);
		expect(second.todaySlug).toBe('2026-11-15');
		expect(second.nextFreeSlug).toBe('2026-11-15-3');
	});

	it('roundtrips Japanese kanji, emojis, and >100KB binary buffers through Base64', () => {
		const text = '仙台の研究室にて 🧪 ナノ粒子とエネルギーの実験日誌\n---\nおわり。';
		expect(base64ToUtf8(utf8ToBase64(text))).toBe(text);

		const big = new Uint8Array(120_000);
		for (let i = 0; i < big.length; i++) big[i] = i % 251;
		const decoded = base64ToBytes(bytesToBase64(big));
		expect(decoded.byteLength).toBe(big.byteLength);
		expect(decoded[99_999]).toBe(big[99_999]);
	});
});

describe('journalCodec — YAML Frontmatter & Obsidian Markdown compatibility', () => {
	it('parses all existing repository blog posts (1.md .. 8.md) cleanly', async () => {
		const blogDir = path.resolve('src/content/blog');
		const files = (await fs.readdir(blogDir)).filter((f) => f.endsWith('.md'));
		expect(files.length).toBeGreaterThanOrEqual(8);

		for (const file of files) {
			const raw = await fs.readFile(path.join(blogDir, file), 'utf8');
			const slug = file.replace(/\.md$/, '');
			const parsed = parseJournalMarkdown(raw, slug);
			expect(parsed.hadFrontmatter).toBe(true);
			expect(parsed.frontmatter.title.length).toBeGreaterThan(0);
			expect(parsed.frontmatter.description.length).toBeGreaterThan(0);
			expect(isValidCalendarDate(parsed.frontmatter.pubDate)).toBe(true);
			expect(parsed.body.trim().length).toBeGreaterThan(0);
		}
	});

	it('safely escapes tricky YAML characters (colons, quotes, hashes, reserved words)', () => {
		const trickyTitle = `Cursor: "最高"の'日誌'環境 #1 — yes`;
		const trickyDesc = `コロン: 引用符 " ' と #タグ を含む要約`;
		const body = `### 今日やったこと\n- [x] エディタ設計\n- [ ] スマホ実機テスト\n`;

		const res = serializeJournalMarkdown(
			{
				title: trickyTitle,
				description: trickyDesc,
				pubDate: '2026-11-15',
				published: false,
				tags: ['#daily', 'obsidian', 'daily'],
			},
			body
		);

		expect(res.ok).toBe(true);
		const reparsed = parseJournalMarkdown(res.markdown, '2026-11-15');
		expect(reparsed.frontmatter.title).toBe(trickyTitle);
		expect(reparsed.frontmatter.description).toBe(trickyDesc);
		expect(reparsed.frontmatter.published).toBe(false);
		expect(reparsed.frontmatter.tags).toEqual(['daily', 'obsidian']);
		expect(reparsed.body.trim()).toBe(body.trim());
	});

	it('imports raw frontmatter-less Obsidian notes with H1 & WikiLinks seamlessly', () => {
		const rawObsidian = `# 2026-11-15 仙台ラボ移動メモ\n\n> 新幹線の中で書いている。\n\n今日は [[NanoFrontier|ナノフロンティア]] の量産製造室について整理した。`;
		const parsed = parseJournalMarkdown(rawObsidian, '2026-11-15');

		expect(parsed.hadFrontmatter).toBe(false);
		expect(parsed.frontmatter.title).toBe('2026-11-15 仙台ラボ移動メモ');
		expect(parsed.frontmatter.pubDate).toBe('2026-11-15');
		expect(parsed.frontmatter.description).toContain('新幹線の中で書いている。');
		expect(extractDescriptionFromMarkdown(parsed.body)).toContain('ナノフロンティア');
	});

	it('rejects empty body or invalid dates with clear Japanese messages', () => {
		const bad = serializeJournalMarkdown(
			{ title: '', pubDate: '2026-02-31' },
			'   '
		);
		expect(bad.ok).toBe(false);
		expect(bad.errors.length).toBe(3);
	});
});

describe('LocalFsJournalStore — CRUD, image upload, and SHA conflict protection', () => {
	it('creates, lists, updates, detects SHA conflicts, uploads images, and deletes', async () => {
		const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'saikattyo-studio-test-'));
		try {
			const store = new LocalFsJournalStore(tmpRoot);

			// 1. Create published entry
			const created = await store.saveEntry({
				slug: '2026-11-15',
				frontmatter: {
					title: '2026-11-15 日誌',
					pubDate: '2026-11-15',
					published: true,
					tags: ['daily'],
				},
				content: '最初の日誌エントリをテスト作成。',
				isNew: true,
			});
			expect(created.ok).toBe(true);
			expect(created.sha).toMatch(/^[0-9a-f]{40}$/);

			// 2. Block duplicate create when isNew=true without sha
			await expect(
				store.saveEntry({
					slug: '2026-11-15',
					frontmatter: { title: '重複', pubDate: '2026-11-15', published: true },
					content: '上書き禁止テスト',
					isNew: true,
				})
			).rejects.toMatchObject({ status: 409, code: 'ALREADY_EXISTS' });

			// 3. Create a draft entry and verify list order
			await store.saveEntry({
				slug: '2026-11-16-draft',
				frontmatter: {
					title: '下書きメモ',
					pubDate: '2026-11-16',
					published: false,
				},
				content: 'まだ公開しない下書き。',
				isNew: true,
			});

			const listed = await store.listEntries();
			expect(listed).toHaveLength(2);
			expect(listed[0].slug).toBe('2026-11-16-draft');
			expect(listed[0].frontmatter.published).toBe(false);

			// 4. Update with matching SHA succeeds; stale SHA throws 409 CONFLICT
			const updated = await store.saveEntry({
				slug: '2026-11-15',
				frontmatter: {
					title: '2026-11-15 日誌（追記）',
					pubDate: '2026-11-15',
					published: true,
				},
				content: '追記した本文。',
				sha: created.sha,
			});
			expect(updated.sha).not.toBe(created.sha);

			await expect(
				store.saveEntry({
					slug: '2026-11-15',
					frontmatter: { title: '古いSHA', pubDate: '2026-11-15', published: true },
					content: '競合エラーになるべき更新',
					sha: created.sha, // stale!
				})
			).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });

			// 5. Image upload writes binary file to public/uploads/YYYY/MM/...
			const tinyWebp = bytesToBase64(new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]));
			const uploaded = await store.uploadImage({
				filename: 'Sendai Lab Photo!.webp',
				base64Data: `data:image/webp;base64,${tinyWebp}`,
				now: new Date('2026-11-15T02:00:00Z'),
			});
			expect(uploaded.publicUrl).toMatch(/^\/uploads\/2026\/11\/.*sendai-lab-photo\.webp$/);
			const savedImg = await fs.readFile(path.join(tmpRoot, uploaded.path));
			expect(savedImg.byteLength).toBe(8);

			// 6. Delete with stale SHA fails; delete with current SHA succeeds
			await expect(
				store.deleteEntry({ slug: '2026-11-15', sha: created.sha })
			).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });

			const delRes = await store.deleteEntry({
				slug: '2026-11-15',
				sha: updated.sha,
			});
			expect(delRes.deletedSlug).toBe('2026-11-15');
			expect(await store.listEntries()).toHaveLength(1);
		} finally {
			await fs.rm(tmpRoot, { recursive: true, force: true });
		}
	});
});

describe('Cloudflare Pages Function /api/studio — Auth & GitHub REST proxy', () => {
	const mockEnv: StudioEnv = {
		GITHUB_TOKEN: 'ghp_secret_server_token',
		STUDIO_PASSPHRASE: 'correct-horse-battery',
		GITHUB_OWNER: 'saikattyo',
		GITHUB_REPO: 'saikatty-site',
		GITHUB_BRANCH: 'main',
	};

	it('exposes capabilities safely without leaking secrets and enforces constant-time passphrase auth', async () => {
		const capRes = await handleStudioApiRequest(
			new Request('https://saikattyo.com/api/studio?action=capabilities'),
			mockEnv
		);
		expect(capRes.status).toBe(200);
		const capBody = await capRes.json();
		expect(capBody).toEqual({
			mode: 'cloudflare',
			passphraseConfigured: true,
			owner: 'saikattyo',
			repo: 'saikatty-site',
			branch: 'main',
		});
		expect(JSON.stringify(capBody)).not.toContain('ghp_secret');
		expect(JSON.stringify(capBody)).not.toContain('correct-horse');

		// Missing auth -> 401
		const noAuth = await handleStudioApiRequest(
			new Request('https://saikattyo.com/api/studio?action=verify'),
			mockEnv
		);
		expect(noAuth.status).toBe(401);

		// Wrong passphrase -> 401
		const badPass = await handleStudioApiRequest(
			new Request('https://saikattyo.com/api/studio?action=verify', {
				headers: { 'x-studio-passphrase': 'wrong-password' },
			}),
			mockEnv
		);
		expect(badPass.status).toBe(401);
	});

	it('saves and deletes entries via mocked GitHub Contents API when passphrase matches', async () => {
		const calls: Array<{ url: string; method: string }> = [];
		const mockFetch: typeof fetch = async (input, init) => {
			const url = String(input);
			const method = init?.method || 'GET';
			calls.push({ url, method });

			if (method === 'GET' && url.includes('/contents/src/content/blog/2026-11-15.md')) {
				return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
			}
			if (method === 'PUT' && url.includes('/contents/src/content/blog/2026-11-15.md')) {
				const body = JSON.parse(String(init?.body));
				const md = base64ToUtf8(body.content);
				expect(md).toContain('title: "2026-11-15 日誌"');
				return new Response(
					JSON.stringify({
						content: { path: 'src/content/blog/2026-11-15.md', sha: 'abc123sha' },
						commit: { sha: 'commit999' },
					}),
					{ status: 201 }
				);
			}
			if (method === 'DELETE' && url.includes('/contents/src/content/blog/2026-11-15.md')) {
				return new Response(
					JSON.stringify({ commit: { sha: 'delcommit888' } }),
					{ status: 200 }
				);
			}
			return new Response(JSON.stringify({ full_name: 'saikattyo/saikatty-site', permissions: { push: true } }), {
				status: 200,
			});
		};

		const saveRes = await handleStudioApiRequest(
			new Request('https://saikattyo.com/api/studio?action=save', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-studio-passphrase': 'correct-horse-battery',
				},
				body: JSON.stringify({
					slug: '2026-11-15',
					frontmatter: {
						title: '2026-11-15 日誌',
						pubDate: '2026-11-15',
						published: true,
					},
					content: 'スマホから日誌を投稿テスト。',
					isNew: true,
				}),
			}),
			mockEnv,
			mockFetch
		);
		expect(saveRes.status).toBe(200);
		const savedJson = await saveRes.json();
		expect(savedJson.sha).toBe('abc123sha');

		const delRes = await handleStudioApiRequest(
			new Request('https://saikattyo.com/api/studio?action=delete', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-studio-passphrase': 'correct-horse-battery',
				},
				body: JSON.stringify({
					slug: '2026-11-15',
					sha: 'abc123sha',
				}),
			}),
			mockEnv,
			mockFetch
		);
		expect(delRes.status).toBe(200);
		expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
	});
});
