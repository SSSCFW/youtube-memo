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
  assert.equal(await page.locator('#youtube-memo-toggle').textContent(), 'メモを表示');
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.__storage.data['height_video-a']), '280px');
  await page.locator('#youtube-memo-toggle').click();
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
