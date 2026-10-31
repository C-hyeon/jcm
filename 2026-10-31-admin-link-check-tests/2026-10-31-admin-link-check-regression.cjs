'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const assert = require('node:assert/strict'), { test } = require('node:test'), { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..'), req = createRequire(path.join(root, 'client/package.json'));
const React = req('react'), { parse } = req('@babel/parser');
const source = fs.readFileSync(path.join(root, 'client/src/pages/Admin.jsx'), 'utf8');
const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
const component = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === 'LinkCheck');
const code = req('esbuild').transformSync(source.slice(component.start, component.end), { loader: 'jsx' }).code;
const fixtures = Array.from({ length: 25 }, (_, i) => ({ id: `qa-${i}`, title: `가짜 QA 자료 ${i}`, url: `https://example.invalid/qa-${i}`, status: ['broken', 'warn', 'ok'][i % 3], httpStatus: [404, 403, 200][i % 3] }));
const clone = value => JSON.parse(JSON.stringify(value));
const ErrorBox = () => null;
function reply(offset, rows = fixtures) { const results = clone(rows.slice(offset, offset + 10)), nextOffset = offset + results.length; return { results, nextOffset, total: rows.length, done: nextOffset >= rows.length }; }
function walk(node, match) { if (!node || typeof node !== 'object') return []; return (match(node) ? [node] : []).concat(React.Children.toArray(node.props?.children).flatMap(child => walk(child, match))); }
function text(node) { if (typeof node === 'string' || typeof node === 'number') return String(node); return React.Children.toArray(node?.props?.children).map(text).join(''); }
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const failure = (status = 503, message = 'Synthetic private detail') => Object.assign(new Error(message), { status, code: 'QA_FAILURE' });
function harness(options = {}) {
  const states = [], refs = [], calls = [], cleanups = [], confirmations = []; let si = 0, ri = 0, first = true, writes = 0;
  const scope = { React, ErrorBox, ExternalLink: 'qa-link',
    useState(initial) { const i = si++; if (!(i in states)) states[i] = initial; return [states[i], next => { writes++; states[i] = typeof next === 'function' ? next(states[i]) : next; }]; },
    useRef(initial) { return refs[ri++] ||= { current: initial }; },
    useEffect(effect) { if (first) cleanups.push(effect()); },
    window: { confirm(message) { confirmations.push(message); return options.confirm ? options.confirm(message) : true; } },
    async api(route, settings) { const call = { route, method: settings.method, body: clone(settings.body) }; calls.push(call); return options.request ? options.request(call, calls) : reply(call.body.offset); },
  };
  const render = vm.runInNewContext(code + ';LinkCheck', scope);
  const h = { calls, confirmations, render() { si = 0; ri = 0; const tree = render(); first = false; return tree; }, unmount() { cleanups.forEach(fn => fn?.()); }, writes: () => writes };
  h.button = () => walk(h.render(), n => n.type === 'button')[0]; h.run = () => h.button().props.onClick();
  h.status = () => walk(h.render(), n => n.props.role === 'status').map(text).join('');
  h.error = () => walk(h.render(), n => n.type === ErrorBox && n.props.error)[0];
  h.items = () => walk(h.render(), n => n.type === 'li'); h.render(); return h;
}

