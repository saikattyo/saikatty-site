export interface JournalFrontmatter {
	title: string;
	description: string;
	pubDate: string; // YYYY-MM-DD
	updatedDate?: string; // YYYY-MM-DD
	heroImage?: string;
	published: boolean;
	tags?: string[];
}

export interface ParsedJournalDocument {
	frontmatter: JournalFrontmatter;
	body: string;
	extraLines: string[];
	hadFrontmatter: boolean;
}

export interface SerializeJournalOptions {
	allowAutoTitle?: boolean;
	extraLines?: string[];
}

const SLUG_REGEX = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Format a Date into `YYYY-MM-DD` in `Asia/Tokyo` (UTC+9). */
export function formatJstDate(date: Date = new Date()): string {
	const jstMs = date.getTime() + 9 * 60 * 60 * 1000;
	const jst = new Date(jstMs);
	const yyyy = jst.getUTCFullYear();
	const mm = String(jst.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(jst.getUTCDate()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

/** Format current JST `HH:MM` for quick timestamp insertion in daily logs. */
export function formatJstTime(date: Date = new Date()): string {
	const jstMs = date.getTime() + 9 * 60 * 60 * 1000;
	const jst = new Date(jstMs);
	const hh = String(jst.getUTCHours()).padStart(2, '0');
	const min = String(jst.getUTCMinutes()).padStart(2, '0');
	return `${hh}:${min}`;
}

export function isValidCalendarDate(dateStr: string): boolean {
	if (!DATE_REGEX.test(dateStr)) return false;
	const [y, m, d] = dateStr.split('-').map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d));
	return (
		dt.getUTCFullYear() === y &&
		dt.getUTCMonth() === m - 1 &&
		dt.getUTCDate() === d
	);
}

/** Normalize user-entered filename/slug into a safe URL & Git filename slug. */
export function sanitizeSlug(raw: string): string {
	return raw
		.trim()
		.replace(/\.(md|mdx)$/i, '')
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '-')
		.replace(/-{2,}/g, '-')
		.replace(/^[-_]+|[-_]+$/g, '')
		.slice(0, 80);
}

export function validateSlug(
	raw: string
): { ok: true; slug: string } | { ok: false; error: string } {
	const cleaned = raw.trim().replace(/\.(md|mdx)$/i, '');
	if (!cleaned) {
		return { ok: false, error: 'スラッグ（ファイル名）を入力してください。' };
	}
	if (cleaned.includes('..') || cleaned.includes('/') || cleaned.includes('\\')) {
		return { ok: false, error: 'スラッグにスラッシュや「..」は使用できません。' };
	}
	if (!SLUG_REGEX.test(cleaned)) {
		return {
			ok: false,
			error: 'スラッグは半角英小文字・数字・ハイフン(-)・アンダースコア(_)のみ使用できます。',
		};
	}
	return { ok: true, slug: cleaned };
}

/** Determine today's daily journal slug and next available suffix if needed. */
export function resolveDailyNoteSlug(
	existingSlugs: Iterable<string>,
	now: Date = new Date()
): {
	todaySlug: string;
	nextFreeSlug: string;
	dateStr: string;
	existsToday: boolean;
} {
	const dateStr = formatJstDate(now);
	const set = new Set(existingSlugs);
	const existsToday = set.has(dateStr);
	let nextFreeSlug = dateStr;
	if (existsToday) {
		let suffix = 2;
		while (set.has(`${dateStr}-${suffix}`)) {
			suffix += 1;
		}
		nextFreeSlug = `${dateStr}-${suffix}`;
	}
	return {
		todaySlug: dateStr,
		nextFreeSlug,
		dateStr,
		existsToday,
	};
}

