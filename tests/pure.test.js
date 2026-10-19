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
  matchSessionMarks,
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

test('session marks prefer their saved tab slot over labels', () => {
  const matches = matchSessionMarks(
    [
      { key: 'old-a', label: 'Claude Code', tabSlot: 'column-1:0' },
      { key: 'old-b', label: 'Claude Code', tabSlot: 'column-1:1' },
    ],
    [
      { uri: 'new-b', label: 'Claude Code', tabSlot: 'column-1:1' },
      { uri: 'new-a', label: 'Claude Code', tabSlot: 'column-1:0' },
    ],
  );
  assert.deepStrictEqual(matches, [
    { key: 'old-a', uri: 'new-a', tabSlot: 'column-1:0' },
    { key: 'old-b', uri: 'new-b', tabSlot: 'column-1:1' },
  ]);
});

test('legacy session marks with duplicate labels reattach in tab order', () => {
  const matches = matchSessionMarks(
    [
      { key: 'old-a', label: 'Claude Code' },
      { key: 'old-b', label: 'Claude Code' },
    ],
    [
      { uri: 'new-a', label: 'Claude Code', tabSlot: 'slot-0' },
      { uri: 'new-b', label: 'Claude Code', tabSlot: 'slot-1' },
    ],
  );
  assert.deepStrictEqual(matches, [
    { key: 'old-a', uri: 'new-a', tabSlot: 'slot-0' },
    { key: 'old-b', uri: 'new-b', tabSlot: 'slot-1' },
  ]);
});

test('session marks match available tabs for a label even if counts differ', () => {
  const matches = matchSessionMarks(
    [{ key: 'old-a', label: 'Claude Code' }],
    [
      { uri: 'new-a', label: 'Claude Code', tabSlot: 'slot-0' },
      { uri: 'new-b', label: 'Claude Code', tabSlot: 'slot-1' },
    ],
  );
  assert.deepStrictEqual(matches, [
    { key: 'old-a', uri: 'new-a', tabSlot: 'slot-0' },
  ]);
});

test('session marks select most recent marks when there are more marks than open tabs', () => {
  const matches = matchSessionMarks(
    [
      { key: 'old-1', label: 'Claude Code', ts: 100 },
      { key: 'old-2', label: 'Claude Code', ts: 300 },
      { key: 'old-3', label: 'Claude Code', ts: 200 },
    ],
    [
      { uri: 'new-a', label: 'Claude Code', tabSlot: 'slot-0' },
    ],
  );
  assert.deepStrictEqual(matches, [
    { key: 'old-2', uri: 'new-a', tabSlot: 'slot-0' },
  ]);
});

test('legacy session marks with stale labels use order only for a complete bucket', () => {
  const matches = matchSessionMarks(
    [
      { key: 'old-a', label: 'Old title A' },
      { key: 'old-b', label: 'Old title B' },
    ],
    [
      { uri: 'new-a', label: 'Restored title A', tabSlot: 'slot-0' },
      { uri: 'new-b', label: 'Restored title B', tabSlot: 'slot-1' },
    ],
  );
  assert.deepStrictEqual(matches, [
    { key: 'old-a', uri: 'new-a', tabSlot: 'slot-0' },
    { key: 'old-b', uri: 'new-b', tabSlot: 'slot-1' },
  ]);

  const incomplete = matchSessionMarks(
    [{ key: 'old-a', label: 'Old title' }],
    [
      { uri: 'new-a', label: 'Restored title A', tabSlot: 'slot-0' },
      { uri: 'new-b', label: 'Restored title B', tabSlot: 'slot-1' },
    ],
  );
  assert.deepStrictEqual(incomplete, []);

  const repeatedOldTitle = matchSessionMarks(
    [
      { key: 'old-a', label: 'Old active title' },
      { key: 'old-b', label: 'Old active title' },
      { key: 'old-c', label: 'Old active title' },
    ],
    [
      { uri: 'new-a', label: 'Old active title', tabSlot: 'slot-0' },
      { uri: 'new-b', label: 'Restored title B', tabSlot: 'slot-1' },
      { uri: 'new-c', label: 'Restored title C', tabSlot: 'slot-2' },
    ],
  );
  assert.deepStrictEqual(repeatedOldTitle, [
    { key: 'old-a', uri: 'new-a', tabSlot: 'slot-0' },
    { key: 'old-b', uri: 'new-b', tabSlot: 'slot-1' },
    { key: 'old-c', uri: 'new-c', tabSlot: 'slot-2' },
  ]);

  assert.deepStrictEqual(
    matchSessionMarks(
      [{ key: 'old-cascade', label: 'Old title' }],
      [{ uri: 'new-cascade', label: 'Restored title', tabSlot: 'slot-0' }],
      false,
    ),
    [],
  );
});
