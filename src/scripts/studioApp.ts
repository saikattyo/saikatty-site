import type { EditorView } from '@codemirror/view';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import {
	extractDescriptionFromMarkdown,
	formatJstDate,
	formatJstTime,
	parseJournalMarkdown,
	resolveDailyNoteSlug,
	sanitizeSlug,
	serializeJournalMarkdown,
	validateSlug,
} from '../lib/journalCodec';
import type { StudioEntrySummary } from '../lib/githubRepoCore';
import {
	clearStoredCredentials,
	detectStudioCapabilities,
	loadStoredCredentials,
	saveStoredCredentials,
	StudioClient,
	type StoredCredentials,
	type StudioCapabilities,
} from '../lib/studioClient';
import {
	createObsidianEditor,
	insertTextAtCursor,
	replaceTextInDoc,
	toggleLinePrefix,
	triggerRedo,
	triggerUndo,
	wrapSelectionWith,
} from './obsidianCm';

marked.setOptions({
	gfm: true,
	breaks: true,
});

interface LocalDraftSnapshot {
	slug: string;
	title: string;
	description: string;
	pubDate: string;
	heroImage: string;
	tagsInput: string;
	published: boolean;
	body: string;
	savedAt: number;
	baseSha?: string;
}

const DRAFT_PREFIX = 'saikattyo_studio_draft_v1:';
const VIEW_MODE_KEY = 'saikattyo_studio_view_mode';

function draftKey(slug: string): string {
	return `${DRAFT_PREFIX}${slug || '__untitled__'}`;
}

function readLocalDraft(slug: string): LocalDraftSnapshot | null {
	try {
		const raw = window.localStorage.getItem(draftKey(slug));
		return raw ? (JSON.parse(raw) as LocalDraftSnapshot) : null;
	} catch {
		return null;
	}
}

function writeLocalDraft(draft: LocalDraftSnapshot): void {
	try {
		window.localStorage.setItem(draftKey(draft.slug), JSON.stringify(draft));
	} catch {
		// Ignore storage quota errors
	}
}

function removeLocalDraft(slug: string): void {
	try {
		window.localStorage.removeItem(draftKey(slug));
	} catch {
		// Ignore
	}
}

