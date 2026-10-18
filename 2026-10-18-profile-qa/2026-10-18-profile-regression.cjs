'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const req = createRequire(path.join(root, 'client/package.json'));
const React = req('react');
const esbuild = req('esbuild');
const { renderToStaticMarkup } = req('react-dom/server');
const { parse } = req('@babel/parser');
const filename = path.join(root, 'client/src/pages/Profile.jsx');
const source = fs.readFileSync(filename, 'utf8');
const me = { uid: 'fixture-profile', email: 'qa@example.test', nickname: '프로필 QA', targetExamId: 'exam1' };
const exams = { loading: false, error: null, data: { items: [{ id: 'exam1', year: 2026, round: 3, type: 'written', examDate: '2026-11-01' }] }, reload() {} };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const fail = () => Object.assign(new Error('연결을 확인한 뒤 다시 시도해 주세요.'), { status: 503 });

function harness(options = {}) {
  const slots = [], effects = [], calls = [], failures = { ...options.failures };
  let cursor = 0, active = true, updatesAfterUnmount = 0, tree, effectQueue = [];
  const props = { user: { uid: me.uid, email: me.email, providerData: [] }, me, exams, ...options.props };
  let server = { ...me };
  async function invoke(kind, body) {
    calls.push({ kind, body });
    if (options.delay?.[kind]) await options.delay[kind];
    if (failures[kind]) { failures[kind]--; throw fail(); }
    if (kind === 'PUT') server = { ...server, ...body };
    return { ...server, ...options.canonical };
  }
  props.refreshMe = () => invoke('GET');
  const hooks = {
    ...React,
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: initial };
      return [slots[i].value, v => { if (!active) updatesAfterUnmount++; slots[i].value = typeof v === 'function' ? v(slots[i].value) : v; }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useEffect(fn, deps) {
      const i = cursor++, previous = effects[i];
      if (!previous || deps.some((v, j) => !Object.is(v, previous.deps[j]))) effectQueue.push(() => {
        previous?.cleanup?.(); effects[i] = { deps, cleanup: fn() };
      });
    },
  };
  const module = { exports: {} }, cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const m = file === filename ? module : { exports: {} }; cache.set(file, m);
    function localRequire(id) {
      if (id === 'react') return file === filename ? hooks : React;
      if (id === 'react-router-dom') return { Link: ({ to, children, ...rest }) => React.createElement('a', { href: to, ...rest }, children), useNavigate: () => () => {}, useLocation: () => ({ pathname: '/profile' }) };
      if (id === 'firebase/auth' || id === '../firebase') return {};
      if (id === '../api/client') return { api: (url, init) => { assert.equal(url, '/api/me'); assert.equal(init.method, 'PUT'); return invoke('PUT', init.body); } };
      if (id === '../context/AuthContext') return { useAuth: () => ({ ...props, logout() {} }) };
      if (id === '../hooks/useApi') return { useApi: () => props.exams };
      if (!id.startsWith('.')) return req(id);
      const base = path.resolve(path.dirname(file), id), resolved = [base, base + '.jsx', base + '.js'].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
      return load(resolved);
    }
    const code = esbuild.transformSync(fs.readFileSync(file, 'utf8') + (file === filename ? '\nexport { ProfileForm };' : ''), { loader: 'jsx', format: 'cjs', jsx: 'automatic' }).code;
    vm.runInNewContext(code, { module: m, exports: m.exports, require: localRequire, console, setTimeout, clearTimeout }, { filename: file });
    return m.exports;
  }
  const Form = load(filename).ProfileForm;
  function render() {
    for (let pass = 0; pass < 2; pass++) {
      cursor = 0; tree = Form(props); const queue = effectQueue; effectQueue = []; queue.forEach(fn => fn());
    }
    return tree;
  }
  function elements(type) {
    const found = [];
    function visit(n) { if (!n || typeof n !== 'object') return; if (n.type === type) found.push(n); React.Children.forEach(n.props?.children, visit); }
    visit(tree); return found;
  }
  const h = {
    props, calls, render, elements,
    save: () => { render(); return tree.props.onSubmit({ preventDefault() {} }); },
    edit: (field, value) => { render(); elements(field === 'nickname' ? 'input' : 'select')[0].props.onChange({ target: { value } }); render(); },
    html: () => { render(); return renderToStaticMarkup(tree); },
    unmount: () => { effects.forEach(e => e?.cleanup?.()); active = false; },
    get updatesAfterUnmount() { return updatesAfterUnmount; },
    get draft() { render(); return { nickname: elements('input')[0].props.value, targetExamId: elements('select')[0].props.value }; },
    read: () => { render(); return elements(load(path.join(root, 'client/src/components/ui.jsx')).ErrorBox).find(n => n.props.error && n.props.onRetry)?.props.onRetry(); },
  };
  render(); return h;
}

