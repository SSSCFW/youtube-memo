const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../memo-model.js');

test('restores legacy text as the first page with automatic switching disabled', () => {
  assert.deepEqual(model.normalizeMemo(undefined, '以前のメモ\nSecond line'), {
    version: 1,
    pages: [{ id: 'page-1', title: '', content: '以前のメモ\nSecond line', startTime: 0 }],
    activePageId: 'page-1',
    autoSwitch: false,
  });
});

test('accepts a legacy string directly without replacing it with fallback text', () => {
  assert.equal(model.normalizeMemo('saved memo', 'older memo').pages[0].content, 'saved memo');
  assert.equal(model.normalizeMemo('', 'older memo').pages[0].content, '');
});

test('defaults malformed and empty records without losing usable legacy text', () => {
  for (const saved of [null, false, 42, [], {}, { pages: [] }, { pages: 'invalid' }, { pages: [null, 42, []] }]) {
    assert.deepEqual(model.normalizeMemo(saved, 'keep this'), {
      version: 1,
      pages: [{ id: 'page-1', title: '', content: 'keep this', startTime: 0 }],
      activePageId: 'page-1',
      autoSwitch: false,
    });
  }
  assert.equal(model.normalizeMemo(undefined, {}).pages[0].content, '');
});

test('preserves saved pages and explicitly untimed first pages over legacy content', () => {
  const saved = {
    version: 1,
    pages: [
      { id: 'intro', title: 'Introduction', content: '', startTime: null },
      { id: 'detail', title: 'Details', content: 'Current text', startTime: 62.5 },
    ],
    activePageId: 'detail',
    autoSwitch: true,
  };
  assert.deepEqual(model.normalizeMemo(saved, 'Old text'), saved);
});

test('normalizing returns independent page objects without modifying stored input', () => {
  const saved = {
    pages: [{ id: 'saved', title: 'Title', content: 'Text', startTime: 10 }],
    activePageId: 'saved',
  };
  const original = JSON.parse(JSON.stringify(saved));
  Object.freeze(saved.pages[0]);
  Object.freeze(saved.pages);
  Object.freeze(saved);
  const result = model.normalizeMemo(saved);
  result.pages[0].content = 'Edited';
  result.pages.push({ id: 'extra' });
  assert.deepEqual(saved, original);
});

test('repairs missing and duplicate IDs while reserving valid later IDs', () => {
  const saved = {
    pages: [
      { content: 'Missing id' },
      { id: 'page-1', content: 'Reserved first id' },
      { id: 'custom', content: 'Keep custom id' },
      { id: 'custom', content: 'Duplicate id' },
      { id: 'page-2', content: 'Reserved second id' },
      { id: '  ', content: 'Blank id' },
    ],
    activePageId: 'custom',
  };
  const result = model.normalizeMemo(saved);
  assert.equal(result.pages[1].id, 'page-1');
  assert.equal(result.pages[2].id, 'custom');
  assert.equal(result.pages[4].id, 'page-2');
  assert.equal(new Set(result.pages.map((page) => page.id)).size, 6);
  assert.ok(result.pages.every((page) => typeof page.id === 'string' && page.id.trim()));
  assert.equal(result.activePageId, 'custom');
  assert.deepEqual(model.normalizeMemo(result), result);
  assert.deepEqual(model.normalizeMemo(saved), result);
});

test('sanitizes malformed page fields and ignores non-page entries', () => {
  const result = model.normalizeMemo({
    pages: [
      null,
      { id: 'broken', title: 10, content: {}, startTime: '30' },
      { id: 'negative', startTime: -1 },
      { id: 'infinite', startTime: Infinity },
      { id: 'nan', startTime: NaN },
      { id: 'missing' },
      { id: 'zero', startTime: 0 },
    ],
  });
  assert.deepEqual(result.pages[0], { id: 'broken', title: '', content: '', startTime: null });
  assert.deepEqual(result.pages.map((page) => page.startTime), [null, null, null, null, null, 0]);
});

test('falls back to the first page when the saved active page no longer exists', () => {
  const result = model.normalizeMemo({
    pages: [{ id: 'first' }, { id: 'second' }],
    activePageId: 'deleted',
  });
  assert.equal(result.activePageId, 'first');
});

test('automatic switching requires an explicit boolean true', () => {
  for (const autoSwitch of [undefined, null, false, 'true', 1, {}, []]) {
    assert.equal(model.normalizeMemo({ pages: [{ id: 'one' }], autoSwitch }).autoSwitch, false);
  }
  assert.equal(model.normalizeMemo({ pages: [{ id: 'one' }], autoSwitch: true }).autoSwitch, true);
});

test('creates distinct empty manual pages without changing the existing page list', () => {
  const pages = Object.freeze([Object.freeze({ id: 'page-1' }), Object.freeze({ id: 'page-3' })]);
  const first = model.createPage(pages);
  const second = model.createPage([...pages, first]);
  assert.equal(first.title, '');
  assert.equal(first.content, '');
  assert.equal(first.startTime, null);
  assert.ok(first.id && second.id);
  assert.equal(new Set([...pages, first, second].map((page) => page.id)).size, 4);
  assert.equal(pages.length, 2);
  assert.equal(model.createPage(undefined).startTime, null);
});

