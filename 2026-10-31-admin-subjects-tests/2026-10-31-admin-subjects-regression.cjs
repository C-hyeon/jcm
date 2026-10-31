'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const assert = require('node:assert/strict'), { test } = require('node:test'), { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..'), req = createRequire(path.join(root, 'client/package.json'));
const React = req('react'), { parse } = req('@babel/parser');
const source = fs.readFileSync(path.join(root, 'client/src/pages/Admin.jsx'), 'utf8');
const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
const component = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === 'SubjectsAdmin');
const code = req('esbuild').transformSync(source.slice(component.start, component.end), { loader: 'jsx' }).code;
const fixtures = [{ id: 'qa-subject', name: '가짜 QA 과목', examType: 'written', order: 1, tags: ['QA'], units: [{ id: 'qa-unit', subjectId: 'qa-subject', name: '가짜 QA 단원', order: 1, standardHours: 2, core: false, tags: [] }] }];
const clone = value => JSON.parse(JSON.stringify(value));
const ErrorBox = () => null, Notice = () => null;
function walk(node, match) {
  if (!node || typeof node !== 'object') return [];
  return (match(node) ? [node] : []).concat(React.Children.toArray(node.props?.children).flatMap(child => walk(child, match)));
}
function text(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return React.Children.toArray(node?.props?.children).map(text).join('');
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const failure = (status = 503, message = 'Synthetic private detail') => Object.assign(new Error(message), { status, code: 'QA_FAILURE' });
function harness(options = {}) {
  const states = [], refs = [], effects = [], calls = []; let si = 0, ri = 0, ei = 0, writes = 0;
  const q = { data: { items: clone(fixtures) }, error: null, loading: false, reloads: 0, reload() { q.reloads++; }, ...options.query };
  const scope = { React, ErrorBox, Notice, Loading: () => null,
    useState(initial) { const i = si++; if (!(i in states)) states[i] = initial; return [states[i], next => { writes++; states[i] = typeof next === 'function' ? next(states[i]) : next; }]; },
    useRef(initial) { return refs[ri++] ||= { current: initial }; },
    useEffect(effect, deps) { const i = ei++, old = effects[i]; if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) effects[i] = { effect, deps, pending: true, cleanup: old?.cleanup }; },
    useApi() { return q; },
    async api(route, settings = {}) { const call = { route, method: settings.method || 'GET', body: settings.body && clone(settings.body) }; calls.push(call); return options.request ? options.request(call, calls) : call.method === 'GET' ? { items: clone(fixtures) } : { ok: true }; },
  };
  const render = vm.runInNewContext(code + ';SubjectsAdmin', scope);
  const h = { q, calls, render() {
    for (let n = 0; n < 8; n++) {
      si = 0; ri = 0; ei = 0; const tree = render(), before = writes;
      for (const effect of effects) if (effect.pending) { effect.pending = false; effect.cleanup?.(); effect.cleanup = effect.effect(); }
      if (before === writes) return tree;
    }
    throw new Error('Unexpected effect loop');
  }, unmount() { effects.forEach(effect => effect.cleanup?.()); }, writes: () => writes };
  h.editor = () => walk(h.render(), n => n.type === 'textarea')[0];
  h.change = value => h.editor().props.onChange({ target: { value } });
  h.button = () => walk(h.render(), n => n.type === 'button')[0];
  h.save = () => h.button().props.onClick();
  h.errors = () => walk(h.render(), n => n.type === ErrorBox && n.props.error);
  h.error = pattern => h.errors().find(n => pattern.test(n.props.error.message));
  h.disabled = () => h.editor().props.disabled === true && h.button().props.disabled === true;
  h.render(); return h;
}

