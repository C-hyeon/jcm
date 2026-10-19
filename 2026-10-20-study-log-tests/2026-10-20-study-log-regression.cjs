'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), { test } = require('node:test'), { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..'), req = createRequire(path.join(root, 'client/package.json'));
const React = req('react'), esbuild = req('esbuild'), { parse } = req('@babel/parser');
const cards = fs.readFileSync(path.join(root, 'client/src/components/StudyCards.jsx'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'client/src/components/ui.jsx'), 'utf8');
function code(source, name) {
  const node = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body.map(n => n.declaration || n).find(n => n.id?.name === name);
  assert.ok(node, name); return source.slice(node.start, node.end);
}
function compile(source) { return esbuild.transformSync(source, { loader: 'jsx', jsx: 'transform' }).code; }
function walk(element, predicate) {
  if (!element || typeof element !== 'object') return [];
  return (predicate(element) ? [element] : []).concat(React.Children.toArray(element.props?.children).flatMap(x => walk(x, predicate)));
}
const Dialog = () => null, StudyLogForm = () => null;
const studyDialog = vm.runInNewContext(compile(code(cards, 'StudyLogDialog')) + ';StudyLogDialog', { React, Dialog, StudyLogForm });
const nativeDialog = vm.runInNewContext(compile(code(ui, 'Dialog')) + ';Dialog', { React, Icon: () => null, useRef: () => ({ current: null }), useId: () => 'log-title', useEffect() {} });
const closeButtons = element => walk(element, x => x.type === 'button' && x.props['aria-label'] === '닫기');
const task = { id: 'qa-task', title: '요구사항 확인', subjectName: '소프트웨어 설계', type: 'study', minutes: 60, done: false, checklist: [], materials: [] };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function harness(options = {}) {
  const states = [], refs = [], calls = [], changed = [];
  let si = 0, ri = 0;
  const scope = { React, Icon: () => null, MaterialLinks: () => null, StudyLogDialog: studyDialog, minutesLabel: String, formatDate: String, UNDERSTANDING: {},
    useState(initial) { const i = si++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef(initial) { const i = ri++; return refs[i] ||= { current: initial }; },
    async api(route, settings) { calls.push({ route, settings }); return options.request ? options.request() : { task: { ...task, done: true }, progress: null }; },
  };
  const renderCard = vm.runInNewContext(compile(code(cards, 'TaskCard')) + ';TaskCard', scope);
  const value = { calls, changed, render() { si = 0; ri = 0; return renderCard({ task, onChange: (...args) => changed.push(args), ...options.props }); } };
  value.dialog = () => walk(value.render(), x => x.type === studyDialog)[0];
  value.open = () => walk(value.render(), x => x.type === 'button' && x.props.className === 'btn btn-primary')[0].props.onClick();
  return value;
}

test('idle and failed study log dialogs retain the normal close button', () => {
  for (const busy of [false, undefined]) {
    const wrapper = studyDialog({ open: true, busy, task, error: 'QA error' });
    assert.equal(wrapper.props.dismissible, true);
    assert.equal(closeButtons(nativeDialog(wrapper.props)).length, 1);
    assert.equal(wrapper.props.children.props.error, 'QA error');
  }
});
test('only a busy study log hides its close button and blocks Escape/cancel', () => {
  let closed = 0, prevented = 0;
  const wrapper = studyDialog({ open: true, busy: true, task, onClose: () => { closed++; } });
  const element = nativeDialog(wrapper.props);
  assert.equal(wrapper.props.dismissible, false); assert.equal(closeButtons(element).length, 0);
  element.props.onKeyDown({ key: 'Escape', preventDefault() { prevented++; } });
  element.props.onCancel({ preventDefault() { prevented++; } });
  assert.equal(prevented, 2); assert.equal(closed, 0);
  assert.equal(wrapper.props.children.type, StudyLogForm);
});
test('TaskCard passes its real pending state to the dialog and restores it after failure', async () => {
  const wait = deferred(), h = harness({ request: () => wait.promise }); h.open();
  assert.equal(h.dialog().props.open, true); assert.equal(h.dialog().props.busy, false);
  const saving = h.dialog().props.onSave({ done: true, actualMinutes: 75, understanding: 1, needsReview: true });
  let props = h.dialog().props; assert.equal(props.busy, true); assert.equal(studyDialog(props).props.dismissible, false);
  let prevented = 0; props.onClose({ preventDefault() { prevented++; } });
  assert.equal(prevented, 1); assert.equal(h.dialog().props.open, true);
  wait.reject(new Error('가짜 저장 실패')); await saving;
  props = h.dialog().props; assert.equal(props.open, true); assert.equal(props.busy, false); assert.equal(props.error, '가짜 저장 실패');
  assert.equal(closeButtons(nativeDialog(studyDialog(props).props)).length, 1); assert.equal(h.changed.length, 0);
});
test('success closes the log, preserves the PATCH contract and blocks duplicate writes', async () => {
  const wait = deferred(), h = harness({ request: () => wait.promise }); h.open();
  const body = { done: true, actualMinutes: 75, understanding: 1, needsReview: true };
  const save = h.dialog().props.onSave(body), duplicate = h.dialog().props.onSave(body);
  await duplicate; assert.equal(h.calls.length, 1); assert.equal(h.dialog().props.open, true);
  assert.equal(h.calls[0].route, '/api/tasks/qa-task'); assert.equal(h.calls[0].settings.method, 'PATCH');
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].settings.body)), body);
  wait.resolve({ task: { ...task, ...body }, progress: { synthetic: true } }); await save;
  assert.equal(h.dialog().props.open, false); assert.equal(h.dialog().props.busy, false); assert.equal(h.changed.length, 1);
});
test('ordinary cancellation stays available when not saving', () => {
  const h = harness(); h.open(); h.dialog().props.onClose();
  assert.equal(h.dialog().props.open, false); assert.equal(h.calls.length, 0);
});
test('guest action still prompts for login without opening a log or writing', () => {
  let prompted = 0; const h = harness({ props: { onRequireLogin() { prompted++; } } }); h.open();
  assert.equal(prompted, 1); assert.equal(h.dialog().props.open, false); assert.equal(h.calls.length, 0);
});
