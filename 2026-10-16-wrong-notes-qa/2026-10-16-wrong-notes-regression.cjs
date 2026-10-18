'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const req = createRequire(path.join(root, 'client/package.json'));
const { parse } = req('@babel/parser');
const React = req('react');
const esbuild = req('esbuild');
const { renderToStaticMarkup } = req('react-dom/server');
const filename = path.join(root, 'client/src/pages/WrongNotes.jsx');
const source = fs.readFileSync(filename, 'utf8');
const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
const component = ast.program.body.find(n => n.type === 'ExportDefaultDeclaration').declaration;
const functions = component.body.body.filter(n => n.type === 'FunctionDeclaration');
const setters = component.body.body.flatMap(n => n.declarations || []).filter(n => n.init?.callee?.name === 'useState').map(n => n.id.elements[0].name);
const refNames = component.body.body.flatMap(n => n.declarations || []).filter(n => n.init?.callee?.name === 'useRef').map(n => n.id.name);
const EMPTY = { subjectId: '', unitId: '', typeTag: '', difficulty: 'mid', round: '', number: '', url: '', memo: '' };
const masters = [
  { id: 'w1', name: '설계', tags: ['요구사항', '설계'], units: [{ id: 'u1', name: '요구사항 확인' }] },
  { id: 'w2', name: 'DB', tags: ['SQL'], units: [{ id: 'u2', name: 'SQL 응용' }] },
];
const note = (id = 'n1', more = {}) => ({ id, subjectId: 'w1', unitId: 'u1', typeTag: '요구사항', difficulty: 'mid', sourceRef: {}, memo: '기존 메모', reviewed: false, createdDate: '2026-10-16', ...more });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const failure = (status = 503) => Object.assign(new Error('저장하지 못했어요.'), { status });
const event = { preventDefault() {} };

function harness(options = {}) {
  const state = { examType: 'written', filter: { subjectId: '', typeTag: '', reviewed: '' }, items: [note()], cursor: null, listLoading: false, listErr: null, form: { ...EMPTY, subjectId: 'w1', typeTag: '요구사항', memo: '입력 보존' }, editing: null, formErr: null, pendingAction: null, actionErr: null, notice: '', ...options.state };
  const refs = { pending: { current: false }, mounted: { current: true }, requestId: { current: 0 }, readPending: { current: false }, controller: { current: null }, retryReset: { current: true }, formRef: { current: null } };
  const calls = [], reloads = [];
  const scope = { ...refs, EMPTY, URLSearchParams, AbortController, subjectOf: Object.fromEntries(masters.map(n => [n.id,n])),
    subjectsUnavailable: !!options.subjectsUnavailable, weak: { reload() { reloads.push('weak'); } },
    document: { getElementById: () => ({ scrollIntoView() {} }) }, window: { confirm: () => options.confirm !== false },
    api: async (route, args = {}) => { calls.push({ route, ...args }); if (options.api) return options.api(route,args); return args.method === 'DELETE' ? { ok: true } : args.method ? note('n1', args.body) : { items: state.items, nextCursor: null }; },
  };
  for (const name of setters) {
    Object.defineProperty(scope, name, { get: () => state[name] });
    scope['set' + name[0].toUpperCase() + name.slice(1)] = value => { state[name] = typeof value === 'function' ? value(state[name]) : value; };
  }
  const setF = component.body.body.find(n => n.declarations?.some(d => d.id.name === 'setF'));
  const handlers = functions.map(n => source.slice(n.start,n.end)).join('\n') + '\n' + source.slice(setF.start,setF.end);
  const h = vm.runInNewContext(handlers + '\n({' + functions.map(n => n.id.name).concat('setF').join(',') + '})',scope);
  return { ...h, state, refs, calls, reloads };
}

test('newest filter response wins even if old network ignores abort', async () => {
  const old = deferred(), fresh = deferred();
  let i = 0; const h = harness({ api: () => ++i === 1 ? old.promise : fresh.promise });
  const a = h.load(); h.changeFilter({ subjectId: 'w2', typeTag: '', reviewed: '' });
  const b = h.load(); fresh.resolve({ items: [note('fresh')], nextCursor: null }); await b;
  old.resolve({ items: [note('old')], nextCursor: 'stale' }); await a;
  assert.equal(h.state.items[0].id,'fresh'); assert.equal(h.state.cursor,null);
  assert.equal(h.calls[0].signal.aborted,true);
});

test('stale finally cannot clear the newest loading state', async () => {
  const old = deferred(), fresh = deferred(); let i = 0;
  const h = harness({ api: () => ++i === 1 ? old.promise : fresh.promise });
  const a = h.load(), b = h.load();
  old.resolve({ items: [], nextCursor: null }); await a;
  assert.equal(h.state.listLoading,true);
  fresh.resolve({ items: [], nextCursor: null }); await b; assert.equal(h.state.listLoading,false);
});

