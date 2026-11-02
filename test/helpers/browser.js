const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let playwright;
try {
  playwright = require('playwright');
} catch (error) {
  if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw error;
  playwright = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright'));
}

const extensionRoot = path.resolve(__dirname, '../..');
let browser;

async function startBrowser() {
  browser = await playwright.chromium.launch({
    executablePath: process.env.YOUTUBE_MEMO_CHROMIUM_PATH || undefined,
    headless: true,
    args: ['--no-sandbox'],
  });
}

async function stopBrowser() {
  if (browser) await browser.close();
}

function watchLayout(videoId, { hosts = true, hiddenSidebar = false } = {}) {
  const player = '<div id="movie_player"><video></video></div>';
  const columns = hosts
    ? `<div id="primary">${player}<p>Video description</p></div><div id="secondary" ${hiddenSidebar ? 'hidden' : ''}><p>Related videos</p></div>`
    : player;
  return `<ytd-watch-flexy video-id="${videoId}" id="watch-${videoId}"><div id="columns">${columns}</div></ytd-watch-flexy>`;
}

function fixtureHtml(videoId, options) {
  const hiddenDuplicate = options.hiddenDuplicate
    ? `<div hidden>${watchLayout('previous-video')}</div>`
    : '';
  return `<!doctype html><html ${options.dark ? 'dark' : ''}><head><style>
    * { box-sizing: border-box; }
    html { color: #0f0f0f; background: #fff; font-family: Arial, sans-serif; }
    html[dark] { color: #f1f1f1; background: #0f0f0f; }
    body { margin: 0; padding: 16px; }
    h1 { font-size: 18px; }
    ytd-watch-flexy { display: block; }
    [hidden] { display: none !important; }
    #masthead-container { height: 56px; margin: -16px -16px 16px; padding: 0 32px; background: #222; color: #fff; }
    #masthead #center { height: 56px; display: flex; align-items: center; }
    #voice-search-button { border-radius: 50%; background: #444; width: 36px; height: 36px; }
    #columns { display: flex; align-items: flex-start; gap: 24px; width: 100%; }
    #primary { width: 700px; min-width: 0; min-height: 240px; }
    #secondary { width: 360px; min-width: 0; min-height: 240px; }
    #movie_player { width: 100%; height: 180px; background: #222; }
    video { width: 100%; height: 100%; }
    @media (max-width: 800px) {
      #columns { flex-direction: column; }
      #primary, #secondary { width: 100%; }
    }
  </style></head><body><div id="masthead-container"><ytd-masthead id="masthead"><div id="center"><span>検索</span><div id="voice-search-button" aria-label="音声検索"></div></div></ytd-masthead></div><h1 tabindex="0">Fixture video</h1>${hiddenDuplicate}${watchLayout(videoId, options)}</body></html>`;
}

// Stub only the extension API boundary. DOM, timers, observers and events remain Chromium's.
function installStorage({ saved, holdReads, holdWrites, getFailures = [], getThrows = [] }) {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const state = {
    data: clone(saved),
    pendingReads: [],
    pendingWrites: [],
    writes: [],
    holdReads,
    holdWrites,
    getFailures: [...getFailures],
    getThrows: [...getThrows],
    gets: 0,
  };
  window.chrome = window.chrome || {};
  chrome.runtime = chrome.runtime || {};

  function complete(request, result, error) {
    if (request.callback) {
      if (error) chrome.runtime.lastError = { message: error };
      try {
        request.callback(result);
      } finally {
        delete chrome.runtime.lastError;
      }
    } else if (error) {
      request.reject(new Error(error));
    } else {
      request.resolve(result);
    }
  }

  state.releaseRead = (index = 0, error = null) => {
    const [request] = state.pendingReads.splice(index, 1);
    if (!request) throw new Error(`No pending read at index ${index}`);
    complete(request, request.result, error);
  };
  state.releaseWrite = (index = 0, error = null) => {
    const [request] = state.pendingWrites.splice(index, 1);
    if (!request) throw new Error(`No pending write at index ${index}`);
    if (!error) Object.assign(state.data, clone(request.values));
    complete(request, undefined, error);
  };

  chrome.storage = { local: {
    get(keys, callback) {
      state.gets += 1;
      if (state.getThrows.length) throw new Error(state.getThrows.shift());
      let resolve;
      let reject;
      const promise = callback ? undefined : new Promise((yes, no) => { resolve = yes; reject = no; });
      const names = keys === null ? Object.keys(state.data) : typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const result = {};
      for (const key of names) {
        if (Object.hasOwn(state.data, key)) result[key] = clone(state.data[key]);
        else if (keys && !Array.isArray(keys) && typeof keys === 'object') result[key] = clone(keys[key]);
      }
      const request = { keys: names, result, callback, resolve, reject };
      if (state.getFailures.length) {
        const failure = state.getFailures.shift();
        setTimeout(() => complete(request, result, failure), 0);
      } else if (state.holdReads) state.pendingReads.push(request);
      else setTimeout(() => complete(request, result), 0);
      return promise;
    },
    set(values, callback) {
      let resolve;
      let reject;
      const promise = callback ? undefined : new Promise((yes, no) => { resolve = yes; reject = no; });
      const request = { values: clone(values), callback, resolve, reject };
      state.writes.push(clone(values));
      if (state.holdWrites) state.pendingWrites.push(request);
      else setTimeout(() => {
        Object.assign(state.data, request.values);
        complete(request);
      }, 0);
      return promise;
    },
  } };
  window.__storage = state;
}

