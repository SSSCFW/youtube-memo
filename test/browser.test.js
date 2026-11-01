const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  startBrowser, stopBrowser, createFixture, ready, navigate,
  setTime, textEquals, savedRecord, record,
} = require('./helpers/browser');

before(startBrowser);
after(stopBrowser);

test('uses the active visible sidebar when an earlier duplicate sidebar is hidden', async (t) => {
  const page = await createFixture(t, { hiddenDuplicate: true });
  await ready(page);
  assert.equal(await page.locator('#youtube-memo-container').evaluate((element) => element.closest('ytd-watch-flexy').getAttribute('video-id')), 'video-a');
  assert.equal(await page.locator('#youtube-memo-container').count(), 1);
});

test('keeps recovering when a watch layout appears more than ten seconds after navigation', async (t) => {
  const page = await createFixture(t, { hosts: false, clock: true });
  await page.clock.fastForward(11000);
  assert.equal(await page.locator('#youtube-memo-container').count(), 0);
  await page.locator('#columns').evaluate((columns) => {
    columns.insertAdjacentHTML('beforeend', '<div id="secondary"><p>Late related videos</p></div>');
  });
  await page.clock.runFor(1200);
  await ready(page);
});

test('restores a memo removed by a same-URL DOM rerender without losing unsaved typing', async (t) => {
  const page = await createFixture(t);
  await ready(page);
  await page.locator('#youtube-memo-textarea').fill('Draft survives the rerender');
  await page.locator('#youtube-memo-container').evaluate((element) => element.remove());
  await ready(page);
  await textEquals(page, 'Draft survives the rerender');
  assert.equal(await page.locator('#youtube-memo-container').count(), 1);
});

test('repairs a memo moved into an unrelated hidden element on the same URL', async (t) => {
  const page = await createFixture(t);
  await ready(page);
  await page.evaluate(() => {
    const stash = document.createElement('div');
    stash.hidden = true;
    document.body.append(stash);
    stash.append(document.getElementById('youtube-memo-container'));
  });
  await page.waitForFunction(() => document.getElementById('youtube-memo-container')?.parentElement?.id === 'secondary');
  assert.equal(await page.locator('#youtube-memo-textarea').isVisible(), true);
});

test('uses the primary column while the sidebar is hidden and reacts to attribute-only layout changes', async (t) => {
  const page = await createFixture(t, { hiddenSidebar: true });
  await ready(page);
  assert.equal(await page.locator('#youtube-memo-container').evaluate((element) => element.parentElement.id), 'primary');
  await page.locator('#secondary').evaluate((element) => { element.hidden = false; });
  await page.waitForFunction(() => document.getElementById('youtube-memo-container')?.parentElement?.id === 'secondary');
  await page.locator('#secondary').evaluate((element) => { element.style.display = 'none'; });
  await page.waitForFunction(() => document.getElementById('youtube-memo-container')?.parentElement?.id === 'primary');
});

test('preserves a legacy memo and height, then saves edited content as page one', async (t) => {
  const page = await createFixture(t, { saved: { 'memo_video-a': 'Old handwritten memo', 'height_video-a': '315px' } });
  await ready(page);
  await textEquals(page, 'Old handwritten memo');
  assert.equal(await page.locator('#youtube-memo-textarea').evaluate((element) => getComputedStyle(element).height), '315px');
  assert.equal(await page.locator('#youtube-memo-page-title').isVisible(), false);
  await page.locator('#youtube-memo-textarea').fill('Migrated and edited');
  const saved = await savedRecord(page, 'video-a', (key) => window.__storage.data[key]?.pages?.[0]?.content === 'Migrated and edited');
  assert.equal(saved.version, 1);
  assert.equal(saved.pages.length, 1);
  assert.equal(saved.pages[0].startTime, 0);
  assert.equal(saved.autoSwitch, false);
  assert.equal(await page.evaluate(() => window.__storage.data['memo_video-a']), 'Old handwritten memo');
});

test('waits for a new video layout and keeps each video memo separate across SPA navigation', async (t) => {
  const page = await createFixture(t, { saved: { 'memo_video-a': 'Alpha', 'memo_video-b': 'Bravo' } });
  await ready(page);
  await textEquals(page, 'Alpha');
  await navigate(page, 'video-b', { hosts: false });
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#youtube-memo-textarea').isVisible(), false);
  await page.locator('#columns').evaluate((columns) => {
    columns.insertAdjacentHTML('beforeend', '<div id="secondary"><p>New related videos</p></div>');
  });
  await ready(page, 'video-b');
  await textEquals(page, 'Bravo');
  await page.locator('#youtube-memo-textarea').fill('Bravo edited');
  await savedRecord(page, 'video-b', (key) => window.__storage.data[key]?.pages?.[0]?.content === 'Bravo edited');
  await navigate(page, 'video-a');
  await ready(page);
  await textEquals(page, 'Alpha');
  await navigate(page, null);
  await page.waitForFunction(() => !document.getElementById('youtube-memo-container'));
});