test('filter change immediately clears old rows and pagination', () => {
  const h = harness({ state: { cursor: 'n1' } }); h.changeFilter({ subjectId: 'w2', typeTag: '', reviewed: '' });
  assert.equal(h.state.items.length,0); assert.equal(h.state.cursor,null); assert.equal(h.state.listLoading,true);
});

test('unchanged filter does not strand list in loading state', () => {
  const h = harness(); h.changeFilter({ subjectId: '', typeTag: '', reviewed: '' }); assert.equal(h.state.listLoading,false);
});

test('exam switch exits editing and clears form errors without inventing examType list query', () => {
  const h = harness({ state: { editing: 'n1', formErr: failure() } }); h.changeExam('practical');
  assert.equal(h.state.editing,null); assert.equal(h.state.form.subjectId,''); assert.equal(h.state.formErr,null);
  assert.equal(h.state.examType,'practical'); assert.equal(h.state.listLoading,false);
});

test('subject change clears unit and type together', () => {
  const h = harness(); h.setF('subjectId')({ target: { value: 'w2' } });
  assert.equal(h.state.form.unitId,''); assert.equal(h.state.form.typeTag,'');
});

test('required fields prevent writes', async () => {
  const h = harness({ state: { form: EMPTY } }); await h.submit(event);
  assert.equal(h.calls.length,0); assert.match(h.state.formErr.message,/필수/);
});

test('subject failure prevents form writes', async () => {
  const h = harness({ subjectsUnavailable: true }); await h.submit(event); assert.equal(h.calls.length,0);
});

test('same-tick duplicate form submit writes once and locks through refresh', async () => {
  const write = deferred(), read = deferred(), reading = deferred();
  const h = harness({ api: (route,args) => args.method ? write.promise : (reading.resolve(), read.promise) });
  const a = h.submit(event); await h.submit(event); assert.equal(h.calls.length,1);
  h.setF('memo')({ target: { value: '다른 입력' } }); h.changeExam('practical'); h.cancelEdit();
  assert.equal(h.state.form.memo,'입력 보존'); assert.equal(h.state.examType,'written');
  write.resolve(note()); await reading.promise; assert.equal(h.refs.pending.current,true);
  read.resolve({ items: [note()], nextCursor: null }); await a; assert.equal(h.refs.pending.current,false);
});

test('failed create retains all draft fields and unlocks retry', async () => {
  let tries = 0; const h = harness({ api: (route,args) => { if (args.method && ++tries === 1) throw failure(); return args.method ? note() : { items: [note()], nextCursor: null }; } });
  const draft = h.state.form; await h.submit(event);
  assert.equal(h.state.form,draft); assert.equal(h.state.formErr.status,503); assert.equal(h.refs.pending.current,false);
  await h.submit(event); assert.equal(h.calls.filter(n => n.method === 'POST').length,2); assert.equal(h.state.formErr,null);
});

test('editing uses PATCH without subjectId and preserves source metadata', async () => {
  const h = harness(); h.startEdit(note('n1', { sourceRef: { url: 'https://example.com', number: '3', round: '2회' } }));
  await h.submit(event); const write = h.calls[0];
  assert.equal(write.method,'PATCH'); assert.equal(write.route,'/api/wrong-notes/n1'); assert.equal('subjectId' in write.body,false);
  assert.equal(write.body.sourceRef.url,'https://example.com'); assert.equal(write.body.sourceRef.number,'3');
});

test('edit failure preserves edit mode and memo', async () => {
  const h = harness({ api: () => { throw failure(); } }); h.startEdit(note()); await h.submit(event);
  assert.equal(h.state.editing,'n1'); assert.equal(h.state.form.memo,'기존 메모'); assert.equal(h.state.formErr.status,503);
});

test('record from another exam gives guidance instead of broken editor', () => {
  const h = harness(); h.startEdit(note('n9', { subjectId: 'practical' }));
  assert.equal(h.state.editing,null); assert.match(h.state.actionErr.error.message,/시험 구분/);
});

test('review remains unchanged until server success and duplicates are blocked', async () => {
  const write = deferred(); const h = harness({ api: (route,args) => args.method ? write.promise : { items: [note('n1',{ reviewed:true })], nextCursor:null } });
  const a = h.toggleReviewed(note()); await h.toggleReviewed(note());
  assert.equal(h.calls.length,1); assert.equal(h.state.items[0].reviewed,false);
  write.resolve(note('n1',{ reviewed:true })); await a; assert.equal(h.state.items[0].reviewed,true);
});

