import {
	EditorView,
	keymap,
	placeholder as cmPlaceholder,
	drawSelection,
	highlightActiveLine,
} from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import {
	defaultKeymap,
	history,
	historyKeymap,
	indentWithTab,
	redo,
	undo,
} from '@codemirror/commands';
import {
	markdown,
	markdownLanguage,
	insertNewlineContinueMarkup,
} from '@codemirror/lang-markdown';
import {
	syntaxHighlighting,
	HighlightStyle,
	bracketMatching,
} from '@codemirror/language';
import {
	autocompletion,
	closeBrackets,
	closeBracketsKeymap,
	type CompletionContext,
	type CompletionResult,
} from '@codemirror/autocomplete';
import { searchKeymap } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import { formatJstDate, formatJstTime } from '../lib/journalCodec';

export interface ObsidianEditorCallbacks {
	onChange: (doc: string) => void;
	onSaveShortcut: () => void;
	onTogglePreviewShortcut: () => void;
	onPasteOrDropFiles: (files: File[]) => void;
	onFocusChange?: (focused: boolean) => void;
}

const obsidianHighlightStyle = HighlightStyle.define([
	{
		tag: tags.heading1,
		color: '#ffffff',
		fontWeight: '800',
		fontSize: '1.5em',
	},
	{
		tag: tags.heading2,
		color: '#f8fafc',
		fontWeight: '700',
		fontSize: '1.28em',
	},
	{
		tag: tags.heading3,
		color: '#e2e8f0',
		fontWeight: '700',
		fontSize: '1.12em',
	},
	{
		tag: [tags.heading4, tags.heading5, tags.heading6],
		color: '#cbd5e1',
		fontWeight: '700',
	},
	{
		tag: tags.strong,
		color: '#ffffff',
		fontWeight: '700',
	},
	{
		tag: tags.emphasis,
		color: '#e2e8f0',
		fontStyle: 'italic',
	},
	{
		tag: tags.strikethrough,
		color: '#64748b',
		textDecoration: 'line-through',
	},
	{
		tag: [tags.monospace, tags.processingInstruction],
		color: '#7dd3fc',
		fontFamily: 'var(--font-mono)',
	},
	{
		tag: [tags.link, tags.url],
		color: '#38bdf8',
		textDecoration: 'underline',
	},
	{
		tag: tags.quote,
		color: '#94a3b8',
		fontStyle: 'italic',
	},
	{
		tag: [tags.meta, tags.comment, tags.contentSeparator],
		color: '#64748b',
	},
	{
		tag: tags.list,
		color: '#94a3b8',
	},
]);

const obsidianEditorTheme = EditorView.theme(
	{
		'&': {
			backgroundColor: 'transparent',
			color: '#eef2f6',
			fontSize: '16.5px',
			height: 'auto',
			minHeight: '52vh',
		},
		'.cm-scroller': {
			fontFamily: "'Noto Sans JP', 'Atkinson', system-ui, sans-serif",
			lineHeight: '1.92',
			padding: '6px 0 140px',
			overflow: 'visible',
		},
		'.cm-content': {
			caretColor: '#ffffff',
			padding: '4px 0',
			maxWidth: '740px',
			minHeight: '48vh',
		},
		'&.cm-focused': {
			outline: 'none',
		},
		'.cm-line': {
			padding: '2px 0',
		},
		'.cm-activeLine': {
			backgroundColor: 'transparent',
		},
		'&.cm-focused .cm-activeLine': {
			backgroundColor: 'rgba(255, 255, 255, 0.022)',
		},
		'.cm-selectionBackground, ::selection': {
			backgroundColor: 'rgba(56, 189, 248, 0.25) !important',
		},
		'.cm-placeholder': {
			color: '#525866',
		},
		'.cm-tooltip': {
			backgroundColor: '#0b0e14',
			border: '1px solid rgba(255, 255, 255, 0.2)',
			color: '#f8fafc',
			fontFamily: 'var(--font-body)',
		},
		'.cm-tooltip-autocomplete > ul > li[aria-selected]': {
			backgroundColor: '#ffffff',
			color: '#000000',
		},
	},
	{ dark: true }
);

/** Obsidian-style `/` slash commands for fast daily journaling on PC & Smartphone. */
function slashCommandSource(context: CompletionContext): CompletionResult | null {
	const match = context.matchBefore(/(?:^|\s)\/[a-zA-Z0-9]*$/);
	if (!match) return null;

	const slashPos = match.text.lastIndexOf('/');
	const from = match.from + slashPos;

	const now = new Date();
	const todayStr = formatJstDate(now);
	const timeStr = formatJstTime(now);

	return {
		from,
		options: [
			{
				label: '/template',
				detail: '日誌テンプレート',
				apply: `### 今日やったこと\n- \n\n### 気づき・違和感\n- \n\n### 明日やること\n- [ ] `,
			},
			{
				label: '/time',
				detail: `現在時刻 (${timeStr} JST)`,
				apply: `**${timeStr}** `,
			},
			{
				label: '/todo',
				detail: 'チェックリスト (- [ ])',
				apply: '- [ ] ',
			},
			{
				label: '/h2',
				detail: '見出し 2 (##)',
				apply: '## ',
			},
			{
				label: '/h3',
				detail: '見出し 3 (###)',
				apply: '### ',
			},
			{
				label: '/quote',
				detail: '引用 (>)',
				apply: '> ',
			},
			{
				label: '/code',
				detail: 'コードブロック',
				apply: '```\n\n```',
			},
			{
				label: '/hr',
				detail: '区切り線 (---)',
				apply: '\n---\n\n',
			},
			{
				label: '/today',
				detail: `今日の日付 (${todayStr})`,
				apply: todayStr,
			},
		],
	};
}