test('places settings beside the hide button below the memo and keeps page text and titles independent', async (t) => {
  const page = await createFixture(t, { saved: { 'memo_video-a': 'Original first page' } });
  await ready(page);
  assert.equal(await page.locator('#youtube-memo-settings').isVisible(), false);
  assert.equal(await page.locator('#youtube-memo-page-title').isVisible(), false);
  const layout = await page.evaluate(() => {
    const box = (id) => document.getElementById(id).getBoundingClientRect().toJSON();
    return {
      memo: box('youtube-memo-area'),
      actions: box('youtube-memo-actions'),
      settings: box('youtube-memo-settings-toggle'),
      hide: box('youtube-memo-toggle'),
    };
  });
  assert.ok(layout.actions.top >= layout.memo.bottom, 'actions follow the memo area');
  assert.ok(Math.abs(layout.settings.top - layout.hide.top) <= 2, 'settings and visibility controls share one row');
  assert.ok(layout.settings.right <= layout.hide.left, 'settings precedes the hide control');
  await page.locator('#youtube-memo-settings-toggle').click();
  assert.equal(await page.locator('#youtube-memo-settings').isVisible(), true);
  assert.equal(await page.locator('#youtube-memo-delete').isDisabled(), true);
  await page.locator('#youtube-memo-add').click();
  assert.equal(await page.locator('#youtube-memo-page-select option').count(), 2);
  assert.equal(await page.locator('#youtube-memo-page-title').isVisible(), true);
  await textEquals(page, '');
  assert.equal(await page.locator('#youtube-memo-start-time').inputValue(), '');
  await page.locator('#youtube-memo-page-title').fill('Second title');
  await page.locator('#youtube-memo-textarea').fill('Second content');
  await page.locator('#youtube-memo-prev').click();
  await textEquals(page, 'Original first page');
  assert.equal(await page.locator('#youtube-memo-page-title').inputValue(), '');
  await page.locator('#youtube-memo-page-title').fill('First title');
  await page.locator('#youtube-memo-textarea').fill('First content');
  await page.locator('#youtube-memo-next').click();
  await textEquals(page, 'Second content');
  assert.equal(await page.locator('#youtube-memo-page-title').inputValue(), 'Second title');
  const saved = await savedRecord(page, 'video-a', (key) => window.__storage.data[key]?.pages?.[0]?.title === 'First title' && window.__storage.data[key]?.pages?.[1]?.content === 'Second content');
  assert.deepEqual(saved.pages.map(({ title, content, startTime }) => ({ title, content, startTime })), [
    { title: 'First title', content: 'First content', startTime: 0 },
    { title: 'Second title', content: 'Second content', startTime: null },
  ]);
  await page.locator('#youtube-memo-settings-toggle').click();
  assert.equal(await page.locator('#youtube-memo-settings').isVisible(), false);
  assert.equal(await page.locator('#youtube-memo-textarea').isVisible(), true);
});

test('confirms deletion of a populated page and prevents deletion of the final page', async (t) => {
  const page = await createFixture(t, { saved: { 'memo_pages_video-a': record({ pages: [
    { id: 'one', title: 'Keep me', content: 'First page', startTime: 0 },
    { id: 'two', title: '', content: 'Second page', startTime: null },
  ] }) } });
  await ready(page);
  await page.locator('#youtube-memo-settings-toggle').click();
  await page.locator('#youtube-memo-next').click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('#youtube-memo-delete').click();
  assert.equal(await page.locator('#youtube-memo-page-select option').count(), 2);
  await textEquals(page, 'Second page');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#youtube-memo-delete').click();
  assert.equal(await page.locator('#youtube-memo-page-select option').count(), 1);
  await textEquals(page, 'First page');
  assert.equal(await page.locator('#youtube-memo-delete').isDisabled(), true);
  assert.equal(await page.locator('#youtube-memo-page-title').isVisible(), false);
  const saved = await savedRecord(page, 'video-a', (key) => window.__storage.data[key]?.pages?.length === 1);
  assert.equal(saved.pages[0].title, 'Keep me');
});

test('accepts a timestamp, rejects invalid time without changing data, and captures current playback time', async (t) => {
  const page = await createFixture(t);
  await ready(page);
  await page.locator('#youtube-memo-settings-toggle').click();
  const time = page.locator('#youtube-memo-start-time');
  assert.equal(await time.inputValue(), '0:00');
  await time.fill('1:02:03');
  await time.press('Tab');
  let saved = await savedRecord(page, 'video-a', (key) => window.__storage.data[key]?.pages?.[0]?.startTime === 3723);
  assert.equal(saved.pages[0].startTime, 3723);
  await time.fill('-1');
  await time.press('Tab');
  await page.waitForTimeout(350);
  saved = await savedRecord(page);
  assert.equal(saved.pages[0].startTime, 3723);
  assert.ok((await page.locator('#youtube-memo-status').textContent()).trim(), 'invalid timestamp is explained');
  await setTime(page, 92);
  await page.locator('#youtube-memo-set-time').click();
  saved = await savedRecord(page, 'video-a', (key) => window.__storage.data[key]?.pages?.[0]?.startTime === 92);
  assert.equal(saved.pages[0].startTime, 92);
  assert.equal(await time.inputValue(), '1:32');
  await time.fill('');
  await time.press('Tab');
  saved = await savedRecord(page, 'video-a', (key) => window.__storage.data[key]?.pages?.[0]?.startTime === null);
  assert.equal(saved.pages[0].startTime, null);
});