test('save trims nickname, keeps target and applies canonical GET values', async () => {
  const h = harness({ canonical: { nickname: '서버 이름' } }); h.edit('nickname', ' 새 이름 '); await h.save();
  assert.deepEqual(h.calls.map(c => c.kind), ['PUT', 'GET']); assert.equal(h.calls[0].body.nickname, '새 이름'); assert.equal(h.calls[0].body.targetExamId, 'exam1');
  assert.equal(h.draft.nickname, '서버 이름'); assert.match(h.html(), /저장했어요/);
});
test('empty target remains the existing nullable API contract', async () => {
  const h = harness(); h.edit('targetExamId', ''); await h.save(); assert.equal(h.calls[0].body.targetExamId, null);
});
for (const nickname of [' ', ' a ', 'x'.repeat(21)]) test('trimmed nickname boundary: ' + JSON.stringify(nickname), async () => {
  const h = harness(); h.edit('nickname', nickname); await h.save(); assert.equal(h.calls.length, 0); assert.match(h.html(), /2~20자/);
});
for (const nickname of ['가나', 'x'.repeat(20)]) test('valid nickname length: ' + nickname.length, async () => {
  const h = harness(); h.edit('nickname', nickname); await h.save(); assert.equal(h.calls.length, 2);
});
test('same-tick duplicate submits produce only one PUT', async () => {
  const wait = deferred(), h = harness({ delay: { PUT: wait.promise } }); const pending = h.save(); await h.save(); await h.save();
  assert.equal(h.calls.length, 1); assert.match(h.html(), /aria-busy="true"/); assert.match(h.html(), /fieldset[^>]*disabled/);
  assert.match(h.html(), /저장 중/); h.edit('nickname', '중복 입력'); assert.equal(h.draft.nickname, me.nickname);
  wait.resolve(); await pending; assert.equal(h.calls.filter(c => c.kind === 'PUT').length, 1);
});
test('GET pending keeps inputs, submit and navigation locked', async () => {
  const wait = deferred(), h = harness({ delay: { GET: wait.promise } }); const pending = h.save(); await Promise.resolve();
  await h.save(); const html = h.html(); assert.match(html, /불러오는 중/); assert.match(html, /aria-disabled="true"/); assert.match(html, /button[^>]*type="submit"[^>]*disabled/);
  wait.resolve(); await pending; assert.equal(h.calls.length, 2);
});
test('PUT failure keeps editable draft and permits explicit retry', async () => {
  const h = harness({ failures: { PUT: 1 } }); h.edit('nickname', '실패 초안'); await h.save();
  assert.equal(h.draft.nickname, '실패 초안'); assert.doesNotMatch(h.html(), /저장했어요/); assert.match(h.html(), /다시 시도/);
  assert.equal(h.elements('fieldset')[0].props.disabled, false); await h.save(); assert.deepEqual(h.calls.map(c => c.kind), ['PUT', 'PUT', 'GET']);
});
test('confirmed PUT plus failed GET retries only GET, even after repeated read failures', async () => {
  const h = harness({ failures: { GET: 2 } }); h.edit('nickname', '보존할 초안'); await h.save();
  assert.match(h.html(), /저장은 완료됐어요/); assert.match(h.html(), /정보 다시 불러오기/); assert.equal(h.elements('fieldset')[0].props.disabled, true);
  h.edit('nickname', '바뀌면 안 됨'); assert.equal(h.draft.nickname, '보존할 초안');
  await h.save(); await h.save(); assert.deepEqual(h.calls.map(c => c.kind), ['PUT', 'GET', 'GET', 'GET']);
  assert.match(h.html(), /저장했어요/); assert.equal(h.elements('fieldset')[0].props.disabled, false);
});
test('editing clears stale success and previous write errors', async () => {
  const h = harness(); await h.save(); h.edit('nickname', '다음 초안'); assert.doesNotMatch(h.html(), /저장했어요/);
  h.edit('nickname', ' '); await h.save(); h.edit('nickname', '정상 초안'); assert.doesNotMatch(h.html(), /2~20자/);
});
test('clean form follows matching context updates', () => {
  const h = harness(); h.props.me = { ...me, nickname: '갱신된 이름', targetExamId: '' }; assert.equal(h.draft.nickname, '갱신된 이름'); assert.equal(h.draft.targetExamId, '');
});
test('context refresh never overwrites an unsaved draft', () => {
  const h = harness(); h.edit('nickname', '작성 중'); h.props.me = { ...me, nickname: '외부 갱신' }; assert.equal(h.draft.nickname, '작성 중');
});
test('context arriving during PUT does not overwrite draft', async () => {
  const wait = deferred(), h = harness({ delay: { PUT: wait.promise } }); h.edit('nickname', '내 초안'); const pending = h.save();
  h.props.me = { ...me, nickname: '다른 응답' }; assert.equal(h.draft.nickname, '내 초안'); wait.resolve(); await pending;
});
for (const propsMe of [null, { ...me, uid: 'different-owner' }, { uid: me.uid }]) test('missing or mismatched initial profile cannot save defaults: ' + JSON.stringify(propsMe), async () => {
  const h = harness({ props: { me: propsMe } }); await h.save(); assert.equal(h.calls.length, 0); assert.equal(h.draft.nickname, '');
  assert.match(h.html(), /프로필 정보를 불러오지/); await h.read(); assert.equal(h.draft.nickname, me.nickname); assert.deepEqual(h.calls.map(c => c.kind), ['GET']);
});
test('initial profile read failure remains retryable without writes', async () => {
  const h = harness({ props: { me: null }, failures: { GET: 1 } }); await h.read(); assert.equal(h.elements('fieldset')[0].props.disabled, true);
  await h.read(); h.render(); assert.equal(h.elements('fieldset')[0].props.disabled, false); assert.equal(h.calls.filter(c => c.kind === 'PUT').length, 0);
});
test('invalid refreshed owner never replaces the draft or repeats PUT', async () => {
  const h = harness({ canonical: { uid: 'other-owner' } }); await h.save(); assert.match(h.html(), /프로필 정보를 확인하지/); await h.save();
  assert.deepEqual(h.calls.map(c => c.kind), ['PUT', 'GET', 'GET']); assert.equal(h.draft.nickname, me.nickname);
});
for (const condition of [{ loading: true, data: null }, { error: fail(), data: null }, { data: { items: [] } }]) test('unavailable selected exam is retained and never silently cleared: ' + Object.keys(condition)[0], async () => {
  const h = harness({ props: { exams: { ...exams, ...condition } } }); assert.match(h.html(), /저장된 목표 회차/);
  assert.equal(h.draft.targetExamId, 'exam1'); await h.save(); assert.equal(h.calls.length, 0);
});
test('exam request error exposes retry without modifying the draft', () => {
  let retries = 0; const h = harness({ props: { exams: { ...exams, data: null, error: fail(), reload: () => retries++ } } });
  assert.match(h.html(), /다시 시도/); h.props.exams.reload(); assert.equal(retries, 1); assert.equal(h.draft.targetExamId, 'exam1');
});
test('no target allows nickname-only save even when exam endpoint is unavailable', async () => {
  const h = harness({ props: { me: { ...me, targetExamId: null }, exams: { ...exams, data: null, error: fail() } } });
  await h.save(); assert.equal(h.calls[0].body.targetExamId, null);
});
test('missing exam can be explicitly cleared and empty list is announced', async () => {
  const h = harness({ props: { exams: { ...exams, data: { items: [] } } } }); assert.match(h.html(), /등록된 시험 회차가 없어요/);
  h.edit('targetExamId', ''); await h.save(); assert.equal(h.calls[0].body.targetExamId, null);
});
test('unmount while PUT pending prevents follow-up GET and component state writes', async () => {
  const wait = deferred(), h = harness({ delay: { PUT: wait.promise } }); const pending = h.save(); h.unmount(); wait.resolve(); await pending;
  assert.deepEqual(h.calls.map(c => c.kind), ['PUT']); assert.equal(h.updatesAfterUnmount, 0);
});
test('unmount while GET pending prevents component state writes', async () => {
  const wait = deferred(), h = harness({ delay: { GET: wait.promise } }); const pending = h.save(); await Promise.resolve(); h.unmount(); wait.resolve(); await pending;
  assert.equal(h.updatesAfterUnmount, 0);
});
test('form remount key is the authenticated user UID', () => { assert.match(source, /<ProfileForm key=\{user\?\.uid\}/); });
test('logout, withdrawal and reauthentication source remain byte-for-byte unchanged', () => {
  const before = cp.execFileSync('git', ['show', 'HEAD:client/src/pages/Profile.jsx'], { cwd: root, encoding: 'utf8' });
  function withdraw(s) { const n = parse(s, { sourceType: 'module', plugins: ['jsx'] }).program.body.find(n => n.type === 'ExportDefaultDeclaration').declaration.body.body.find(n => n.id?.name === 'withdraw'); return s.slice(n.start, n.end); }
  assert.equal(withdraw(source), withdraw(before));
  const tail = s => s.slice(s.indexOf('      <section className="card">\n        <h2>로그아웃</h2>'));
  assert.equal(tail(source), tail(before));
});