test('materials, exams and the shell are byte-preserved; links have separate coverage', () => {
  const links = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === 'LinkCheck');
  let outside = source;
  for (const node of [component, links].sort((a, b) => b.start - a.start)) {
    outside = outside.slice(0, node.start) + (node === component ? '/* SUBJECTS_ADMIN */' : '/* LINK_CHECK */') + outside.slice(node.end);
  }
  assert.equal(crypto.createHash('sha256').update(outside).digest('hex'), 'c485a6038cd73689d3510a2332c5ca40d9b12a3262f5912f9e586e73daff135e');
});
test('initial JSON keeps subject fields and strips only the units subjectId like the original editor', () => {
  const h = harness(), value = JSON.parse(h.editor().props.value);
  assert.equal(value[0].id, 'qa-subject'); assert.equal(value[0].units[0].id, 'qa-unit');
  assert.equal('subjectId' in value[0].units[0], false); assert.equal(value[0].units[0].standardHours, 2);
});
test('syntax failure preserves the exact editor text and sends no API request', async () => {
  const h = harness(); h.change(' [ broken JSON '); await h.save();
  assert.equal(h.editor().props.value, ' [ broken JSON '); assert.equal(h.calls.length, 0);
  assert.ok(h.error(/JSON 형식/)); assert.equal(h.error(/JSON 형식/).props.onRetry, undefined); assert.equal(h.disabled(), false);
});
test('fixing syntax clears the error and keeps the PUT masters subjects-only contract', async () => {
  const h = harness(); h.change('{'); await h.save(); h.change(JSON.stringify(fixtures)); await h.save();
  assert.equal(h.calls[0].route, '/api/admin/masters'); assert.equal(h.calls[0].method, 'PUT');
  assert.deepEqual(Object.keys(h.calls[0].body), ['subjects']); assert.deepEqual(h.calls[0].body.subjects, fixtures);
  assert.equal(h.calls[1].route, '/api/subjects'); assert.equal(h.calls[1].method, 'GET'); assert.equal(h.q.reloads, 0);
});
test('save failure preserves exact whitespace and all input without a follow-up read', async () => {
  const h = harness({ request() { throw failure(); } }), value = '\n ' + JSON.stringify(fixtures) + '  \n'; h.change(value); await h.save();
  assert.equal(h.editor().props.value, value); assert.equal(h.calls.length, 1); assert.equal(h.disabled(), false);
  assert.ok(h.error(/저장하지 못했어요/)); assert.doesNotMatch(text(h.render()), /마스터를 저장했어요/);
});
test('save failure retry uses the preserved JSON and clears the error on success', async () => {
  let writes = 0; const h = harness({ request(call) { if (call.method === 'PUT' && writes++ === 0) throw failure(); return { items: clone(fixtures) }; } });
  const value = h.editor().props.value; await h.save(); await h.error(/저장하지 못했어요/).props.onRetry();
  assert.deepEqual(h.calls.filter(c => c.method === 'PUT').map(c => c.body), [{ subjects: JSON.parse(value) }, { subjects: JSON.parse(value) }]);
  assert.equal(h.errors().length, 0); assert.match(text(h.render()), /마스터를 저장했어요/);
});
test('editing after failure saves the updated draft instead of a frozen payload', async () => {
  let writes = 0; const h = harness({ request(call) { if (call.method === 'PUT' && writes++ === 0) throw failure(); return { items: clone(fixtures) }; } });
  await h.save(); const next = clone(fixtures); next[0].name = '수정한 새 입력'; h.change(JSON.stringify(next)); await h.save();
  assert.equal(h.calls.filter(c => c.method === 'PUT')[1].body.subjects[0].name, '수정한 새 입력');
});
test('pending write locks the editor, duplicate saves and synthetic input events', async () => {
  const wait = deferred(), h = harness({ request: call => call.method === 'GET' ? { items: clone(fixtures) } : wait.promise });
  const initial = h.editor().props.value, first = h.save(); await h.save(); h.change('must not replace');
  assert.equal(h.calls.length, 1); assert.equal(h.editor().props.value, initial); assert.equal(h.disabled(), true);
  assert.equal(text(h.button()), '저장 중…'); wait.resolve({ ok: true }); await first; assert.equal(h.disabled(), false);
});
test('the lock remains active during the post-write GET so newer input cannot be overwritten', async () => {
  const wait = deferred(), started = deferred(), h = harness({ request(call) { if (call.method === 'GET') { started.resolve(); return wait.promise; } return { ok: true }; } });
  const first = h.save(); await started.promise; assert.equal(text(h.button()), '목록 확인 중…');
  h.change('new input during refresh'); await h.save(); assert.equal(h.disabled(), true); assert.equal(h.calls.length, 2);
  wait.resolve({ items: clone(fixtures) }); await first; assert.equal(h.disabled(), false); assert.doesNotMatch(h.editor().props.value, /new input/);
});
test('post-commit read failure retains submitted JSON, marks success separately and blocks writes', async () => {
  const h = harness({ request(call) { if (call.method === 'GET') throw failure(); return { ok: true }; } });
  const value = '  ' + JSON.stringify(fixtures); h.change(value); await h.save();
  assert.equal(h.editor().props.value, value); assert.ok(h.error(/저장은 완료됐지만/)); assert.match(text(h.render()), /마스터를 저장했어요/);
  await h.save(); h.change('blocked'); assert.equal(h.calls.length, 2); assert.equal(h.editor().props.value, value); assert.equal(h.disabled(), true);
});
test('read failure retry only performs GET and restores the normalized editor', async () => {
  let reads = 0; const h = harness({ request(call) { if (call.method === 'GET' && reads++ === 0) throw failure(); return { items: clone(fixtures) }; } });
  await h.save(); await h.error(/저장은 완료됐지만/).props.onRetry();
  assert.equal(h.calls.filter(c => c.method === 'PUT').length, 1); assert.equal(h.calls.filter(c => c.method === 'GET').length, 2);
  assert.equal(h.disabled(), false); assert.equal(h.errors().length, 0); assert.equal('subjectId' in JSON.parse(h.editor().props.value)[0].units[0], false);
});
test('duplicate GET retries are locked without resending the master update', async () => {
  let reads = 0; const wait = deferred(), h = harness({ request(call) { if (call.method !== 'GET') return { ok: true }; if (++reads === 1) throw failure(); return wait.promise; } });
  await h.save(); const retry = h.error(/저장은 완료됐지만/).props.onRetry, first = retry(); await retry();
  assert.equal(h.calls.length, 3); assert.equal(h.disabled(), true); wait.resolve({ items: clone(fixtures) }); await first; assert.equal(h.disabled(), false);
});
test('multiple read failures preserve the draft until a successful GET', async () => {
  let reads = 0; const h = harness({ request(call) { if (call.method === 'GET' && ++reads < 3) throw failure(); return { items: clone(fixtures) }; } });
  await h.save(); const value = h.editor().props.value; await h.error(/저장은 완료됐지만/).props.onRetry();
  assert.equal(h.disabled(), true); assert.equal(h.editor().props.value, value);
  await h.error(/저장은 완료됐지만/).props.onRetry(); assert.equal(h.disabled(), false); assert.equal(h.calls.filter(c => c.method === 'PUT').length, 1);
});
test('initial loading and query failure disable save and typing', async () => {
  for (const query of [{ data: null, loading: true }, { data: null, error: failure() }]) {
    const h = harness({ query }); await h.save(); h.change('blocked'); assert.equal(h.disabled(), true); assert.equal(h.calls.length, 0); assert.equal(h.editor().props.value, '');
  }
});
test('initial query failure is localized and retries only the original query', () => {
  const h = harness({ query: { data: null, error: failure() } }), error = h.error(/불러오지 못했어요/);
  assert.ok(error); assert.doesNotMatch(error.props.error.message, /Synthetic private detail/); error.props.onRetry();
  assert.equal(h.q.reloads, 1); assert.equal(h.calls.length, 0);
});
for (const status of [400, 401, 403]) {
  test(`${status}: server validation/authentication details and status are preserved`, async () => {
    const h = harness({ request() { throw failure(status, '서버의 한국어 안내'); } }); await h.save();
    const error = h.error(/저장하지 못했어요/).props.error; assert.equal(error.status, status); assert.equal(error.code, 'QA_FAILURE'); assert.match(error.message, /서버의 한국어 안내/);
  });
}
test('editing after a successful refresh removes the stale success notice', async () => {
  const h = harness(); await h.save(); assert.match(text(h.render()), /마스터를 저장했어요/);
  h.change('[]'); assert.doesNotMatch(text(h.render()), /마스터를 저장했어요/);
});
test('empty master data is shown as valid JSON rather than an uninitialized blank editor', () => {
  const h = harness({ query: { data: { items: [] } } }); assert.equal(h.editor().props.value, '[]'); assert.equal(h.disabled(), false);
});
test('syntactically valid but schema-invalid JSON stays visible with the server validation error', async () => {
  const h = harness({ request() { throw failure(400, '과목 배열을 확인해 주세요.'); } }); h.change('{"invalid":true}'); await h.save();
  assert.equal(h.editor().props.value, '{"invalid":true}'); assert.ok(h.error(/과목 배열/)); assert.equal(h.calls.length, 1);
});
test('a malformed post-commit read is a read failure and cannot clear the submitted draft', async () => {
  const h = harness({ request: call => call.method === 'GET' ? { items: [{}] } : { ok: true } });
  const value = h.editor().props.value; await h.save(); assert.equal(h.editor().props.value, value); assert.ok(h.error(/저장은 완료됐지만/));
});
test('leaving during a pending write prevents state updates and the follow-up GET', async () => {
  const wait = deferred(), h = harness({ request: () => wait.promise }), first = h.save(); h.unmount(); const before = h.writes();
  wait.resolve({ ok: true }); await first; assert.equal(h.writes(), before); assert.equal(h.calls.length, 1);
});
test('leaving during a pending GET prevents later state updates', async () => {
  const wait = deferred(), started = deferred(), h = harness({ request(call) { if (call.method === 'GET') { started.resolve(); return wait.promise; } return { ok: true }; } });
  const first = h.save(); await started.promise; h.unmount(); const before = h.writes(); wait.resolve({ items: clone(fixtures) }); await first; assert.equal(h.writes(), before);
});
