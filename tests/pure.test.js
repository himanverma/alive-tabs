// Unit tests for compiled out/pure.js — run via `npm test` (node --test).
const test = require('node:test');
const assert = require('node:assert');
const {
  contrastColor,
  sanitizeHex,
  escapeCssContent,
  firstGraphemes,
  globMatch,
  globToRegExp,
} = require('../out/pure.js');

test('sanitizeHex normalizes hex colors', () => {
  assert.strictEqual(sanitizeHex('#e11d48'), '#e11d48');
  assert.strictEqual(sanitizeHex('E11D48'), '#e11d48');
  assert.strictEqual(sanitizeHex('#f80'), '#ff8800');
  assert.strictEqual(sanitizeHex('f80'), '#ff8800');
  assert.strictEqual(sanitizeHex(undefined), undefined);
  assert.strictEqual(sanitizeHex(''), undefined);
  assert.strictEqual(sanitizeHex('#12'), undefined);
  assert.strictEqual(sanitizeHex('zzzzzz'), undefined);
  assert.strictEqual(sanitizeHex('#e11d48ff'), undefined); // 8-digit not supported
});

test('contrastColor picks readable foreground', () => {
  assert.strictEqual(contrastColor('#ffffff'), '#000000');
  assert.strictEqual(contrastColor('#000000'), '#ffffff');
  assert.strictEqual(contrastColor('#e11d48'), '#ffffff'); // dark red → white
  assert.strictEqual(contrastColor('#eab308'), '#000000'); // amber → black
  assert.strictEqual(contrastColor('garbage'), '#ffffff');
});

test('escapeCssContent escapes quotes, backslashes, dots, newlines', () => {
  assert.strictEqual(escapeCssContent('🔴'), '🔴');
  assert.strictEqual(escapeCssContent('a.b'), 'a\\2e b');
  assert.strictEqual(escapeCssContent('say "hi"'), 'say \\"hi\\"');
  assert.strictEqual(escapeCssContent('a\nb'), 'ab');
  assert.strictEqual(escapeCssContent('back\\slash'), 'back\\\\slash');
});

test('firstGraphemes truncates by grapheme cluster', () => {
  assert.strictEqual(firstGraphemes('🔴', 2), '🔴');
  assert.strictEqual(firstGraphemes('WIP', 2), 'WI');
  assert.strictEqual(firstGraphemes('👨‍👩‍👧‍👦👍', 2), '👨‍👩‍👧‍👦👍'); // ZWJ emoji = 1 cluster
});

test('globMatch: **/ covers any depth', () => {
  assert.ok(globMatch('**/*.test.ts', 'src/a.test.ts'));
  assert.ok(globMatch('**/*.test.ts', 'a.test.ts'));
  assert.ok(globMatch('**/*.test.ts', '/abs/path/a.test.ts'));
  assert.ok(!globMatch('**/*.test.ts', 'src/a.ts'));
});

test('globMatch: * and ? stay within a segment', () => {
  assert.ok(globMatch('src/*.ts', 'src/a.ts'));
  assert.ok(!globMatch('src/*.ts', 'src/deep/a.ts'));
  assert.ok(globMatch('a?.ts', 'ab.ts'));
  assert.ok(!globMatch('a?.ts', 'axb.ts'));
});

test('globMatch: {a,b} alternation and char classes', () => {
  assert.ok(globMatch('**/*.{test,spec}.*', 'x/y.spec.js'));
  assert.ok(globMatch('**/*.{test,spec}.*', 'y.test.ts'));
  assert.ok(globMatch('**/*.{test,spec}.*', 'y.test.ts.bak')); // '*' matches dots too — correct glob semantics
  assert.ok(!globMatch('**/*.{test,spec}.*', 'y.txt'));
  assert.ok(globMatch('[ab].ts', 'a.ts'));
  assert.ok(!globMatch('[ab].ts', 'c.ts'));
});

test('globMatch: case-insensitive, windows separators normalized', () => {
  assert.ok(globMatch('**/README.md', 'docs/README.md'));
  assert.ok(globMatch('**/README.md', 'docs\\readme.md'));
  assert.ok(globMatch('README.md', 'readme.md'));
});

test('globMatch: literals are escaped', () => {
  assert.ok(!globMatch('a+b.ts', 'axb.ts')); // + is literal, not regex
  assert.ok(globMatch('a+b.ts', 'a+b.ts'));
  assert.ok(!globMatch('x.ts', 'x1ts'));
});

test('globToRegExp anchors the whole string', () => {
  assert.ok(!globToRegExp('*.ts').test('x.ts.bak'));
  assert.ok(globToRegExp('*.ts').test('x.ts'));
});