test('keeps automatic switching opt-in and persists the preference separately for each video', async (t) => {
  const page = await createFixture(t, { saved: { 'memo_pages_video-a': record() } });
  await ready(page);
  await page.locator('#youtube-memo-settings-toggle').click();
  assert.equal(await page.locator('#youtube-memo-auto-switch').isChecked(), false);
  await setTime(page, 75);
  await textEquals(page, 'First page');
  await page.locator('#youtube-memo-auto-switch').check();
  await textEquals(page, 'Third page');
  await savedRecord(page, 'video-a', (key) => window.__storage.data[key]?.autoSwitch === true);
  await navigate(page, 'video-b');
  await ready(page, 'video-b');
  if (!(await page.locator('#youtube-memo-settings').isVisible())) await page.locator('#youtube-memo-settings-toggle').click();
  assert.equal(await page.locator('#youtube-memo-auto-switch').isChecked(), false);
  await navigate(page, 'video-a');
  await ready(page);
  if (!(await page.locator('#youtube-memo-settings').isVisible())) await page.locator('#youtube-memo-settings-toggle').click();
  assert.equal(await page.locator('#youtube-memo-auto-switch').isChecked(), true);
  await page.locator('#youtube-memo-auto-switch').uncheck();
  await setTime(page, 35);
  await textEquals(page, 'First page');
  await savedRecord(page, 'video-a', (key) => window.__storage.data[key]?.autoSwitch === false);
});

test('switches timed pages on forward and backward seeks while leaving untimed pages manual-only', async (t) => {
  const page = await createFixture(t, { saved: { 'memo_pages_video-a': record({ autoSwitch: true }) } });
  await ready(page);
  await textEquals(page, 'First page');
  await setTime(page, 75);
  await textEquals(page, 'Third page');
  await setTime(page, 20);
  await textEquals(page, 'First page');
  await setTime(page, 30);
  await textEquals(page, 'Second page');
  await setTime(page, 1000);
  await textEquals(page, 'Third page');
});

test('honors a manual page choice until playback crosses into another timed segment', async (t) => {
  const page = await createFixture(t, { saved: { 'memo_pages_video-a': record({ autoSwitch: true }) } });
  await ready(page);
  await page.locator('#youtube-memo-settings-toggle').click();
  await setTime(page, 5);
  await page.locator('#youtube-memo-page-select').selectOption('manual');
  await textEquals(page, 'Manual page');
  await setTime(page, 10);
  await textEquals(page, 'Manual page');
  await setTime(page, 31);
  await textEquals(page, 'Second page');
});

test('defers automatic page changes while typing or composing with an IME', async (t) => {
  const page = await createFixture(t, { saved: { 'memo_pages_video-a': record({ autoSwitch: true }) } });
  await ready(page);
  const textarea = page.locator('#youtube-memo-textarea');
  await textarea.fill('Editing the introduction');
  await setTime(page, 40);
  await page.waitForTimeout(100);
  await textEquals(page, 'Editing the introduction');
  await page.locator('h1').focus();
  await textEquals(page, 'Second page');
  await textarea.focus();
  await textarea.dispatchEvent('compositionstart', { data: '編' });
  await textarea.evaluate((element) => {
    element.value = '編集中';
    element.dispatchEvent(new InputEvent('input', { bubbles: true, data: '編集中', isComposing: true }));
  });
  await setTime(page, 70);
  await page.locator('h1').focus();
  await page.waitForTimeout(100);
  await textEquals(page, '編集中');
  await textarea.dispatchEvent('compositionend', { data: '編集中' });
  await textEquals(page, 'Third page');
  const saved = await savedRecord(page, 'video-a', (key) => window.__storage.data[key]?.pages?.[1]?.content === '編集中');
  assert.equal(saved.pages[0].content, 'Editing the introduction');
  assert.equal(saved.pages[1].content, '編集中');
});

test('also protects title and timestamp editing from automatic page changes', async (t) => {
  const page = await createFixture(t, { saved: { 'memo_pages_video-a': record({ autoSwitch: true }) } });
  await ready(page);
  await page.locator('#youtube-memo-settings-toggle').click();
  await page.locator('#youtube-memo-page-title').fill('Title being edited');
  await setTime(page, 40);
  await page.waitForTimeout(100);
  await textEquals(page, 'First page');
  assert.equal(await page.locator('#youtube-memo-page-title').inputValue(), 'Title being edited');
  await page.locator('h1').focus();
  await textEquals(page, 'Second page');
  await page.locator('#youtube-memo-start-time').focus();
  await setTime(page, 70);
  await page.waitForTimeout(100);
  await textEquals(page, 'Second page');
  await page.locator('h1').focus();
  await textEquals(page, 'Third page');
  const saved = await savedRecord(page, 'video-a', (key) => window.__storage.data[key]?.pages?.[0]?.title === 'Title being edited');
  assert.equal(saved.pages[0].title, 'Title being edited');
});

test('follows a replaced video element and ignores time events from the detached player', async (t) => {
  const page = await createFixture(t, { saved: { 'memo_pages_video-a': record({ autoSwitch: true }) } });
  await ready(page);
  await setTime(page, 35);
  await textEquals(page, 'Second page');
  await page.evaluate(() => {
    const oldVideo = document.querySelector('#movie_player video');
    window.__detachedVideo = oldVideo;
    const next = document.createElement('video');
    Object.defineProperty(next, 'currentTime', { configurable: true, writable: true, value: 65 });
    oldVideo.replaceWith(next);
  });
  await textEquals(page, 'Third page');
  await page.evaluate(() => {
    window.__detachedVideo.currentTime = 5;
    window.__detachedVideo.dispatchEvent(new Event('timeupdate'));
  });
  await page.waitForTimeout(100);
  await textEquals(page, 'Third page');
  await setTime(page, 5);
  await textEquals(page, 'First page');
});

