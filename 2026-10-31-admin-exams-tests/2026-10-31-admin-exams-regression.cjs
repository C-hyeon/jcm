'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const assert = require('node:assert/strict'), { test } = require('node:test'), { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..'), req = createRequire(path.join(root, 'client/package.json'));
const React = req('react'), { parse } = req('@babel/parser'), esbuild = req('esbuild');
const source = fs.readFileSync(path.join(root, 'client/src/pages/Admin.jsx'), 'utf8');
const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
const component = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === 'ExamsAdmin');
const code = esbuild.transformSync(source.slice(component.start, component.end), { loader: 'jsx' }).code;
const fixtures = [
  { id: '2027-1-written', year: 2027, round: 1, type: 'written', examDate: '2027-03-01', source: '가짜 QA 공고 A' },
  { id: '2027-2-practical', year: 2027, round: 2, type: 'practical', examDate: '2027-06-01', source: '가짜 QA 공고 B' },
];
const clone = v => JSON.parse(JSON.stringify(v));
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
const failure = (status = 503, message = '가짜 통신 오류') => Object.assign(new Error(message), { status, code: 'QA_FAILURE' });
function harness(options = {}) {
  const states = [], refs = [], effects = [], calls = [], confirmations = [];
  let si = 0, ri = 0, ei = 0, changes = 0, alive = true;
  const q = { data: { items: clone(options.items || fixtures) }, error: null, loading: false, reloads: 0, reload() { q.reloads++; }, ...options.query };
  const scope = { React, ErrorBox, Notice, Loading: () => null, EXAM_TYPE: { written: '필기', practical: '실기' }, formatDate: value => value,
    useState(initial) { const i = si++; if (!(i in states)) states[i] = initial; return [states[i], next => { changes++; states[i] = typeof next === 'function' ? next(states[i]) : next; }]; },
    useRef(initial) { return refs[ri++] ||= { current: initial }; },
    useEffect(effect, deps) { const i = ei++, old = effects[i]; if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) effects[i] = { effect, deps, pending: true, cleanup: old?.cleanup }; },
    useApi() { return q; },
    window: { confirm(message) { confirmations.push(message); return options.confirm ? options.confirm(message) : true; } },
    async api(route, settings = {}) {
      const call = { route, method: settings.method || 'GET', body: settings.body && clone(settings.body) }; calls.push(call);
      return options.request ? options.request(call, calls) : call.method === 'GET' ? { items: clone(options.items || fixtures) } : { ok: true };
    },
  };
  const render = vm.runInNewContext(code + ';ExamsAdmin', scope);
  const h = { q, calls, confirmations, render() {
    assert.ok(alive);
    let tree;
    for (let n = 0; n < 8; n++) {
      si = 0; ri = 0; ei = 0; tree = render(); const before = changes;
      for (const effect of effects) if (effect.pending) { effect.pending = false; effect.cleanup?.(); effect.cleanup = effect.effect(); }
      if (changes === before) return tree;
    }
    throw new Error('Unexpected effect loop');
  }, unmount() { effects.forEach(effect => effect.cleanup?.()); alive = false; }, writes: () => changes };
  h.buttons = label => walk(h.render(), n => n.type === 'button' && text(n).trim() === label);
  h.click = (label, index = 0) => { const button = h.buttons(label)[index]; assert.ok(button, label); return button.props.onClick(); };
  h.fields = label => walk(h.render(), n => ['input', 'select'].includes(n.type) && n.props['aria-label'] === label);
  h.change = (label, value, index = 0) => h.fields(label)[index].props.onChange({ target: { value } });
  h.errors = () => walk(h.render(), n => n.type === ErrorBox && n.props.error);
  h.error = pattern => h.errors().find(n => pattern.test(n.props.error.message));
  h.values = label => h.fields(label).map(n => n.props.value);
  h.disabled = () => walk(h.render(), n => ['input', 'select'].includes(n.type) || n.type === 'button' && text(n).trim() !== '다시 시도').every(n => n.props.disabled === true);
  h.render(); return h;
}

