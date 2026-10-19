'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), { test } = require('node:test'), { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..'), req = createRequire(path.join(root, 'client/package.json'));
const React = req('react'), esbuild = req('esbuild'), { parse } = req('@babel/parser');
const { renderToStaticMarkup } = req('react-dom/server');
const authFile = path.join(root, 'client/src/pages/Auth.jsx');
const auth = fs.readFileSync(authFile, 'utf8');
const ui = fs.readFileSync(path.join(root, 'client/src/components/ui.jsx'), 'utf8');
const layout = fs.readFileSync(path.join(root, 'client/src/components/Layout.jsx'), 'utf8');
function declaration(source, name) {
  return parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body.map(n => n.declaration || n).find(n => n.id?.name === name);
}
function code(source, name) { const n = declaration(source, name); assert.ok(n, name); return source.slice(n.start, n.end); }
function compile(source) { return esbuild.transformSync(source, { loader: 'jsx', jsx: 'transform' }).code; }
function walk(element, predicate) {
  if (!element || typeof element !== 'object') return [];
  return (predicate(element) ? [element] : []).concat(React.Children.toArray(element.props?.children).flatMap(x => walk(x, predicate)));
}
const buttons = element => walk(element, x => x.type === 'button');
function hooks() {
  const states = [], refs = [], cleanups = [];
  let si = 0, ri = 0, mounted = true, started = false, afterUnmount = 0;
  return {
    useState(initial) {
      const i = si++; if (!(i in states)) states[i] = initial;
      return [states[i], value => { if (!mounted) afterUnmount++; states[i] = typeof value === 'function' ? value(states[i]) : value; }];
    },
    useRef(initial) { const i = ri++; return refs[i] ||= { current: initial }; },
    useEffect(fn) { if (!started) { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); } },
    reset() { si = 0; ri = 0; },
    rendered() { started = true; },
    unmount() { cleanups.forEach(fn => fn()); mounted = false; },
    states, get afterUnmount() { return afterUnmount; },
  };
}
function modal(props) {
  const h = hooks();
  const fn = vm.runInNewContext(compile(code(ui, 'Dialog')) + ';Dialog', { ...h, React, Icon: () => null, useId: () => 'dialog-title' });
  return fn(props);
}
test('dialog is dismissible by default and retains its labelled native element', () => {
  let closes = 0, prevented = 0;
  const element = modal({ open: true, onClose() { closes++; }, title: '제목' });
  assert.equal(element.type, 'dialog'); assert.equal(element.props['aria-labelledby'], 'dialog-title');
  assert.equal(buttons(element).length, 1); assert.equal(buttons(element)[0].props['aria-label'], '닫기');
  element.props.onCancel({ preventDefault() { prevented++; } });
  assert.equal(closes, 1); assert.equal(prevented, 0);
});
test('non-dismissible dialog prevents native cancel and has no inert close button', () => {
  let closes = 0, prevented = 0;
  const element = modal({ open: true, dismissible: false, onClose() { closes++; } });
  element.props.onCancel({ preventDefault() { prevented++; } });
  assert.equal(prevented, 1); assert.equal(closes, 0); assert.equal(buttons(element).length, 0);
});
test('normal dialog still forwards the event so a pending study log can prevent cancel', () => {
  let prevented = 0;
  const event = { preventDefault() { prevented++; } };
  const element = modal({ open: true, onClose: e => e.preventDefault() });
  element.props.onCancel(event); assert.equal(prevented, 1);
});
test('only a non-dismissible dialog cancels the Escape key, never Tab navigation', () => {
  let prevented = 0;
  const event = key => ({ key, preventDefault() { prevented++; } });
  modal({ open: true, dismissible: false }).props.onKeyDown(event('Escape'));
  assert.equal(prevented, 1);
  modal({ open: true, dismissible: false }).props.onKeyDown(event('Tab'));
  modal({ open: true }).props.onKeyDown(event('Escape'));
  assert.equal(prevented, 1);
});
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function gate(options = {}) {
  const h = hooks(), calls = [], failures = { ...options.failures };
  const Dialog = () => null, PrivacyNotice = () => null, ErrorBox = () => null;
  async function invoke(kind, ...args) {
    calls.push({ kind, args });
    options.onCall?.(kind);
    if (options.delay?.[kind]) await options.delay[kind];
    if (failures[kind]) { failures[kind]--; throw new Error('Fixture failure'); }
  }
  const fn = vm.runInNewContext(compile(code(layout, 'ConsentGate')) + ';ConsentGate', {
    ...h, React, Dialog, PrivacyNotice, ErrorBox,
    useAuth: () => ({ refreshMe: () => invoke('refresh'), logout: () => invoke('logout') }),
    api: (...args) => invoke('write', ...args),
  });
  const api = { calls, h, render() { h.reset(); const element = fn(); h.rendered(); return element; } };
  api.errorBox = element => walk(element, x => x.type === ErrorBox)[0];
  return api;
}
test('consent gate uses a non-dismissible dialog and is isolated by user identity', () => {
  assert.equal(gate().render().props.dismissible, false);
  assert.match(layout, /<ConsentGate key=\{user\.uid\} \/>/);
});
test('failed consent write unlocks actions and retries the unchanged API contract', async () => {
  const g = gate({ failures: { write: 1 } });
  await buttons(g.render())[1].props.onClick();
  let element = g.render();
  assert.equal(buttons(element)[1].props.disabled, false);
  assert.match(g.errorBox(element).props.error.message, /동의를 저장하지 못/);
  assert.equal(g.calls.filter(x => x.kind === 'refresh').length, 0);
  await g.errorBox(element).props.onRetry(); element = g.render();
  assert.equal(g.errorBox(element).props.error, null);
  assert.deepEqual(g.calls.map(x => x.kind), ['write', 'write', 'refresh']);
  assert.equal(g.calls[0].args[0], '/api/me');
  assert.equal(g.calls[0].args[1].method, 'PUT'); assert.equal(g.calls[0].args[1].body.consent, true);
});
test('failed refresh retries only the read after a successful consent write', async () => {
  const g = gate({ failures: { refresh: 1 } });
  await buttons(g.render())[1].props.onClick();
  const element = g.render();
  assert.match(g.errorBox(element).props.error.message, /동의는 저장됐지만/);
  assert.equal(buttons(element)[1].props.children, '정보 다시 불러오기');
  await g.errorBox(element).props.onRetry();
  assert.deepEqual(g.calls.map(x => x.kind), ['write', 'refresh', 'refresh']);
});
test('same-tick repeated consent and logout requests are blocked while saving', async () => {
  const wait = deferred(), g = gate({ delay: { write: wait.promise } });
  const initial = buttons(g.render()), saving = initial[1].props.onClick();
  await initial[1].props.onClick(); await initial[0].props.onClick();
  const current = g.render();
  assert.equal(g.calls.length, 1); assert.ok(buttons(current).every(x => x.props.disabled));
  assert.equal(walk(current, x => x.props?.role === 'status')[0].props.children, '동의를 저장하는 중이에요.');
  wait.resolve(); await saving; assert.ok(buttons(g.render()).every(x => !x.props.disabled));
});
test('refresh phase is announced and blocks competing actions', async () => {
  const wait = deferred(), entered = deferred(), g = gate({ delay: { refresh: wait.promise }, onCall: kind => { if (kind === 'refresh') entered.resolve(); } });
  const saving = buttons(g.render())[1].props.onClick();
  await entered.promise;
  const current = g.render();
  assert.equal(walk(current, x => x.props?.role === 'status')[0].props.children, '사용자 정보를 확인하는 중이에요.');
  assert.ok(buttons(current).every(x => x.props.disabled));
  wait.resolve(); await saving;
});
test('logout failure retries logout, never consent, and clears its lock', async () => {
  const g = gate({ failures: { logout: 1 } });
  await buttons(g.render())[0].props.onClick();
  const current = g.render(); assert.match(g.errorBox(current).props.error.message, /로그아웃하지 못/);
  assert.ok(buttons(current).every(x => !x.props.disabled));
  await g.errorBox(current).props.onRetry(); assert.deepEqual(g.calls.map(x => x.kind), ['logout', 'logout']);
});
test('unmount during the write prevents stale account refresh and state updates', async () => {
  const wait = deferred(), g = gate({ delay: { write: wait.promise } });
  const saving = buttons(g.render())[1].props.onClick();
  g.h.unmount(); wait.resolve(); await saving;
  assert.deepEqual(g.calls.map(x => x.kind), ['write']); assert.equal(g.h.afterUnmount, 0);
});
function fields() {
  let field = '', error = '', effect;
  const focused = [], form = { elements: { namedItem: name => ({ focus: () => focused.push(name) }) } };
  const fn = vm.runInNewContext(code(auth, 'useAuthFields') + ';useAuthFields', {
    useState: () => [field, value => { field = value; }], useRef: () => ({ current: form }), useId: () => 'form-error',
    useEffect: fn => { effect = fn; },
  });
  return { focused, get error() { return error; }, render() { const value = fn(error, value => { error = value; }); effect(); return value; } };
}
for (const name of ['email', 'nickname', 'password', 'password2', 'consent']) {
  test(name + ' validation links the error and focuses the named field', () => {
    const f = fields(); f.render().reject(name, '입력을 확인해 주세요.');
    const current = f.render(), props = current.inputProps(name);
    assert.equal(props.name, name); assert.equal(props['aria-invalid'], true);
    assert.equal(props['aria-describedby'], current.errorId); assert.equal(f.focused.at(-1), name);
    assert.equal(current.inputProps('another-field')['aria-invalid'], undefined);
  });
}
test('submitting the same invalid value again refocuses without requiring a new error render', () => {
  const f = fields(); f.render().reject('email', '이메일을 입력해 주세요.');
  const current = f.render(); current.reject('email', '이메일을 입력해 주세요.');
  assert.equal(f.focused.length, 2); assert.equal(f.focused.at(-1), 'email');
});
test('editing clears field metadata and remote failures do not blame a field', () => {
  const f = fields(); f.render().reject('password', '비밀번호를 입력해 주세요.');
  f.render().clear(); let current = f.render();
  assert.equal(f.error, ''); assert.equal(current.inputProps('password')['aria-invalid'], undefined);
  current.setFormError('네트워크 연결을 확인해 주세요.'); current = f.render();
  assert.equal(current.field, ''); assert.equal(current.inputProps('password')['aria-describedby'], undefined);
});
function renderAuth(page, override = {}) {
  const cache = new Map();
  const keys = { Login: ['email', 'password', 'error', 'fails', 'busy', 'field'], Signup: ['form', 'error', 'busy', 'field'], ResetPassword: ['email', 'sent', 'error', 'busy', 'field'] }[page];
  let cursor = 0;
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    function localRequire(id) {
      if (id.endsWith('.css')) return {};
      if (id === 'react' && file === authFile) return { ...React, useState(initial) { const key = keys[cursor++]; return [Object.hasOwn(override, key) ? override[key] : initial, () => {}]; }, useRef: initial => ({ current: initial }) };
      if (id === 'react-router-dom') return { Link: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children), Navigate: () => null, useLocation: () => ({ pathname: '/login' }), useNavigate: () => () => {}, useSearchParams: () => [new URLSearchParams()] };
      if (['firebase/auth', '../firebase', '../api/client'].includes(id)) return {};
      if (id === '../context/AuthContext') return { useAuth: () => ({ user: null }) };
      if (!id.startsWith('.')) return req(id);
      const base = path.resolve(path.dirname(file), id), resolved = [base, base + '.jsx', base + '.js'].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
      return load(resolved);
    }
    vm.runInNewContext(esbuild.transformSync(fs.readFileSync(file, 'utf8'), { loader: 'jsx', jsx: 'automatic', format: 'cjs' }).code,
      { module, exports: module.exports, require: localRequire, console, URL, window: { location: { origin: 'http://fixture.test' } } }, { filename: file });
    return module.exports;
  }
  return renderToStaticMarkup(React.createElement(load(authFile)[page]));
}
for (const page of ['Login', 'Signup', 'ResetPassword']) {
  test(page + ' rendered field error references the same unique alert ID', () => {
    const html = renderAuth(page, { error: '이메일을 입력해 주세요.', field: 'email' });
    const alertId = html.match(/<p id="([^"]+)" class="field-error" role="alert"/)[1];
    const input = html.match(/<input[^>]+name="email"[^>]*>/)[0];
    assert.ok(input.includes('aria-describedby="' + alertId + '"')); assert.ok(input.includes('aria-invalid="true"'));
  });
  test(page + ' rendered network error belongs to the form, not an input', () => {
    const html = renderAuth(page, { error: '네트워크 연결을 확인해 주세요.', field: '' });
    assert.match(html, /<form[^>]*aria-describedby=/); assert.doesNotMatch(html, /aria-invalid="true"/);
  });
}
test('signup password confirmation has its own error and preserves both masked controls', () => {
  const html = renderAuth('Signup', { error: '비밀번호 확인이 일치하지 않습니다.', field: 'password2' });
  assert.equal((html.match(/type="password"/g) || []).length, 2);
  assert.match(html, /<input name="password2" aria-invalid="true" aria-describedby=/);
  assert.doesNotMatch(html, /<input name="password" aria-invalid=/);
});
test('signup consent checkbox receives the same field-specific error support', () => {
  const html = renderAuth('Signup', { error: '동의가 필요해요.', field: 'consent' });
  assert.match(html, /<input name="consent" aria-invalid="true" aria-describedby="[^"]+" type="checkbox"/);
});