test('disables editing during load and ignores a late callback from the previous video', async (t) => {
  const page = await createFixture(t, {
    saved: { 'memo_video-a': 'Delayed Alpha', 'memo_video-b': 'Loaded Bravo' },
    holdReads: true,
  });
  await page.locator('#youtube-memo-textarea').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#youtube-memo-textarea').isDisabled(), true);
  await navigate(page, 'video-b');
  await page.waitForFunction(() => window.__storage.pendingReads.length === 2);
  assert.equal(await page.locator('#youtube-memo-textarea').isDisabled(), true);
  await page.evaluate(() => window.__storage.releaseRead(1));
  await ready(page, 'video-b');
  await textEquals(page, 'Loaded Bravo');
  await page.locator('#youtube-memo-textarea').fill('Bravo after load');
  await savedRecord(page, 'video-b', (key) => window.__storage.data[key]?.pages?.[0]?.content === 'Bravo after load');
  await page.evaluate(() => window.__storage.releaseRead(0));
  await page.waitForTimeout(200);
  await textEquals(page, 'Bravo after load');
  assert.equal(await page.evaluate(() => window.__storage.data['memo_video-a']), 'Delayed Alpha');
  assert.equal(await page.evaluate(() => window.__storage.writes.some((write) => Object.hasOwn(write, 'memo_pages_video-a'))), false);
});

test('keeps unread data protected and reports a storage load failure', async (t) => {
  const page = await createFixture(t, { saved: { 'memo_video-a': 'Must not be overwritten' }, holdReads: true });
  await page.locator('#youtube-memo-textarea').waitFor({ state: 'visible' });
  await page.evaluate(() => window.__storage.releaseRead(0, 'Storage is temporarily unavailable'));
  await page.waitForFunction(() => document.getElementById('youtube-memo-status')?.textContent.trim());
  assert.equal(await page.locator('#youtube-memo-textarea').isDisabled(), true);
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.__storage.data['memo_video-a']), 'Must not be overwritten');
  assert.equal(await page.evaluate(() => window.__storage.writes.some((write) => Object.hasOwn(write, 'memo_pages_video-a'))), false);
});

test('serializes asynchronous saves so an older write cannot overwrite the latest edit', async (t) => {
  const page = await createFixture(t);
  await ready(page);
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__storage.holdWrites = true; });
  await page.locator('#youtube-memo-textarea').fill('First pending edit');
  await page.waitForFunction(() => window.__storage.pendingWrites.some((write) => Object.hasOwn(write.values, 'memo_pages_video-a')));
  await page.locator('#youtube-memo-textarea').fill('Newest edit wins');
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.__storage.pendingWrites.filter((write) => Object.hasOwn(write.values, 'memo_pages_video-a')).length), 1, 'only one record write may be in flight');
  await page.evaluate(() => {
    const index = window.__storage.pendingWrites.findIndex((write) => Object.hasOwn(write.values, 'memo_pages_video-a'));
    window.__storage.releaseWrite(index);
  });
  await page.waitForFunction(() => window.__storage.pendingWrites.some((write) => write.values['memo_pages_video-a']?.pages?.[0]?.content === 'Newest edit wins'));
  await page.evaluate(() => {
    const index = window.__storage.pendingWrites.findIndex((write) => write.values['memo_pages_video-a']?.pages?.[0]?.content === 'Newest edit wins');
    window.__storage.releaseWrite(index);
  });
  const saved = await savedRecord(page, 'video-a', (key) => window.__storage.data[key]?.pages?.[0]?.content === 'Newest edit wins');
  assert.equal(saved.pages[0].content, 'Newest edit wins');
});

test('finishes queued saves for the old video without overwriting the newly opened video', async (t) => {
  const page = await createFixture(t, { saved: { 'memo_video-a': 'Alpha', 'memo_video-b': 'Bravo' } });
  await ready(page);
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__storage.holdWrites = true; });
  await page.locator('#youtube-memo-textarea').fill('First Alpha edit');
  await page.waitForFunction(() => window.__storage.pendingWrites.some((write) => Object.hasOwn(write.values, 'memo_pages_video-a')));
  await page.locator('#youtube-memo-textarea').fill('Final Alpha edit');
  await page.waitForTimeout(350);
  await navigate(page, 'video-b');
  await ready(page, 'video-b');
  await textEquals(page, 'Bravo');
  await page.locator('#youtube-memo-textarea').fill('Final Bravo edit');
  await page.waitForFunction(() => window.__storage.pendingWrites.some((write) => Object.hasOwn(write.values, 'memo_pages_video-b')));
  await page.evaluate(() => {
    const index = window.__storage.pendingWrites.findIndex((write) => Object.hasOwn(write.values, 'memo_pages_video-b'));
    window.__storage.releaseWrite(index);
  });
  await savedRecord(page, 'video-b', (key) => window.__storage.data[key]?.pages?.[0]?.content === 'Final Bravo edit');
  await page.evaluate(() => {
    const index = window.__storage.pendingWrites.findIndex((write) => Object.hasOwn(write.values, 'memo_pages_video-a'));
    window.__storage.releaseWrite(index);
  });
  await page.waitForFunction(() => window.__storage.pendingWrites.some((write) => write.values['memo_pages_video-a']?.pages?.[0]?.content === 'Final Alpha edit'));
  await page.evaluate(() => {
    const index = window.__storage.pendingWrites.findIndex((write) => write.values['memo_pages_video-a']?.pages?.[0]?.content === 'Final Alpha edit');
    window.__storage.releaseWrite(index);
  });
  const saved = await savedRecord(page, 'video-a', (key) => window.__storage.data[key]?.pages?.[0]?.content === 'Final Alpha edit');
  assert.equal(saved.pages[0].content, 'Final Alpha edit');
  await textEquals(page, 'Final Bravo edit');
});

