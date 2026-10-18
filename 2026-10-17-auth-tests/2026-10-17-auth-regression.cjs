'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const req = createRequire(path.join(root, 'client/package.json'));
const { parse } = req('@babel/parser');
const esbuild = req('esbuild');
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const filename = path.join(root, 'client/src/pages/Auth.jsx');
const source = fs.readFileSync(filename, 'utf8');
const nodes = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body;
const declarations = nodes.flatMap(n => n.declaration ? [n.declaration] : [n]);
function node(name) {
  return declarations.find(n => n.id?.name === name || n.declarations?.some(d => d.id.name === name));
}
const code = name => source.slice(node(name).start, node(name).end);
const shared = ['ERR', 'msg', 'NEXT_PATHS', 'safeNext', 'emailError'].map(code).join('\n');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const failure = code => Object.assign(new Error('Fixture failure'), { code });
function action() {
  const state = { busy: null };
  const value = vm.runInNewContext(code('useAuthAction') + ';useAuthAction()', {
    useState: () => [null, v => { state.busy = v; }],
    useRef: v => ({ current: v }),
  });
  Object.defineProperty(value, 'busy', { get: () => state.busy });
  return value;
}
function harness(page = 'Login', options = {}) {
  const state = { email: ' qa@example.test ', password: ' Example123! ', error: '', fails: 0, sent: false,
    form: { email: ' qa@example.test ', nickname: ' 프론트 QA ', password: 'Example123!', password2: 'Example123!', consent: true }, ...options.state };
  const calls = [], navigations = [], sharedAction = action();
  const failures = { ...options.failures };
  async function invoke(kind, ...args) {
    calls.push({ kind, args });
    if (options.delay?.[kind]) await options.delay[kind];
    if (failures[kind]) { failures[kind]--; throw failure(options.code || 'auth/network-request-failed'); }
    return { user: { uid: 'fixture-only-user' } };
  }
  const scope = { action: sharedAction, auth: {}, googleProvider: {}, next: '/materials?q=SQL&bookmarked=1#topics',
    URL, window: { location: { origin: 'http://fixture.test' } },
    document: { createElement: () => ({ type: '', value: '', validity: { typeMismatch: !!options.emailMismatch } }) },
    signInWithEmailAndPassword: (...args) => invoke('email', ...args),
    createUserWithEmailAndPassword: (...args) => invoke('signup', ...args),
    updateProfile: (...args) => invoke('profile', ...args),
    api: (...args) => invoke('api', ...args),
    refreshMe: () => invoke('refresh'),
    signInWithPopup: (...args) => invoke('google', ...args),
    sendPasswordResetEmail: (...args) => invoke('reset', ...args),
    navigate: (...args) => navigations.push(args),
  };
  for (const name of Object.keys(state)) {
    Object.defineProperty(scope, name, { get: () => state[name] });
    scope['set' + name[0].toUpperCase() + name.slice(1)] = v => { state[name] = typeof v === 'function' ? v(state[name]) : v; };
  }
  scope.onError = scope.setError;
  const funcs = node(page).body.body.filter(n => n.type === 'FunctionDeclaration').map(n => source.slice(n.start, n.end)).join('\n');
  let googleClick;
  function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'JSXAttribute' && n.name.name === 'onClick') googleClick = n.value.expression;
    for (const v of Object.values(n)) if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v);
  }
  walk(node('GoogleButton'));
  const methods = vm.runInNewContext(shared + '\n' + funcs + '\n({submit,google:' + source.slice(googleClick.start, googleClick.end) + '})', scope);
  return { ...methods, state, calls, navigations, action: sharedAction, event: { preventDefault() {} } };
}

