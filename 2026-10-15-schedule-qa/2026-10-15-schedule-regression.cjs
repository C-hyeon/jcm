'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { fixture } = require('./2026-10-15-fixtures.cjs');
const root = path.resolve(__dirname, '..');
const requireClient = createRequire(path.join(root, 'client/package.json'));
const { parse } = requireClient('@babel/parser');
const { transformSync } = requireClient('esbuild');
const React = requireClient('react');
const { renderToStaticMarkup } = requireClient('react-dom/server');
const source = fs.readFileSync(path.join(root, 'client/src/pages/Schedule.jsx'), 'utf8');
const ast = (text) => parse(text, { sourceType: 'module', plugins: ['jsx'] }).program.body.map((n) => n.declaration || n);
const code = (name, text = source, pool = ast(text)) => {
  const node = pool.find((n) => n.id?.name === name || n.declarations?.some((d) => d.id.name === name));
  assert.ok(node, name); return text.slice(node.start, node.end);
};
function load(text, modules = {}) {
  const module = { exports: {} };
  vm.runInNewContext(transformSync(text, { loader: 'jsx', jsx: 'automatic', format: 'cjs', define: { 'import.meta.env.DEV': 'false' } }).code, {
    module, exports: module.exports,
    require: (name) => { assert.ok(name in modules, name); return modules[name]; },
  });
  return module.exports;
}
const format = load(fs.readFileSync(path.join(root, 'client/src/lib/format.js'), 'utf8'));
const helpers = vm.runInNewContext(['moveCalendarDate', 'dayStatus', 'calendarKeyDate'].map((name) => code(name)).join('\n') + '\n({moveCalendarDate,dayStatus,calendarKeyDate})', { addDays: format.addDays, dayOfWeek: format.dayOfWeek });
for (const [date, direction, view, expected] of [
  ['2026-01-31', 1, 'month', '2026-02-28'], ['2024-01-31', 1, 'month', '2024-02-29'],
  ['2024-03-31', -1, 'month', '2024-02-29'], ['2026-12-31', 1, 'month', '2027-01-31'],
  ['2027-01-31', -1, 'month', '2026-12-31'], ['2026-10-30', 1, 'month', '2026-11-30'],
  ['2026-12-31', 1, 'week', '2027-01-07'], ['2027-01-01', -1, 'week', '2026-12-25'],
]) test(`calendar move ${date} ${direction} ${view}`, () => assert.equal(helpers.moveCalendarDate(date, direction, view), expected));
for (const [key, expected] of [['ArrowLeft', '2026-10-14'], ['ArrowRight', '2026-10-16'], ['ArrowUp', '2026-10-08'], ['ArrowDown', '2026-10-22'], ['Home', '2026-10-11'], ['End', '2026-10-17'], ['PageUp', '2026-09-15'], ['PageDown', '2026-11-15'], ['Enter', null], ['Tab', null]]) {
  test(`calendar keyboard ${key}`, () => assert.equal(helpers.calendarKeyDate(key, '2026-10-15', 'month'), expected));
}
test('weekly PageDown preserves weekday across a year boundary', () => assert.equal(helpers.calendarKeyDate('PageDown', '2026-12-31', 'week'), '2027-01-07'));
const f = fixture();
test('past unfinished tasks are labelled incomplete', () => assert.match(helpers.dayStatus('2026-10-14', f.tasks.filter((t) => t.date === '2026-10-14'), f.plan, f.today), /미완료 1건/));
test('today distinguishes completed and remaining', () => assert.equal(helpers.dayStatus(f.today, f.tasks.filter((t) => t.date === f.today), f.plan, f.today), '완료 1/2 · 남음 1건'));
test('future unfinished tasks are scheduled, not overdue', () => {
  const status = helpers.dayStatus('2026-10-16', f.tasks.filter((t) => t.date === '2026-10-16'), f.plan, f.today);
  assert.match(status, /예정 2건/); assert.doesNotMatch(status, /미완료/);
});
test('all-done date has a completion status', () => assert.equal(helpers.dayStatus('2026-10-13', f.tasks.filter((t) => t.date === '2026-10-13'), f.plan, f.today), '완료 1건'));
for (const [date, expected] of [['2026-10-17', '휴식일'], ['2026-10-19', '과제 없음'], ['2026-08-31', '계획 범위 밖'], ['2027-03-21', '계획 범위 밖'], ['2027-03-20', '시험일']]) {
  test(`empty date ${date} is ${expected}`, () => assert.equal(helpers.dayStatus(date, [], f.plan, f.today), expected));
}
test('existing tasks are not hidden by a rest-day classification', () => assert.match(helpers.dayStatus('2026-10-17', [{ done: false }], f.plan, f.today), /예정 1건/));
test('missing study-day metadata is not invented', () => assert.equal(helpers.dayStatus('2026-10-17', [], { examDate: f.plan.examDate }, f.today), '과제 없음'));