test('reports a failed save and can save a later edit successfully', async (t) => {
  const page = await createFixture(t);
  await ready(page);
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__storage.holdWrites = true; });
  await page.locator('#youtube-memo-textarea').fill('Unsaved edit');
  await page.waitForFunction(() => window.__storage.pendingWrites.some((write) => Object.hasOwn(write.values, 'memo_pages_video-a')));
  await page.evaluate(() => {
    const index = window.__storage.pendingWrites.findIndex((write) => Object.hasOwn(write.values, 'memo_pages_video-a'));
    window.__storage.releaseWrite(index, 'Write quota exceeded');
  });
  await page.waitForFunction(() => document.getElementById('youtube-memo-status')?.textContent.trim());
  await textEquals(page, 'Unsaved edit');
  await page.evaluate(() => { window.__storage.holdWrites = false; });
  await page.locator('#youtube-memo-textarea').fill('Successful later edit');
  await savedRecord(page, 'video-a', (key) => window.__storage.data[key]?.pages?.[0]?.content === 'Successful later edit');
});

test('keeps a real resized height when the memo is collapsed and expanded', async (t) => {
  const page = await createFixture(t, { saved: { 'height_video-a': '220px' } });
  await ready(page);
  await page.locator('#youtube-memo-textarea').evaluate((element) => { element.style.height = '280px'; });
  await page.waitForFunction(() => window.__storage.data['height_video-a'] === '280px');
  await page.locator('#youtube-memo-toggle').click();
  assert.equal(await page.locator('#youtube-memo-area').isVisible(), false);
  assert.equal(await page.locator('#youtube-memo-header-show').textContent(), 'メモを表示');
  assert.equal(await page.locator('#secondary #youtube-memo-container').count(), 0);
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.__storage.data['height_video-a']), '280px');
  await page.locator('#youtube-memo-header-show').click();
  assert.equal(await page.locator('#youtube-memo-area').isVisible(), true);
  assert.equal(await page.locator('#youtube-memo-textarea').evaluate((element) => getComputedStyle(element).height), '280px');
});

for (const dark of [false, true]) {
  test(`fits memo controls into a narrow ${dark ? 'dark' : 'light'} layout`, async (t) => {
    const page = await createFixture(t, {
      dark,
      viewport: { width: 390, height: 1100 },
      saved: { 'memo_pages_video-a': record({ pages: [
        { id: 'one', title: '長いタイトルのメモページ', content: '動画を見ながらメモを入力します。', startTime: 0 },
        { id: 'two', title: 'もう一つのページ', content: '後半のメモ', startTime: 45 },
      ] }) },
    });
    await ready(page);
    await page.locator('#youtube-memo-settings-toggle').click();
    const bounds = await page.locator('#youtube-memo-container').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left, right: rect.right, viewport: innerWidth,
        scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
        controls: [...element.querySelectorAll('input, textarea, select, button')]
          .filter((control) => control.getClientRects().length)
          .map((control) => ({ id: control.id, left: control.getBoundingClientRect().left, right: control.getBoundingClientRect().right })),
      };
    });
    assert.ok(bounds.left >= 0 && bounds.right <= bounds.viewport, 'memo stays within the viewport');
    assert.ok(bounds.scrollWidth <= bounds.clientWidth + 1, 'memo has no horizontal overflow');
    for (const control of bounds.controls) {
      assert.ok(control.left >= bounds.left && control.right <= bounds.right + 1, `${control.id} stays inside the memo`);
    }
    if (process.env.YOUTUBE_MEMO_SCREENSHOTS) {
      fs.mkdirSync(process.env.YOUTUBE_MEMO_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.YOUTUBE_MEMO_SCREENSHOTS, `memo-${dark ? 'dark' : 'light'}-390.png`), fullPage: true });
    }
  });
}


