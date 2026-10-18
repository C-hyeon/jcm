'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), { test } = require('node:test'), { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..'), req = createRequire(path.join(root, 'client/package.json'));
const React = req('react'), esbuild = req('esbuild'), { renderToStaticMarkup } = req('react-dom/server');
const filename = path.join(root, 'client/src/pages/LearningPath.jsx');
const material = { id: 'qa-material', title: '개념 자료', type: 'blog', url: 'https://example.test/concept', sourceName: 'QA 출처', reason: '자료 설명', highlight: true };
const data = { subject: { id: 'w5', name: '정보시스템 구축관리', rate: 25 }, subjects: [{ id: 'w5', name: '정보시스템 구축관리', rate: 25, weakShare: 10 }], reason: '서버의 보강 이유',
  focusUnits: [{ id: 'unit1', name: '보안 구축', rate: 0, needsReview: true }],
  steps: [{ stage: 'concept', step: 1, label: '개념 학습', materials: [material] }, { stage: 'practice', step: 2, label: '문제 풀이', materials: [{ ...material, id: 'qa-practice' }] }] };
function render(overrides = {}, search = 'subjectId=w5') {
  const cache = new Map(), calls = [], selections = [], dependencies = [];
  let retries = 0, fetcher;
  const query = { data, loading: false, error: null, reload: () => retries++, ...overrides };
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const m = { exports: {} }; cache.set(file, m);
    function localRequire(id) {
      if (id === 'react-router-dom') return {
        Link: ({ to, children, ...props }) => React.createElement('a', { href: typeof to === 'string' ? to : to.pathname, ...props }, children),
        useSearchParams: () => [new URLSearchParams(search), next => selections.push(next)], useLocation: () => ({ pathname: '/path' }),
      };
      if (id === '../api/client') return { api: (...args) => { calls.push(args); return Promise.resolve(data); } };
      if (id === '../hooks/useApi') return { useApi: (fn, deps) => { fetcher = fn; dependencies.push(deps); return query; } };
      if (!id.startsWith('.')) return req(id);
      const base = path.resolve(path.dirname(file), id), resolved = [base, base + '.jsx', base + '.js'].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
      return load(resolved);
    }
    const code = esbuild.transformSync(fs.readFileSync(file, 'utf8') + (file === filename ? '\nexport { materialsLink };' : ''), { loader: 'jsx', format: 'cjs', jsx: 'automatic' }).code;
    vm.runInNewContext(code, { module: m, exports: m.exports, require: localRequire, console, URLSearchParams, setTimeout, clearTimeout }, { filename: file });
    return m.exports;
  }
  const component = load(filename), tree = component.default();
  const html = renderToStaticMarkup(tree);
  function find(type) {
    const out = []; function visit(n) {
      if (!n || typeof n !== 'object') return;
      if (n.type === type || (typeof n.type === 'function' && n.type.name === type)) out.push(n);
      React.Children.forEach(n.props?.children, visit); visit(n.props?.actions); visit(n.props?.action);
    }
    visit(tree); return out;
  }
  return { html, find, link: component.materialsLink, selections, calls, dependencies, fetch: () => fetcher(), get retries() { return retries; } };
}
const error = status => ({ status, message: '조회하지 못했어요.' });
for (const status of [0, 404, 500, 503]) test('error ' + status + ' retains heading, retry and selected-query recovery', () => {
  const r = render({ data: null, error: error(status) }); assert.match(r.html, /<h1>학습 경로<\/h1>/);
  assert.match(r.html, /다시 시도/); assert.match(r.html, /href="\/path"[^>]*>추천 과목으로 돌아가기/);
  assert.doesNotMatch(r.html, /보안 구축|개념 자료/);
});
test('queryless error keeps retry without a no-op reset link', () => {
  const r = render({ data: null, error: error(503) }, ''); assert.match(r.html, /<h1>학습 경로/); assert.match(r.html, /다시 시도/); assert.doesNotMatch(r.html, /추천 과목으로 돌아가기/);
});
test('401 preserves login guidance instead of suggesting query reset as authentication recovery', () => {
  const r = render({ data: null, error: error(401) }); assert.match(r.html, /다시 로그인/); assert.match(r.html, /next=%2Fpath/); assert.doesNotMatch(r.html, /추천 과목으로 돌아가기/);
});
test('retry invokes existing reload without changing subject or issuing a write', async () => {
  const r = render({ data: null, error: error(500) }); r.find('ErrorBox')[0].props.onRetry();
  assert.equal(r.retries, 1); assert.equal(r.selections.length, 0); assert.equal(r.calls.length, 0);
  await r.fetch(); assert.equal(r.calls[0][0], '/api/learning-path?subjectId=w5'); assert.equal(r.calls[0].length, 1);
});
for (const old of [null, data]) test('loading keeps title while hiding stale content: ' + !!old, () => {
  const r = render({ loading: true, data: old }); assert.match(r.html, /<h1>학습 경로/); assert.match(r.html, /aria-busy="true"/); assert.doesNotMatch(r.html, /개념 자료|먼저 볼 단원|이 단계 자료 더 보기/);
});
test('server-selected recommended subject supplies links when URL has no subject', () => {
  const r = render({}, ''); assert.match(r.html, /지금 보강할 과목/); assert.match(r.html, /subjectId=w5&amp;stage=concept/);
});
test('each step links exactly the returned subject and stage', () => {
  const r = render(); assert.match(r.html, /href="\/materials\?subjectId=w5&amp;stage=concept"/); assert.match(r.html, /href="\/materials\?subjectId=w5&amp;stage=practice"/);
  assert.equal((r.html.match(/이 단계 자료 더 보기/g) || []).length, 2);
});
test('empty materials keeps subject but does not invent a stage', () => {
  const r = render({ data: { ...data, steps: [] } }); assert.match(r.html, /이 과목에 등록된 자료가 아직 없어요/); assert.match(r.html, /href="\/materials\?subjectId=w5"/); assert.doesNotMatch(r.html, /이 단계 자료 더 보기|stage=/);
});
test('subject IDs are query encoded rather than interpreted as injected filters', () => {
  const r = render(); const url = new URL(r.link('과목 &/?#bookmarked=1', 'concept'), 'http://qa.test');
  assert.equal(url.searchParams.get('subjectId'), '과목 &/?#bookmarked=1'); assert.equal(url.searchParams.has('bookmarked'), false); assert.equal(url.searchParams.get('stage'), 'concept');
});
test('new hub links deliberately omit previous search, bookmark and type filters', () => {
  const r = render({}, 'subjectId=w5&q=old&bookmarked=1&type=video'); const url = new URL(r.link('w5', 'practice'), 'http://qa.test');
  assert.deepEqual([...url.searchParams.keys()], ['subjectId', 'stage']);
});
test('subject select retains the existing URL update behavior', () => {
  const r = render(); r.find('select')[0].props.onChange({ target: { value: 'w3' } });
  assert.equal(r.selections.length, 1); assert.equal(r.selections[0].subjectId, 'w3');
});
test('external links, source, highlight and progress remain intact', () => {
  const r = render(); assert.match(r.html, /target="_blank" rel="noopener noreferrer"/); assert.match(r.html, /출처:.*QA 출처/); assert.match(r.html, /취약 유형 관련/); assert.match(r.html, /복습 필요/); assert.match(r.html, /aria-valuenow="25"/);
});
test('fetch contract and dependencies stay GET-only and subject-scoped', async () => {
  const r = render(); await r.fetch(); assert.equal(r.calls[0][0], '/api/learning-path?subjectId=w5'); assert.equal(r.calls[0].length, 1); assert.equal(r.dependencies[0][0], 'w5');
});
test('default fetch still lets the server choose the focus subject', async () => {
  const r = render({}, ''); await r.fetch(); assert.equal(r.calls[0][0], '/api/learning-path');
});

