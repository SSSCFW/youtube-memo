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