test('shows bottom page navigation without expanding settings only when multiple pages exist', async (t) => {
  const page = await createFixture(t, { saved: { 'memo_video-a': 'Original page' } });
  await ready(page);
  assert.equal(await page.locator('#youtube-memo-prev').isVisible(), false);
  assert.equal(await page.locator('#youtube-memo-next').isVisible(), false);
  assert.equal(await page.locator('#youtube-memo-settings-toggle').isVisible(), true);
  assert.equal(await page.locator('#youtube-memo-toggle').isVisible(), true);

  await page.locator('#youtube-memo-settings-toggle').click();
  await page.locator('#youtube-memo-add').click();
  await page.locator('#youtube-memo-page-title').fill('Another page');
  await page.locator('#youtube-memo-textarea').fill('Second page');
  await page.locator('#youtube-memo-settings-toggle').click();

  assert.equal(await page.locator('#youtube-memo-settings').isVisible(), false);
  assert.equal(await page.locator('#youtube-memo-prev').isVisible(), true);
  assert.equal(await page.locator('#youtube-memo-next').isVisible(), true);
  const order = await page.locator('#youtube-memo-actions > button').evaluateAll((buttons) => buttons.map((button) => button.id));
  assert.deepEqual(order, [
    'youtube-memo-prev', 'youtube-memo-next', 'youtube-memo-settings-toggle', 'youtube-memo-toggle',
  ]);
  assert.equal(await page.locator('#youtube-memo-prev').textContent(), '戻る');
  assert.equal(await page.locator('#youtube-memo-next').textContent(), '前へ');

  const positions = await page.locator('#youtube-memo-actions > button').evaluateAll((buttons) =>
    buttons.map((button) => button.getBoundingClientRect().toJSON()));
  assert.ok(positions.every((rect) => Math.abs(rect.top - positions[0].top) <= 2), 'four controls are on one row');
  assert.ok(positions.every((rect, i) => i === 0 || positions[i - 1].right <= rect.left), 'controls follow requested order');

  assert.equal(await page.locator('#youtube-memo-next').isDisabled(), true);
  await page.locator('#youtube-memo-prev').click();
  await textEquals(page, 'Original page');
  assert.equal(await page.locator('#youtube-memo-prev').isDisabled(), true);
  await page.locator('#youtube-memo-next').click();
  await textEquals(page, 'Second page');

  await page.locator('#youtube-memo-toggle').click();
  assert.equal(await page.locator('#youtube-memo-area').isVisible(), false);
  assert.equal(await page.locator('#youtube-memo-prev').isVisible(), true);
  await page.locator('#youtube-memo-header-show').click();
  await textEquals(page, 'Second page');
});

test('moves the active page up and down without losing its text, title, cue, or selection', async (t) => {
  const page = await createFixture(t, {
    saved: { 'memo_pages_video-a': record({ activePageId: 'two' }) },
  });
  await ready(page);
  await page.locator('#youtube-memo-settings-toggle').click();
  assert.equal(await page.locator('#youtube-memo-move-up').isDisabled(), false);
  assert.equal(await page.locator('#youtube-memo-move-down').isDisabled(), false);
  await page.locator('#youtube-memo-move-down').click();

  const optionOrder = async () => page.locator('#youtube-memo-page-select option').evaluateAll(
    (options) => options.map((option) => option.value)
  );
  assert.deepEqual(await optionOrder(), ['one', 'three', 'two', 'manual']);
  assert.equal(await page.locator('#youtube-memo-page-select').inputValue(), 'two');
  await textEquals(page, 'Second page');
  assert.equal(await page.locator('#youtube-memo-page-title').inputValue(), 'Middle');
  assert.equal(await page.locator('#youtube-memo-start-time').inputValue(), '0:30');

  let saved = await savedRecord(page, 'video-a',
    (key) => window.__storage.data[key]?.pages?.[2]?.id === 'two');
  assert.deepEqual(saved.pages.map((entry) => entry.id), ['one', 'three', 'two', 'manual']);
  assert.equal(saved.activePageId, 'two');
  assert.deepEqual(saved.pages[2], { id: 'two', title: 'Middle', content: 'Second page', startTime: 30 });

  await page.locator('#youtube-memo-move-up').click();
  await page.locator('#youtube-memo-move-up').click();
  assert.deepEqual(await optionOrder(), ['two', 'one', 'three', 'manual']);
  assert.equal(await page.locator('#youtube-memo-move-up').isDisabled(), true);
  assert.equal(await page.locator('#youtube-memo-move-down').isDisabled(), false);
  await page.locator('#youtube-memo-next').click();
  await textEquals(page, 'First page');
  saved = await savedRecord(page, 'video-a',
    (key) => window.__storage.data[key]?.pages?.[0]?.id === 'two');
  assert.equal(saved.pages[0].content, 'Second page');
});

test('reordering pages changes the tie-breaker for equal playback cues while leaving times untouched', async (t) => {
  const page = await createFixture(t, {
    saved: { 'memo_pages_video-a': record({
      activePageId: 'one',
      autoSwitch: true,
      pages: [
        { id: 'one', title: 'Intro', content: 'Intro text', startTime: 0 },
        { id: 'two', title: 'A', content: 'A text', startTime: 30 },
        { id: 'three', title: 'B', content: 'B text', startTime: 30 },
      ],
    }) },
  });
  await ready(page);
  await page.locator('#youtube-memo-settings-toggle').click();
  await page.locator('#youtube-memo-page-select').selectOption('three');
  await page.locator('#youtube-memo-move-up').click();
  assert.deepEqual(await page.locator('#youtube-memo-page-select option').evaluateAll(
    (options) => options.map((option) => option.value)), ['one', 'three', 'two']);
  await setTime(page, 30);
  await textEquals(page, 'A text');
  await setTime(page, 0);
  await textEquals(page, 'Intro text');
  const saved = await savedRecord(page, 'video-a',
    (key) => window.__storage.data[key]?.pages?.[1]?.id === 'three');
  assert.deepEqual(saved.pages.map((entry) => entry.startTime), [0, 30, 30]);
});

