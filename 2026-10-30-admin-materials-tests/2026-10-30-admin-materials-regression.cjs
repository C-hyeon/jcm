'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const assert = require('node:assert/strict'), { test } = require('node:test'), { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..'), req = createRequire(path.join(root, 'client/package.json'));
const React = req('react'), esbuild = req('esbuild'), { parse } = req('@babel/parser');
const source = fs.readFileSync(path.join(root, 'client/src/pages/Admin.jsx'), 'utf8');
const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
const component = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === 'MaterialsAdmin');
const empty = ast.program.body.flatMap(n => n.declarations || []).find(n => n.id?.name === 'EMPTY');
const code = esbuild.transformSync(source.slice(empty.start, empty.end).replace(/^EMPTY/, 'const EMPTY') + ';\n' + source.slice(component.start, component.end), { loader: 'jsx' }).code;
const material = { id: 'qa-1', title: 'QA 자료', sourceName: '가짜 출처', author: '가짜 작성자', url: 'https://example.invalid/qa', subjectId: null, unitIds: [], type: 'doc', stage: 'concept', reason: 'QA 검증용', tags: ['SQL'], visible: true, linkStatus: 'ok', linkCheckedAt: null };
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
function failure(status = 503, message = '가짜 QA 오류') { return Object.assign(new Error(message), { status, code: 'QA_FAILURE' }); }

function harness(options = {}) {
  const states = [], refs = [], cleanups = [], calls = [], confirmations = [];
  let si = 0, ri = 0, qi = 0, first = true, stateWrites = 0, listWrites = 0;
  const list = { data: { items: [clone(material)] }, error: null, loading: false, reloads: 0,
    reload() { this.reloads++; }, setData(value) { listWrites++; this.data = typeof value === 'function' ? value(this.data) : value; }, ...options.list };
  const subjects = { data: { items: [] }, error: null, loading: false };
  const scope = { React, ErrorBox, Notice, ExternalLink: 'qa-external', Loading: () => null,
    EXAM_TYPE: { written: '필기' }, MATERIAL_TYPE: { doc: '문서' }, STAGE: { concept: '개념' },
    useState(initial) { const i = si++; if (!(i in states)) states[i] = initial; return [states[i], next => { stateWrites++; states[i] = typeof next === 'function' ? next(states[i]) : next; }]; },
    useRef(initial) { return refs[ri++] ||= { current: initial }; },
    useEffect(effect) { if (first) cleanups.push(effect()); },
    useApi() { return qi++ === 0 ? list : subjects; },
    window: { scrollTo() {}, confirm(message) { confirmations.push(message); return options.confirm ? options.confirm(message) : true; } },
    async api(route, settings = {}) {
      const call = { route, method: settings.method || 'GET', body: settings.body && clone(settings.body) }; calls.push(call);
      return options.request ? options.request(call, calls) : call.method === 'GET' ? { items: [clone(material)] } : { ok: true };
    },
  };
  const render = vm.runInNewContext(code + ';MaterialsAdmin', scope);
  const h = { list, calls, confirmations, render() { si = 0; ri = 0; qi = 0; const value = render(); first = false; return value; }, unmount() { cleanups.forEach(fn => fn?.()); }, writes: () => ({ state: stateWrites, list: listWrites }) };
  h.form = () => walk(h.render(), node => node.type === 'form')[0];
  h.buttons = label => walk(h.render(), node => node.type === 'button' && text(node).trim() === label);
  h.click = label => { const button = h.buttons(label)[0]; assert.ok(button, label); return button.props.onClick(); };
  h.field = label => {
    const wrapper = walk(h.render(), node => node.type === 'label' && text(node).trim() === label)[0];
    assert.ok(wrapper, label);
    return walk(wrapper, node => ['input', 'select', 'textarea'].includes(node.type))[0];
  };
  h.change = (label, value) => h.field(label).props.onChange({ target: { type: 'text', value } });
  h.submit = () => h.form().props.onSubmit({ preventDefault() {} });
  h.errors = () => walk(h.render(), node => node.type === ErrorBox && node.props.error);
  h.error = pattern => h.errors().find(node => pattern.test(node.props.error.message));
  h.disabled = () => walk(h.render(), node => node.type === 'fieldset' && node.props.className === 'form grid-form')[0].props.disabled;
  h.fill = () => {
    for (const [label, value] of [['제목 *', '새 QA 자료'], ['출처(사이트·채널) *', '가짜 출처'], ['원저작자 *', '가짜 작성자'], ['URL (https만) *', 'https://example.invalid/new'], ['추천 이유 * (본문 요약·복제 금지, 왜 추천하는지만)', '시험용 추천 이유'], ['태그 (쉼표 구분, 오답 유형과 같은 이름 권장)', ' SQL, 정규화, ']]) h.change(label, value);
  };
  return h;
}