test('failed review keeps confirmed row and exact retry target', async () => {
  let fail = true;
  const h = harness({ api: (route,args) => { if (args.method && fail) throw failure(); return args.method ? note('n1',{ reviewed:true }) : { items:[note('n1',{ reviewed:true })],nextCursor:null }; } });
  await h.toggleReviewed(note()); assert.equal(h.state.items[0].reviewed,false); assert.equal(h.state.actionErr.kind,'review');
  fail = false; await h.retryAction(); assert.equal(h.state.items[0].reviewed,true);
  assert.equal(h.calls.filter(n=>n.method==='PATCH').length,2);
});

test('review removes row from incompatible filter even if refresh fails', async () => {
  const h = harness({ state: { filter: { subjectId:'',typeTag:'',reviewed:'false' } }, api: (route,args) => { if (!args.method) throw failure(); return note('n1',{ reviewed:true }); } });
  await h.toggleReviewed(note());
  assert.equal(h.state.items.length,0); assert.equal(h.state.actionErr,null); assert.equal(h.state.listErr.status,503);
  assert.match(h.state.notice,/복습 완료/);
});

test('unreview also respects reviewed-only filter', async () => {
  const h = harness({ state: { filter: { subjectId:'',typeTag:'',reviewed:'true' }, items:[note('n1',{reviewed:true})] }, api: (route,args) => { if (!args.method) throw failure(); return note(); } });
  await h.toggleReviewed(note('n1',{reviewed:true})); assert.equal(h.state.items.length,0);
});

test('cancelled delete does not write', async () => {
  const h = harness({ confirm:false }); await h.remove(note()); assert.equal(h.calls.length,0);
});

test('delete failure retains record and retry reuses DELETE', async () => {
  let fail = true;
  const h = harness({ api: (route,args) => { if (args.method && fail) throw failure(); return args.method ? {ok:true} : {items:[],nextCursor:null}; } });
  await h.remove(note()); assert.equal(h.state.items.length,1); assert.equal(h.state.actionErr.kind,'delete');
  fail = false; await h.retryAction(); assert.equal(h.state.items.length,0);
  assert.equal(h.calls.filter(n=>n.method==='DELETE').length,2);
});

test('deleting edited row clears editor only on successful delete', async () => {
  const h = harness(); h.startEdit(note()); await h.remove(note()); assert.equal(h.state.editing,null); assert.equal(h.state.form.subjectId,'');
});

test('row action cannot steal an active form lock', async () => {
  const write = deferred(); const h = harness({ api: (route,args) => args.method ? write.promise : {items:[],nextCursor:null} });
  const a = h.submit(event); await h.remove(note()); await h.toggleReviewed(note()); h.startEdit(note());
  assert.equal(h.calls.length,1); assert.equal(h.state.editing,null);
  write.resolve(note()); await a;
});

test('successful create with failed list refresh does not repeat POST on read retry', async () => {
  let fail = true;
  const h = harness({ api: (route,args) => { if (args.method) return note('created'); if(fail) throw failure(); return {items:[note('created')],nextCursor:null}; } });
  await h.submit(event); assert.equal(h.state.form.memo,''); assert.equal(h.state.items[0].id,'created');
  assert.equal(h.state.formErr,null); assert.equal(h.state.listErr.status,503); assert.match(h.state.notice,/기록했어요/);
  fail = false; await h.load(h.refs.retryReset.current); assert.equal(h.calls.filter(n=>n.method==='POST').length,1);
});

test('pagination deduplicates IDs and single-flights same-tick clicks', async () => {
  const read = deferred(); const h = harness({ state:{cursor:'n1'}, api:()=>read.promise });
  const a = h.load(false); await h.load(false); assert.equal(h.calls.length,1); assert.match(h.calls[0].route,/cursor=n1/);
  read.resolve({items:[note(),note('n2')],nextCursor:null}); await a; assert.equal(h.state.items.length,2);
});

test('failed pagination retains rows and retries same cursor', async () => {
  let tries = 0; const h = harness({ state:{cursor:'n1'}, api:()=>{if(++tries===1)throw failure();return {items:[note('n2')],nextCursor:null};} });
  await h.load(false); assert.equal(h.state.items.length,1); assert.equal(h.state.cursor,'n1'); assert.equal(h.refs.retryReset.current,false);
  await h.load(h.refs.retryReset.current); assert.match(h.calls[1].route,/cursor=n1/); assert.equal(h.state.items.length,2);
});

test('unmounted page ignores late reads and writes', async () => {
  const response = deferred(); const h = harness({api:()=>response.promise});
  const a = h.submit(event); h.refs.mounted.current=false; response.resolve(note()); await a;
  assert.equal(h.state.form.memo,'입력 보존'); assert.equal(h.reloads.length,0);
});

test('new record outside active filters does not appear locally on read failure', async () => {
  const h = harness({state:{items:[],filter:{subjectId:'w2',typeTag:'SQL',reviewed:''}},api:(route,args)=>{if(!args.method)throw failure();return note('new');}});
  await h.submit(event); assert.equal(h.state.items.length,0);
});

