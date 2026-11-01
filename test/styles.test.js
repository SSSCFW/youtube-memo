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
  const actions = getRule(css, '#youtube-memo-actions');
  assert.match(title, /margin:\s*0\s+0\s+4px\s*;/);
  assert.match(title, /padding:\s*3px\s+2px\s*;/);
  assert.match(actions, /flex-wrap:\s*nowrap\s*;/);
});