test('shared action lock rejects same-tick requests and unlocks for retry', () => {
  const a = action(); assert.equal(a.begin('email'), true); assert.equal(a.begin('google'), false);
  assert.equal(a.busy, 'email'); a.end(); assert.equal(a.pending.current, false); assert.equal(a.begin('google'), true);
});
for (const page of ['Login', 'Signup', 'ResetPassword']) {
  test(page + ' blocks blank email before SDK calls', async () => {
    const h = harness(page, { state: page === 'Signup' ? { form: { email: '  ' } } : { email: ' ' } });
    await h.submit(h.event); assert.equal(h.calls.length, 0); assert.match(h.state.error, /이메일을 입력/);
  });
  test(page + ' delegates email syntax validation to native validity', async () => {
    const h = harness(page, { emailMismatch: true }); await h.submit(h.event);
    assert.equal(h.calls.length, 0); assert.match(h.state.error, /이메일 형식/);
  });
}
test('login blocks a missing password without strengthening existing password rules', async () => {
  const h = harness('Login', { state: { password: '' } }); await h.submit(h.event); assert.equal(h.calls.length, 0); assert.match(h.state.error, /비밀번호를 입력/);
});
test('login trims only email and preserves the password exactly', async () => {
  const h = harness(); await h.submit(h.event); assert.equal(h.calls[0].args[1], 'qa@example.test'); assert.equal(h.calls[0].args[2], ' Example123! ');
  assert.equal(h.navigations[0][0], '/materials?q=SQL&bookmarked=1#topics'); assert.equal(h.navigations[0][1].replace, true);
});
for (const page of ['Login', 'Signup', 'ResetPassword']) {
  test(page + ' prevents repeated submit while its SDK call is pending', async () => {
    const wait = deferred(), kind = { Login: 'email', Signup: 'signup', ResetPassword: 'reset' }[page];
    const h = harness(page, { delay: { [kind]: wait.promise } }); const pending = h.submit(h.event);
    await h.submit(h.event); assert.equal(h.calls.length, 1); assert.equal(h.action.pending.current, true);
    wait.resolve(); await pending; assert.equal(h.calls.filter(c => c.kind === kind).length, 1);
  });
}
for (const page of ['Login', 'Signup']) {
  test(page + ' blocks Google while email processing is pending', async () => {
    const wait = deferred(), kind = page === 'Login' ? 'email' : 'signup';
    const h = harness(page, { delay: { [kind]: wait.promise } }); const pending = h.submit(h.event);
    await h.google(); assert.equal(h.calls.length, 1); wait.resolve(); await pending;
  });
  test(page + ' blocks email and repeated Google while Google is pending', async () => {
    const wait = deferred(), h = harness(page, { delay: { google: wait.promise } }); const pending = h.google();
    await h.google(); await h.submit(h.event); assert.equal(h.calls.length, 1); wait.resolve(); await pending;
    assert.equal(h.navigations.length, 1); assert.equal(h.action.pending.current, false);
  });
}
for (const [sdkCode, expected] of [['auth/network-request-failed', /네트워크/], ['auth/invalid-credential', /이메일 또는 비밀번호/], ['auth/too-many-requests', /잠시/]]) {
  test('login failure ' + sdkCode + ' keeps inputs and allows retry', async () => {
    const h = harness('Login', { failures: { email: 1 }, code: sdkCode }); await h.submit(h.event);
    assert.match(h.state.error, expected); assert.equal(h.state.email, ' qa@example.test '); assert.equal(h.state.password, ' Example123! ');
    assert.equal(h.action.pending.current, false); await h.submit(h.event); assert.equal(h.navigations.length, 1);
  });
}
for (const sdkCode of ['auth/popup-closed-by-user', 'auth/network-request-failed']) {
  test('Google failure ' + sdkCode + ' clears busy and permits retry', async () => {
    const h = harness('Login', { failures: { google: 1 }, code: sdkCode }); await h.google();
    assert.ok(h.state.error); assert.equal(h.action.pending.current, false); await h.google(); assert.equal(h.navigations.length, 1);
  });
}
for (const [patch, expected] of [[{ nickname: 'a' }, /닉네임/], [{ password: 'short' }, /비밀번호는/], [{ password2: 'Mismatch123!' }, /일치/], [{ consent: false }, /동의/]]) {
  test('signup retains existing validation ' + Object.keys(patch)[0], async () => {
    const h = harness('Signup'); Object.assign(h.state.form, patch); await h.submit(h.event); assert.equal(h.calls.length, 0); assert.match(h.state.error, expected);
  });
}
test('signup preserves SDK and profile write order and consent contract', async () => {
  const h = harness('Signup'); await h.submit(h.event); assert.deepEqual(h.calls.map(c => c.kind), ['signup', 'profile', 'api', 'refresh']);
  assert.equal(h.calls[0].args[1], 'qa@example.test'); assert.equal(h.calls[1].args[1].displayName, '프론트 QA');
  assert.equal(h.calls[2].args[0], '/api/me'); assert.equal(h.calls[2].args[1].method, 'PUT'); assert.equal(h.calls[2].args[1].body.consent, true);
  assert.equal(h.navigations[0][0], '/materials?q=SQL&bookmarked=1#topics');
});
test('failed initial signup keeps the draft and permits retry', async () => {
  const h = harness('Signup', { failures: { signup: 1 }, code: 'auth/email-already-in-use' }); await h.submit(h.event);
  assert.match(h.state.error, /이미 가입/); assert.equal(h.state.form.nickname, ' 프론트 QA '); assert.equal(h.action.pending.current, false);
});
test('reset failure preserves email and retries only the existing SDK operation', async () => {
  const h = harness('ResetPassword', { failures: { reset: 1 } }); await h.submit(h.event); assert.equal(h.state.sent, false); assert.match(h.state.error, /네트워크/);
  await h.submit(h.event); assert.equal(h.state.sent, true); assert.equal(h.calls.length, 2); assert.equal(h.calls[1].args[1], 'qa@example.test'); assert.equal(h.action.pending.current, false);
});