function render(states = {}, queries = {}) {
  const cache = new Map();
  function load(file) {
    if(cache.has(file))return cache.get(file).exports;
    const module={exports:{}}; cache.set(file,module); let index=0,refIndex=0,queryIndex=0;
    const localRequire=id=>{
      if(id==='react'&&file===filename)return {...React,useRef:initial=>({current:refNames[refIndex++]==='mounted'?true:initial}),useState:initial=>{const key=setters[index++];return [Object.hasOwn(states,key)?states[key]:initial,()=>{}];}};
      if(id==='react-router-dom')return {Link:({to,children,...rest})=>React.createElement('a',{href:to,...rest},children),useLocation:()=>({pathname:'/wrong-notes'})};
      if(file===filename&&id==='../context/AuthContext')return {useAuth:()=>({me:{profile:{examType:'written'}}})};
      if(file===filename&&id==='../api/client')return {};
      if(file===filename&&id==='../hooks/useApi')return {useApi:()=>{const key=queryIndex++===0?'subjects':'weak';return {data:key==='subjects'?{items:masters}:{topTypes:[]},loading:false,error:null,reload(){},...queries[key]};}};
      if(!id.startsWith('.'))return req(id);
      const base=path.resolve(path.dirname(file),id); return load([base,base+'.jsx',base+'.js'].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile()));
    };
    vm.runInNewContext(esbuild.transformSync(fs.readFileSync(file,'utf8'),{loader:'jsx',format:'cjs',jsx:'automatic'}).code,{module,exports:module.exports,require:localRequire,console},{filename:file});
    return module.exports;
  }
  return renderToStaticMarkup(React.createElement(load(filename).default));
}

test('list error is not displayed as an empty result',()=>{
  const html=render({listLoading:false,listErr:failure(),items:[]});
  assert.match(html,/role="alert"/); assert.doesNotMatch(html,/기록된 오답이 없어요|조건에 맞는 오답이 없어요/);
});

test('empty filters and true empty account have distinct messages',()=>{
  assert.match(render({listLoading:false,items:[]}),/기록된 오답이 없어요/);
  assert.match(render({listLoading:false,items:[],filter:{subjectId:'',typeTag:'',reviewed:'false'}}),/조건에 맞는 오답이 없어요/);
});

test('empty visible page with remaining cursor is not called empty',()=>{
  const html=render({listLoading:false,items:[],cursor:'n1'});assert.doesNotMatch(html,/기록된 오답이 없어요/);assert.match(html,/더 보기/);
});

test('catalog and weakness errors both have retry guidance',()=>{
  const html=render({listLoading:false},{subjects:{data:null,error:failure()},weak:{data:null,error:failure()}});
  assert.equal((html.match(/role="alert"/g)||[]).length,2);assert.equal((html.match(/>다시 시도</g)||[]).length,2);
});

test('form lock disables fields, exam switch, cancel and all row actions',()=>{
  const html=render({listLoading:false,pendingAction:{kind:'save',id:'n1'},editing:'n1',items:[note()]});
  assert.match(html,/aria-busy="true"/);assert.match(html,/저장 중/);
  assert.equal((html.match(/disabled=""/g)||[]).length,18);
});

test('mutation errors render login guidance on 401 instead of retries',()=>{
  const html=render({listLoading:false,actionErr:{error:failure(401),note:note(),kind:'review'}});
  assert.match(html,/다시 로그인/);assert.doesNotMatch(html,/>다시 시도</);
});

test('new touch CSS is scoped and pre-existing CSS is preserved byte-for-byte',()=>{
  const css=require('../2026-10-19-header-qa/2026-10-19-header-css.cjs').stripHeaderCSS(fs.readFileSync(path.join(root,'client/src/styles.css'),'utf8'));
  const rule='.wrong-notes-page .seg-sm .seg-item,\n.wrong-notes-page .tag-picker .chip,\n.wrong-notes-page .note-actions .btn-sm {\n  min-height: 44px;\n}\n';
  assert.equal(css.split(rule).length,2);
  const before={ hashes: { 'client/src/styles.css': '2958453c9a1668956fce3340a981df49f410493c17f85a43dd731c5ac94cc2e3' } };
  const onboardingRule='.onboarding .onboarding-fields {\n  border: 0;\n  padding: 0;\n  margin: 0;\n  min-width: 0;\n}\n.onboarding .seg-item,\n.onboarding .day {\n  min-height: 44px;\n}\n';
  assert.equal(css.split(onboardingRule).length,2);
  assert.equal(crypto.createHash('sha256').update(css.replace(rule,'').replace(onboardingRule,'')).digest('hex'),before.hashes['client/src/styles.css']);
});
