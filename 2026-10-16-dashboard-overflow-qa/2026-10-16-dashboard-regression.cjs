'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { fixture } = require('./2026-10-16-dashboard-fixtures.cjs');
const root = path.resolve(__dirname, '..');
const client = path.join(root, 'client');
const requireClient = createRequire(path.join(client, 'package.json'));
const React = requireClient('react');
const { renderToStaticMarkup } = requireClient('react-dom/server');
const { transformSync } = requireClient('esbuild');
const { parse } = requireClient('@babel/parser');
const h = React.createElement;
function load(source, modules) {
  const module = { exports: {} };
  vm.runInNewContext(transformSync(source, { loader: 'jsx', jsx: 'automatic', format: 'cjs' }).code, {
    module, exports: module.exports,
    require: (name) => { assert.ok(name in modules, name); return modules[name]; },
  });
  return module.exports;
}
function render({ data = fixture(), loading = false, error = null } = {}) {
  const router = {
    Link: ({ to, children, ...props }) => h('a', { ...props, href: to }, children),
    useLocation: () => ({ pathname: '/dashboard' }),
  };
  const modules = { react: React, 'react/jsx-runtime': requireClient('react/jsx-runtime'), 'react-router-dom': router };
  const charts = Object.fromEntries(['Bar', 'BarChart', 'CartesianGrid', 'LabelList', 'Legend', 'Line', 'LineChart', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis'].map((name) => [name, ({ children }) => h('div', { 'data-chart-part': name }, children)]));
  const ui = load(fs.readFileSync(path.join(client, 'src/components/ui.jsx'), 'utf8'), { ...modules, './Icon': () => null });
  const format = load(fs.readFileSync(path.join(client, 'src/lib/format.js'), 'utf8'), {});
  const dashboard = load(fs.readFileSync(path.join(client, 'src/pages/Dashboard.jsx'), 'utf8'), {
    ...modules, recharts: charts,
    '../api/client': { api: () => { throw Error('SSR must not call live APIs'); } },
    '../hooks/useApi': { useApi: () => ({ data, loading, error, reload() {} }) },
    '../lib/format': format, '../components/ui': ui,
  });
  return renderToStaticMarkup(h(dashboard.default));
}
test('dashboard owns a page-scoped root', () => assert.match(render(), /class="stack dashboard-page"/));
test('all four populated charts retain their tooltips', () => assert.equal((render().match(/data-chart-part="Tooltip"/g) || []).length, 4));
test('metrics and weakness explanation stay visible', () => {
  const html = render(); assert.match(html, /42.5%/); assert.match(html, /100.6/); assert.match(html, /최근 2주 동안의 오답/);
});
test('both period options remain available', () => { const html = render(); assert.match(html, /최근 4주/); assert.match(html, /전체/); });
test('empty learning data retains its entry actions', () => { const html = render({ data: { empty: true } }); assert.match(html, /진도 입력하기/); assert.match(html, /오답 기록하기/); });
test('empty weakness does not hide other charts', () => {
  const html = render({ data: { ...fixture(), weakness: [] } }); assert.match(html, /오답 기록이 없어요/); assert.equal((html.match(/data-chart-part="Tooltip"/g) || []).length, 3);
});
test('loading and read failure retain their original states', () => {
  assert.match(render({ data: null, loading: true }), /aria-busy="true"/);
  const html = render({ data: null, error: { message: '조회 실패' } }); assert.match(html, /role="alert"/); assert.match(html, /다시 시도/);
});
test('overflow containment belongs only to dashboard chart boxes', () => {
  const css = requireClient('postcss').parse(fs.readFileSync(path.join(client, 'src/styles.css'), 'utf8'));
  const rules = []; css.walkRules((rule) => { if (rule.selector === '.dashboard-page .chart-box') rules.push(rule); });
  assert.equal(rules.length, 1);
  assert.ok(rules[0].nodes.some((node) => node.prop === 'overflow' && node.value === 'clip'));
});
test('tooltips wrap and vertical chart tooltips stay inside the chart', () => {
  const source = fs.readFileSync(path.join(client, 'src/pages/Dashboard.jsx'), 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const declaration = ast.program.body.find((node) => node.type === 'VariableDeclaration' && node.declarations.some((item) => item.id.name === 'TOOLTIP_PROPS'));
  const props = vm.runInNewContext(source.slice(declaration.start, declaration.end) + '\nTOOLTIP_PROPS');
  assert.equal(props.wrapperStyle.maxWidth, '100%');
  assert.equal(props.contentStyle.whiteSpace, 'normal');
  const tooltips = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'JSXOpeningElement' && node.name.name === 'Tooltip') tooltips.push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') walk(value);
    }
  }
  walk(ast);
  assert.equal(tooltips.length, 4);
  tooltips.forEach((tooltip) => assert.ok(tooltip.attributes.some((attribute) => attribute.type === 'JSXSpreadAttribute' && attribute.argument.name === 'TOOLTIP_PROPS')));
  tooltips.slice(0, 2).forEach((tooltip) => {
    const position = tooltip.attributes.find((attribute) => attribute.name?.name === 'position');
    assert.equal(position.value.expression.properties.find((property) => property.key.name === 'x').value.value, 0);
  });
});
test('app and optional QA caches resolve independently without changing defaults', async () => {
  const { resolveConfig } = await import(pathToFileURL(path.join(client, 'node_modules/vite/dist/node/index.js')).href);
  const config = { root: client, configFile: path.join(client, 'vite.config.js'), logLevel: 'silent' };
  const previous = process.env.JCM_VITE_CACHE_DIR;
  try {
    delete process.env.JCM_VITE_CACHE_DIR;
    const app = await resolveConfig(config, 'serve');
    assert.equal(app.cacheDir, path.join(client, 'node_modules/.vite'));
    const caches = [app.cacheDir];
    for (const name of ['home', 'materials', 'schedule']) {
      process.env.JCM_VITE_CACHE_DIR = path.join(__dirname, `2026-10-16-${name}-cache`);
      const qa = await resolveConfig(config, 'serve');
      assert.equal(qa.cacheDir, process.env.JCM_VITE_CACHE_DIR);
      caches.push(qa.cacheDir);
    }
    assert.equal(new Set(caches).size, 4);
  } finally {
    if (previous === undefined) delete process.env.JCM_VITE_CACHE_DIR;
    else process.env.JCM_VITE_CACHE_DIR = previous;
  }
});
