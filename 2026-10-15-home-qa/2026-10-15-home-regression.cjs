'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const clientRequire = createRequire(path.join(root, 'client/package.json'));
const React = clientRequire('react');
const { renderToStaticMarkup } = clientRequire('react-dom/server');
const { transformSync } = clientRequire('esbuild');
const { parse } = clientRequire('@babel/parser');
const h = React.createElement;
const read = (relative) => fs.readFileSync(path.join(root, 'client/src', relative), 'utf8');
function declarations(source) {
  return parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body.map((node) => node.declaration || node);
}
function functionSource(source, name) {
  const node = declarations(source).find((item) => item.id?.name === name);
  assert.ok(node, `Missing function: ${name}`);
  return source.slice(node.start, node.end);
}
const homeSource = read('pages/Home.jsx');
const cardsSource = read('components/StudyCards.jsx');

function renderHome({ member = true, loading = false, today, guest = null } = {}) {
  const calls = [];
  const data = {
    '/api/today': today,
    '/api/progress': { overall: 0, remainingMinutes: 120, subjects: [] },
    '/api/weakness': { nextReview: [] },
    '/api/recommendations?limit=1': { items: [] },
    '/api/exams': { items: [] },
    '/api/materials?type=cbt': { items: [] },
  };
  const api = (route) => { calls.push(route); assert.ok(route in data, route); return data[route]; };
  const router = {
    Link: ({ to, children, ...props }) => h('a', { ...props, href: to }, children),
    useNavigate: () => () => {},
  };
  const ui = {
    EmptyState: ({ title, children, action }) => h('div', { className: 'empty' }, h('p', null, title), children, action),
    ErrorBox: ({ error }) => error ? h('div', { role: 'alert' }, error.message) : null,
    Loading: () => h('div', { 'aria-busy': true }, 'Loading'),
    Notice: ({ children }) => h('div', null, children),
    ExternalLink: ({ href, children }) => h('a', { href, target: '_blank' }, children),
    Dialog: () => null,
    ProgressBar: ({ value, label }) => h('progress', { value, 'aria-label': label }),
  };
  const format = {
    addDays: () => '2026-10-21', todayKST: () => '2026-10-15', diffDays: () => 90,
    EXAM_TYPE: { written: '필기' }, formatDate: (value) => value || '',
    minutesLabel: (value) => `${value}분`, ddayLabel: (value) => `D-${value}`,
    MATERIAL_TYPE: {}, UNDERSTANDING: { 2: '보통' },
  };
  const shared = {
    react: React, 'react/jsx-runtime': clientRequire('react/jsx-runtime'), 'react-router-dom': router,
    '../api/client': { api }, '../lib/format': format,
  };
  function load(source, modules) {
    const module = { exports: {} };
    vm.runInNewContext(transformSync(source, { loader: 'jsx', jsx: 'automatic', format: 'cjs' }).code, {
      module, exports: module.exports,
      require: (name) => { assert.ok(name in modules, name); return modules[name]; },
    });
    return module.exports;
  }
  const cards = load(cardsSource, { ...shared, './ui': ui, './Icon': () => null });
  const home = load(homeSource, {
    ...shared, '../components/ui': ui, '../components/StudyCards': cards,
    '../components/SignupPrompt': () => null, '../components/Icon': () => null,
    '../context/AuthContext': { useAuth: () => ({ user: member ? { uid: 'qa' } : null, loading, migrated: false }) },
    '../hooks/useApi': { useApi: (fetcher) => ({ data: fetcher ? fetcher() : null, loading: false, error: null }) },
    '../lib/guest': { loadGuest: () => guest },
  });
  return { html: renderToStaticMarkup(h(home.default)), calls };
}
const task = { id: 'qa-task', title: 'QA 학습 과제', subjectName: '소프트웨어 설계', minutes: 30, done: false, type: 'study', checklist: [], materials: [] };
const ready = (tasks = [task]) => ({ today: '2026-10-15', exam: { type: 'written', date: '2027-01-13', dday: 90 }, isStudyDay: true, tasks });