export function wrapSelectionWith(
	view: EditorView,
	prefix: string,
	suffix = prefix,
	placeholderText = 'テキスト'
): void {
	const { from, to } = view.state.selection.main;
	const selected = view.state.sliceDoc(from, to);
	if (selected) {
		view.dispatch({
			changes: { from, to, insert: `${prefix}${selected}${suffix}` },
			selection: {
				anchor: from + prefix.length,
				head: from + prefix.length + selected.length,
			},
		});
	} else {
		const insert = `${prefix}${placeholderText}${suffix}`;
		view.dispatch({
			changes: { from, to, insert },
			selection: {
				anchor: from + prefix.length,
				head: from + prefix.length + placeholderText.length,
			},
		});
	}
	view.focus();
}

export function toggleLinePrefix(view: EditorView, prefix: string): void {
	const line = view.state.doc.lineAt(view.state.selection.main.head);
	if (line.text.startsWith(prefix)) {
		view.dispatch({
			changes: { from: line.from, to: line.from + prefix.length, insert: '' },
		});
	} else {
		view.dispatch({
			changes: { from: line.from, to: line.from, insert: prefix },
			selection: { anchor: line.to + prefix.length },
		});
	}
	view.focus();
}

export function insertTextAtCursor(view: EditorView, text: string): void {
	const { from, to } = view.state.selection.main;
	view.dispatch({
		changes: { from, to, insert: text },
		selection: { anchor: from + text.length },
	});
	view.focus();
}

export function triggerUndo(view: EditorView): void {
	undo(view);
	view.focus();
}

export function triggerRedo(view: EditorView): void {
	redo(view);
	view.focus();
}

export function replaceTextInDoc(
	view: EditorView,
	search: string,
	replacement: string
): boolean {
	const full = view.state.doc.toString();
	const idx = full.indexOf(search);
	if (idx === -1) return false;
	view.dispatch({
		changes: { from: idx, to: idx + search.length, insert: replacement },
	});
	return true;
}

/** Toggle Markdown `- [ ]` ⇄ `- [x]` when clicking on task marker characters. */
function makeTaskCheckboxClickHandler() {
	return EditorView.domEventHandlers({
		mousedown(event, view) {
			const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
			if (pos === null) return false;
			const line = view.state.doc.lineAt(pos);
			const match = line.text.match(/^(\s*[-*+]\s+\[)([ xX])(\]\s)/);
			if (!match) return false;
			const bracketStart = line.from + match[1].length - 1;
			const bracketEnd = bracketStart + 3;
			if (pos >= line.from && pos <= bracketEnd + 1) {
				const nextChar = match[2] === ' ' ? 'x' : ' ';
				view.dispatch({
					changes: {
						from: line.from + match[1].length,
						to: line.from + match[1].length + 1,
						insert: nextChar,
					},
				});
				event.preventDefault();
				return true;
			}
			return false;
		},
	});
}

export function createObsidianEditor(
	parent: HTMLElement,
	initialDoc: string,
	callbacks: ObsidianEditorCallbacks
): EditorView {
	const state = EditorState.create({
		doc: initialDoc,
		extensions: [
			history(),
			drawSelection(),
			bracketMatching(),
			closeBrackets(),
			highlightActiveLine(),
			EditorView.lineWrapping,
			cmPlaceholder(
				'ここに思考を書き留める…（「/」でコマンド、画像ドラッグ＆ペースト対応）'
			),
			markdown({ base: markdownLanguage }),
			syntaxHighlighting(obsidianHighlightStyle),
			obsidianEditorTheme,
			autocompletion({
				override: [slashCommandSource],
				activateOnTyping: true,
			}),
			makeTaskCheckboxClickHandler(),
			keymap.of([
				{
					key: 'Enter',
					run: insertNewlineContinueMarkup,
				},
				{
					key: 'Mod-s',
					run: () => {
						callbacks.onSaveShortcut();
						return true;
					},
				},
				{
					key: 'Mod-b',
					run: (view) => {
						wrapSelectionWith(view, '**', '**', '太字');
						return true;
					},
				},
				{
					key: 'Mod-i',
					run: (view) => {
						wrapSelectionWith(view, '*', '*', '斜体');
						return true;
					},
				},
				{
					key: 'Mod-k',
					run: (view) => {
						wrapSelectionWith(view, '[', '](https://)', 'リンク名');
						return true;
					},
				},
				{
					key: 'Mod-e',
					run: () => {
						callbacks.onTogglePreviewShortcut();
						return true;
					},
				},
				indentWithTab,
				...closeBracketsKeymap,
				...defaultKeymap,
				...historyKeymap,
				...searchKeymap,
			]),
			EditorView.domEventHandlers({
				paste(event) {
					const items = event.clipboardData?.files;
					if (items && items.length > 0) {
						const files = Array.from(items).filter(
							(f) => f.type.startsWith('image/') || /\.md$/i.test(f.name)
						);
						if (files.length > 0) {
							event.preventDefault();
							callbacks.onPasteOrDropFiles(files);
							return true;
						}
					}
					return false;
				},
				drop(event) {
					const items = event.dataTransfer?.files;
					if (items && items.length > 0) {
						const files = Array.from(items).filter(
							(f) => f.type.startsWith('image/') || /\.(md|mdx)$/i.test(f.name)
						);
						if (files.length > 0) {
							event.preventDefault();
							callbacks.onPasteOrDropFiles(files);
							return true;
						}
					}
					return false;
				},
			}),
			EditorView.updateListener.of((update) => {
				if (update.docChanged) {
					callbacks.onChange(update.state.doc.toString());
				}
				if (update.focusChanged) {
					callbacks.onFocusChange?.(update.view.hasFocus);
				}
			}),
		],
	});

	return new EditorView({
		state,
		parent,
	});
}