const commonCbt = { ...material, id: 'common-cbt', type: 'cbt', subjectId: null, stage: 'practice', title: '공통 기출 CBT' };
const subjectCbt = { ...commonCbt, id: 'subject-cbt', subjectId: 'w5', title: '과목 기출 CBT' };
function renderMaterials(materials, stage = 'practice', search) {
  return render({ data: { ...data, steps: [{ step: 1, stage, label: '문제 풀이', materials }] } }, search);
}
test('common-only CBT links to common subject, same stage and CBT type, never an empty subject filter', () => {
  const r = renderMaterials([commonCbt]);
  assert.match(r.html, /href="\/materials\?subjectId=common&amp;stage=practice&amp;type=cbt"/);
  assert.match(r.html, /공통 CBT 자료 보기/); assert.doesNotMatch(r.html, /subjectId=w5&amp;stage=practice/);
  assert.doesNotMatch(r.html, /이 단계 자료 더 보기|과목 자료 더 보기/);
});
test('missing common subjectId is treated identically to null', () => {
  const { subjectId, ...m } = commonCbt; const r = renderMaterials([m]);
  assert.match(r.html, /subjectId=common&amp;stage=practice&amp;type=cbt/);
});
test('mixed subject and common CBT exposes separate clearly named filters', () => {
  const r = renderMaterials([{ ...material, subjectId: 'w5' }, commonCbt]);
  assert.match(r.html, /과목 자료 더 보기/); assert.match(r.html, /공통 CBT 자료 보기/);
  assert.match(r.html, /href="\/materials\?subjectId=w5&amp;stage=practice"/);
  assert.match(r.html, /href="\/materials\?subjectId=common&amp;stage=practice&amp;type=cbt"/);
});
test('subject-specific CBT stays subject-scoped rather than becoming common', () => {
  const r = renderMaterials([subjectCbt]); assert.match(r.html, /subjectId=w5&amp;stage=practice/);
  assert.doesNotMatch(r.html, /subjectId=common|공통 CBT 자료 보기/);
});
test('multiple common CBT items create only one common link', () => {
  const r = renderMaterials([commonCbt, { ...commonCbt, id: 'common-cbt-2' }]);
  assert.equal((r.html.match(/공통 CBT 자료 보기/g) || []).length, 1);
});
test('mixing subject CBT with common CBT does not hide the subject link', () => {
  const r = renderMaterials([subjectCbt, commonCbt]); assert.match(r.html, /과목 자료 더 보기/); assert.match(r.html, /공통 CBT 자료 보기/);
});
for (const stage of ['intro', 'concept', 'practice', 'final']) test('common CBT preserves returned stage ' + stage, () => {
  const r = renderMaterials([{ ...commonCbt, stage }], stage); assert.match(r.html, new RegExp('subjectId=common&amp;stage=' + stage + '&amp;type=cbt'));
});
test('default recommended subject keeps common links accurate without URL subjectId', () => {
  const r = renderMaterials([commonCbt], 'practice', ''); assert.match(r.html, /지금 보강할 과목/);
  assert.match(r.html, /subjectId=common&amp;stage=practice&amp;type=cbt/);
});
test('common links cannot inherit previous bookmarked, search or resource type filters', () => {
  const r = renderMaterials([commonCbt], 'practice', 'subjectId=w5&bookmarked=1&q=old&type=video');
  const link = r.find('Link').find(n => n.props.to.includes('subjectId=common'));
  const u = new URL(link.props.to, 'http://qa.test');
  assert.deepEqual([...u.searchParams.keys()], ['subjectId', 'stage', 'type']); assert.equal(u.searchParams.get('type'), 'cbt');
});
test('common routing introduces no completion, progress, or bookmark write', async () => {
  const r = renderMaterials([commonCbt]); await r.fetch(); assert.equal(r.calls.length, 1); assert.equal(r.calls[0].length, 1);
  assert.match(r.html, /target="_blank" rel="noopener noreferrer"/);
});