test('member without learning conditions has exactly one plan action and a material path', () => {
  const { html, calls } = renderHome({ today: { needsOnboarding: true } });
  assert.match(html, /학습 계획 만들기/);
  assert.match(html, /시험일·학습 시간에 맞춰 계획 설정/);
  assert.match(html, /href="\/materials"/);
  assert.equal((html.match(/<button/g) || []).length, 1);
  assert.doesNotMatch(html, /약 1분|배정된 과제와 추천 자료/);
  assert.deepEqual(calls, ['/api/today']);
});
test('member without a schedule has both start choices and no duplicate generation action', () => {
  const { html, calls } = renderHome({ today: { needsPlan: true, exam: ready().exam, today: '2026-10-15' } });
  assert.match(html, /스케줄 만들기/); assert.match(html, /원하는 자료 찾아 학습/);
  assert.match(html, /저장한 학습 조건으로 스케줄 생성/);
  assert.equal((html.match(/스케줄 만들기/g) || []).length, 1);
  assert.deepEqual(calls, ['/api/today']);
});
test('normal member keeps the information order and places the unit link before tasks', () => {
  const { html } = renderHome({ today: ready() });
  const labels = ['시험까지 남은 기간', '학습 시작 방법', '오늘 할 일', '다른 단원 학습 기록', 'QA 학습 과제', '과목별 진도', '다음에 복습할 취약 주제', '다음 추천'];
  const indices = labels.map((label) => html.indexOf(label));
  indices.forEach((value) => assert.ok(value >= 0));
  assert.deepEqual(indices.slice().sort((a, b) => a - b), indices);
  assert.doesNotMatch(html, /이후 스케줄과 추천에 반영됩니다/);
});
test('rest day retains the alternate unit record action', () => {
  const { html } = renderHome({ today: { ...ready([]), isStudyDay: false, nextStudyDate: '2026-10-16' } });
  assert.match(html, /오늘은 쉬는 날이에요/); assert.match(html, /다른 단원 학습 기록/);
});
test('study day without assignments retains both start and unit record actions', () => {
  const { html } = renderHome({ today: ready([]) });
  assert.match(html, /오늘 배정된 과제가 없어요/); assert.match(html, /다른 단원 학습 기록/);
  assert.match(html, /오늘 계획대로 학습/); assert.match(html, /원하는 자료 찾아 학습/);
});
test('completed tasks retain the original correction and cancellation actions', () => {
  const { html } = renderHome({ today: ready([{ ...task, done: true, actualMinutes: 30, understanding: 2 }]) });
  assert.match(html, /기록 수정/); assert.match(html, /완료 취소/); assert.match(html, /다른 단원 학습 기록/);
});
test('guest without a preview has an accurate plan description and material access', () => {
  const { html, calls } = renderHome({ member: false });
  assert.match(html, /내 학습 계획 만들기/); assert.match(html, /시험일·학습 시간에 맞춰 계획 설정/);
  assert.match(html, /원하는 자료 찾아 학습/);
  assert.doesNotMatch(html, /다른 단원 학습 기록|배정된 과제와 추천 자료/);
  assert.deepEqual(calls, ['/api/exams', '/api/materials?type=cbt']);
});
test('guest with a preview retains today action and login-gated recording', () => {
  const guest = { plan: { examType: 'written', examDate: '2027-01-13' }, tasks: [{ ...task, date: '2026-10-15' }] };
  const { html } = renderHome({ member: false, guest });
  assert.match(html, /오늘 계획대로 학습/); assert.match(html, /완료하고 기록/);
  assert.match(html, /완료 체크·오답 기록·추천은 가입 후 저장돼요/);
  assert.doesNotMatch(html, /다른 단원 학습 기록/);
});
test('authentication loading does not expose a member or guest action prematurely', () => {
  const { html, calls } = renderHome({ loading: true });
  assert.match(html, /aria-busy="true"/); assert.doesNotMatch(html, /원하는 자료 찾아 학습/);
  assert.deepEqual(calls, []);
});
for (const reducedMotion of [false, true]) {
  test(`today action moves focus before scrolling, reduced motion=${reducedMotion}`, () => {
    const calls = [];
    const target = { focus: (options) => calls.push(['focus', plain(options)]), scrollIntoView: (options) => calls.push(['scroll', plain(options)]) };
    const hook = vm.runInNewContext(functionSource(homeSource, 'useScrollTo') + '\nuseScrollTo', {
      useRef: () => ({ current: target }), window: { matchMedia: () => ({ matches: reducedMotion }) },
    });
    hook()[1]();
    assert.deepEqual(calls, [['focus', { preventScroll: true }], ['scroll', { behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' }]]);
  });
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }
test('today action is safe before its target is mounted', () => {
  const hook = vm.runInNewContext(functionSource(homeSource, 'useScrollTo') + '\nuseScrollTo', { useRef: () => ({ current: null }) });
  assert.doesNotThrow(() => hook()[1]());
});
test('shared StudyCards functions preserve behavior outside approved choices, recommendations and log dismissibility', () => {
  const before = execFileSync('git', ['show', 'HEAD:client/src/components/StudyCards.jsx'], { cwd: root, encoding: 'utf8' });
  const normalizeLogUI = (text) => text
    .replace('<StudyLogDialog open={logOpen} busy={busy}', '<StudyLogDialog open={logOpen}')
    .replace('function StudyLogDialog({ open, busy,', 'function StudyLogDialog({ open,')
    .replace('<Dialog open={open} dismissible={!busy} onClose={onClose} title="학습 기록">', '<Dialog open={open} onClose={onClose} title="학습 기록">');
  for (const node of declarations(before).filter((item) => item.type === 'FunctionDeclaration' && !['StartChoice', 'RecommendationCards'].includes(item.id.name))) {
    assert.equal(normalizeLogUI(functionSource(cardsSource, node.id.name)), normalizeLogUI(functionSource(before, node.id.name)), node.id.name);
  }
});
test('existing Materials implementation is preserved', () => {
  const hash = require('node:crypto').createHash('sha256').update(read('pages/Materials.jsx')).digest('hex');
  assert.equal(hash, 'a3f143a855c1df503d1fbfb42fd044e32d8cdd9da505e93a43cf9740f95c505e');
});