function render(page, overrides = {}, query = 'next=' + encodeURIComponent('/materials?q=SQL&bookmarked=1#topics')) {
  const cache = new Map(), keys = { Login: ['email', 'password', 'error', 'fails', 'busy'], Signup: ['form', 'error', 'busy'], ResetPassword: ['email', 'sent', 'error', 'busy'] }[page];
  let index = 0;
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const m = { exports: {} }; cache.set(file, m);
    function localRequire(id) {
      if (id.endsWith('.css')) return {};
      if (id === 'react' && file === filename) return { ...React, useState: initial => { const key = keys[index++]; return [Object.hasOwn(overrides, key) ? overrides[key] : initial, () => {}]; }, useRef: v => ({ current: v }) };
      if (id === 'react-router-dom') return { Link: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children), Navigate: ({ to }) => React.createElement('div', { 'data-next': to }), useNavigate: () => () => {}, useSearchParams: () => [new URLSearchParams(query)] };
      if (id === 'firebase/auth' || id === '../firebase') return {};
      if (id === '../api/client') return {};
      if (id === '../context/AuthContext') return { useAuth: () => ({ user: null, refreshMe() {} }) };
      if (!id.startsWith('.')) return req(id);
      const base = path.resolve(path.dirname(file), id), resolved = [base, base + '.jsx', base + '.js'].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
      return load(resolved);
    }
    vm.runInNewContext(esbuild.transformSync(fs.readFileSync(file, 'utf8'), { loader: 'jsx', format: 'cjs', jsx: 'automatic' }).code,
      { module: m, exports: m.exports, require: localRequire, console, URL, window: { location: { origin: 'http://fixture.test' } } }, { filename: file });
    return m.exports;
  }
  return renderToStaticMarkup(React.createElement(load(filename)[page]));
}
for (const page of ['Login', 'Signup', 'ResetPassword']) {
  test(page + ' locks inputs, submit and navigation while pending', () => {
    const html = render(page, { busy: page === 'ResetPassword' ? 'reset' : 'email' });
    assert.match(html, /aria-busy="true"/); assert.match(html, /<fieldset[^>]*disabled=""/); assert.match(html, /aria-disabled="true"/);
    assert.match(html, /<button[^>]*type="submit"[^>]*disabled=""/);
  });
}
test('password controls are named, independently identified, masked and never submit the form', () => {
  const html = render('Signup'); assert.equal((html.match(/type="password"/g) || []).length, 2);
  assert.equal((html.match(/aria-pressed="false"/g) || []).length, 2); assert.match(html, /aria-label="비밀번호 보기"/); assert.match(html, /aria-label="비밀번호 확인 보기"/);
  const ids = [...html.matchAll(/aria-controls="([^"]+)"/g)].map(m => m[1]); assert.equal(new Set(ids).size, 2);
  assert.equal((html.match(/type="button" class="auth-password-toggle"/g) || []).length, 2);
});
test('password visibility only changes local visibility and leaves value and onChange bindings intact', () => {
  const inputNodes = [], clickNodes = [];
  function visit(n) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'JSXOpeningElement' && n.name.name === 'input') inputNodes.push(n);
    if (n.type === 'JSXAttribute' && n.name.name === 'onClick') clickNodes.push(n.value.expression);
    for (const v of Object.values(n)) if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v === 'object') visit(v);
  }
  visit(node('PasswordField'));
  const attribute = name => inputNodes[0].attributes.find(a => a.name?.name === name).value.expression;
  assert.equal(attribute('value').name, 'value'); assert.equal(attribute('onChange').name, 'onChange');
  let visible = false;
  const click = vm.runInNewContext('(' + source.slice(clickNodes[0].start, clickNodes[0].end) + ')', { setVisible: fn => { visible = fn(visible); } });
  click(); assert.equal(visible, true); click(); assert.equal(visible, false);
});
test('auth navigation is guarded synchronously before the busy render', () => {
  let click;
  function visit(n) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'JSXAttribute' && n.name.name === 'onClick') click = n.value.expression;
    for (const v of Object.values(n)) if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v === 'object') visit(v);
  }
  visit(node('AuthLink'));
  const a = action(); let blocked = 0;
  const handler = vm.runInNewContext('(' + source.slice(click.start, click.end) + ')', { action: a });
  handler({ preventDefault() { blocked++; } }); assert.equal(blocked, 0);
  a.begin('email'); handler({ preventDefault() { blocked++; } }); assert.equal(blocked, 1);
});
test('login uses current-password and signup uses new-password autocomplete', () => {
  assert.match(render('Login'), /autoComplete="current-password"/); assert.equal((render('Signup').match(/autoComplete="new-password"/g) || []).length, 2);
});
test('five failures do not claim the password was necessarily wrong', () => {
  const html = render('Login', { fails: 5 }); assert.match(html, /네트워크 연결/); assert.doesNotMatch(html, /비밀번호를 5회/);
  assert.match(html, /reset-password\?next=/); assert.match(html, /&amp;email=/);
});
test('login, signup and both reset branches retain the safe next query and fragment', () => {
  const expected = encodeURIComponent('/materials?q=SQL&bookmarked=1#topics');
  for (const [page, state] of [['Login', {}], ['Signup', {}], ['ResetPassword', {}], ['ResetPassword', { sent: true }]]) assert.ok(render(page, state).includes('next=' + expected));
});
test('reset return links reject an external next URL', () => {
  assert.match(render('ResetPassword', {}, 'next=' + encodeURIComponent('//external.test/')), /href="\/login\?next=%2F"/);
});
test('all new style selectors are scoped to auth and the shared stylesheet is untouched', () => {
  const css = req('postcss').parse(fs.readFileSync(path.join(root, 'client/src/pages/2026-10-17-auth.css'), 'utf8'));
  css.walkRules(rule => rule.selectors.forEach(selector => assert.ok(selector.startsWith('.auth-page '), selector)));
  // Baseline from 0859724; no local QA snapshot is required.
  const stylesHash = 'ab380b4380eecab26194bbe2b6bcdef4053d85d2dd49c54d4aa905d0d17caec9';
  assert.equal(crypto.createHash('sha256').update(require('../2026-10-19-header-qa/2026-10-19-header-css.cjs').stripHeaderCSS(fs.readFileSync(path.join(root, 'client/src/styles.css'), 'utf8'))).digest('hex'), stylesHash);
});
test('existing icons are byte-preserved and only eye icons are added', () => {
  const text = fs.readFileSync(path.join(root, 'client/src/components/Icon.jsx'), 'utf8');
  const original = text.split('\n').filter(line => !/^  (eye|eyeOff):/.test(line)).join('\n');
  const iconsHash = '2a418117c709443bece108d8e5661d9c69650a8877105125e0fa0ae0ee7e768c';
  assert.equal(crypto.createHash('sha256').update(original).digest('hex'), iconsHash);
});