async function createFixture(t, options = {}) {
  const videoId = options.videoId || 'video-a';
  const context = await browser.newContext({ viewport: options.viewport || { width: 1200, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, [], 'content scripts should not throw in the browser');
  });
  if (options.clock) await page.clock.install({ time: new Date('2026-11-01T12:00:00Z') });
  await page.addInitScript(installStorage, {
    saved: options.saved || {},
    holdReads: options.holdReads || false,
    holdWrites: options.holdWrites || false,
    getFailures: options.getFailures || [],
    getThrows: options.getThrows || [],
  });
  await page.route('**/*', async (route) => {
    if (route.request().isNavigationRequest()) {
      await route.fulfill({ contentType: 'text/html', body: fixtureHtml(videoId, options) });
    } else {
      await route.abort();
    }
  });
  await page.goto(`https://www.youtube.com/watch?v=${videoId}`);
  await page.addStyleTag({ path: path.join(extensionRoot, 'styles.css') });
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
  for (const script of manifest.content_scripts[0].js) {
    await page.addScriptTag({ path: path.join(extensionRoot, script) });
  }
  return page;
}

async function ready(page, videoId = 'video-a') {
  // In page-specific split mode the editor is hidden, but still attached and loaded.
  await page.locator('#youtube-memo-textarea').waitFor({ state: 'attached' });
  await page.waitForFunction((id) => {
    const textarea = document.getElementById('youtube-memo-textarea');
    return textarea && !textarea.disabled && textarea.dataset.videoId === id;
  }, videoId);
}

async function navigate(page, videoId, { hosts = true } = {}) {
  const layout = videoId ? watchLayout(videoId, { hosts }) : '<p>Home feed</p>';
  await page.evaluate(({ videoId, layout }) => {
    history.pushState({}, '', videoId ? `/watch?v=${videoId}` : '/');
    for (const watch of document.querySelectorAll('ytd-watch-flexy')) watch.remove();
    document.body.insertAdjacentHTML('beforeend', layout);
    window.dispatchEvent(new Event('yt-navigate-finish'));
  }, { videoId, layout });
}

async function setTime(page, seconds, selector = '#movie_player video') {
  await page.locator(selector).evaluate((video, seconds) => {
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: seconds });
    video.dispatchEvent(new Event('timeupdate'));
    video.dispatchEvent(new Event('seeked'));
  }, seconds);
}

async function textEquals(page, text) {
  await page.waitForFunction((text) => document.getElementById('youtube-memo-textarea')?.value === text, text);
}

async function savedRecord(page, videoId = 'video-a', predicate = null) {
  const key = `memo_pages_${videoId}`;
  await page.waitForFunction((key) => Boolean(window.__storage.data[key]), key);
  if (predicate) await page.waitForFunction(predicate, key);
  return page.evaluate((key) => window.__storage.data[key], key);
}

function record({ autoSwitch = false, activePageId = 'one', pages } = {}) {
  return {
    version: 1,
    pages: pages || [
      { id: 'one', title: 'Intro', content: 'First page', startTime: 0 },
      { id: 'two', title: 'Middle', content: 'Second page', startTime: 30 },
      { id: 'three', title: 'Ending', content: 'Third page', startTime: 60 },
      { id: 'manual', title: 'Notes', content: 'Manual page', startTime: null },
    ],
    activePageId,
    autoSwitch,
  };
}

module.exports = { startBrowser, stopBrowser, createFixture, ready, navigate, setTime, textEquals, savedRecord, record, watchLayout };