/** Extract a clean plain-text summary from Markdown body when description is omitted. */
export function extractDescriptionFromMarkdown(body: string, maxLen = 95): string {
	const withoutFences = body
		.replace(/\r\n/g, '\n')
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/~~~[\s\S]*?~~~/g, ' ');

	const lines = withoutFences.split('\n');
	const meaningful: string[] = [];

	for (const rawLine of lines) {
		const trimmed = rawLine.trim();
		if (!trimmed) continue;
		if (/^---+$|^\*\*\*+$|^___+$/.test(trimmed)) continue;
		if (/^!\[[^\]]*\]\([^)]*\)$/.test(trimmed)) continue;

		const plain = trimmed
			.replace(/^#{1,6}\s+/, '')
			.replace(/^>\s*/, '')
			.replace(/^[-*+]\s+\[[ xX]\]\s+/, '')
			.replace(/^[-*+]\s+/, '')
			.replace(/^\d+\.\s+/, '')
			.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
			.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
			.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias || target)
			.replace(/`([^`]+)`/g, '$1')
			.replace(/(\*\*|__)(.*?)\1/g, '$2')
			.replace(/(\*|_)(.*?)\1/g, '$2')
			.replace(/~~(.*?)~~/g, '$1')
			.replace(/<[^>]+>/g, '')
			.replace(/\s+/g, ' ')
			.trim();

		if (plain) {
			meaningful.push(plain);
			if (meaningful.join(' ').length >= maxLen) break;
		}
	}

	const combined = meaningful.join(' ').trim();
	if (!combined) return '日々の思考を書き留めた日誌。';
	if (combined.length <= maxLen) return combined;
	return `${combined.slice(0, maxLen - 1).trimEnd()}…`;
}

function unquoteYamlScalar(raw: string): string {
	const val = raw.trim();
	if (val.length >= 2 && val.startsWith("'") && val.endsWith("'")) {
		return val.slice(1, -1).replace(/''/g, "'");
	}
	if (val.length >= 2 && val.startsWith('"') && val.endsWith('"')) {
		try {
			return JSON.parse(val);
		} catch {
			return val.slice(1, -1);
		}
	}
	return val;
}

function normalizeDateString(raw: string, fallback: string): string {
	const cleaned = unquoteYamlScalar(raw);
	if (isValidCalendarDate(cleaned)) return cleaned;
	const parsed = new Date(cleaned);
	if (!Number.isNaN(parsed.getTime())) {
		const yyyy = parsed.getUTCFullYear();
		const mm = String(parsed.getUTCMonth() + 1).padStart(2, '0');
		const dd = String(parsed.getUTCDate()).padStart(2, '0');
		const candidate = `${yyyy}-${mm}-${dd}`;
		if (isValidCalendarDate(candidate)) return candidate;
	}
	return fallback;
}

function parseInlineTags(raw: string): string[] {
	const trimmed = raw.trim();
	if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return [];
	const inner = trimmed.slice(1, -1).trim();
	if (!inner) return [];
	return inner
		.split(',')
		.map((part) => unquoteYamlScalar(part))
		.map((t) => t.replace(/^#/, '').trim())
		.filter(Boolean);
}

/**
 * Parse a Markdown file (with or without YAML frontmatter, including raw Obsidian notes)
 * into structured metadata and Markdown body.
 */
export function parseJournalMarkdown(
	rawMarkdown: string,
	fallbackSlug = '',
	now: Date = new Date()
): ParsedJournalDocument {
	const normalized = rawMarkdown.replace(/\r\n/g, '\n');
	const slugDateMatch = fallbackSlug.match(/^(\d{4}-\d{2}-\d{2})/);
	const defaultDate =
		slugDateMatch && isValidCalendarDate(slugDateMatch[1])
			? slugDateMatch[1]
			: formatJstDate(now);

	const fmMatch = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);

	if (!fmMatch) {
		// Raw Obsidian note without frontmatter: lift leading `# Heading` if present
		let body = normalized.replace(/^\n+/, '');
		let inferredTitle = fallbackSlug ? `${fallbackSlug}` : `${defaultDate} 日誌`;
		const h1Match = body.match(/^#\s+(.+)\n+/);
		if (h1Match) {
			inferredTitle = h1Match[1].trim();
			body = body.slice(h1Match[0].length);
		}
		return {
			frontmatter: {
				title: inferredTitle,
				description: extractDescriptionFromMarkdown(body),
				pubDate: defaultDate,
				published: true,
			},
			body,
			extraLines: [],
			hadFrontmatter: false,
		};
	}

	const fmBlock = fmMatch[1];
	const body = fmMatch[2];
	const lines = fmBlock.split('\n');

	let title = '';
	let description = '';
	let pubDate = defaultDate;
	let updatedDate: string | undefined;
	let heroImage: string | undefined;
	let published = true;
	const tags: string[] = [];
	const extraLines: string[] = [];

	let inTagsBlock = false;

	for (const line of lines) {
		if (inTagsBlock) {
			const listItem = line.match(/^\s*-\s+(.+)$/);
			if (listItem) {
				const tagVal = unquoteYamlScalar(listItem[1]).replace(/^#/, '').trim();
				if (tagVal) tags.push(tagVal);
				continue;
			}
			inTagsBlock = false;
		}

		const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
		if (!kv) {
			if (line.trim()) extraLines.push(line);
			continue;
		}

		const [, key, rawVal] = kv;
		switch (key) {
			case 'title':
				title = unquoteYamlScalar(rawVal);
				break;
			case 'description':
				description = unquoteYamlScalar(rawVal);
				break;
			case 'pubDate':
				pubDate = normalizeDateString(rawVal, defaultDate);
				break;
			case 'updatedDate': {
				const u = normalizeDateString(rawVal, '');
				if (u) updatedDate = u;
				break;
			}
			case 'heroImage': {
				const h = unquoteYamlScalar(rawVal);
				if (h) heroImage = h;
				break;
			}
			case 'published': {
				const b = unquoteYamlScalar(rawVal).toLowerCase();
				published = b !== 'false' && b !== '0' && b !== 'no';
				break;
			}
			case 'tags': {
				if (!rawVal.trim()) {
					inTagsBlock = true;
				} else {
					tags.push(...parseInlineTags(rawVal));
				}
				break;
			}
			default:
				extraLines.push(line);
		}
	}

	return {
		frontmatter: {
			title: title || (fallbackSlug ? fallbackSlug : `${pubDate} 日誌`),
			description: description || extractDescriptionFromMarkdown(body),
			pubDate,
			updatedDate,
			heroImage,
			published,
			tags: tags.length > 0 ? tags : undefined,
		},
		body,
		extraLines,
		hadFrontmatter: true,
	};
}