function render(options = {}) {
  const data = fixture(options.case || 'default');
  const range = format.monthGrid(data.today);
  const rangeKey = `${data.auth.user?.uid || ''}:${range.from}:${range.to}`;
  let call = 0;
  const router = { Link: ({ to, children, ...props }) => React.createElement('a', { ...props, href: to }, children), useLocation: () => ({ pathname: '/schedule' }) };
  const modules = {
    react: React, 'react/jsx-runtime': requireClient('react/jsx-runtime'), 'react-router-dom': router,
    '../api/client': { api: () => { throw Error('SSR must not call a live API'); }, apiWithConfirm: () => { throw Error('No writes'); } },
    '../lib/format': { ...format, todayKST: () => data.today },
    '../context/AuthContext': { useAuth: () => data.auth }, '../lib/guest': { loadGuest: () => data.guest },
  };
  const ui = load(fs.readFileSync(path.join(root, 'client/src/components/ui.jsx'), 'utf8'), { ...modules, './Icon': () => null });
  const cards = load(fs.readFileSync(path.join(root, 'client/src/components/StudyCards.jsx'), 'utf8'), { ...modules, './ui': ui, './Icon': () => null });
  const schedule = load(source, {
    ...modules, '../components/ui': ui, '../components/StudyCards': cards, '../components/SignupPrompt': () => null,
    '../hooks/useApi': { useApi: () => {
      if (call++ === 0) return { data: { plan: data.plan, hasProfile: data.hasProfile }, loading: false, error: options.planError ? { message: '일정 조회 실패' } : null, reload() {} };
      return { data: options.tasksError ? null : { items: data.tasks.filter((t) => t.date >= range.from && t.date <= range.to), rangeKey: options.oldRange ? 'old-range' : rangeKey },
        loading: !!options.loading, error: options.tasksError ? { rangeKey, status: 503, message: '일정을 불러오지 못했어요.' } : null, reload() {} };
    } },
  });
  return renderToStaticMarkup(React.createElement(schedule.default));
}
test('ready calendar renders real grid rows and one roving tab stop', () => {
  const html = render();
  assert.match(html, /role="rowgroup"/); assert.equal((html.match(/tabindex="0"/g) || []).length, 1);
  assert.equal((html.match(/class="cal-week-row" role="row"/g) || []).length, 5);
  assert.match(html, /aria-current="date"/); assert.match(html, /완료 1\/2 · 남음 1건/);
});
for (const opts of [{ loading: true }, { oldRange: true }]) test(`loading does not masquerade as an empty date ${JSON.stringify(opts)}`, () => {
  const html = render(opts); assert.match(html, /과제를 불러오는 중이에요/);
  assert.doesNotMatch(html, /이 날은 배정된 과제가 없어요|class="task-card/);
});
test('task request failure exposes retry, not a false empty state', () => {
  const html = render({ tasksError: true }); assert.match(html, /role="alert"/); assert.match(html, /다시 시도/);
  assert.doesNotMatch(html, /이 날은 배정된 과제가 없어요|class="task-card/);
});
test('plan request failure is distinct from a missing plan', () => {
  const html = render({ planError: true }); assert.match(html, /일정 조회 실패/); assert.doesNotMatch(html, /아직 스케줄이 없어요/);
});
test('missing plan keeps the existing create action', () => assert.match(render({ case: 'no-plan' }), /저장한 조건으로 스케줄 만들기/));
test('missing learning profile keeps the onboarding link', () => assert.match(render({ case: 'no-profile' }), /href="\/onboarding"/));
test('guest preview keeps login gating and does not fetch member data', () => {
  const html = render({ case: 'guest' }); assert.match(html, /비회원 미리보기예요/); assert.match(html, /요구사항 확인/);
});
test('guest without preview keeps the empty plan action', () => assert.match(render({ case: 'guest-empty' }), /아직 스케줄이 없어요/));
test('all completed tasks still expose the original record actions', () => assert.match(render({ case: 'all-done' }), /기록 수정/));
test('a genuinely empty study day is shown only after a successful read', () => assert.match(render({ case: 'empty' }), /이 날은 배정된 과제가 없어요/));
test('regeneration and task-update handlers are unchanged', () => {
  const before = execFileSync('git', ['show', 'HEAD:client/src/pages/Schedule.jsx'], { cwd: root, encoding: 'utf8' });
  for (const name of ['regenerate', 'updateTask']) {
    const previous = ast(before).find((n) => n.type === 'FunctionDeclaration' && n.id.name === 'Schedule').body.body;
    const current = ast(source).find((n) => n.type === 'FunctionDeclaration' && n.id.name === 'Schedule').body.body;
    assert.equal(code(name, source, current), code(name, before, previous));
  }
});
test('schedule CSS stays scoped and preserves navigation and focus states', () => {
  const css = fs.readFileSync(path.join(root, 'client/src/styles.css'), 'utf8');
  const start = css.indexOf('/* Schedule-only navigation');
  const end = css.indexOf('/* ───── 진도 아코디언', start);
  assert.ok(start >= 0 && end > start, 'schedule CSS block exists');
  const parsed = requireClient('postcss').parse(css.slice(start, end));
  const rules = [];
  parsed.walkRules((rule) => {
    rules.push(rule);
    rule.selectors.forEach((selector) => assert.ok(selector.startsWith('.schedule-page'), selector));
  });
  for (const selector of ['.schedule-page .cal-toolbar', '.schedule-page .cal-nav', '.schedule-page .cal-count', '.schedule-page .cal-state', '.schedule-page .calendar.week .cal-items']) {
    assert.ok(rules.some((rule) => rule.selectors.includes(selector)), selector);
  }
  for (const [selector, property, value] of [
    ['.schedule-page .cal-today', 'min-height', '44px'],
    ['.schedule-page .cal-cell:focus-visible', 'outline', '3px solid #2563eb'],
    ['.schedule-page .cal-week-row', 'grid-template-columns', 'repeat(7, minmax(0, 1fr))'],
  ]) {
    assert.ok(rules.some((rule) => rule.selectors.includes(selector) && rule.nodes.some((node) => node.prop === property && node.value === value)), `${selector} ${property}`);
  }
});