test('the administrator shell, constants and imports are byte-preserved; each tab has separate coverage', () => {
  const exams = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === 'ExamsAdmin');
  const subjects = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === 'SubjectsAdmin');
  const links = ast.program.body.find(n => n.type === 'FunctionDeclaration' && n.id?.name === 'LinkCheck');
  let outside = source;
  for (const node of [component, exams, subjects, links].sort((a, b) => b.start - a.start)) {
    const marker = node === component ? '/* MATERIALS_ADMIN */' : node === exams ? '/* EXAMS_ADMIN */' : node === subjects ? '/* SUBJECTS_ADMIN */' : '/* LINK_CHECK */';
    outside = outside.slice(0, node.start) + marker + outside.slice(node.end);
  }
  outside = outside.replace("import { useEffect, useRef, useState } from 'react';", "import { useEffect, useState } from 'react';");
  assert.equal(crypto.createHash('sha256').update(outside).digest('hex'), 'c9f4c43cc582272696dfeb37e4b77946a94838a5b5ef088bba29386cfb0590a3');
});
test('create preserves the POST contract, common subject and tag normalization', async () => {
  const h = harness(); h.fill(); await h.submit();
  assert.equal(h.calls[0].route, '/api/admin/materials'); assert.equal(h.calls[0].method, 'POST');
  assert.equal(h.calls[0].body.subjectId, null); assert.deepEqual(h.calls[0].body.tags, ['SQL', '정규화']);
  assert.equal(h.calls[0].body.title, '새 QA 자료'); assert.equal(h.calls[0].body.reason, '시험용 추천 이유');
  assert.equal(h.calls[1].method, 'GET'); assert.equal(h.list.reloads, 0);
});
test('a failed create preserves every input and the existing list without starting a read', async () => {
  const h = harness({ request: () => { throw failure(); } }); h.fill();
  const before = clone(h.list.data); await h.submit();
  assert.equal(h.field('제목 *').props.value, '새 QA 자료');
  assert.equal(h.field('URL (https만) *').props.value, 'https://example.invalid/new');
  assert.equal(h.field('태그 (쉼표 구분, 오답 유형과 같은 이름 권장)').props.value, ' SQL, 정규화, ');
  assert.deepEqual(h.list.data, before); assert.equal(h.calls.length, 1); assert.equal(h.disabled(), false);
  assert.ok(h.error(/자료를 등록하지 못했어요/));
});
test('a failed edit retains edit mode, id and input and can retry with the same PUT target', async () => {
  let failures = 1;
  const h = harness({ request: call => { if (call.method === 'PUT' && failures-- > 0) throw failure(); return { items: [clone(material)] }; } });
  h.click('수정'); h.change('제목 *', '수정 중인 제목'); await h.submit();
  assert.equal(h.field('제목 *').props.value, '수정 중인 제목'); assert.ok(h.error(/자료를 수정하지 못했어요/));
  await h.submit();
  assert.equal(h.calls.filter(c => c.method === 'PUT').length, 2);
  assert.equal(h.calls[0].route, '/api/admin/materials/qa-1'); assert.equal(h.calls[1].route, h.calls[0].route);
  assert.equal(h.calls.some(c => c.method === 'POST'), false); assert.equal(h.field('제목 *').props.value, '');
});
test('rapid duplicate submits and competing row actions produce one write', async () => {
  const wait = deferred();
  const h = harness({ request: call => call.method === 'GET' ? { items: [clone(material)] } : wait.promise }); h.fill();
  const first = h.submit(); await h.submit(); await h.click('공개'); await h.click('삭제');
  assert.equal(h.calls.length, 1); assert.equal(h.confirmations.length, 0); assert.equal(h.disabled(), true);
  wait.resolve({ ok: true }); await first; assert.equal(h.disabled(), false);
});
test('a pending edit cannot be cancelled or replaced by editing another row', async () => {
  const wait = deferred(), h = harness({ request: call => call.method === 'GET' ? { items: [clone(material)] } : wait.promise });
  h.click('수정'); h.change('제목 *', '보존할 수정'); const saving = h.submit();
  h.click('취소'); h.click('수정');
  assert.equal(h.field('제목 *').props.value, '보존할 수정'); assert.equal(h.buttons('수정 저장 중…').length, 1);
  wait.resolve({ ok: true }); await saving;
});
test('a successful create clears the form only after the write resolves', async () => {
  const wait = deferred(), h = harness({ request: call => call.method === 'GET' ? { items: [clone(material)] } : wait.promise }); h.fill();
  const saving = h.submit(); assert.equal(h.field('제목 *').props.value, '새 QA 자료');
  wait.resolve({ ok: true }); await saving;
  assert.equal(h.field('제목 *').props.value, ''); assert.equal(h.errors().length, 0);
  assert.match(text(h.render()), /등록했어요/);
});
test('a post-create read failure preserves the previous list and blocks another create', async () => {
  const h = harness({ request: call => { if (call.method === 'GET') throw failure(); return { ok: true }; } }); h.fill();
  const before = clone(h.list.data); await h.submit();
  assert.deepEqual(h.list.data, before); assert.equal(h.field('제목 *').props.value, '');
  assert.ok(h.error(/변경은 완료됐지만/)); assert.equal(h.disabled(), true);
  await h.submit(); assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
});
test('retry after a committed write repeats only GET and is itself locked', async () => {
  let read = 0; const wait = deferred();
  const h = harness({ request: call => { if (call.method !== 'GET') return { ok: true }; if (++read === 1) throw failure(); return wait.promise; } }); h.fill();
  await h.submit(); const retry = h.error(/변경은 완료됐지만/).props.onRetry;
  const first = retry(), duplicate = retry(); await duplicate;
  assert.equal(h.calls.length, 3); assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
  wait.resolve({ items: [] }); await first;
  assert.deepEqual(h.list.data, { items: [] }); assert.equal(h.disabled(), false); assert.equal(h.errors().length, 0);
});
test('cancelling delete confirmation makes no request and preserves the edit form', async () => {
  const h = harness({ confirm: () => false }); h.click('수정'); h.change('제목 *', '아직 저장하지 않은 입력');
  await h.click('삭제'); assert.equal(h.calls.length, 0); assert.equal(h.field('제목 *').props.value, '아직 저장하지 않은 입력');
});
test('a failed delete preserves its row and requires confirmation again on retry', async () => {
  let failures = 1;
  const h = harness({ request: call => { if (call.method === 'DELETE' && failures-- > 0) throw failure(); return { items: [] }; } });
  await h.click('삭제'); assert.equal(h.list.data.items.length, 1); assert.ok(h.error(/자료를 삭제하지 못했어요/));
  await h.error(/자료를 삭제하지 못했어요/).props.onRetry();
  assert.equal(h.confirmations.length, 2); assert.equal(h.calls.filter(c => c.method === 'DELETE').length, 2); assert.equal(h.list.data.items.length, 0);
});
test('deleting the last item updates count and empty state after a successful read', async () => {
  const h = harness({ request: () => ({ items: [] }) }); await h.click('삭제');
  assert.match(text(h.render()), /등록된 자료 \(0\)/); assert.match(text(h.render()), /등록된 자료가 없어요/);
  assert.equal(h.buttons('삭제').length, 0);
});
test('a failed visibility change retains the old public state and does not refresh', async () => {
  const h = harness({ request: () => { throw failure(); } }); await h.click('공개');
  assert.equal(h.list.data.items[0].visible, true); assert.equal(h.buttons('공개').length, 1);
  assert.equal(h.calls.length, 1); assert.ok(h.error(/공개 상태를 변경하지 못했어요/));
});
test('visibility retries the intended boolean and preserves the existing PUT body contract', async () => {
  let failures = 1;
  const h = harness({ request: call => { if (call.method === 'PUT' && failures-- > 0) throw failure(); return { items: [{ ...clone(material), visible: false }] }; } });
  await h.click('공개'); await h.error(/공개 상태를 변경하지 못했어요/).props.onRetry();
  for (const call of h.calls.filter(c => c.method === 'PUT')) {
    assert.equal(call.route, '/api/admin/materials/qa-1'); assert.equal(call.body.visible, false);
    assert.equal('id' in call.body, false); assert.equal('linkStatus' in call.body, false); assert.equal('linkCheckedAt' in call.body, false);
    assert.equal(call.body.title, material.title); assert.deepEqual(call.body.tags, material.tags);
  }
  assert.equal(h.buttons('비공개').length, 1);
});
test('changing visibility of the edited item preserves unsaved fields and synchronizes visible', async () => {
  const h = harness({ request: () => ({ items: [{ ...clone(material), visible: false }] }) }); h.click('수정'); h.change('제목 *', '저장 전 제목');
  await h.click('공개'); assert.equal(h.field('제목 *').props.value, '저장 전 제목');
  const publicCheckbox = walk(h.render(), n => n.type === 'input' && n.props.type === 'checkbox').at(-1);
  assert.equal(publicCheckbox.props.checked, false);
  await h.submit(); const save = h.calls.filter(c => c.method === 'PUT').at(-1);
  assert.equal(save.body.visible, false); assert.equal(save.body.title, '저장 전 제목');
});
test('successful deletion clears the form only if that same item was being edited', async () => {
  const h = harness({ request: () => ({ items: [] }) }); h.click('수정'); h.change('제목 *', '삭제 대상 수정');
  await h.click('삭제'); assert.equal(h.field('제목 *').props.value, ''); assert.equal(h.buttons('취소').length, 0);
});
test('failed deletion of the edited item keeps its unsaved form', async () => {
  const h = harness({ request: () => { throw failure(); } }); h.click('수정'); h.change('제목 *', '보존할 입력');
  await h.click('삭제'); assert.equal(h.field('제목 *').props.value, '보존할 입력'); assert.equal(h.buttons('취소').length, 1);
});
for (const label of ['삭제', '공개']) {
  test(`${label}: a post-write read failure retries only the read`, async () => {
    let reads = 0;
    const h = harness({ request: call => { if (call.method === 'GET' && ++reads === 1) throw failure(); return { items: [] }; } });
    await h.click(label); const error = h.error(/변경은 완료됐지만/); assert.ok(error); assert.equal(h.disabled(), true);
    await error.props.onRetry(); assert.equal(h.calls.filter(c => c.method !== 'GET').length, 1); assert.equal(h.disabled(), false);
  });
}
test('pending writes cannot update a different tab after unmount', async () => {
  const wait = deferred(), h = harness({ request: () => wait.promise }); h.fill(); const saving = h.submit();
  h.unmount(); const before = h.writes(); wait.resolve({ ok: true }); await saving;
  assert.deepEqual(h.writes(), before); assert.equal(h.calls.length, 1);
});
test('initial loading and initial query failure block mutations without showing an empty result', async () => {
  for (const list of [{ loading: true, data: null }, { error: failure(), data: null }]) {
    const h = harness({ list }); h.fill(); await h.submit();
    assert.equal(h.disabled(), true); assert.equal(h.calls.length, 0);
    assert.doesNotMatch(text(h.render()), /등록된 자료가 없어요/);
  }
});
test('form error retry requests a native form submission instead of bypassing HTML validation', async () => {
  const h = harness({ request: () => { throw failure(); } }); h.fill(); await h.submit();
  let requested = 0; h.form().ref.current = { requestSubmit() { requested++; } };
  h.error(/자료를 등록하지 못했어요/).props.onRetry();
  assert.equal(requested, 1); assert.equal(h.calls.length, 1);
});
test('client validation details and authentication status remain available to ErrorBox', async () => {
  for (const status of [400, 401, 409]) {
    const h = harness({ request: () => { throw failure(status, '서버의 한국어 입력 안내'); } }); h.fill(); await h.submit();
    const error = h.error(/자료를 등록하지 못했어요/).props.error;
    assert.equal(error.status, status); assert.equal(error.code, 'QA_FAILURE'); assert.match(error.message, /서버의 한국어 입력 안내/);
  }
});
test('internal server error details are not exposed in the new error copy', async () => {
  const h = harness({ request: () => { throw failure(500, 'private stack secret'); } }); h.fill(); await h.submit();
  assert.doesNotMatch(h.error(/자료를 등록하지 못했어요/).props.error.message, /private stack secret/);
});
test('mobile width constraints are scoped to the materials list and its scrollable table', () => {
  const tree = harness().render();
  const sections = walk(tree, node => node.type === 'section');
  assert.equal(sections.length, 2);
  assert.equal(sections[0].props.style, undefined);
  assert.equal(sections[1].props.style.minWidth, 0);
  const wrappers = walk(sections[1], node => node.type === 'div' && node.props.className === 'table-wrap');
  assert.equal(wrappers.length, 1);
  const tables = walk(wrappers[0], node => node.type === 'table');
  assert.equal(tables.length, 1);
  assert.equal(tables[0].props.style.minWidth, 640);
});