/**
 * Validate and serialize a journal entry into Astro-verified Markdown with safe YAML quoting.
 */
export function serializeJournalMarkdown(
	frontmatter: Partial<JournalFrontmatter>,
	body: string,
	options: SerializeJournalOptions = {}
): {
	ok: boolean;
	markdown: string;
	normalized: JournalFrontmatter;
	errors: string[];
} {
	const errors: string[] = [];
	const pubDate = (frontmatter.pubDate || '').trim() || formatJstDate();
	if (!isValidCalendarDate(pubDate)) {
		errors.push('公開日（pubDate）は YYYY-MM-DD 形式の正しい日付で指定してください。');
	}

	let title = (frontmatter.title || '').trim();
	if (!title && options.allowAutoTitle) {
		title = `${pubDate} 日誌`;
	}
	if (!title) {
		errors.push('タイトルを入力してください。');
	}

	const cleanBody = body.replace(/\r\n/g, '\n');
	if (!cleanBody.trim()) {
		errors.push('本文が空です。1文字以上入力してください。');
	}

	const description =
		(frontmatter.description || '').trim() || extractDescriptionFromMarkdown(cleanBody);

	let updatedDate = frontmatter.updatedDate?.trim() || undefined;
	if (updatedDate && !isValidCalendarDate(updatedDate)) {
		errors.push('更新日（updatedDate）は YYYY-MM-DD 形式で指定してください。');
		updatedDate = undefined;
	}

	const heroImage = frontmatter.heroImage?.trim() || undefined;
	if (heroImage && !/^(https?:\/\/|\/)/.test(heroImage)) {
		errors.push('heroImage は「/」始まりのパスまたは https:// URL で指定してください。');
	}

	const published = frontmatter.published !== false;
	const cleanTags = Array.from(
		new Set(
			(frontmatter.tags || [])
				.map((t) => t.replace(/^#/, '').trim())
				.filter(Boolean)
		)
	);

	const normalized: JournalFrontmatter = {
		title,
		description,
		pubDate,
		...(updatedDate ? { updatedDate } : {}),
		...(heroImage ? { heroImage } : {}),
		published,
		...(cleanTags.length > 0 ? { tags: cleanTags } : {}),
	};

	const fmLines = [
		'---',
		`title: ${JSON.stringify(normalized.title)}`,
		`description: ${JSON.stringify(normalized.description)}`,
		`pubDate: ${JSON.stringify(normalized.pubDate)}`,
	];

	if (normalized.updatedDate) {
		fmLines.push(`updatedDate: ${JSON.stringify(normalized.updatedDate)}`);
	}
	if (normalized.heroImage) {
		fmLines.push(`heroImage: ${JSON.stringify(normalized.heroImage)}`);
	}
	fmLines.push(`published: ${normalized.published ? 'true' : 'false'}`);
	if (normalized.tags && normalized.tags.length > 0) {
		fmLines.push(`tags: [${normalized.tags.map((t) => JSON.stringify(t)).join(', ')}]`);
	}
	if (options.extraLines && options.extraLines.length > 0) {
		fmLines.push(...options.extraLines);
	}
	fmLines.push('---');

	const bodyTrimmedStart = cleanBody.replace(/^\n/, '');
	const bodyWithTrailingNewline = bodyTrimmedStart.endsWith('\n')
		? bodyTrimmedStart
		: `${bodyTrimmedStart}\n`;

	const markdown = `${fmLines.join('\n')}\n\n${bodyWithTrailingNewline}`;

	return {
		ok: errors.length === 0,
		markdown,
		normalized,
		errors,
	};
}

/** Chunk-safe binary Uint8Array -> Base64 (works in Browser, Workers, and Node). */
export function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const slice = bytes.subarray(i, i + chunkSize);
		binary += String.fromCharCode(...slice);
	}
	return btoa(binary);
}

/** Base64 (ignoring whitespace/newlines from GitHub API) -> Uint8Array. */
export function base64ToBytes(base64: string): Uint8Array {
	const cleaned = base64.replace(/\s+/g, '');
	const binary = atob(cleaned);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

export function utf8ToBase64(text: string): string {
	return bytesToBase64(new TextEncoder().encode(text));
}

export function base64ToUtf8(base64: string): string {
	return new TextDecoder('utf-8').decode(base64ToBytes(base64));
}