test('chooses the latest reached cue regardless of page ordering or seek direction', () => {
  const pages = [
    { id: 'intro', startTime: 0 },
    { id: 'late', startTime: 120 },
    { id: 'middle', startTime: 30 },
    { id: 'manual', startTime: null },
  ];
  for (const [seconds, expected] of [[0, 'intro'], [29.99, 'intro'], [30, 'middle'], [120, 'late'], [200, 'late'], [45, 'middle'], [5, 'intro']]) {
    assert.equal(model.getPageAtTime(pages, seconds), expected, `at ${seconds} seconds`);
  }
});

test('uses the first page before the first cue and when all pages are untimed', () => {
  assert.equal(model.getPageAtTime([{ id: 'manual', startTime: null }, { id: 'timed', startTime: 10 }], 9), 'manual');
  assert.equal(model.getPageAtTime([{ id: 'first', startTime: 20 }, { id: 'earlier', startTime: 10 }], 0), 'first');
  assert.equal(model.getPageAtTime([{ id: 'first', startTime: null }, { id: 'second', startTime: null }], 100), 'first');
});

test('resolves equal cue times to the later page in page order', () => {
  const pages = [{ id: 'a', startTime: 0 }, { id: 'b', startTime: 30 }, { id: 'c', startTime: 30 }];
  assert.equal(model.getPageAtTime(pages, 30), 'c');
  assert.equal(model.getPageAtTime(pages, 200), 'c');
});

test('ignores invalid cues instead of treating null and strings as zero', () => {
  const pages = [
    { id: 'valid', startTime: 0 },
    { id: 'manual', startTime: null },
    { id: 'string', startTime: '0' },
    { id: 'negative', startTime: -1 },
    { id: 'infinite', startTime: Infinity },
    { id: 'nan', startTime: NaN },
  ];
  assert.equal(model.getPageAtTime(pages, 100), 'valid');
});

test('returns no selected page for invalid playback time or an empty page list', () => {
  for (const time of [undefined, null, '', '30', -1, NaN, Infinity]) {
    assert.equal(model.getPageAtTime([{ id: 'one', startTime: 0 }], time), null);
  }
  for (const pages of [undefined, null, [], {}, [null, {}]]) {
    assert.equal(model.getPageAtTime(pages, 0), null);
  }
});

test('parses seconds and fractional seconds without accepting unrelated numeric syntax', () => {
  for (const [input, expected] of [['0', 0], ['  75  ', 75], ['12.5', 12.5], ['0.001', 0.001], ['005', 5]]) {
    assert.equal(model.parseTime(input), expected);
  }
  for (const input of ['-1', '+1', '1e3', '0x10', 'Infinity', '1.2.3']) {
    assert.equal(model.parseTime(input), null, input);
  }
});

test('parses minute and hour timestamps with optional fractional seconds', () => {
  for (const [input, expected] of [['1:02', 62], ['90:02', 5402], ['1:02.5', 62.5], ['2:03:04', 7384], ['2:3:4.25', 7384.25], ['0:00:00.125', 0.125]]) {
    assert.equal(model.parseTime(input), expected, input);
  }
});

test('rejects out-of-range or incomplete timestamp components and overflow', () => {
  for (const input of ['', '   ', ':10', '1:', '1::2', '1:60', '1:59.9999:0', '1:60:00', '1:00:60', '1.5:00', '1:02:03:04', '1: 02', '9'.repeat(400), `${'9'.repeat(400)}:00:00`, undefined, null, {}, [], true]) {
    assert.equal(model.parseTime(input), null, String(input));
  }
});

test('formats whole seconds as minute or hour timestamps with padded components', () => {
  for (const [seconds, expected] of [[0, '0:00'], [5, '0:05'], [60, '1:00'], [3599, '59:59'], [3600, '1:00:00'], [3661, '1:01:01'], [360000, '100:00:00']]) {
    assert.equal(model.formatTime(seconds), expected);
  }
});

test('preserves fractional seconds without adding floating-point subtraction artifacts', () => {
  for (const [seconds, expected] of [[1.25, '0:01.25'], [61.1, '1:01.1'], [3661.125, '1:01:01.125'], [60.001234, '1:00.001234'], [0.0000001, '0:00.0000001']]) {
    assert.equal(model.formatTime(seconds), expected);
    assert.equal(model.parseTime(model.formatTime(seconds)), seconds);
  }
});

test('formats missing and invalid times as an empty field', () => {
  for (const seconds of [null, undefined, '', '30', -1, NaN, Infinity, {}, true]) {
    assert.equal(model.formatTime(seconds), '');
  }
});

test('browser scripts expose the same behavior without requiring a module loader', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'memo-model.js'), 'utf8'), context);
  assert.equal(context.YouTubeMemoModel.normalizeMemo(undefined, 'Browser text').pages[0].content, 'Browser text');
  assert.equal(context.YouTubeMemoModel.parseTime('1:30'), 90);
  assert.equal(context.YouTubeMemoModel.getPageAtTime([{ id: 'a', startTime: 0 }], 1), 'a');
});
