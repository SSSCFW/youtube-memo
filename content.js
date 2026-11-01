(() => {
  'use strict';

  if (globalThis.__youtubeMemoInitialized) return;
  globalThis.__youtubeMemoInitialized = true;

  const Model = globalThis.YouTubeMemoModel;
  const memoCache = new Map();
  const heightCache = new Map();
  const widthCache = new Map();
  const MIN_MEMO_WIDTH = 320;
  const MIN_VIDEO_WIDTH = 480;
  const MAX_MEMO_WIDTH = 900;
  const writers = new Map();
  let current = null;
  let reconcileTimer = null;

  function videoIdFromUrl() {
    if (location.pathname !== '/watch') return null;
    return new URLSearchParams(location.search).get('v') || null;
  }

  function storageError() {
    return chrome.runtime && chrome.runtime.lastError;
  }

  // One serialized queue per video. A newer pending snapshot replaces an older one.
  function queueWrite(videoId, values) {
    let writer = writers.get(videoId);
    if (!writer) {
      writer = { pending: null, failed: null, saving: false, error: false };
      writers.set(videoId, writer);
    }
    writer.pending = Object.assign({}, writer.failed, writer.pending, values);
    writer.failed = null;
    writer.error = false;
    flushWrite(videoId, writer);
  }

  function flushWrite(videoId, writer) {
    if (writer.saving || !writer.pending) return;
    const batch = writer.pending;
    writer.pending = null;
    writer.saving = true;
    const finish = (error) => {
      writer.saving = false;
      writer.error = Boolean(error);
      if (error) writer.failed = Object.assign({}, batch, writer.failed);
      if (current && current.videoId === videoId) current.renderStatus();
      // Retry a failed batch only when there is newer work or the user retries.
      if (writer.pending) {
        writer.pending = Object.assign({}, writer.failed, writer.pending);
        writer.failed = null;
        flushWrite(videoId, writer);
      }
    };
    try {
      chrome.storage.local.set(batch, () => finish(storageError()));
    } catch (error) {
      finish(error);
    }
  }

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
        return false;
      }
    }
    // Empty layout containers can have zero height until the memo is inserted.
    return true;
  }

  function firstVisible(root, selector) {
    return [...root.querySelectorAll(selector)].find(isVisible) || null;
  }

  function findLayout(videoId) {
    const allRoots = [...document.querySelectorAll('ytd-watch-flexy, ytd-watch-grid')];
    const visibleRoots = allRoots.filter(isVisible);
    const root = visibleRoots.find((node) => node.getAttribute('video-id') === videoId)
      || visibleRoots.find((node) => !node.getAttribute('video-id'))
      || (allRoots.length === 0 ? document : null);
    if (!root) return null;
    const sidebar = firstVisible(root, '#secondary');
    if (sidebar) return { root, host: sidebar, prepend: true };
    const below = firstVisible(root, '#below');
    if (below) return { root, host: below, prepend: true };
    const primary = firstVisible(root, '#primary-inner') || firstVisible(root, '#primary');
    return primary ? { root, host: primary, prepend: false } : null;
  }

  // Only change two-column watch layouts. Respect mobile, theater and fullscreen.
  function resizableColumns(layout) {
    if (!layout || layout.host.id !== 'secondary' || window.innerWidth < 1050) return null;
    const root = layout.root;
    if (root.nodeType !== 1 || root.matches('[fullscreen], [theater]')) return null;
    const columns = root.querySelector('#columns');
    const primary = columns?.querySelector(':scope > #primary');
    const secondary = columns?.querySelector(':scope > #secondary');
    if (!primary || secondary !== layout.host || !isVisible(primary) || !isVisible(secondary)) return null;
    const outer = columns.getBoundingClientRect();
    const video = primary.getBoundingClientRect();
    const memo = secondary.getBoundingClientRect();
    if (video.width < MIN_VIDEO_WIDTH || memo.width < 200 ||
        memo.left <= video.left || Math.abs(video.top - memo.top) > 64) return null;
    const offset = Math.max(0, video.left - outer.left);
    const gap = Math.max(0, memo.left - video.right);
    const maxWidth = Math.floor(Math.min(MAX_MEMO_WIDTH, outer.width - offset - gap - MIN_VIDEO_WIDTH));
    return maxWidth >= MIN_MEMO_WIDTH ? { root, columns, secondary, maxWidth } : null;
  }

  function makeElement(tag, id, text) {
    const element = document.createElement(tag);
    if (id) element.id = id;
    if (text) element.textContent = text;
    return element;
  }

  function makeButton(id, text, callback) {
    const button = makeElement('button', id, text);
    button.type = 'button';
    button.addEventListener('click', callback);
    return button;
  }

  class MemoController {
    constructor(videoId) {
      this.videoId = videoId;
      this.memo = null;
      this.loaded = false;
      this.disposed = false;
      this.loadError = false;
      this.validationError = '';
      this.hidden = false;
      this.detailsOpen = false;
      this.composing = false;
      this.lastAutoPageId = null;
      this.video = null;
      this.root = null;
      this.resizeTimer = null;
      this.focusTimer = null;
      this.heightReady = false;
      this.sidebarWidth = null;
      this.widthLayout = null;
      this.widthDrag = null;
      this.currentLayout = null;
      this.build();
      this.onPlayback = () => this.syncPlayback();
    }

    isCurrent() {
      return !this.disposed && current === this && videoIdFromUrl() === this.videoId;
    }

    build() {
      this.container = makeElement('section', 'youtube-memo-container');
      this.container.className = 'youtube-memo-visible';
      this.container.setAttribute('aria-label', '動画のメモ');
      this.container.dataset.videoId = this.videoId;

      this.area = makeElement('div', 'youtube-memo-area');
      this.title = makeElement('input', 'youtube-memo-page-title');
      this.title.type = 'text';
      this.title.hidden = true;
      this.title.setAttribute('aria-label', 'ページタイトル');
      this.title.autocomplete = 'off';
      this.textarea = makeElement('textarea', 'youtube-memo-textarea');
      this.textarea.dataset.videoId = this.videoId;
      this.textarea.placeholder = '歌詞やメモを入力してください...';
      this.textarea.setAttribute('aria-label', 'メモ');
      // The title navigation mirrors the bottom page controls.
      this.titleRow = makeElement('div', 'youtube-memo-title-row');
      this.titleNav = makeElement('div', 'youtube-memo-title-navigation');
      this.titlePrevious = makeButton('youtube-memo-title-prev', '戻る', () => this.stepPage(-1));
      this.titleNext = makeButton('youtube-memo-title-next', '前へ', () => this.stepPage(1));
      this.titleNav.append(this.titlePrevious, this.titleNext);
      this.titleRow.append(this.title, this.titleNav);
      this.titleRow.hidden = true;
      this.area.append(this.titleRow, this.textarea);

      // The drag grip lives on the memo's left edge, adjoining the video.
      this.widthHandle = makeElement('div', 'youtube-memo-width-handle', '⋮');
      this.widthHandle.hidden = true;
      this.widthHandle.tabIndex = 0;
      this.widthHandle.setAttribute('role', 'separator');
      this.widthHandle.setAttribute('aria-orientation', 'vertical');
      this.widthHandle.setAttribute('aria-label', '動画とメモの横幅を調整');
      this.widthHandle.title = '左右にドラッグして横幅を調整（左右キーでも操作できます）';
      this.widthHandle.addEventListener('pointerdown', (event) => this.beginWidthDrag(event));
      this.widthHandle.addEventListener('keydown', (event) => this.resizeWidthWithKeyboard(event));

      this.headerShow = makeButton('youtube-memo-header-show', 'メモを表示', () => {
        if (!this.isCurrent()) return;
        this.hidden = false;
        this.renderVisibility();
        scheduleReconcile(0);
      });

      this.actions = makeElement('div', 'youtube-memo-actions');
      // Keep page navigation visible outside detailed settings for multi-page notes.
      this.previous = makeButton('youtube-memo-prev', '戻る', () => this.stepPage(-1));
      this.previous.title = '前のページへ';
      this.next = makeButton('youtube-memo-next', '前へ', () => this.stepPage(1));
      this.next.title = '次のページへ';
      this.settingsToggle = makeButton('youtube-memo-settings-toggle', '詳細設定', () => {
        this.detailsOpen = !this.detailsOpen;
        this.renderVisibility();
      });
      this.settingsToggle.setAttribute('aria-controls', 'youtube-memo-settings');
      this.toggle = makeButton('youtube-memo-toggle', 'メモを非表示', () => {
        this.hidden = !this.hidden;
        this.renderVisibility();
        scheduleReconcile(0);
      });
      this.toggle.setAttribute('aria-controls', 'youtube-memo-area');
      this.actions.append(this.previous, this.next, this.settingsToggle, this.toggle);

      this.settings = makeElement('div', 'youtube-memo-settings');
      this.settings.hidden = true;
      this.settings.setAttribute('aria-label', 'メモの詳細設定');
      const pageLabel = makeElement('label', null, 'ページ');
      pageLabel.htmlFor = 'youtube-memo-page-select';
      const navigation = makeElement('div', 'youtube-memo-navigation');
      this.select = makeElement('select', 'youtube-memo-page-select');
      navigation.append(this.select);
      const reorder = makeElement('div', 'youtube-memo-reorder-actions');
      this.moveUp = makeButton('youtube-memo-move-up', '上へ移動', () => this.movePage(-1));
      this.moveDown = makeButton('youtube-memo-move-down', '下へ移動', () => this.movePage(1));
      reorder.append(this.moveUp, this.moveDown);
      const editing = makeElement('div', 'youtube-memo-page-actions');
      this.add = makeButton('youtube-memo-add', 'ページを追加', () => this.addPage());
      this.remove = makeButton('youtube-memo-delete', 'このページを削除', () => this.deletePage());
      editing.append(this.add, this.remove);

      const timeLabel = makeElement('label', null, 'このページの開始時刻');
      timeLabel.htmlFor = 'youtube-memo-start-time';
      const timeRow = makeElement('div', 'youtube-memo-time-row');
      this.startTime = makeElement('input', 'youtube-memo-start-time');
      this.startTime.type = 'text';
      this.startTime.placeholder = '例: 1:30（空欄は手動のみ）';
      this.startTime.autocomplete = 'off';
      this.startTime.spellcheck = false;
      this.startTime.setAttribute('aria-describedby', 'youtube-memo-time-help');
      this.setTime = makeButton('youtube-memo-set-time', '現在の再生時間を設定', () => {
        if (!this.canEdit() || !this.video || !Number.isFinite(this.video.currentTime)) return;
        this.startTime.value = Model.formatTime(Math.floor(this.video.currentTime));
        this.saveStartTime();
      });
      timeRow.append(this.startTime, this.setTime);
      const help = makeElement('p', 'youtube-memo-time-help',
        '秒数・分:秒・時:分:秒で指定します。空欄のページは手動で切り替えます。');
      const autoLabel = makeElement('label', 'youtube-memo-auto-label');
      this.autoSwitch = makeElement('input', 'youtube-memo-auto-switch');
      this.autoSwitch.type = 'checkbox';
      autoLabel.append(this.autoSwitch, document.createTextNode('再生時間で自動切り替え（この動画）'));
      const widthRow = makeElement('div', 'youtube-memo-width-settings');
      this.widthReset = makeButton('youtube-memo-width-reset', '横幅をリセット', () => this.resetWidth());
      widthRow.append(this.widthReset);
      this.settings.append(pageLabel, navigation, reorder, editing, timeLabel, timeRow, help, autoLabel, widthRow);

      this.statusRow = makeElement('div', 'youtube-memo-status-row');
      this.status = makeElement('span', 'youtube-memo-status');
      this.status.setAttribute('role', 'status');
      this.retry = makeButton('youtube-memo-retry', '再試行', () => {
        if (!this.isCurrent()) return;
        if (this.loadError) this.load();
        else {
          const writer = writers.get(this.videoId);
          if (writer && writer.failed) queueWrite(this.videoId, writer.failed);
          this.renderStatus();
        }
      });
      this.retry.hidden = true;
      this.statusRow.append(this.status, this.retry);
      this.container.append(this.widthHandle, this.area, this.actions, this.settings, this.statusRow);

      this.textarea.addEventListener('input', () => {
        if (!this.canEdit()) return;
        this.activePage().content = this.textarea.value;
        this.persist();
      });
      this.title.addEventListener('input', () => {
        if (!this.canEdit()) return;
        this.activePage().title = this.title.value;
        this.renderOptions();
        this.persist();
      });
      this.select.addEventListener('change', () => this.selectPage(this.select.value, true));
      this.autoSwitch.addEventListener('change', () => {
        if (!this.canEdit()) return;
        this.memo.autoSwitch = this.autoSwitch.checked;
        this.lastAutoPageId = null;
        this.persist();
        this.syncPlayback();
      });
      this.startTime.addEventListener('input', () => {
        this.validationError = '';
        this.startTime.removeAttribute('aria-invalid');
        this.startTime.setCustomValidity('');
        this.renderStatus();
      });
      this.startTime.addEventListener('change', () => this.saveStartTime());
      for (const field of [this.title, this.textarea, this.startTime]) {
        field.addEventListener('compositionstart', () => { this.composing = true; });
        field.addEventListener('compositionend', () => {
          this.composing = false;
          this.schedulePlayback();
        });
        field.addEventListener('blur', () => this.schedulePlayback());
      }

      this.resizeObserver = new ResizeObserver(() => {
        clearTimeout(this.resizeTimer);
        if (!this.heightReady || !this.loaded || this.hidden || !this.isCurrent()) return;
        this.resizeTimer = setTimeout(() => this.saveHeight(), 300);
      });
      this.resizeObserver.observe(this.textarea);
      this.renderEnabled();
      this.renderVisibility();
      this.renderStatus();
    }

    canEdit() {
      if (!this.isCurrent()) {
        scheduleReconcile(0);
        return false;
      }
      return this.loaded;
    }

    activePage() {
      return this.memo.pages.find((page) => page.id === this.memo.activePageId) || this.memo.pages[0];
    }

    load() {
      this.loadError = false;
      this.renderStatus();
      const key = 'memo_pages_' + this.videoId;
      const legacyKey = 'memo_' + this.videoId;
      const heightKey = 'height_' + this.videoId;
      const widthKey = 'memo_sidebar_width_' + this.videoId;
      const complete = (result, error) => {
        if (!this.isCurrent()) return;
        if (error) {
          this.loadError = true;
          this.renderStatus();
          return;
        }
        this.memo = Model.normalizeMemo(memoCache.get(this.videoId) || result[key], result[legacyKey]);
        const height = heightCache.get(this.videoId) || result[heightKey];
        if (typeof height === 'string' && /^\d+(?:\.\d+)?px$/.test(height) && parseFloat(height) > 0) {
          this.textarea.style.height = height;
        }
        const savedWidth = widthCache.has(this.videoId) ? widthCache.get(this.videoId) : result[widthKey];
        this.sidebarWidth = Number.isFinite(savedWidth) && savedWidth >= MIN_MEMO_WIDTH
          ? Math.min(MAX_MEMO_WIDTH, Math.round(savedWidth)) : null;
        this.loaded = true;
        this.renderPage();
        this.renderStatus();
        this.heightReady = true;
        this.syncPlayback();
        scheduleReconcile(0);
      };
      try {
        chrome.storage.local.get([key, legacyKey, heightKey, widthKey], (result) => complete(result || {}, storageError()));
      } catch (error) {
        complete({}, error);
      }
    }

    persist() {
      if (!this.loaded || !this.isCurrent()) return;
      const snapshot = Model.normalizeMemo(this.memo);
      memoCache.set(this.videoId, snapshot);
      queueWrite(this.videoId, { ['memo_pages_' + this.videoId]: snapshot });
      this.renderStatus();
    }

    renderStatus() {
      let message = '';
      if (this.loadError) message = 'メモを読み込めませんでした。再試行してください。';
      else if (!this.loaded) message = 'メモを読み込み中...';
      else if (this.validationError) message = this.validationError;
      else if (writers.get(this.videoId)?.error) message = '保存できませんでした。再試行してください。';
      if (this.status.textContent !== message) this.status.textContent = message;
      this.statusRow.hidden = !message;
      this.statusRow.classList.toggle('youtube-memo-error', Boolean(this.loadError || this.validationError || writers.get(this.videoId)?.error));
      this.retry.hidden = !(this.loadError || writers.get(this.videoId)?.error);
    }

    renderOptions() {
      const options = this.memo.pages.map((page, index) => {
        const label = (index + 1) + '. ' + (page.title.trim() || 'ページ ' + (index + 1));
        const option = makeElement('option', null, label);
        option.value = page.id;
        return option;
      });
      this.select.replaceChildren(...options);
      this.select.value = this.memo.activePageId;
    }

    renderPage() {
      const page = this.activePage();
      this.titleRow.hidden = this.memo.pages.length < 2;
      this.title.hidden = this.memo.pages.length < 2;
      this.title.value = page.title;
      this.title.placeholder = 'ページ ' + (this.memo.pages.indexOf(page) + 1) + ' のタイトル';
      this.textarea.value = page.content;
      this.textarea.scrollTop = 0;
      this.startTime.value = Model.formatTime(page.startTime);
      this.validationError = '';
      this.startTime.removeAttribute('aria-invalid');
      this.startTime.setCustomValidity('');
      this.autoSwitch.checked = this.memo.autoSwitch;
      this.renderOptions();
      this.renderEnabled();
      this.renderStatus();
    }

    renderEnabled() {
      for (const field of [this.title, this.textarea, this.select, this.startTime, this.autoSwitch, this.add]) {
        field.disabled = !this.loaded;
      }
      const index = this.loaded ? this.memo.pages.findIndex((page) => page.id === this.memo.activePageId) : 0;
      const hasMultiplePages = this.loaded && this.memo.pages.length > 1;
      this.previous.hidden = !hasMultiplePages;
      this.next.hidden = !hasMultiplePages;
      this.previous.disabled = !hasMultiplePages || index <= 0;
      this.next.disabled = !hasMultiplePages || index >= this.memo.pages.length - 1;
      this.titlePrevious.disabled = this.previous.disabled;
      this.titleNext.disabled = this.next.disabled;
      this.moveUp.disabled = !hasMultiplePages || index <= 0;
      this.moveDown.disabled = !hasMultiplePages || index >= this.memo.pages.length - 1;
      this.remove.disabled = !hasMultiplePages;
      this.setTime.disabled = !this.loaded || !this.video;
      this.widthReset.disabled = !this.loaded || this.sidebarWidth === null;
    }

    renderVisibility() {
      this.area.hidden = this.hidden;
      this.container.classList.toggle('youtube-memo-hidden', this.hidden);
      this.container.classList.toggle('youtube-memo-visible', !this.hidden);
      this.toggle.textContent = this.hidden ? 'メモを表示' : 'メモを非表示';
      this.toggle.setAttribute('aria-expanded', String(!this.hidden));
      this.settings.hidden = !this.detailsOpen;
      this.settingsToggle.setAttribute('aria-expanded', String(this.detailsOpen));
      if (this.hidden) {
        clearTimeout(this.resizeTimer);
        this.stopWidthDrag(true);
      }
    }

    mountHeaderShow() {
      const center = document.querySelector('ytd-masthead #center') ||
        document.querySelector('#masthead-container #center');
      if (!center || !isVisible(center)) {
        this.headerShow.remove();
        return;
      }
      const voice = center.querySelector('#voice-search-button');
      const voiceIsChild = voice && voice.parentElement === center;
      if (this.headerShow.parentElement !== center ||
          (voiceIsChild && voice.nextElementSibling !== this.headerShow)) {
        if (voiceIsChild) voice.after(this.headerShow);
        else center.append(this.headerShow);
      }
    }

    clearWidthLayout() {
      if (!this.widthLayout) return;
      this.widthLayout.root.classList.remove('youtube-memo-width-layout');
      this.widthLayout.root.style.removeProperty('--youtube-memo-sidebar-width');
      this.widthLayout = null;
    }

    applyWidthLayout(layout) {
      const next = !this.hidden && this.loaded ? resizableColumns(layout) : null;
      if (this.widthLayout && this.widthLayout.root !== next?.root) this.clearWidthLayout();
      this.widthLayout = next;
      this.widthHandle.hidden = !next;
      if (!next) {
        this.widthHandle.removeAttribute('aria-valuenow');
        return;
      }
      const width = this.sidebarWidth === null ? null :
        Math.max(MIN_MEMO_WIDTH, Math.min(next.maxWidth, this.sidebarWidth));
      if (width === null) {
        next.root.classList.remove('youtube-memo-width-layout');
        next.root.style.removeProperty('--youtube-memo-sidebar-width');
      } else {
        const size = width + 'px';
        if (next.root.style.getPropertyValue('--youtube-memo-sidebar-width') !== size) {
          next.root.style.setProperty('--youtube-memo-sidebar-width', size);
        }
        next.root.classList.add('youtube-memo-width-layout');
      }
      const effective = width ?? Math.round(next.secondary.getBoundingClientRect().width);
      this.widthHandle.setAttribute('aria-valuenow', String(effective));
      this.widthHandle.setAttribute('aria-valuemin', String(MIN_MEMO_WIDTH));
      this.widthHandle.setAttribute('aria-valuemax', String(next.maxWidth));
    }

    saveWidth(value) {
      if (!this.canEdit()) return;
      this.sidebarWidth = value;
      widthCache.set(this.videoId, value);
      queueWrite(this.videoId, { ['memo_sidebar_width_' + this.videoId]: value });
      this.renderEnabled();
      this.renderStatus();
    }

    resetWidth() {
      if (!this.canEdit()) return;
      this.stopWidthDrag(true);
      this.saveWidth(null);
      this.applyWidthLayout(this.currentLayout);
    }

    beginWidthDrag(event) {
      if (event.button !== 0 || this.hidden || !this.loaded || !this.widthLayout) return;
      event.preventDefault();
      if (this.widthDrag) this.stopWidthDrag(true);
      this.widthDrag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: Math.round(this.widthLayout.secondary.getBoundingClientRect().width),
        original: this.sidebarWidth,
        maxWidth: this.widthLayout.maxWidth,
      };
      this.onWidthMove = (e) => this.moveWidthDrag(e);
      this.onWidthEnd = (e) => this.stopWidthDrag(false, e);
      this.onWidthCancel = (e) => this.stopWidthDrag(true, e);
      window.addEventListener('pointermove', this.onWidthMove);
      window.addEventListener('pointerup', this.onWidthEnd);
      window.addEventListener('pointercancel', this.onWidthCancel);
      document.documentElement.classList.add('youtube-memo-dragging');
      if (this.widthHandle.setPointerCapture) this.widthHandle.setPointerCapture(event.pointerId);
    }

    moveWidthDrag(event) {
      const drag = this.widthDrag;
      if (!drag || event.pointerId !== drag.pointerId || !this.isCurrent()) return;
      const width = Math.round(Math.max(MIN_MEMO_WIDTH,
        Math.min(drag.maxWidth, drag.startWidth + drag.startX - event.clientX)));
      if (width === this.sidebarWidth) return;
      this.sidebarWidth = width;
      this.applyWidthLayout(this.currentLayout);
      this.renderEnabled();
    }

    stopWidthDrag(cancel, event) {
      const drag = this.widthDrag;
      if (!drag || (event && event.pointerId !== drag.pointerId)) return;
      this.widthDrag = null;
      window.removeEventListener('pointermove', this.onWidthMove);
      window.removeEventListener('pointerup', this.onWidthEnd);
      window.removeEventListener('pointercancel', this.onWidthCancel);
      document.documentElement.classList.remove('youtube-memo-dragging');
      if (this.widthHandle.hasPointerCapture?.(drag.pointerId)) {
        this.widthHandle.releasePointerCapture(drag.pointerId);
      }
      if (cancel || this.sidebarWidth === drag.original ||
          Math.abs((this.sidebarWidth ?? drag.startWidth) - drag.startWidth) < 1) {
        this.sidebarWidth = drag.original;
        this.applyWidthLayout(this.currentLayout);
        this.renderEnabled();
        return;
      }
      this.saveWidth(this.sidebarWidth);
      this.applyWidthLayout(this.currentLayout);
    }

    resizeWidthWithKeyboard(event) {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key) ||
          this.hidden || !this.loaded || !this.widthLayout) return;
      event.preventDefault();
      const currentWidth = this.sidebarWidth ??
        this.widthLayout.secondary.getBoundingClientRect().width;
      const delta = event.key === 'ArrowLeft' ? 24 : -24;
      const width = Math.round(Math.max(MIN_MEMO_WIDTH,
        Math.min(this.widthLayout.maxWidth, currentWidth + delta)));
      if (width === Math.round(currentWidth)) return;
      this.saveWidth(width);
      this.applyWidthLayout(this.currentLayout);
    }

    selectPage(id, manual = false) {
      if (!this.canEdit() || !this.memo.pages.some((page) => page.id === id)) return;
      if (manual) this.rememberPlaybackSegment();
      if (this.memo.activePageId === id) return;
      this.memo.activePageId = id;
      this.renderPage();
      this.persist();
    }

    stepPage(direction) {
      if (!this.canEdit()) return;
      const index = this.memo.pages.findIndex((page) => page.id === this.memo.activePageId);
      const page = this.memo.pages[index + direction];
      if (page) this.selectPage(page.id, true);
    }

    movePage(direction) {
      if (!this.canEdit()) return;
      const index = this.memo.pages.findIndex((page) => page.id === this.memo.activePageId);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= this.memo.pages.length) return;
      // Move the page record as one unit, keeping its title, text, cue and ID together.
      const [page] = this.memo.pages.splice(index, 1);
      this.memo.pages.splice(destination, 0, page);
      this.rememberPlaybackSegment();
      this.renderPage();
      this.persist();
    }

    addPage() {
      if (!this.canEdit()) return;
      const page = Model.createPage(this.memo.pages);
      this.memo.pages.push(page);
      this.memo.activePageId = page.id;
      this.rememberPlaybackSegment();
      this.renderPage();
      this.persist();
      this.title.focus();
    }

    deletePage() {
      if (!this.canEdit() || this.memo.pages.length <= 1) return;
      const page = this.activePage();
      if ((page.content || page.title) && !window.confirm('このページを削除しますか？メモとタイトルも削除されます。')) return;
      const index = this.memo.pages.indexOf(page);
      this.memo.pages.splice(index, 1);
      this.memo.activePageId = this.memo.pages[Math.min(index, this.memo.pages.length - 1)].id;
      this.rememberPlaybackSegment();
      this.renderPage();
      this.persist();
    }

    saveStartTime() {
      if (!this.canEdit()) return;
      const raw = this.startTime.value.trim();
      const seconds = Model.parseTime(raw);
      if (raw && seconds === null) {
        this.validationError = '開始時刻を秒数・分:秒・時:分:秒で入力してください。';
        this.startTime.setAttribute('aria-invalid', 'true');
        this.startTime.setCustomValidity(this.validationError);
        this.renderStatus();
        return;
      }
      this.activePage().startTime = seconds;
      this.startTime.value = Model.formatTime(seconds);
      this.startTime.removeAttribute('aria-invalid');
      this.startTime.setCustomValidity('');
      this.validationError = '';
      this.rememberPlaybackSegment();
      this.persist();
      this.renderStatus();
    }

    rememberPlaybackSegment() {
      this.lastAutoPageId = this.video ? Model.getPageAtTime(this.memo.pages, this.video.currentTime) : null;
    }

    schedulePlayback() {
      clearTimeout(this.focusTimer);
      this.focusTimer = setTimeout(() => this.syncPlayback(), 0);
    }

    syncPlayback() {
      if (!this.isCurrent() || !this.loaded || !this.memo.autoSwitch || !this.video) return;
      if (this.composing || [this.title, this.textarea, this.startTime].includes(document.activeElement)) return;
      if (this.video.closest('.ad-showing') || this.root?.querySelector('#movie_player.ad-showing')) return;
      const target = Model.getPageAtTime(this.memo.pages, this.video.currentTime);
      if (!target || target === this.lastAutoPageId) return;
      this.lastAutoPageId = target;
      this.selectPage(target);
    }

    bindVideo(root) {
      this.root = root;
      const video = root ? firstVisible(root, '#movie_player video, video.html5-main-video, video') : null;
      if (this.video === video) return;
      if (this.video) {
        for (const type of ['timeupdate', 'seeking', 'seeked', 'loadedmetadata', 'durationchange', 'play']) {
          this.video.removeEventListener(type, this.onPlayback);
        }
      }
      this.video = video;
      if (video) {
        for (const type of ['timeupdate', 'seeking', 'seeked', 'loadedmetadata', 'durationchange', 'play']) {
          video.addEventListener(type, this.onPlayback);
        }
      }
      this.renderEnabled();
      this.syncPlayback();
    }

    saveHeight() {
      if (!this.isCurrent() || !this.loaded || this.hidden || !isVisible(this.textarea)) return;
      const height = getComputedStyle(this.textarea).height;
      if (!height.endsWith('px') || !Number.isFinite(parseFloat(height)) || parseFloat(height) <= 0) return;
      if (heightCache.get(this.videoId) === height) return;
      heightCache.set(this.videoId, height);
      queueWrite(this.videoId, { ['height_' + this.videoId]: height });
    }

    dispose() {
      this.stopWidthDrag(true);
      this.clearWidthLayout();
      this.headerShow.remove();
      this.disposed = true;
      clearTimeout(this.resizeTimer);
      clearTimeout(this.focusTimer);
      this.resizeObserver.disconnect();
      this.bindVideo(null);
      this.container.remove();
    }
  }

  function reconcile() {
    const videoId = videoIdFromUrl();
    // Invalidate the previous video before waiting for the next layout.
    if (current && current.videoId !== videoId) {
      current.dispose();
      current = null;
    }
    if (!videoId) return;
    if (!current) {
      current = new MemoController(videoId);
      current.load();
    }
    const layout = findLayout(videoId);
    current.currentLayout = layout;
    if (current.hidden) {
      // The related-video list is never covered by a collapsed memo panel.
      current.container.remove();
      current.clearWidthLayout();
      current.widthHandle.hidden = true;
      current.mountHeaderShow();
      current.bindVideo(layout?.root || null);
      return;
    }
    current.headerShow.remove();
    if (!layout) {
      current.container.remove();
      current.clearWidthLayout();
      current.widthHandle.hidden = true;
      current.bindVideo(null);
      return;
    }
    if (current.container.parentElement !== layout.host
      || (layout.prepend && layout.host.firstElementChild !== current.container)) {
      if (layout.prepend) layout.host.prepend(current.container);
      else layout.host.appendChild(current.container);
    }
    current.bindVideo(layout.root);
    current.applyWidthLayout(layout);
    current.syncPlayback();
  }

  function scheduleReconcile(delay = 100) {
    if (reconcileTimer !== null) return;
    reconcileTimer = setTimeout(() => {
      reconcileTimer = null;
      reconcile();
    }, delay);
  }

  new MutationObserver((records) => {
    // Editor changes must not trigger an endless observer/render cycle.
    if (records.some((record) => !current || !current.container.contains(record.target))) {
      scheduleReconcile();
    }
  }).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['hidden', 'style', 'class', 'video-id', 'aria-hidden'],
  });

  for (const type of ['yt-navigate-finish', 'yt-page-data-updated', 'popstate', 'pageshow', 'resize']) {
    window.addEventListener(type, () => scheduleReconcile(0));
  }
  document.addEventListener('fullscreenchange', () => scheduleReconcile(0));
  document.addEventListener('visibilitychange', () => scheduleReconcile(0));
  document.addEventListener('DOMContentLoaded', () => scheduleReconcile(0));
  // Also recover from missed SPA events, history changes, or attribute-only layout swaps.
  setInterval(reconcile, 1000);
  reconcile();
})();
