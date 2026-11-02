const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function getRule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule: ${selector}`);
  return match[1];
}

test('memo toggle button uses a compact intrinsic-width layout', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const rule = getRule(css, '#youtube-memo-toggle');

  assert.match(rule, /width:\s*auto\s*;/);
  assert.match(rule, /padding:\s*6px\s+10px\s*;/);
  assert.match(rule, /font-size:\s*12px\s*;/);
});


test('title gap is compact and the action row does not wrap', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const title = getRule(css, '#youtube-memo-page-title');
  const titleRow = getRule(css, '#youtube-memo-title-row');
  const actions = getRule(css, '#youtube-memo-actions');
  assert.match(title, /margin:\s*0\s*;/);
  assert.match(titleRow, /margin-bottom:\s*4px\s*;/);
  assert.match(title, /padding:\s*3px\s+2px\s*;/);
  assert.match(actions, /flex-wrap:\s*nowrap\s*;/);
});


test('title navigation and resize header controls have scoped styles', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert.match(getRule(css, '#youtube-memo-title-row'), /display:\s*flex\s*;/);
  assert.match(getRule(css, '#youtube-memo-title-navigation'), /display:\s*flex\s*;/);
  assert.match(getRule(css, '#youtube-memo-width-handle'), /cursor:\s*ew-resize\s*;/);
  assert.match(getRule(css, '#youtube-memo-header-show'), /margin-inline-start:\s*12px\s*!important\s*;/);
});


test('split mode has a dedicated multi-column text preview with safe overflow', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const preview = getRule(css, '#youtube-memo-split-preview');
  assert.match(preview, /column-count:\s*2\s*;/);
  assert.match(preview, /white-space:\s*pre-wrap\s*;/);
  assert.match(preview, /overflow-x:\s*auto\s*;/);
  assert.match(preview, /overflow-y:\s*hidden\s*;/);
  assert.match(getRule(css, '#youtube-memo-split-toolbar'), /display:\s*flex\s*;/);
});
