'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict'), { test } = require('node:test'), { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..'), req = createRequire(path.join(root, 'client/package.json'));
const css = fs.readFileSync(path.join(root, 'client/src/styles.css'), 'utf8');
const { headerCSS, stripHeaderCSS } = require('./2026-10-19-header-css.cjs');
const parsed = req('postcss').parse(headerCSS(css));
const rules = Object.fromEntries(parsed.nodes.filter(n => n.type === 'rule').map(n => [n.selector, Object.fromEntries(n.nodes.map(d => [d.prop, d.value]))]));
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

test('header overrides are restricted to shared header selectors', () => {
  assert.deepEqual(Object.keys(rules), ['.topbar', '.brand', '.brand-mark', '.topbar-right', '.user-chip', '.user-chip > span']);
  assert.ok(parsed.nodes.every(n => n.type === 'rule' || n.type === 'comment'));
});
test('brand remains one line and its mark keeps its original size', () => {
  assert.deepEqual(rules['.brand'], { 'flex-shrink': '0', 'white-space': 'nowrap' });
  assert.deepEqual(rules['.brand-mark'], { 'flex-shrink': '0' });
});
test('member identity can shrink without constraining guest actions', () => {
  assert.deepEqual(rules['.topbar'], { 'min-width': '0' });
  assert.deepEqual(rules['.topbar-right'], { 'min-width': '0' });
  assert.deepEqual(rules['.user-chip'], { 'min-width': '0', 'max-width': '100%' });
});
test('nickname is ellipsized as text, not removed or font-scaled', () => {
  assert.deepEqual(rules['.user-chip > span'], { 'min-width': '0', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' });
});
test('all CSS outside the new header block is byte-preserved', () => {
  assert.equal(hash(stripHeaderCSS(css)), 'ab380b4380eecab26194bbe2b6bcdef4053d85d2dd49c54d4aa905d0d17caec9');
});
test('CSS comparison helper rejects duplicate or incomplete blocks', () => {
  assert.throws(() => headerCSS(css + headerCSS(css)));
  assert.throws(() => headerCSS('/* Header-only compact identity. */\n.brand {}'));
});
test('CSS without a header block is returned unchanged', () => {
  const original = stripHeaderCSS(css);
  assert.equal(stripHeaderCSS(original), original);
});
test('layout outside the approved consent gate, full nickname and account links is unchanged', () => {
  const cp = require('node:child_process');
  const before = cp.execFileSync('git', ['show', '2f11e50:client/src/components/Layout.jsx'], { cwd: root, encoding: 'utf8' });
  const current = fs.readFileSync(path.join(root, 'client/src/components/Layout.jsx'), 'utf8');
  const gate = text => req('@babel/parser').parse(text, { sourceType: 'module', plugins: ['jsx'] }).program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === 'ConsentGate');
  const oldGate = gate(before), newGate = gate(current);
  assert.ok(oldGate && newGate);
  let restored = current.slice(0, newGate.start) + before.slice(oldGate.start, oldGate.end) + current.slice(newGate.end);
  for (const [changed, original] of [
    ["import { useEffect, useRef, useState } from 'react';", "import { useEffect, useState } from 'react';"],
    ["import { Dialog, ErrorBox, Loading } from './ui';", "import { Dialog, Loading } from './ui';"],
    ['<ConsentGate key={user.uid} />', '<ConsentGate />'],
  ]) {
    assert.equal(restored.split(changed).length, 2);
    restored = restored.replace(changed, original);
  }
  assert.equal(restored, before);
});

const helper = "require('../2026-10-19-header-qa/2026-10-19-header-css.cjs').stripHeaderCSS";
const comparisons = [
  ['2026-10-16-progress-qa/2026-10-16-progress-regression.cjs', `${helper}(fs.readFileSync(path.join(root, 'client/src/styles.css'), 'utf8'))`, "fs.readFileSync(path.join(root, 'client/src/styles.css'), 'utf8')", 'f02bf2eccd98b19d67f3eb965ce147aa011642f7c615f86f5452e8c26cc21991'],
  ['2026-10-16-wrong-notes-qa/2026-10-16-wrong-notes-regression.cjs', `${helper}(fs.readFileSync(path.join(root,'client/src/styles.css'),'utf8'))`, "fs.readFileSync(path.join(root,'client/src/styles.css'),'utf8')", 'bed88cb70d14ad04bafa65e4abf8315a1ff1cc4ff8e1bfaef5df3dc6f1b34be8'],
  ['2026-10-17-onboarding-tests/2026-10-17-onboarding-regression.cjs', `${helper}(fs.readFileSync(path.join(root,'client/src/styles.css'),'utf8'))`, "fs.readFileSync(path.join(root,'client/src/styles.css'),'utf8')", '15bb515af0d4ea35d7f6a6a73cd906cf21de605efa2d2c5fcd2b664f3faa9842'],
  ['2026-10-17-auth-tests/2026-10-17-auth-regression.cjs', `${helper}(fs.readFileSync(path.join(root, 'client/src/styles.css'), 'utf8'))`, "fs.readFileSync(path.join(root, 'client/src/styles.css'))", '8fa9f77bab7f1550cbfd49926b0cae067c65be6a176cb15453d9a9349216cf6f'],
];
const portableBaselines = {
  '2026-10-16-progress-qa/2026-10-16-progress-regression.cjs': [
    "{ hashes: { 'client/src/styles.css': 'b1cd815f8fa9696e375c5f9d2c4e312ff008adc9f1791ccdc723bc44779308dd' } }",
    "JSON.parse(fs.readFileSync(path.join(__dirname, '2026-10-16-before.json'), 'utf8'))",
  ],
  '2026-10-16-wrong-notes-qa/2026-10-16-wrong-notes-regression.cjs': [
    "{ hashes: { 'client/src/styles.css': '2958453c9a1668956fce3340a981df49f410493c17f85a43dd731c5ac94cc2e3' } }",
    "JSON.parse(fs.readFileSync(path.join(__dirname,'2026-10-16-before.json'),'utf8'))",
  ],
};
const authHarnessAdditions = [
  "  scope.fields = {\n    reject: (_field, message) => scope.setError(message),\n    clear: () => scope.setError(''),\n    setFormError: scope.setError,\n  };\n",
  "  keys.push('field');\n",
];
for (const [file, changed, original, digest] of comparisons) {
  test(`${file}: only approved CSS comparison, baseline access and auth harness are changed`, () => {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.equal(text.split(changed).length, 2);
    let restored = text.replace(changed, original);
    if (portableBaselines[file]) {
      const [portable, snapshot] = portableBaselines[file];
      assert.equal(text.split(portable).length, 2);
      restored = restored.replace(portable, snapshot);
    }
    if (file === '2026-10-17-auth-tests/2026-10-17-auth-regression.cjs') {
      for (const addition of authHarnessAdditions) {
        assert.equal(restored.split(addition).length, 2);
        restored = restored.replace(addition, '');
      }
    }
    if (file === '2026-10-16-wrong-notes-qa/2026-10-16-wrong-notes-regression.cjs') {
      assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'));
      restored += '\n';
    }
    assert.equal(hash(restored), digest);
  });
}