test('materials and the shell are byte-preserved; subjects and links have separate coverage', () => {
  const subjects = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === 'SubjectsAdmin');
  const links = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === 'LinkCheck');
  let outside = source;
  for (const node of [component, subjects, links].sort((a, b) => b.start - a.start)) {
    outside = outside.slice(0, node.start) + (node === component ? '/* EXAMS_ADMIN */' : node === subjects ? '/* SUBJECTS_ADMIN */' : '/* LINK_CHECK */') + outside.slice(node.end);
  }
  assert.equal(crypto.createHash('sha256').update(outside).digest('hex'), 'ec840b37917eb4e1306601cefa48ec94833f360362fbd56ccee9ea849be78ded');
});
test('the exams-only existing grid wrapper lets the 800px table scroll inside a shrinking card', () => {
  const tree = harness().render(); assert.equal(tree.props.className, 'stack');
  const card = walk(tree, n => n.type === 'section')[0]; assert.equal(card.props.style.minWidth, 0);
  const wrap = walk(card, n => n.props.className === 'table-wrap')[0];
  const table = walk(wrap, n => n.type === 'table')[0]; assert.equal(table.props.style.minWidth, 800);
  assert.equal(walk(table, n => n.type === 'td' && n.props.className === 'nowrap').length, fixtures.length);
});
test('save keeps the masters contract, number conversion and generated new-row ID', async () => {
  const h = harness(); h.click('+ 일정 추가'); h.change('연도', '2028', 2); h.change('회차', '3', 2); h.change('시험일', '2028-03-01', 2);
  await h.click('저장');
  const write = h.calls[0]; assert.equal(write.route, '/api/admin/masters'); assert.equal(write.method, 'PUT');
  assert.deepEqual(Object.keys(write.body), ['exams']); assert.equal(write.body.exams[2].id, '2028-3-written');
  assert.equal(write.body.exams[2].year, 2028); assert.equal(write.body.exams[2].round, 3);
  assert.equal(h.calls[1].route, '/api/exams?all=1'); assert.equal(h.q.reloads, 0);
});
test('save failure keeps all existing and new row inputs without starting a read', async () => {
  const h = harness({ request() { throw failure(); } }); h.change('근거', '보존할 입력'); h.click('+ 일정 추가');
  const before = h.values('근거'); await h.click('저장');
  assert.deepEqual(h.values('근거'), before); assert.equal(h.calls.length, 1); assert.equal(h.disabled(), false);
  assert.ok(h.error(/저장하지 못했어요/));
});
test('save retry succeeds and validation errors keep the Korean server detail', async () => {
  let writes = 0;
  const h = harness({ request(call) { if (call.method === 'PUT' && writes++ === 0) throw failure(400, '날짜를 확인해 주세요.'); return { items: clone(fixtures) }; } });
  await h.click('저장'); assert.match(h.error(/저장하지 못했어요/).props.error.message, /날짜를 확인해 주세요/);
  await h.error(/저장하지 못했어요/).props.onRetry(); assert.equal(h.calls.filter(c => c.method === 'PUT').length, 2);
  assert.equal(h.errors().length, 0); assert.match(text(h.render()), /저장했어요/);
});
test('editing after a save failure permits saving the updated input rather than a frozen old payload', async () => {
  let writes = 0;
  const h = harness({ request(call) { if (call.method === 'PUT' && writes++ === 0) throw failure(); return { items: clone(fixtures) }; } });
  await h.click('저장'); h.change('근거', '수정한 최신 입력'); await h.click('저장');
  assert.equal(h.calls.filter(c => c.method === 'PUT')[1].body.exams[0].source, '수정한 최신 입력');
});
test('pending save blocks duplicate save, delete, add and synthetic input changes', async () => {
  const wait = deferred(), h = harness({ request: call => call.method === 'GET' ? { items: clone(fixtures) } : wait.promise });
  const first = h.click('저장');
  h.click('저장 중…'); h.click('삭제'); h.click('+ 일정 추가'); h.change('근거', '차단할 입력');
  assert.equal(h.calls.length, 1); assert.equal(h.confirmations.length, 0); assert.equal(h.disabled(), true);
  assert.deepEqual(h.values('근거'), fixtures.map(r => r.source));
  wait.resolve({ ok: true }); await first; assert.equal(h.disabled(), false);
});
test('delete cancellation leaves the rows and unsaved inputs unchanged', async () => {
  const h = harness({ confirm: () => false }); h.change('근거', '미저장'); await h.click('삭제');
  assert.equal(h.calls.length, 0); assert.equal(h.values('근거')[0], '미저장');
});
test('new rows can be removed locally without confirmation or API calls', () => {
  const h = harness(); h.click('+ 일정 추가'); h.click('+ 일정 추가'); h.change('근거', '남길 새 행', 3);
  h.click('삭제', 2); assert.equal(h.fields('연도').length, 3); assert.equal(h.values('근거')[2], '남길 새 행');
  assert.equal(h.confirmations.length, 0); assert.equal(h.calls.length, 0);
});
test('failed delete is caught, preserves inputs and skips the follow-up read', async () => {
  const h = harness({ request() { throw failure(); } }); h.change('근거', '다른 행의 초안', 1);
  await h.click('삭제'); assert.equal(h.values('근거')[1], '다른 행의 초안'); assert.equal(h.fields('연도').length, 2);
  assert.equal(h.calls.length, 1); assert.ok(h.error(/삭제하지 못했어요/)); assert.equal(h.disabled(), false);
});
test('delete retry confirms again; cancelled retry sends no second DELETE', async () => {
  let confirm = true, writes = 0;
  const h = harness({ confirm: () => confirm, request(call) { if (call.method === 'DELETE' && writes++ === 0) throw failure(); return { items: [clone(fixtures[1])] }; } });
  await h.click('삭제'); confirm = false; await h.error(/삭제하지 못했어요/).props.onRetry();
  assert.equal(h.calls.length, 1); confirm = true; await h.error(/삭제하지 못했어요/).props.onRetry();
  assert.equal(h.confirmations.length, 3); assert.equal(h.fields('연도').length, 1);
  assert.deepEqual(h.calls.filter(c => c.method === 'DELETE').map(c => c.route), ['/api/admin/exams/2027-1-written', '/api/admin/exams/2027-1-written']);
});
test('delete refresh preserves dirty existing rows and new rows, but updates clean server rows', async () => {
  const third = { ...fixtures[1], id: '2027-3-written', round: 3 };
  const h = harness({ items: [...fixtures, third], request: () => ({ items: [{ ...clone(fixtures[1]), source: '서버 변경 B' }, { ...third, source: '서버 변경 C' }] }) });
  h.change('근거', '미저장 B', 1); h.click('+ 일정 추가'); h.change('근거', '새 행 초안', 3);
  await h.click('삭제'); assert.deepEqual(h.values('근거'), ['미저장 B', '서버 변경 C', '새 행 초안']);
  assert.equal(h.calls.filter(c => c.method === 'PUT').length, 0);
});
test('an unsaved dirty row missing from the refreshed server response is not silently discarded', async () => {
  const h = harness({ request: () => ({ items: [] }) }); h.change('근거', '남겨야 하는 초안', 1);
  await h.click('삭제'); assert.deepEqual(h.values('근거'), ['남겨야 하는 초안']);
});
for (const kind of ['save', 'delete']) {
  test(`${kind}: committed mutation followed by read failure locks controls and retries GET only`, async () => {
    let reads = 0;
    const h = harness({ request(call) { if (call.method === 'GET' && ++reads === 1) throw failure(); return { items: kind === 'save' ? clone(fixtures) : [clone(fixtures[1])] }; } });
    if (kind === 'delete') h.change('근거', '보존할 초안', 1);
    await h.click(kind === 'save' ? '저장' : '삭제'); assert.ok(h.error(/변경은 완료됐지만/)); assert.equal(h.disabled(), true);
    h.click('저장'); h.click('+ 일정 추가'); assert.equal(h.calls.filter(c => c.method !== 'GET').length, 1);
    await h.error(/변경은 완료됐지만/).props.onRetry(); assert.equal(h.calls.filter(c => c.method !== 'GET').length, 1);
    assert.equal(h.disabled(), false); if (kind === 'delete') assert.equal(h.values('근거')[0], '보존할 초안');
  });
}
test('new row IDs are normalized after a committed save, even if refreshing fails', async () => {
  const h = harness({ request(call) { if (call.method === 'GET') throw failure(); return { ok: true }; } });
  h.click('+ 일정 추가'); h.change('연도', '2028', 2); h.change('회차', '4', 2); await h.click('저장');
  const body = walk(h.render(), n => n.type === 'tbody')[0]; assert.equal(body.props.children.at(-1).key, '2028-4-written');
  assert.equal(h.disabled(), true); assert.equal(h.calls.filter(c => c.method === 'PUT').length, 1);
});
test('repeated refresh failures keep the deletion context and drafts until a successful GET', async () => {
  let reads = 0;
  const h = harness({ request(call) { if (call.method === 'GET' && ++reads < 3) throw failure(); return { items: [clone(fixtures[1])] }; } });
  h.change('근거', '두 번 실패해도 보존', 1); await h.click('삭제');
  await h.error(/변경은 완료됐지만/).props.onRetry(); assert.equal(h.disabled(), true);
  await h.error(/변경은 완료됐지만/).props.onRetry(); assert.equal(h.disabled(), false);
  assert.equal(h.values('근거')[0], '두 번 실패해도 보존'); assert.equal(h.calls.filter(c => c.method === 'DELETE').length, 1);
});
test('duplicate refresh retries are locked and do not repeat the mutation', async () => {
  const wait = deferred(); let reads = 0;
  const h = harness({ request(call) { if (call.method !== 'GET') return { ok: true }; if (++reads === 1) throw failure(); return wait.promise; } });
  await h.click('저장'); const retry = h.error(/변경은 완료됐지만/).props.onRetry;
  const first = retry(); await retry(); assert.equal(h.calls.length, 3); assert.equal(h.disabled(), true);
  wait.resolve({ items: clone(fixtures) }); await first; assert.equal(h.disabled(), false);
});
test('successful save clears dirty flags so later deletion can update clean server rows', async () => {
  let reads = 0;
  const h = harness({ request(call) { if (call.method !== 'GET') return { ok: true }; return { items: ++reads === 1 ? clone(fixtures) : [{ ...fixtures[0], source: '새 서버 값' }] }; } });
  h.change('근거', '저장할 초안'); await h.click('저장'); await h.click('삭제', 1);
  assert.equal(h.values('근거')[0], '새 서버 값');
});
test('initial loading and query failure block mutations without claiming an empty result', () => {
  for (const query of [{ data: null, loading: true }, { data: null, error: failure() }]) {
    const h = harness({ query }); h.click('저장'); h.click('+ 일정 추가');
    assert.equal(h.calls.length, 0); assert.equal(h.disabled(), true); assert.doesNotMatch(text(h.render()), /등록된 시험 일정이 없어요/);
  }
});
test('initial query failure is localized and retries the query, not a write', () => {
  const h = harness({ query: { data: null, error: failure(503, 'Internal private detail') } });
  const error = h.error(/불러오지 못했어요/); assert.ok(error); assert.doesNotMatch(error.props.error.message, /Internal private detail/);
  error.props.onRetry(); assert.equal(h.q.reloads, 1); assert.equal(h.calls.length, 0);
});
test('deleting the final persisted row shows the empty state', async () => {
  const h = harness({ items: [fixtures[0]], request: () => ({ items: [] }) }); await h.click('삭제');
  assert.equal(h.fields('연도').length, 0); assert.match(text(h.render()), /등록된 시험 일정이 없어요/);
});
test('a failed save does not lose dirty flags needed to preserve edits during a later deletion', async () => {
  const h = harness({ request(call) { if (call.method === 'PUT') throw failure(); return { items: [clone(fixtures[1])] }; } });
  h.change('근거', '실패 후에도 초안', 1); await h.click('저장'); await h.click('삭제');
  assert.equal(h.values('근거')[0], '실패 후에도 초안');
});
for (const status of [401, 403]) {
  test(`${status} error keeps status/code and the server message for ErrorBox`, async () => {
    const h = harness({ request() { throw failure(status, '권한을 확인해 주세요.'); } }); await h.click('저장');
    const error = h.error(/저장하지 못했어요/).props.error;
    assert.equal(error.status, status); assert.equal(error.code, 'QA_FAILURE'); assert.match(error.message, /권한을 확인해 주세요/);
  });
}
test('pending mutation cannot update state or start a read after leaving the tab', async () => {
  const wait = deferred(), h = harness({ request: () => wait.promise }); const saving = h.click('저장');
  h.unmount(); const before = h.writes(); wait.resolve({ ok: true }); await saving;
  assert.equal(h.writes(), before); assert.equal(h.calls.length, 1);
});
test('pending refresh cannot update state after unmount', async () => {
  const wait = deferred(), started = deferred(), h = harness({ request: call => { if (call.method === 'GET') { started.resolve(); return wait.promise; } return { ok: true }; } });
  const saving = h.click('저장'); await started.promise;
  assert.equal(h.calls.length, 2); h.unmount(); const before = h.writes(); wait.resolve({ items: [] }); await saving;
  assert.equal(h.writes(), before);
});