test('reduces the visible page title spacing above the editor', async (t) => {
  const page = await createFixture(t, { saved: { 'memo_pages_video-a': record() } });
  await ready(page);
  const metrics = await page.locator('#youtube-memo-page-title').evaluate((title) => {
    const style = getComputedStyle(title);
    const row = document.getElementById('youtube-memo-title-row');
    const textarea = document.getElementById('youtube-memo-textarea');
    return {
      titleMarginBottom: style.marginBottom,
      rowMarginBottom: getComputedStyle(row).marginBottom,
      paddingTop: style.paddingTop,
      paddingBottom: style.paddingBottom,
      gap: textarea.getBoundingClientRect().top - row.getBoundingClientRect().bottom,
    };
  });
  assert.equal(metrics.titleMarginBottom, '0px');
  assert.equal(metrics.rowMarginBottom, '4px');
  assert.equal(metrics.paddingTop, '3px');
  assert.equal(metrics.paddingBottom, '3px');
  assert.ok(metrics.gap <= 5, 'title and memo should have a small gap');
});


test('shows page switching controls next to the title as well as below the memo', async (t) => {
  const page = await createFixture(t, { saved: { 'memo_pages_video-a': record() } });
  await ready(page);
  const titleRow = page.locator('#youtube-memo-title-row');
  assert.equal(await titleRow.isVisible(), true);
  assert.equal(await page.locator('#youtube-memo-title-prev').textContent(), '戻る');
  assert.equal(await page.locator('#youtube-memo-title-next').textContent(), '前へ');
  const [titleBounds, navBounds] = await Promise.all([
    page.locator('#youtube-memo-page-title').boundingBox(),
    page.locator('#youtube-memo-title-navigation').boundingBox(),
  ]);
  assert.ok(navBounds.x > titleBounds.x + titleBounds.width - 2, 'title buttons are aligned on its right');
  assert.ok(Math.abs(navBounds.y - titleBounds.y) < 25, 'title buttons are vertically aligned');

  assert.equal(await page.locator('#youtube-memo-title-prev').isDisabled(), true);
  await page.locator('#youtube-memo-title-next').click();
  await textEquals(page, 'Second page');
  assert.equal(await page.locator('#youtube-memo-page-title').inputValue(), 'Middle');
  await page.locator('#youtube-memo-next').click();
  await textEquals(page, 'Third page');
  await page.locator('#youtube-memo-title-prev').click();
  await textEquals(page, 'Second page');
  await page.locator('#youtube-memo-prev').click();
  await textEquals(page, 'First page');
});

test('hides the memo completely from related videos and puts the restore button beside the masthead microphone', async (t) => {
  const page = await createFixture(t);
  await ready(page);
  const before = await page.locator('#secondary').evaluate((el) => el.textContent);
  assert.match(before, /Related videos/);
  await page.locator('#youtube-memo-toggle').click();

  const restore = page.locator('#youtube-memo-header-show');
  await restore.waitFor({ state: 'visible' });
  assert.equal(await page.locator('#youtube-memo-container').count(), 0, 'memo has been fully detached');
  assert.equal(await page.locator('#secondary').evaluate((el) => el.textContent.trim()), 'Related videos');
  assert.equal(await restore.evaluate((el) => el.parentElement.id), 'center');
  assert.equal(await restore.evaluate((el) => el.previousElementSibling?.id), 'voice-search-button');

  await restore.click();
  await ready(page);
  assert.equal(await restore.count(), 0);
  assert.equal(await page.locator('#secondary #youtube-memo-container').count(), 1);
  assert.match(await page.locator('#secondary').evaluate((el) => el.textContent), /Related videos/);
});

test('restores the top button when the masthead is rebuilt and removes it on navigation away', async (t) => {
  const page = await createFixture(t);
  await ready(page);
  await page.locator('#youtube-memo-toggle').click();
  await page.locator('#youtube-memo-header-show').waitFor({ state: 'visible' });
  await page.locator('#masthead #center').evaluate((center) => {
    const replacement = document.createElement('div');
    replacement.id = 'center';
    replacement.innerHTML = '<span>検索</span><div id="voice-search-button"></div>';
    center.replaceWith(replacement);
  });
  await page.locator('#youtube-memo-header-show').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#youtube-memo-header-show').evaluate((el) => el.parentElement.id), 'center');
  await navigate(page, null);
  await page.waitForFunction(() => document.getElementById('youtube-memo-header-show') === null);
});

test('dragging the splitter resizes video and memo columns and saves the width', async (t) => {
  const page = await createFixture(t);
  await ready(page);
  const handle = page.locator('#youtube-memo-width-handle');
  await handle.waitFor({ state: 'visible' });
  const before = await page.evaluate(() => ({
    primary: document.querySelector('#primary').getBoundingClientRect().width,
    secondary: document.querySelector('#secondary').getBoundingClientRect().width,
  }));
  const box = await handle.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 180, y, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(() => Number.isFinite(window.__storage.data['memo_sidebar_width_video-a']));
  const after = await page.evaluate(() => ({
    primary: document.querySelector('#primary').getBoundingClientRect().width,
    secondary: document.querySelector('#secondary').getBoundingClientRect().width,
    saved: window.__storage.data['memo_sidebar_width_video-a'],
  }));
  assert.ok(after.secondary > before.secondary + 90);
  assert.ok(after.primary < before.primary - 60);
  assert.ok(after.saved >= after.secondary - 2);
  assert.equal(await page.locator('#watch-video-a').evaluate((el) => el.classList.contains('youtube-memo-width-layout')), true);
});