test('all product code outside LinkCheck is byte-preserved', () => {
  const outside = source.slice(0, component.start) + '/* LINK_CHECK */' + source.slice(component.end);
  assert.equal(crypto.createHash('sha256').update(outside).digest('hex'), 'c6afccee444a9f37e999d69bde8a4c9b75e177dce67fbb836f7a8618167257ac');
});
test('mounting does not start an external link check', () => {
  const h = harness(); assert.equal(h.calls.length, 0); assert.equal(text(h.button()), '전체 점검 실행'); assert.equal(h.status(), '');
});
test('normal checking keeps the POST contract and visits offsets 0, 10, 20', async () => {
  const h = harness(); await h.run();
  assert.deepEqual(h.calls.map(c => [c.route, c.method, c.body]), [0, 10, 20].map(offset => ['/api/admin/link-check', 'POST', { offset, limit: 10 }]));
  assert.equal(h.confirmations.length, 0); assert.match(h.status(), /전체 점검을 마쳤어요/); assert.match(h.status(), /25\/25건/);
  assert.match(h.status(), /실패 9건 · 확인 필요 8건/); assert.equal(h.items().length, 17); assert.equal(text(h.button()), '전체 다시 점검');
});
test('rapid duplicate handlers are blocked synchronously before a render', async () => {
  const wait = deferred(), h = harness({ request: c => c.body.offset === 0 ? wait.promise : reply(c.body.offset) });
  const run = h.button().props.onClick, first = run(); await run(); await run();
  assert.equal(h.calls.length, 1); assert.equal(h.confirmations.length, 0); assert.equal(h.button().props.disabled, true);
  assert.match(h.status(), /시작하는 중/); wait.resolve(reply(0)); await first; assert.equal(h.calls.length, 3);
});
test('intermediate failure keeps confirmed progress/results and does not auto-retry', async () => {
  const h = harness({ request(c) { if (c.body.offset === 10) throw failure(); return reply(0); } }); await h.run();
  assert.equal(h.calls.length, 2); assert.equal(h.items().length, 7); assert.match(h.status(), /점검 중단/); assert.match(h.status(), /10\/25건/);
  assert.match(h.error().props.error.message, /중단된 요청도 일부 처리/); assert.match(h.error().props.error.message, /처음부터 점검/);
  assert.equal(h.error().props.onRetry, undefined); assert.equal(h.button().props.disabled, false);
});
test('cancelling a full restart preserves progress, results and the error without a request', async () => {
  const h = harness({ confirm: () => false, request(c) { if (c.body.offset === 10) throw failure(); return reply(0); } }); await h.run();
  const before = { status: h.status(), items: h.items().map(text), error: h.error().props.error.message }; await h.run();
  assert.deepEqual({ status: h.status(), items: h.items().map(text), error: h.error().props.error.message }, before);
  assert.equal(h.calls.length, 2); assert.equal(h.confirmations.length, 1); assert.match(h.confirmations[0], /처음부터 모든 자료/);
});
test('confirmed restart resets both results and progress, then starts at zero rather than resuming', async () => {
  const wait = deferred(); let restart = false;
  const h = harness({ confirm() { restart = true; return true; }, request(c) { if (restart && c.body.offset === 0) return wait.promise; if (c.body.offset === 10) throw failure(); return reply(0); } });
  await h.run(); const second = h.run(); assert.equal(h.items().length, 0); assert.doesNotMatch(h.status(), /10\/25/); assert.match(h.status(), /시작하는 중/);
  assert.equal(h.error(), undefined); assert.deepEqual(h.calls.map(c => c.body.offset), [0, 10, 0]);
  wait.resolve(reply(0)); await second;
});
test('restart after a completed run requires confirmation and does not append old results', async () => {
  let restart = false; const clean = fixtures.map(r => ({ ...r, status: 'ok', httpStatus: 200 }));
  const h = harness({ confirm() { restart = true; return true; }, request: c => reply(c.body.offset, restart ? clean : fixtures) });
  await h.run(); assert.equal(h.items().length, 17); await h.run(); assert.equal(h.items().length, 0);
  assert.match(h.status(), /실패 0건 · 확인 필요 0건/); assert.equal(h.confirmations.length, 1);
});
test('empty data is a completed empty state, not a failure or unfinished 0/0 counter', async () => {
  const h = harness({ request: () => reply(0, []) }); await h.run();
  assert.equal(h.status(), '점검할 자료가 없어요.'); assert.equal(h.error(), undefined); assert.equal(h.calls.length, 1); assert.equal(h.items().length, 0);
});
test('failure before the first response does not invent a total or a completed state', async () => {
  const h = harness({ request() { throw failure(); } }); await h.run();
  assert.match(h.status(), /확인된 결과가 아직 없어요/); assert.doesNotMatch(h.status(), /전체 점검을 마쳤어요|0\/0/);
  assert.equal(h.calls.length, 1); assert.doesNotMatch(h.error().props.error.message, /Synthetic private detail/);
});
test('transport rejection without an HTTP status has Korean guidance', async () => {
  const h = harness({ request() { throw new TypeError('Failed to fetch'); } }); await h.run();
  assert.match(h.error().props.error.message, /연결 상태/); assert.doesNotMatch(h.error().props.error.message, /Failed to fetch/);
});
for (const status of [400, 401, 403]) {
  test(`${status} retains status/code and the Korean server detail for the existing ErrorBox`, async () => {
    const h = harness({ request() { throw failure(status, '권한과 요청을 확인해 주세요.'); } }); await h.run();
    const error = h.error().props.error; assert.equal(error.status, status); assert.equal(error.code, 'QA_FAILURE'); assert.match(error.message, /권한과 요청/);
  });
}
const invalid = [
  ['non-advancing cursor', { results: [], nextOffset: 0, total: 25, done: false }],
  ['missing results', { nextOffset: 10, total: 25, done: false }],
  ['non-numeric offset', { results: [], nextOffset: '0', total: 0, done: true }],
  ['negative total', { results: [], nextOffset: 0, total: -1, done: true }],
  ['inconsistent completion', { results: [], nextOffset: 0, total: 25, done: true }],
  ['offset beyond total', { results: fixtures.slice(0, 2), nextOffset: 2, total: 1, done: true }],
  ['oversized batch', { results: fixtures.slice(0, 11), nextOffset: 11, total: 25, done: false }],
  ['malformed item', { results: [null], nextOffset: 1, total: 1, done: true }],
];
for (const [name, response] of invalid) {
  test(`invalid ${name} stops safely rather than repeatedly posting`, async () => {
    const h = harness({ request: () => response }); await h.run();
    assert.equal(h.calls.length, 1); assert.equal(h.items().length, 0); assert.equal(h.error().props.error.code, 'INVALID_CHECK_RESPONSE'); assert.equal(h.button().props.disabled, false);
  });
}
test('invalid later response preserves only the last confirmed batch', async () => {
  const h = harness({ request: c => c.body.offset === 0 ? reply(0) : { results: [], nextOffset: 10, total: 0, done: true } }); await h.run();
  assert.equal(h.calls.length, 2); assert.equal(h.items().length, 7); assert.match(h.status(), /10\/25/); assert.equal(h.error().props.error.code, 'INVALID_CHECK_RESPONSE');
});
test('network/timeout record errors are localized and warn stays distinct from broken', async () => {
  const rows = [
    { ...fixtures[0], httpStatus: null, error: 'timeout' }, { ...fixtures[3], httpStatus: null, error: 'network' },
    { ...fixtures[1], httpStatus: 429 }, { ...fixtures[0], id: 'qa-other', httpStatus: null, error: 'internal-secret' },
  ];
  const h = harness({ request: () => reply(0, rows) }); await h.run(); const content = text(h.render());
  assert.match(content, /응답 시간 초과/); assert.match(content, /연결 실패/); assert.match(content, /확인 필요/); assert.match(content, /HTTP 429/); assert.doesNotMatch(content, /internal-secret/);
  assert.match(h.status(), /실패 3건 · 확인 필요 1건/);
});
test('repeated record IDs do not cause duplicate React row keys or silently discard responses', async () => {
  const rows = [fixtures[0], { ...fixtures[0], status: 'warn', httpStatus: 403 }];
  const h = harness({ request: () => reply(0, rows) }); await h.run(); const list = walk(h.render(), n => n.type === 'ul')[0];
  assert.equal(new Set(list.props.children.map(n => n.key)).size, 2); assert.equal(h.items().length, 2);
});
test('result title, status and HTTP detail are grouped instead of becoming separate grid rows', async () => {
  const h = harness({ request: () => reply(0, [fixtures[0]]) }); await h.run();
  const row = walk(h.render(), n => n.type === 'ul')[0].props.children[0];
  const summary = row.props.children[0]; assert.equal(summary.type, 'div');
  assert.equal(walk(summary, n => n.type === 'strong').length, 1);
  assert.equal(walk(summary, n => n.type === 'span' && n.props.className === 'status st-broken').length, 1);
  assert.match(text(summary), /HTTP 404/);
});
test('leaving during a pending batch prevents state updates and all later batches', async () => {
  const wait = deferred(), h = harness({ request: () => wait.promise }), first = h.run(); h.unmount(); const before = h.writes();
  wait.resolve(reply(0)); await first; assert.equal(h.writes(), before); assert.equal(h.calls.length, 1);
});
test('late rejection after unmount is caught without updating state', async () => {
  const wait = deferred(), h = harness({ request: () => wait.promise }), first = h.run(); h.unmount(); const before = h.writes();
  wait.reject(failure()); await first; assert.equal(h.writes(), before); assert.equal(h.calls.length, 1);
});
test('stale handlers after unmount cannot restart a check or open confirmation', async () => {
  const h = harness({ request: () => reply(0, []) }); await h.run(); const run = h.button().props.onClick; h.unmount(); const before = h.writes(); await run();
  assert.equal(h.calls.length, 1); assert.equal(h.confirmations.length, 0); assert.equal(h.writes(), before);
});
