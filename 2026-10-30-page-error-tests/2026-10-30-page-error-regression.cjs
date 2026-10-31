'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), { test } = require('node:test'), { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..'), req = createRequire(path.join(root, 'client/package.json'));
const React = req('react'), esbuild = req('esbuild'), { parse } = req('@babel/parser');
const source = fs.readFileSync(path.join(root, 'client/src/components/2026-10-30-PageErrorBoundary.jsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'client/src/App.jsx'), 'utf8');

function load(location = { pathname: '/progress', search: '' }) {
  const module = { exports: {} }, reloaded = [];
  const scope = { module, exports: module.exports, window: { location: { reload: () => reloaded.push(true) } }, require(id) {
    if (id === 'react-router-dom') return { Link: 'qa-link', useLocation: () => location };
    if (id === './Icon') return () => null;
    return req(id);
  } };
  vm.runInNewContext(esbuild.transformSync(source, { loader: 'jsx', jsx: 'automatic', format: 'cjs' }).code, scope);
  const wrapper = module.exports.default;
  const child = React.createElement('div', null, '정상 화면');
  const element = wrapper({ children: child });
  return { wrapper, location, child, element, boundary: new element.type(element.props), reloaded };
}
function walk(element, match) {
  if (!element || typeof element !== 'object') return [];
  return (match(element) ? [element] : []).concat(React.Children.toArray(element.props?.children).flatMap(child => walk(child, match)));
}
function text(element) {
  if (typeof element === 'string' || typeof element === 'number') return String(element);
  return React.Children.toArray(element?.props?.children).map(text).join('');
}
function failed(h) {
  h.boundary.state = h.element.type.getDerivedStateFromError(new Error('private QA stack and URL'));
  return h.boundary.render();
}

test('normal pages pass through unchanged', () => {
  const h = load();
  assert.equal(h.boundary.state.failed, false);
  assert.equal(h.boundary.render(), h.child);
});
test('a page failure renders a Korean alert without internal error details', () => {
  const view = failed(load());
  assert.equal(view.props.role, 'alert');
  assert.match(text(view), /페이지를 불러오지 못했어요/);
  assert.match(text(view), /연결 상태를 확인/);
  assert.doesNotMatch(text(view), /private QA|stack|https?:/);
});
test('the error heading is programmatically focusable and receives focus after capture', () => {
  const h = load(), view = failed(h);
  const heading = walk(view, node => node.type === 'h1')[0];
  assert.equal(heading.props.tabIndex, -1);
  let focused = 0;
  h.boundary.heading.current = { focus() { focused++; } };
  h.boundary.componentDidCatch();
  assert.equal(focused, 1);
});
test('capture safely handles an unavailable heading ref', () => {
  const h = load();
  assert.doesNotThrow(() => h.boundary.componentDidCatch());
});
test('reload is explicit, not an automatic or timer-based retry', () => {
  const h = load(), view = failed(h);
  h.boundary.componentDidCatch();
  assert.equal(h.reloaded.length, 0);
  const button = walk(view, node => node.type === 'button')[0];
  assert.equal(button.props.type, 'button');
  assert.equal(text(button), '새로고침');
  button.props.onClick();
  assert.equal(h.reloaded.length, 1);
  assert.doesNotMatch(source, /setTimeout|setInterval|location\.(assign|replace)/);
});
test('home navigation uses the router and reuses the existing home icon', () => {
  const view = failed(load()), link = walk(view, node => node.type === 'qa-link')[0];
  assert.equal(link.props.to, '/');
  assert.match(text(link), /홈으로/);
  assert.equal(walk(link, node => node.props?.name === 'home').length, 1);
});
test('a different pathname changes the boundary key', () => {
  const h = load(), before = h.element.key;
  h.location.pathname = '/dashboard';
  const next = h.wrapper({ children: h.child });
  assert.notEqual(next.key, before);
  assert.equal(new next.type(next.props).state.failed, false);
});
test('query-only navigation does not remount the current page or discard its input', () => {
  const h = load();
  h.location.search = '?subjectId=another';
  assert.equal(h.wrapper({ children: h.child }).key, h.element.key);
});

const ast = parse(app, { sourceType: 'module', plugins: ['jsx'] });
const guardNode = ast.program.body.flatMap(node => node.declarations || []).find(node => node.id?.name === 'guard');
function guardElement() {
  const scope = { React, RequireAuth: () => null, PageErrorBoundary: () => null, Suspense: React.Suspense, Loading: () => null };
  const guard = vm.runInNewContext(esbuild.transformSync(`const guard = ${app.slice(guardNode.init.start, guardNode.init.end)};`, { loader: 'jsx' }).code + ';guard', scope);
  return { scope, guard };
}
test('authentication and administrator checks remain outside the error boundary', () => {
  const { scope, guard } = guardElement();
  for (const admin of [false, true]) {
    const element = guard(React.createElement('qa-page'), admin);
    assert.equal(element.type, scope.RequireAuth);
    assert.equal(element.props.admin, admin);
    assert.equal(element.props.children.type, scope.PageErrorBoundary);
  }
});
test('the existing Suspense loading state and page child remain intact', () => {
  const { scope, guard } = guardElement(), child = React.createElement('qa-page');
  const suspense = guard(child).props.children.props.children;
  assert.equal(suspense.type, React.Suspense);
  assert.equal(suspense.props.fallback.type, scope.Loading);
  assert.equal(suspense.props.children, child);
});
test('all seven lazy routes still use the guarded path, with admin access limited to admin', () => {
  const routes = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'JSXElement' && node.openingElement.name.name === 'Route') routes.push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(ast.program);
  const expected = { progress: 'Progress', 'wrong-notes': 'WrongNotes', path: 'LearningPath', recommend: 'Recommend', dashboard: 'Dashboard', profile: 'Profile', admin: 'Admin' };
  const guarded = routes.filter(node => node.openingElement.attributes.some(attr => attr.name?.name === 'element' && attr.value?.expression?.callee?.name === 'guard'));
  assert.equal(guarded.length, 7);
  for (const node of guarded) {
    const attrs = Object.fromEntries(node.openingElement.attributes.filter(attr => attr.name).map(attr => [attr.name.name, attr.value]));
    const route = attrs.path.value, call = attrs.element.expression;
    assert.equal(call.arguments[0].openingElement.name.name, expected[route]);
    assert.equal(call.arguments[1]?.value || false, route === 'admin');
  }
});
test('the boundary is presentation-only and reuses existing styles without API or account operations', () => {
  assert.doesNotMatch(source, /from ['"].*(?:api\/|firebase|AuthContext)/);
  assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|console\./);
  assert.match(source, /className="empty"/);
  assert.match(source, /className="row-center"/);
  assert.match(source, /className="btn btn-primary"/);
});