test('remembers separate video widths and resets only the active video', async (t) => {
  const page = await createFixture(t);
  await ready(page);
  const grip = page.locator('#youtube-memo-width-handle');
  await grip.focus();
  await grip.press('ArrowLeft');
  console.log('DEBUG MEMO WIDTH', JSON.stringify(await page.evaluate(() => ({
    active: document.activeElement?.id,
    aria: document.getElementById('youtube-memo-width-handle')?.getAttribute('aria-valuenow'),
    isHidden: document.getElementById('youtube-memo-width-handle')?.hidden,
    rootClass: document.getElementById('watch-video-a')?.className,
    rootStyle: document.getElementById('watch-video-a')?.style.getPropertyValue('--youtube-memo-sidebar-width'),
    secondaryWidth: document.getElementById('secondary')?.getBoundingClientRect().width,
    data: window.__storage.data['memo_sidebar_width_video-a'],
    pending: window.__storage.writes,
    error: document.getElementById('youtube-memo-status')?.textContent,
  }))));
  await page.waitForFunction(() => Number.isFinite(window.__storage.data['memo_sidebar_width_video-a']));
  const widthA = await page.evaluate(() => window.__storage.data['memo_sidebar_width_video-a']);
  await navigate(page, 'video-b');
  await ready(page, 'video-b');
  assert.equal(await page.locator('#watch-video-b').evaluate((el) => el.classList.contains('youtube-memo-width-layout')), false);
  await page.locator('#youtube-memo-width-handle').focus();
  await page.locator('#youtube-memo-width-handle').press('ArrowLeft');
  await page.locator('#youtube-memo-width-handle').press('ArrowLeft');
  await page.waitForFunction(() => Number.isFinite(window.__storage.data['memo_sidebar_width_video-b']));
  const widthB = await page.evaluate(() => window.__storage.data['memo_sidebar_width_video-b']);
  assert.ok(widthB > widthA);

  await navigate(page, 'video-a');
  await ready(page);
  await page.waitForFunction((width) =>
    document.getElementById('watch-video-a')?.style.getPropertyValue('--youtube-memo-sidebar-width') === width + 'px', widthA);

  await page.locator('#youtube-memo-settings-toggle').click();
  await page.locator('#youtube-memo-width-reset').click();
  await page.waitForFunction(() => Object.hasOwn(window.__storage.data, 'memo_sidebar_width_video-a') &&
    window.__storage.data['memo_sidebar_width_video-a'] === null);
  assert.equal(await page.locator('#watch-video-a').evaluate((el) => el.classList.contains('youtube-memo-width-layout')), false);
  assert.equal(await page.locator('#youtube-memo-width-reset').isDisabled(), true);
  assert.equal(await page.locator('#secondary').evaluate((el) => Math.round(el.getBoundingClientRect().width)), 360);

  await navigate(page, 'video-b');
  await ready(page, 'video-b');
  await page.waitForFunction((width) =>
    document.getElementById('watch-video-b')?.style.getPropertyValue('--youtube-memo-sidebar-width') === width + 'px', widthB);
});

test('temporarily disables width customization for mobile and theater without losing saved width', async (t) => {
  const page = await createFixture(t);
  await ready(page);
  await page.locator('#youtube-memo-width-handle').focus();
  await page.locator('#youtube-memo-width-handle').press('ArrowLeft');
  await page.waitForFunction(() => Number.isFinite(window.__storage.data['memo_sidebar_width_video-a']));
  const width = await page.evaluate(() => window.__storage.data['memo_sidebar_width_video-a']);
  await page.setViewportSize({ width: 760, height: 1000 });
  await page.waitForFunction(() => !document.getElementById('watch-video-a').classList.contains('youtube-memo-width-layout'));
  assert.equal(await page.locator('#youtube-memo-width-handle').isVisible(), false);
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.waitForFunction((size) =>
    document.getElementById('watch-video-a')?.style.getPropertyValue('--youtube-memo-sidebar-width') === size + 'px', width);
  await page.locator('#watch-video-a').evaluate((el) => el.setAttribute('theater', ''));
  await page.waitForFunction(() => !document.getElementById('watch-video-a').classList.contains('youtube-memo-width-layout'));
  await page.locator('#watch-video-a').evaluate((el) => el.removeAttribute('theater'));
  await page.waitForFunction((size) =>
    document.getElementById('watch-video-a')?.style.getPropertyValue('--youtube-memo-sidebar-width') === size + 'px', width);
});

test('hiding a resized memo restores native sidebar width and showing it reapplies the saved width', async (t) => {
  const page = await createFixture(t);
  await ready(page);
  await page.locator('#youtube-memo-width-handle').focus();
  await page.locator('#youtube-memo-width-handle').press('ArrowLeft');
  await page.waitForFunction(() => Number.isFinite(window.__storage.data['memo_sidebar_width_video-a']));
  const saved = await page.evaluate(() => window.__storage.data['memo_sidebar_width_video-a']);
  await page.locator('#youtube-memo-toggle').click();
  await page.locator('#youtube-memo-header-show').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#watch-video-a').evaluate((el) => el.classList.contains('youtube-memo-width-layout')), false);
  assert.equal(await page.locator('#secondary').evaluate((el) => Math.round(el.getBoundingClientRect().width)), 360);
  await page.locator('#youtube-memo-header-show').click();
  await ready(page);
  await page.waitForFunction((size) =>
    document.getElementById('watch-video-a')?.style.getPropertyValue('--youtube-memo-sidebar-width') === size + 'px', saved);
  assert.equal(await page.locator('#youtube-memo-width-handle').isVisible(), true);
});