export async function mountStudioApp(): Promise<void> {
	const $ = <T extends HTMLElement>(sel: string) =>
		document.querySelector<T>(sel)!;

	const shellEl = $<HTMLElement>('[data-studio-shell]');

	// Shell & Auth elements
	const authOverlay = $<HTMLElement>('[data-auth-overlay]');
	const authForm = $<HTMLFormElement>('[data-auth-form]');
	const authModeTabs = Array.from(
		document.querySelectorAll<HTMLButtonElement>('[data-auth-tab]')
	);
	const passphraseField = $<HTMLElement>('[data-field-passphrase]');
	const tokenField = $<HTMLElement>('[data-field-token]');
	const passphraseInput = $<HTMLInputElement>('[data-input-passphrase]');
	const tokenInput = $<HTMLInputElement>('[data-input-token]');
	const repoOwnerInput = $<HTMLInputElement>('[data-input-owner]');
	const repoNameInput = $<HTMLInputElement>('[data-input-repo]');
	const repoBranchInput = $<HTMLInputElement>('[data-input-branch]');
	const authErrorEl = $<HTMLElement>('[data-auth-error]');
	const authSubmitBtn = $<HTMLButtonElement>('[data-auth-submit]');
	const connBadgeEl = $<HTMLElement>('[data-conn-badge]');
	const logoutBtn = $<HTMLButtonElement>('[data-btn-logout]');

	// Sidebar & Sheet Backdrops
	const sidebarEl = $<HTMLElement>('[data-studio-sidebar]');
	const sidebarBackdrop = $<HTMLElement>('[data-sidebar-backdrop]');
	const propsBackdrop = $<HTMLElement>('[data-props-backdrop]');
	const openSidebarBtn = $<HTMLButtonElement>('[data-btn-open-sidebar]');
	const closeSidebarBtn = $<HTMLButtonElement>('[data-btn-close-sidebar]');
	const dailyNoteBtn = $<HTMLButtonElement>('[data-btn-daily]');
	const dailyNoteMobileBtn = $<HTMLButtonElement>('[data-btn-daily-mobile]');
	const newNoteBtn = $<HTMLButtonElement>('[data-btn-new]');
	const importMdBtn = $<HTMLButtonElement>('[data-btn-import-md]');
	const importMdInput = $<HTMLInputElement>('[data-input-import-md]');
	const searchInput = $<HTMLInputElement>('[data-input-search]');
	const filterBtns = Array.from(
		document.querySelectorAll<HTMLButtonElement>('[data-filter]')
	);
	const entryListEl = $<HTMLElement>('[data-entry-list]');
	const entryCountEl = $<HTMLElement>('[data-entry-count]');

	// Editor workspace & Properties Sheet
	const titleInput = $<HTMLTextAreaElement>('[data-input-title]');
	const propsToggleBtn = $<HTMLButtonElement>('[data-btn-toggle-props]');
	const closePropsBtn = $<HTMLButtonElement>('[data-btn-close-props]');
	const mobileMetaBtn = $<HTMLButtonElement>('[data-btn-mobile-meta]');
	const mobileSettingsBtn = $<HTMLButtonElement>('[data-btn-mobile-settings]');
	const mobilePubDot = $<HTMLElement>('[data-mobile-pub-dot]');
	const mobileDateLabel = $<HTMLElement>('[data-mobile-date-label]');
	const mobileSyncLabel = $<HTMLElement>('[data-mobile-sync-label]');
	const pubSegBtns = Array.from(
		document.querySelectorAll<HTMLButtonElement>('[data-btn-set-pub]')
	);

	const propsDrawer = $<HTMLElement>('[data-props-drawer]');
	const slugInput = $<HTMLInputElement>('[data-input-slug]');
	const dateInput = $<HTMLInputElement>('[data-input-date]');
	const descInput = $<HTMLInputElement>('[data-input-desc]');
	const tagsInput = $<HTMLInputElement>('[data-input-tags]');
	const heroInput = $<HTMLInputElement>('[data-input-hero]');
	const uploadHeroBtn = $<HTMLButtonElement>('[data-btn-upload-hero]');
	const publishedToggle = $<HTMLInputElement>('[data-input-published]');
	const publishedLabel = $<HTMLElement>('[data-published-label]');

	const draftBanner = $<HTMLElement>('[data-draft-banner]');
	const restoreDraftBtn = $<HTMLButtonElement>('[data-btn-restore-draft]');
	const discardDraftBtn = $<HTMLButtonElement>('[data-btn-discard-draft]');

	const viewBtns = Array.from(
		document.querySelectorAll<HTMLButtonElement>('[data-view-mode]')
	);
	const mobilePreviewBtn = $<HTMLButtonElement>('[data-btn-mobile-preview]');
	const mobilePreviewLabel = $<HTMLElement>('[data-mobile-preview-label]');

	const workspaceGrid = $<HTMLElement>('[data-workspace-grid]');
	const cmHost = $<HTMLElement>('[data-cm-host]');
	const previewTitleEl = $<HTMLElement>('[data-preview-title]');
	const previewMetaEl = $<HTMLElement>('[data-preview-meta]');
	const previewBodyEl = $<HTMLElement>('[data-preview-body]');

	// Mobile Bottom Bars
	const mobileTabbar = $<HTMLElement>('[data-mobile-tabbar]');
	const mobileKbBar = $<HTMLElement>('[data-mobile-kb-bar]');
	const kbDoneBtn = $<HTMLButtonElement>('[data-btn-kb-done]');

	// Action controls
	const saveBtn = $<HTMLButtonElement>('[data-btn-save]');
	const saveMobileBtn = $<HTMLButtonElement>('[data-btn-save-mobile]');
	const mobileSaveLabel = $<HTMLElement>('[data-mobile-save-label]');
	const deleteOpenBtn = $<HTMLButtonElement>('[data-btn-delete-open]');
	const deleteOpenMobileBtn = $<HTMLButtonElement>('[data-btn-delete-open-mobile]');
	const downloadMdBtn = $<HTMLButtonElement>('[data-btn-download-md]');
	const downloadMdMobileBtn = $<HTMLButtonElement>('[data-btn-download-md-mobile]');
	const openLiveLink = $<HTMLAnchorElement>('[data-link-open-live]');
	const openLiveMobileLink = $<HTMLAnchorElement>('[data-link-open-live-mobile]');
	const imageFileInput = $<HTMLInputElement>('[data-input-image-file]');
	const heroFileInput = $<HTMLInputElement>('[data-input-hero-file]');

	// Status bar & Toast & Delete Modal
	const dirtyStatusEl = $<HTMLElement>('[data-dirty-status]');
	const statsEl = $<HTMLElement>('[data-editor-stats]');
	const deployStatusEl = $<HTMLElement>('[data-deploy-status]');
	const toastEl = $<HTMLElement>('[data-studio-toast]');

	const deleteModal = $<HTMLElement>('[data-delete-modal]');
	const deleteTargetLabel = $<HTMLElement>('[data-delete-target]');
	const deleteBackupBtn = $<HTMLButtonElement>('[data-btn-delete-backup]');
	const deleteCancelBtn = $<HTMLButtonElement>('[data-btn-delete-cancel]');
	const deleteConfirmBtn = $<HTMLButtonElement>('[data-btn-delete-confirm]');

	// Runtime state
	let capabilities: StudioCapabilities;
	let client: StudioClient | null = null;
	let entries: StudioEntrySummary[] = [];
	let activeFilter: 'all' | 'published' | 'draft' = 'all';
	let searchQuery = '';

	let currentSlug = '';
	let currentSha: string | undefined;
	let currentExtraLines: string[] = [];
	let isNewEntry = true;
	let isDirty = false;
	let isSaving = false;
	let suppressEditorEvents = false;
	let cmFocused = false;
	let titleFocused = false;
	let pendingRecoverableDraft: LocalDraftSnapshot | null = null;
	let draftTimer: number | undefined;
	let deployPollTimer: number | undefined;

	let viewMode: 'edit' | 'split' | 'preview' =
		window.innerWidth >= 1040 ? 'split' : 'edit';
	try {
		const savedMode = window.localStorage.getItem(VIEW_MODE_KEY);
		if (
			savedMode === 'edit' ||
			savedMode === 'preview' ||
			(savedMode === 'split' && window.innerWidth >= 860)
		) {
			viewMode = savedMode;
		}
	} catch {
		// Ignore
	}

	// Track iOS Safari visualViewport so Top Bar & Keyboard Accessory Bar never get pushed off-screen
	const syncVisualViewport = () => {
		const vv = window.visualViewport;
		if (!vv) return;
		shellEl.style.height = `${Math.round(vv.height)}px`;
		shellEl.style.transform = `translate3d(0, ${Math.round(vv.offsetTop)}px, 0)`;
		const kbOpen = window.innerHeight - vv.height > 130;
		shellEl.classList.toggle('is-keyboard-open', kbOpen);
		syncMobileBottomBars();
	};

	if (window.visualViewport) {
		window.visualViewport.addEventListener('resize', syncVisualViewport);
		window.visualViewport.addEventListener('scroll', syncVisualViewport);
	}

	const resizeTitleTextarea = () => {
		titleInput.style.height = 'auto';
		titleInput.style.height = `${Math.max(42, titleInput.scrollHeight)}px`;
	};

	const syncMobileBottomBars = () => {
		const isMobileViewport = window.innerWidth <= 860;
		if (!isMobileViewport) {
			mobileKbBar.hidden = true;
			mobileTabbar.hidden = true;
			return;
		}
		mobileTabbar.hidden = false;
		mobileKbBar.hidden = viewMode === 'preview';
		kbDoneBtn.hidden = !(cmFocused || titleFocused);
	};

	window.addEventListener('resize', () => {
		resizeTitleTextarea();
		syncVisualViewport();
		syncMobileBottomBars();
	});

	let toastTimer: number | undefined;
	const showToast = (msg: string, isError = false) => {
		toastEl.textContent = msg;
		toastEl.classList.toggle('is-error', isError);
		toastEl.hidden = false;
		window.clearTimeout(toastTimer);
		toastTimer = window.setTimeout(() => {
			toastEl.hidden = true;
		}, 3800);
	};

	// Mobile Drawers / Sheets open & close helpers
	const closeMobileSidebar = () => {
		sidebarEl.classList.remove('is-open');
		sidebarBackdrop.hidden = true;
	};

	const openMobileSidebar = () => {
		closePropsSheet();
		sidebarEl.classList.add('is-open');
		sidebarBackdrop.hidden = false;
	};

	const closePropsSheet = () => {
		propsDrawer.hidden = true;
		propsBackdrop.hidden = true;
		propsToggleBtn.classList.remove('is-active');
	};

	const togglePropsSheet = () => {
		const willOpen = propsDrawer.hidden;
		if (willOpen) {
			closeMobileSidebar();
			propsDrawer.hidden = false;
			if (window.innerWidth <= 860) {
				propsBackdrop.hidden = false;
			}
			propsToggleBtn.classList.add('is-active');
		} else {
			closePropsSheet();
		}
	};

	openSidebarBtn.addEventListener('click', openMobileSidebar);
	closeSidebarBtn.addEventListener('click', closeMobileSidebar);
	sidebarBackdrop.addEventListener('click', closeMobileSidebar);

	propsToggleBtn.addEventListener('click', togglePropsSheet);
	mobileMetaBtn.addEventListener('click', togglePropsSheet);
	mobileSettingsBtn.addEventListener('click', togglePropsSheet);
	closePropsBtn.addEventListener('click', closePropsSheet);
	propsBackdrop.addEventListener('click', closePropsSheet);

	let editorView: EditorView;

	const getBodyText = (): string =>
		editorView ? editorView.state.doc.toString() : '';

	const setBodyText = (text: string) => {
		if (!editorView) return;
		editorView.dispatch({
			changes: {
				from: 0,
				to: editorView.state.doc.length,
				insert: text,
			},
		});
	};

	const parseTagsInput = (raw: string): string[] =>
		raw
			.split(/[,、\s]+/)
			.map((t) => t.replace(/^#/, '').trim())
			.filter(Boolean);

	const updatePublishedUi = () => {
		const pub = publishedToggle.checked;
		publishedLabel.textContent = pub ? '公開 (Published)' : '下書き (Draft)';
		publishedLabel.classList.toggle('is-draft', !pub);

		mobilePubDot.classList.toggle('is-draft', !pub);
		mobileDateLabel.textContent = (dateInput.value || formatJstDate()).replace(/-/g, '.');

		pubSegBtns.forEach((btn) => {
			btn.classList.toggle('is-active', (btn.dataset.btnSetPub === 'true') === pub);
		});

		const ctaLabel = isNewEntry
			? pub
				? '公開する'
				: '下書き保存'
			: pub
				? '保存する'
				: '下書き更新';
		saveBtn.textContent = ctaLabel;
		mobileSaveLabel.textContent = ctaLabel;

		if (!isNewEntry && pub && currentSlug) {
			const liveHref = `/blog/${currentSlug}/`;
			openLiveLink.href = liveHref;
			openLiveMobileLink.href = liveHref;
			openLiveLink.hidden = false;
			openLiveMobileLink.hidden = false;
		} else {
			openLiveLink.hidden = true;
			openLiveMobileLink.hidden = true;
		}

		deleteOpenBtn.hidden = isNewEntry;
		deleteOpenMobileBtn.hidden = isNewEntry;
	};

	const renderPreviewAndStats = () => {
		const body = getBodyText();
		const chars = body.replace(/\s/g, '').length;
		const lines = body ? body.split('\n').length : 1;
		statsEl.textContent = `${chars.toLocaleString()} 文字 · ${lines} 行`;

		if (viewMode === 'edit') return;

		const title = titleInput.value.trim() || `${dateInput.value || formatJstDate()} 日誌`;
		const desc =
			descInput.value.trim() || extractDescriptionFromMarkdown(body);
		previewTitleEl.textContent = title;
		previewMetaEl.textContent = `${dateInput.value || formatJstDate()} · ${
			publishedToggle.checked ? 'PUBLISHED' : 'DRAFT'
		} — ${desc}`;

		const rawHtml = marked.parse(body) as string;
		previewBodyEl.innerHTML = DOMPurify.sanitize(rawHtml, {
			ADD_ATTR: ['target', 'rel', 'loading'],
		});
	};

	const setViewMode = (next: 'edit' | 'split' | 'preview') => {
		if (next === 'split' && window.innerWidth <= 860) {
			next = viewMode === 'preview' ? 'edit' : 'preview';
		}
		viewMode = next;
		workspaceGrid.dataset.mode = viewMode;
		for (const b of viewBtns) {
			const active = b.dataset.viewMode === viewMode;
			b.classList.toggle('is-active', active);
			b.setAttribute('aria-pressed', String(active));
		}

		const isPrev = viewMode === 'preview';
		mobilePreviewBtn.classList.toggle('is-active', isPrev);
		mobilePreviewLabel.textContent = isPrev ? '書く' : 'プレビュー';

		try {
			window.localStorage.setItem(VIEW_MODE_KEY, viewMode);
		} catch {
			// Ignore
		}
		syncMobileBottomBars();
		renderPreviewAndStats();
	};

	const scheduleLocalDraftSave = () => {
		window.clearTimeout(draftTimer);
		draftTimer = window.setTimeout(() => {
			const slugKey = slugInput.value.trim() || currentSlug || '__new__';
			writeLocalDraft({
				slug: slugKey,
				title: titleInput.value,
				description: descInput.value,
				pubDate: dateInput.value,
				heroImage: heroInput.value,
				tagsInput: tagsInput.value,
				published: publishedToggle.checked,
				body: getBodyText(),
				savedAt: Date.now(),
				baseSha: currentSha,
			});
			if (isDirty) {
				dirtyStatusEl.textContent = '未反映（端末退避済）';
				dirtyStatusEl.dataset.state = 'dirty';
				mobileSyncLabel.textContent = '未保存';
				mobileSyncLabel.dataset.state = 'dirty';
			}
		}, 250);
	};

	const markDirty = () => {
		if (suppressEditorEvents) return;
		isDirty = true;
		dirtyStatusEl.textContent = '編集中…';
		dirtyStatusEl.dataset.state = 'dirty';
		mobileSyncLabel.textContent = '編集中';
		mobileSyncLabel.dataset.state = 'dirty';
		updatePublishedUi();
		renderPreviewAndStats();
		scheduleLocalDraftSave();
	};

	const markClean = (label = '同期済') => {
		window.clearTimeout(draftTimer);
		isDirty = false;
		dirtyStatusEl.textContent = label;
		dirtyStatusEl.dataset.state = 'clean';
		mobileSyncLabel.textContent = label;
		mobileSyncLabel.dataset.state = 'clean';
	};

	window.addEventListener('beforeunload', (e) => {
		if (isDirty) {
			e.preventDefault();
			e.returnValue = '';
		}
	});

	const confirmDiscardIfDirty = (): boolean => {
		if (!isDirty) return true;
		return window.confirm(
			'未アップロードの変更があります（端末には下書き退避されています）。別のノートに切り替えますか？'
		);
	};

	const renderSidebarList = () => {
		const q = searchQuery.trim().toLowerCase();
		const filtered = entries.filter((item) => {
			if (activeFilter === 'published' && !item.frontmatter.published) return false;
			if (activeFilter === 'draft' && item.frontmatter.published) return false;
			if (!q) return true;
			const hay = [
				item.slug,
				item.frontmatter.title,
				item.frontmatter.description,
				...(item.frontmatter.tags || []),
			]
				.join(' ')
				.toLowerCase();
			return hay.includes(q);
		});

		entryCountEl.textContent = `${filtered.length} / ${entries.length} NOTES`;
		entryListEl.innerHTML = '';

		if (filtered.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'vault-empty';
			empty.textContent = '該当するノートがありません。';
			entryListEl.appendChild(empty);
			return;
		}

		for (const item of filtered) {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'vault-item';
			if (!isNewEntry && item.slug === currentSlug) {
				btn.classList.add('is-selected');
			}
			btn.dataset.entrySlug = item.slug;

			const top = document.createElement('div');
			top.className = 'vault-item-top';

			const dot = document.createElement('span');
			dot.className = item.frontmatter.published
				? 'status-dot is-pub'
				: 'status-dot is-draft';
			dot.title = item.frontmatter.published ? '公開中' : '下書き';

			const dateSpan = document.createElement('span');
			dateSpan.className = 'vault-item-date';
			dateSpan.textContent = item.frontmatter.pubDate;

			const slugSpan = document.createElement('span');
			slugSpan.className = 'vault-item-slug';
			slugSpan.textContent = `${item.slug}.md`;

			top.append(dot, dateSpan, slugSpan);

			const titleDiv = document.createElement('div');
			titleDiv.className = 'vault-item-title';
			titleDiv.textContent = item.frontmatter.title;

			btn.append(top, titleDiv);
			btn.addEventListener('click', () => {
				if (!confirmDiscardIfDirty()) return;
				void openExistingEntry(item.slug);
				closeMobileSidebar();
			});
			entryListEl.appendChild(btn);
		}
	};

	const applySnapshotToForm = (snap: {
		slug: string;
		title: string;
		description: string;
		pubDate: string;
		heroImage?: string;
		tagsInput?: string;
		published: boolean;
		body: string;
	}) => {
		suppressEditorEvents = true;
		try {
			slugInput.value = snap.slug;
			slugInput.readOnly = !isNewEntry;
			titleInput.value = snap.title;
			descInput.value = snap.description;
			dateInput.value = snap.pubDate;
			heroInput.value = snap.heroImage || '';
			tagsInput.value = snap.tagsInput || '';
			publishedToggle.checked = snap.published;
			setBodyText(snap.body);
			resizeTitleTextarea();
			updatePublishedUi();
			renderPreviewAndStats();
		} finally {
			suppressEditorEvents = false;
		}
	};

	const openExistingEntry = async (slug: string) => {
		if (!client) return;
		try {
			mobileSyncLabel.textContent = '読込中…';
			const detail = await client.getEntry(slug);
			currentSlug = detail.slug;
			currentSha = detail.sha;
			currentExtraLines = detail.extraLines;
			isNewEntry = false;

			applySnapshotToForm({
				slug: detail.slug,
				title: detail.frontmatter.title,
				description: detail.frontmatter.description,
				pubDate: detail.frontmatter.pubDate,
				heroImage: detail.frontmatter.heroImage || '',
				tagsInput: (detail.frontmatter.tags || []).join(', '),
				published: detail.frontmatter.published,
				body: detail.body,
			});

			markClean('同期済');
			renderSidebarList();

			const local = readLocalDraft(detail.slug);
			if (
				local &&
				(local.body.trim() !== detail.body.trim() ||
					local.title.trim() !== detail.frontmatter.title.trim())
			) {
				pendingRecoverableDraft = local;
				draftBanner.hidden = false;
			} else {
				pendingRecoverableDraft = null;
				draftBanner.hidden = true;
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : '記事の読み込みに失敗しました';
			showToast(msg, true);
		}
	};

	const startNewNote = (opts?: { dailyMode?: boolean }) => {
		if (!confirmDiscardIfDirty()) return;
		if (viewMode === 'preview') setViewMode('edit');
		const daily = resolveDailyNoteSlug(entries.map((e) => e.slug));

		if (opts?.dailyMode && daily.existsToday) {
			void openExistingEntry(daily.todaySlug);
			closeMobileSidebar();
			showToast(`今日の日誌 (${daily.todaySlug}.md) を開きました`);
			return;
		}

		const targetSlug = opts?.dailyMode ? daily.todaySlug : daily.nextFreeSlug;
		currentSlug = targetSlug;
		currentSha = undefined;
		currentExtraLines = [];
		isNewEntry = true;
		pendingRecoverableDraft = null;
		draftBanner.hidden = true;

		const defaultTitle = opts?.dailyMode ? `${daily.dateStr} 日誌` : '';
		const defaultBody = opts?.dailyMode ? `**${formatJstTime()}**\n\n` : '';

		applySnapshotToForm({
			slug: targetSlug,
			title: defaultTitle,
			description: '',
			pubDate: daily.dateStr,
			heroImage: '',
			tagsInput: opts?.dailyMode ? 'daily' : '',
			published: true,
			body: defaultBody,
		});

		const savedLocal = readLocalDraft(targetSlug);
		if (savedLocal && savedLocal.body.trim()) {
			pendingRecoverableDraft = savedLocal;
			draftBanner.hidden = false;
		}

		markClean('新規');
		renderSidebarList();
		closeMobileSidebar();
		closePropsSheet();

		if (opts?.dailyMode) {
			editorView.focus();
			editorView.dispatch({
				selection: { anchor: editorView.state.doc.length },
			});
		} else {
			titleInput.focus();
		}
	};

	restoreDraftBtn.addEventListener('click', () => {
		if (!pendingRecoverableDraft) return;
		applySnapshotToForm(pendingRecoverableDraft);
		draftBanner.hidden = true;
		pendingRecoverableDraft = null;
		markDirty();
		showToast('端末に退避されていた下書きを復元しました');
	});

	discardDraftBtn.addEventListener('click', () => {
		if (pendingRecoverableDraft) {
			removeLocalDraft(pendingRecoverableDraft.slug);
		}
		pendingRecoverableDraft = null;
		draftBanner.hidden = true;
		showToast('ローカル下書きを破棄しました');
	});

	const pollDeployProgress = () => {
		if (!client) return;
		window.clearInterval(deployPollTimer);
		let ticks = 0;

		const checkOnce = async () => {
			if (!client) return;
			ticks += 1;
			try {
				const st = await client.getDeployStatus();
				if (st.state === 'in_progress') {
					deployStatusEl.textContent = `DEPLOYING (${st.commitSha || '...'})`;
					deployStatusEl.dataset.deploy = 'building';
				} else if (st.state === 'completed') {
					deployStatusEl.textContent = `LIVE (${st.commitSha || 'OK'})`;
					deployStatusEl.dataset.deploy = 'ready';
					window.clearInterval(deployPollTimer);
				} else if (st.state === 'failed') {
					deployStatusEl.textContent = `BUILD FAILED (${st.commitSha || 'ERR'})`;
					deployStatusEl.dataset.deploy = 'failed';
					window.clearInterval(deployPollTimer);
				} else {
					deployStatusEl.textContent = st.commitSha ? `COMMIT ${st.commitSha}` : 'READY';
					deployStatusEl.dataset.deploy = 'ready';
					if (ticks >= 2) window.clearInterval(deployPollTimer);
				}
			} catch {
				window.clearInterval(deployPollTimer);
			}
			if (ticks >= 18) window.clearInterval(deployPollTimer);
		};

		void checkOnce();
		deployPollTimer = window.setInterval(() => void checkOnce(), 5000);
	};

	const handleSave = async () => {
		if (!client || isSaving) return;

		const rawSlug = slugInput.value.trim();
		const slugCheck = validateSlug(rawSlug);
		if (!slugCheck.ok) {
			propsDrawer.hidden = false;
			if (window.innerWidth <= 860) propsBackdrop.hidden = false;
			slugInput.focus();
			showToast(slugCheck.error, true);
			return;
		}

		const body = getBodyText();
		let title = titleInput.value.trim().replace(/\s*\n+\s*/g, ' ');
		if (!title && /^\d{4}-\d{2}-\d{2}/.test(slugCheck.slug)) {
			title = `${dateInput.value || slugCheck.slug.slice(0, 10)} 日誌`;
			titleInput.value = title;
			resizeTitleTextarea();
		}

		const frontmatter = {
			title,
			description: descInput.value.trim(),
			pubDate: dateInput.value.trim() || formatJstDate(),
			updatedDate: !isNewEntry ? formatJstDate() : undefined,
			heroImage: heroInput.value.trim() || undefined,
			published: publishedToggle.checked,
			tags: parseTagsInput(tagsInput.value),
		};

		const precheck = serializeJournalMarkdown(frontmatter, body, {
			allowAutoTitle: false,
			extraLines: currentExtraLines,
		});
		if (!precheck.ok) {
			showToast(precheck.errors[0], true);
			if (!title) titleInput.focus();
			return;
		}

		if (!descInput.value.trim()) {
			descInput.value = precheck.normalized.description;
		}

		isSaving = true;
		saveBtn.disabled = true;
		saveMobileBtn.disabled = true;
		saveBtn.textContent = '保存中…';
		mobileSaveLabel.textContent = '保存中…';

		try {
			const res = await client.saveEntry({
				slug: slugCheck.slug,
				frontmatter: precheck.normalized,
				content: body,
				extraLines: currentExtraLines,
				sha: isNewEntry ? undefined : currentSha,
				isNew: isNewEntry,
			});

			removeLocalDraft(currentSlug);
			removeLocalDraft(res.slug);

			currentSlug = res.slug;
			currentSha = res.sha;
			isNewEntry = false;
			slugInput.value = res.slug;
			slugInput.readOnly = true;
			draftBanner.hidden = true;

			markClean('保存済');
			updatePublishedUi();

			entries = await client.listEntries();
			renderSidebarList();
			pollDeployProgress();

			showToast(
				publishedToggle.checked
					? `「${precheck.normalized.title}」を公開保存しました`
					: `「${precheck.normalized.title}」を下書き保存しました`
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : '保存に失敗しました';
			showToast(msg, true);
		} finally {
			isSaving = false;
			saveBtn.disabled = false;
			saveMobileBtn.disabled = false;
			updatePublishedUi();
		}
	};

	const handleFilesUpload = async (files: File[]) => {
		if (!client || files.length === 0) return;

		for (const file of files) {
			if (/\.(md|mdx)$/i.test(file.name)) {
				if (!confirmDiscardIfDirty()) return;
				const text = await file.text();
				const baseSlug =
					sanitizeSlug(file.name) ||
					resolveDailyNoteSlug(entries.map((e) => e.slug)).nextFreeSlug;
				const parsed = parseJournalMarkdown(text, baseSlug);
				const existing = entries.find((e) => e.slug === baseSlug);

				currentSlug = baseSlug;
				currentSha = existing?.sha;
				currentExtraLines = parsed.extraLines;
				isNewEntry = !existing;

				applySnapshotToForm({
					slug: baseSlug,
					title: parsed.frontmatter.title,
					description: parsed.frontmatter.description,
					pubDate: parsed.frontmatter.pubDate,
					heroImage: parsed.frontmatter.heroImage || '',
					tagsInput: (parsed.frontmatter.tags || []).join(', '),
					published: parsed.frontmatter.published,
					body: parsed.body,
				});
				markDirty();
				closeMobileSidebar();
				showToast(
					existing
						? `「${file.name}」を読み込みました（保存で上書き更新）`
						: `「${file.name}」を取り込みました（保存で反映）`
				);
				continue;
			}

			if (file.type.startsWith('image/')) {
				const token = `![Uploading ${file.name}...]()`;
				insertTextAtCursor(editorView, `${token}\n`);
				try {
					const uploaded = await client.uploadImage(file);
					const alt = file.name.replace(/\.[^.]+$/, '');
					replaceTextInDoc(editorView, token, `![${alt}](${uploaded.publicUrl})`);
					markDirty();
					showToast(`画像を挿入しました (${uploaded.publicUrl})`);
				} catch (err) {
					replaceTextInDoc(editorView, `${token}\n`, '');
					const msg =
						err instanceof Error ? err.message : '画像アップロードに失敗しました';
					showToast(msg, true);
				}
			}
		}
	};

	const downloadCurrentMarkdown = () => {
		const slug = sanitizeSlug(slugInput.value) || currentSlug || formatJstDate();
		const serialized = serializeJournalMarkdown(
			{
				title: titleInput.value.trim() || `${slug} 日誌`,
				description: descInput.value.trim(),
				pubDate: dateInput.value.trim() || formatJstDate(),
				heroImage: heroInput.value.trim() || undefined,
				published: publishedToggle.checked,
				tags: parseTagsInput(tagsInput.value),
			},
			getBodyText(),
			{ allowAutoTitle: true, extraLines: currentExtraLines }
		);

		const blob = new Blob([serialized.markdown], {
			type: 'text/markdown;charset=utf-8',
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${slug}.md`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	};

	const openDeleteModal = () => {
		if (isNewEntry || !currentSlug) return;
		closePropsSheet();
		deleteTargetLabel.textContent = `${titleInput.value || currentSlug} (${currentSlug}.md)`;
		deleteModal.hidden = false;
	};

	deleteOpenBtn.addEventListener('click', openDeleteModal);
	deleteOpenMobileBtn.addEventListener('click', openDeleteModal);
	downloadMdBtn.addEventListener('click', downloadCurrentMarkdown);
	downloadMdMobileBtn.addEventListener('click', downloadCurrentMarkdown);

	deleteCancelBtn.addEventListener('click', () => {
		deleteModal.hidden = true;
	});

	deleteBackupBtn.addEventListener('click', () => {
		downloadCurrentMarkdown();
		showToast(`${currentSlug}.md を保存しました`);
	});

	deleteConfirmBtn.addEventListener('click', async () => {
		if (!client || !currentSlug || !currentSha) return;
		deleteConfirmBtn.disabled = true;
		deleteConfirmBtn.textContent = '削除中…';

		try {
			const targetSlug = currentSlug;
			await client.deleteEntry({ slug: targetSlug, sha: currentSha });
			removeLocalDraft(targetSlug);
			deleteModal.hidden = true;
			isDirty = false;

			entries = await client.listEntries();
			if (entries.length > 0) {
				await openExistingEntry(entries[0].slug);
			} else {
				startNewNote({ dailyMode: true });
			}
			pollDeployProgress();
			showToast(`「${targetSlug}.md」を削除しました`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : '削除に失敗しました';
			showToast(msg, true);
		} finally {
			deleteConfirmBtn.disabled = false;
			deleteConfirmBtn.textContent = '完全に削除する';
		}
	});

	// Mount CodeMirror 6 editor
	editorView = createObsidianEditor(cmHost, '', {
		onChange: () => markDirty(),
		onSaveShortcut: () => void handleSave(),
		onTogglePreviewShortcut: () =>
			setViewMode(viewMode === 'preview' ? 'edit' : 'preview'),
		onPasteOrDropFiles: (files) => void handleFilesUpload(files),
		onFocusChange: (focused) => {
			cmFocused = focused;
			window.setTimeout(syncMobileBottomBars, 40);
		},
	});

	titleInput.addEventListener('focus', () => {
		titleFocused = true;
		syncMobileBottomBars();
	});
	titleInput.addEventListener('blur', () => {
		titleFocused = false;
		window.setTimeout(syncMobileBottomBars, 40);
	});
	titleInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && !e.isComposing) {
			e.preventDefault();
			editorView.focus();
		}
	});
	titleInput.addEventListener('input', () => {
		resizeTitleTextarea();
		markDirty();
	});

	kbDoneBtn.addEventListener('click', () => {
		editorView.contentDOM.blur();
		titleInput.blur();
		cmFocused = false;
		titleFocused = false;
		syncMobileBottomBars();
	});

	// Wire formatting & Undo/Redo actions without stealing focus from iOS keyboard
	document.querySelectorAll<HTMLButtonElement>('[data-fmt]').forEach((btn) => {
		btn.addEventListener('mousedown', (e) => {
			if (btn.dataset.fmt !== 'image') {
				e.preventDefault();
			}
		});
		btn.addEventListener('click', () => {
			const kind = btn.dataset.fmt;
			if (kind === 'image') {
				imageFileInput.click();
				return;
			}
			if (viewMode === 'preview') setViewMode('edit');
			switch (kind) {
				case 'h2':
					toggleLinePrefix(editorView, '## ');
					break;
				case 'h3':
					toggleLinePrefix(editorView, '### ');
					break;
				case 'bold':
					wrapSelectionWith(editorView, '**', '**', '太字');
					break;
				case 'italic':
					wrapSelectionWith(editorView, '*', '*', '斜体');
					break;
				case 'bullet':
					toggleLinePrefix(editorView, '- ');
					break;
				case 'todo':
					toggleLinePrefix(editorView, '- [ ] ');
					break;
				case 'quote':
					toggleLinePrefix(editorView, '> ');
					break;
				case 'code':
					wrapSelectionWith(editorView, '`', '`', 'code');
					break;
				case 'link':
					wrapSelectionWith(editorView, '[', '](https://)', 'リンク');
					break;
				case 'hr':
					insertTextAtCursor(editorView, '\n---\n\n');
					break;
				case 'time':
					insertTextAtCursor(editorView, `**${formatJstTime()}** `);
					break;
				case 'undo':
					triggerUndo(editorView);
					break;
				case 'redo':
					triggerRedo(editorView);
					break;
			}
		});
	});

	imageFileInput.addEventListener('change', () => {
		if (imageFileInput.files && imageFileInput.files.length > 0) {
			void handleFilesUpload(Array.from(imageFileInput.files));
			imageFileInput.value = '';
		}
	});

	uploadHeroBtn.addEventListener('click', () => heroFileInput.click());
	heroFileInput.addEventListener('change', async () => {
		if (!client || !heroFileInput.files?.[0]) return;
		const file = heroFileInput.files[0];
		heroFileInput.value = '';
		try {
			uploadHeroBtn.disabled = true;
			uploadHeroBtn.textContent = '送信中…';
			const uploaded = await client.uploadImage(file);
			heroInput.value = uploaded.publicUrl;
			markDirty();
			showToast(`アイキャッチを設定しました (${uploaded.publicUrl})`);
		} catch (err) {
			showToast(
				err instanceof Error ? err.message : 'アイキャッチのアップロードに失敗しました',
				true
			);
		} finally {
			uploadHeroBtn.disabled = false;
			uploadHeroBtn.textContent = '画像選択';
		}
	});

	importMdBtn.addEventListener('click', () => importMdInput.click());
	importMdInput.addEventListener('change', () => {
		if (importMdInput.files && importMdInput.files.length > 0) {
			void handleFilesUpload(Array.from(importMdInput.files));
			importMdInput.value = '';
		}
	});

	[slugInput, dateInput, descInput, tagsInput, heroInput].forEach((el) => {
		el.addEventListener('input', () => markDirty());
	});

	publishedToggle.addEventListener('change', () => {
		updatePublishedUi();
		markDirty();
	});

	pubSegBtns.forEach((btn) => {
		btn.addEventListener('click', () => {
			publishedToggle.checked = btn.dataset.btnSetPub === 'true';
			updatePublishedUi();
			markDirty();
		});
	});

	dailyNoteBtn.addEventListener('click', () => startNewNote({ dailyMode: true }));
	dailyNoteMobileBtn.addEventListener('click', () => startNewNote({ dailyMode: true }));
	newNoteBtn.addEventListener('click', () => startNewNote({ dailyMode: false }));
	saveBtn.addEventListener('click', () => void handleSave());
	saveMobileBtn.addEventListener('click', () => void handleSave());

	mobilePreviewBtn.addEventListener('click', () => {
		setViewMode(viewMode === 'preview' ? 'edit' : 'preview');
	});

	searchInput.addEventListener('input', () => {
		searchQuery = searchInput.value;
		renderSidebarList();
	});

	filterBtns.forEach((btn) => {
		btn.addEventListener('click', () => {
			activeFilter = (btn.dataset.filter as typeof activeFilter) || 'all';
			filterBtns.forEach((b) => b.classList.toggle('is-active', b === btn));
			renderSidebarList();
		});
	});

	viewBtns.forEach((btn) => {
		btn.addEventListener('click', () => {
			const m = btn.dataset.viewMode as typeof viewMode;
			if (m) setViewMode(m);
		});
	});

	setViewMode(viewMode);
	syncVisualViewport();
	syncMobileBottomBars();

	// Auth Modal Tab Switching
	let selectedAuthTab: 'passphrase' | 'github-token' = 'github-token';
	const selectAuthTab = (tab: 'passphrase' | 'github-token') => {
		selectedAuthTab = tab;
		authModeTabs.forEach((b) =>
			b.classList.toggle('is-active', b.dataset.authTab === tab)
		);
		passphraseField.hidden = tab !== 'passphrase';
		tokenField.hidden = tab !== 'github-token';
		authErrorEl.hidden = true;
	};

	authModeTabs.forEach((btn) => {
		btn.addEventListener('click', () => {
			const tab = btn.dataset.authTab as 'passphrase' | 'github-token';
			if (tab) selectAuthTab(tab);
		});
	});

	const connectAndBoot = async (creds: StoredCredentials, persist: boolean) => {
		const candidate = new StudioClient(creds);
		const info = await candidate.verify();
		if (!info.canPush) {
			throw new Error(
				`リポジトリ ${info.fullName} への書き込み権限がありません。Contents: Read and write 権限を付与してください。`
			);
		}
		client = candidate;
		if (persist && creds.authMode !== 'local-fs') {
			saveStoredCredentials(creds);
		}

		authOverlay.hidden = true;
		connBadgeEl.textContent =
			creds.authMode === 'local-fs'
				? 'LOCAL VAULT'
				: `${creds.owner}/${creds.repo}`;
		logoutBtn.hidden = creds.authMode === 'local-fs';

		entries = await client.listEntries();
		renderSidebarList();

		const urlSlug = new URLSearchParams(window.location.search).get('slug');
		if (urlSlug && entries.some((e) => e.slug === urlSlug)) {
			await openExistingEntry(urlSlug);
		} else if (entries.length > 0) {
			await openExistingEntry(entries[0].slug);
		} else {
			startNewNote({ dailyMode: true });
		}
	};

	authForm.addEventListener('submit', async (e) => {
		e.preventDefault();
		authErrorEl.hidden = true;
		authSubmitBtn.disabled = true;
		authSubmitBtn.textContent = '接続確認中…';

		try {
			const creds: StoredCredentials =
				selectedAuthTab === 'passphrase'
					? {
							authMode: 'passphrase',
							passphrase: passphraseInput.value.trim(),
							owner: repoOwnerInput.value.trim() || 'saikattyo',
							repo: repoNameInput.value.trim() || 'saikatty-site',
							branch: repoBranchInput.value.trim() || 'main',
						}
					: {
							authMode: 'github-token',
							githubToken: tokenInput.value.trim(),
							owner: repoOwnerInput.value.trim() || 'saikattyo',
							repo: repoNameInput.value.trim() || 'saikatty-site',
							branch: repoBranchInput.value.trim() || 'main',
						};

			if (selectedAuthTab === 'passphrase' && !creds.passphrase) {
				throw new Error('パスフレーズを入力してください。');
			}
			if (selectedAuthTab === 'github-token' && !creds.githubToken) {
				throw new Error('GitHub Personal Access Token を入力してください。');
			}

			await connectAndBoot(creds, true);
			showToast('Vault に接続しました');
		} catch (err) {
			authErrorEl.textContent =
				err instanceof Error ? err.message : '接続に失敗しました';
			authErrorEl.hidden = false;
		} finally {
			authSubmitBtn.disabled = false;
			authSubmitBtn.textContent = 'VAULT に接続';
		}
	});

	logoutBtn.addEventListener('click', () => {
		if (!confirmDiscardIfDirty()) return;
		clearStoredCredentials();
		client = null;
		tokenInput.value = '';
		passphraseInput.value = '';
		closeMobileSidebar();
		authOverlay.hidden = false;
	});

	capabilities = await detectStudioCapabilities();
	repoOwnerInput.value = capabilities.owner;
	repoNameInput.value = capabilities.repo;
	repoBranchInput.value = capabilities.branch;

	if (capabilities.mode === 'local-fs') {
		try {
			await connectAndBoot(
				{
					authMode: 'local-fs',
					owner: capabilities.owner,
					repo: capabilities.repo,
					branch: capabilities.branch,
				},
				false
			);
			return;
		} catch {
			// Fall through
		}
	}

	if (capabilities.passphraseConfigured) {
		selectAuthTab('passphrase');
	} else {
		selectAuthTab('github-token');
	}

	const saved = loadStoredCredentials();
	if (saved) {
		try {
			await connectAndBoot(saved, false);
			return;
		} catch {
			clearStoredCredentials();
		}
	}

	authOverlay.hidden = false;
}
