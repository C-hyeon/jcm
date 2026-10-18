'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {test}=require('node:test'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),req=createRequire(path.join(root,'client/package.json'));
const {parse}=req('@babel/parser'),esbuild=req('esbuild'),React=req('react'),{renderToStaticMarkup}=req('react-dom/server');
const filename=path.join(root,'client/src/pages/Onboarding.jsx'),source=fs.readFileSync(filename,'utf8');
const ast=parse(source,{sourceType:'module',plugins:['jsx']});
const component=ast.program.body.find(n=>n.type==='ExportDefaultDeclaration').declaration;
const functions=component.body.body.filter(n=>n.type==='FunctionDeclaration');
const states=component.body.body.flatMap(n=>n.declarations||[]).filter(n=>n.init?.callee?.name==='useState').map(n=>n.id.elements[0].name);
const refs=component.body.body.flatMap(n=>n.declarations||[]).filter(n=>n.init?.callee?.name==='useRef').map(n=>n.id.name);
const apiSource=fs.readFileSync(path.join(root,'client/src/api/client.js'),'utf8');
const confirmNode=parse(apiSource,{sourceType:'module'}).program.body.find(n=>n.declaration?.id?.name==='apiWithConfirm').declaration;
const handlers=functions.map(n=>source.slice(n.start,n.end)).join('\n')+'\n'+apiSource.slice(confirmNode.start,confirmNode.end);
const subjects=[{id:'w1',name:'소프트웨어 설계'},{id:'w2',name:'데이터베이스 구축'}];
const form=()=>({examType:'written',examId:'',customDate:'2026-11-13',dailyHours:2,studyDays:[1,2,3,4,5],stage:'intro',subjectProgress:{w1:25},subjectConfidence:{w1:1}});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const fail=(status=503,code='QA_FAILURE')=>Object.assign(new Error('다시 시도해 주세요.'),{status,code});
const date=(d,n)=>{const [y,m,day]=d.split('-').map(Number);return new Date(Date.UTC(y,m-1,day)+n*86400000).toISOString().slice(0,10)};
function harness(options={}){
 const state={step:3,error:null,saving:false,saveStage:null,form:form(),...options.state};
 const references={pending:{current:false},attempt:{current:null},mounted:{current:true},owner:{current:options.guest?null:'qa-user'}};
 const calls=[],navigations=[],guest=[];
 const scope={...references,STEPS:['a','b','c','d'],EXAM_TYPE:{written:'필기',practical:'실기'},STAGE:{intro:1,concept:1,practice:1,final:1},today:options.today||'2026-10-17',addDays:date,
 user:options.guest?null:{uid:'qa-user'},subjects:{data:{items:subjects},loading:false,error:null,...options.subjects},
 exams:{data:{items:[{id:'e1',type:'written',examDate:'2027-02-13'}]},loading:false,error:null,...options.exams},
 existing:{data:{profile:null},loading:false,error:null,...options.existing},
 window:{confirm:()=>options.confirm!==false},
 api:async(route,args={})=>{calls.push({route,...args});return options.api?options.api(route,args):route==='/api/plans/preview'?{plan:{id:'qa-plan'},tasks:[]}:{ok:true};},
 refreshMe:async()=>{calls.push({route:'refreshMe'});if(options.refresh)await options.refresh();},
 navigate:(...args)=>navigations.push(args),
 saveGuest:data=>{guest.push(data);if(options.saveGuest)options.saveGuest(data);},
 loadGuest:()=>options.loadGuest?options.loadGuest():guest.at(-1),
 };
 for(const name of states){Object.defineProperty(scope,name,{get:()=>state[name]});scope['set'+name[0].toUpperCase()+name.slice(1)]=value=>{state[name]=typeof value==='function'?value(state[name]):value;};}
 Object.defineProperty(scope,'subjectItems',{get:()=>scope.subjects.loading||scope.subjects.error?[]:scope.subjects.data?.items||[]});
 Object.defineProperty(scope,'examDate',{get:()=>state.form.examId?scope.exams.data?.items?.find(n=>n.id===state.form.examId)?.examDate:state.form.customDate});
 Object.defineProperty(scope,'refreshOnly',{get:()=>state.saveStage==='refresh'&&!!references.attempt.current?.planCreated&&references.attempt.current.owner===(scope.user?.uid||null)});
 return{...vm.runInNewContext(handlers+'\n({'+functions.map(n=>n.id.name).join(',')+'})',scope),state,references,calls,navigations,guest,scope};
}
for(const [name,patch,step] of [
 ['past date',{customDate:'2026-10-17'},0],
 ['blank date',{customDate:''},0],
 ['invalid calendar date',{customDate:'2027-02-30'},0],
 ['invalid exam type',{examType:'other'},0],
 ['empty weekdays',{studyDays:[]},1],
 ['invalid weekday',{studyDays:[7]},1],
 ['zero hours',{dailyHours:0},1],
 ['too many hours',{dailyHours:12.5},1],
 ['fractional hours',{dailyHours:0.7},1],
 ['non-numeric hours',{dailyHours:'x'},1],
 ['invalid stage',{stage:'other'},2],
 ['invalid progress',{subjectProgress:{w1:101}},3],
 ['invalid confidence',{subjectConfidence:{w1:4}},3],
]){
 test('final submit validates '+name,async()=>{
  const h=harness({state:{form:{...form(),...patch}}});await h.submit();assert.equal(h.calls.length,0);assert.equal(h.state.step,step);assert.ok(h.state.error.message);
 });
}
test('step boundaries remain 0..3',()=>{const h=harness({state:{step:0}});h.previousStep();assert.equal(h.state.step,0);h.state.step=3;h.nextStep();assert.equal(h.state.step,3)});
test('0.5 and 12 hours and 0/100 progress are valid',async()=>{for(const hours of [0.5,12]){const h=harness({state:{form:{...form(),dailyHours:hours,subjectProgress:{w1:0,w2:100}}}});await h.submit();assert.equal(h.navigations.length,1)}});
test('normal logged-in flow preserves endpoints, defaults and navigation',async()=>{
 const h=harness();await h.submit();assert.deepEqual(h.calls.map(n=>n.route),['/api/study-profile','/api/plans','refreshMe']);assert.equal(h.calls[0].method,'PUT');
 assert.equal(h.calls[0].body.subjectConfidence.w2,2);assert.equal(h.calls[0].body.subjectProgress.w2,0);assert.equal(h.navigations[0][0],'/schedule');
});
test('selected exam uses catalog date',async()=>{const h=harness({state:{form:{...form(),examId:'e1',customDate:''}}});await h.submit();assert.equal(h.calls[0].body.examDate,'2027-02-13')});
for(const name of ['loading','error','empty']){
 test('subject '+name+' blocks writes',async()=>{const h=harness({subjects:name==='loading'?{loading:true}:name==='error'?{error:fail()}:{data:{items:[]}}});await h.submit();assert.equal(h.calls.length,0);assert.equal(h.state.step,3)});
}
for(const name of ['loading','error']){
 test('existing profile '+name+' blocks writes',async()=>{const h=harness({existing:name==='loading'?{loading:true}:{error:fail()}});await h.submit();assert.equal(h.calls.length,0)});
 test('selected exam '+name+' blocks writes',async()=>{const h=harness({exams:name==='loading'?{loading:true}:{error:fail()},state:{form:{...form(),examId:'e1'}}});await h.submit();assert.equal(h.calls.length,0)});
}
test('manual date still works when exam list fails',async()=>{const h=harness({exams:{data:null,error:fail()}});await h.submit();assert.equal(h.navigations.length,1)});
test('same-tick duplicate saves and input changes are guarded through refresh',async()=>{
 const write=deferred(),read=deferred(),started=deferred();
 const h=harness({api:(route)=>route==='/api/study-profile'?write.promise:{ok:true},refresh:()=>{started.resolve();return read.promise}});
 const a=h.submit();await h.submit();h.set({dailyHours:5});h.previousStep();h.nextStep();
 assert.equal(h.calls.length,1);assert.equal(h.state.form.dailyHours,2);assert.equal(h.state.step,3);
 write.resolve({ok:true});await started.promise;assert.equal(h.references.pending.current,true);assert.equal(h.state.saveStage,'refresh');
 read.resolve();await a;assert.equal(h.references.pending.current,false);
});
test('failed profile save keeps draft and retries PUT without premature plan creation',async()=>{
 let attempts=0;const h=harness({api:(route)=>{if(route==='/api/study-profile'&&++attempts===1)throw fail();return {ok:true}}});
 await h.submit();assert.equal(h.calls.length,1);assert.equal(h.state.form.dailyHours,2);assert.equal(h.state.saveStage,'profile');await h.submit();
 assert.equal(h.calls.filter(n=>n.method==='PUT').length,2);assert.equal(h.calls.filter(n=>n.route==='/api/plans').length,1);
});
test('plan failure retry does not repeat a confirmed profile save',async()=>{
 let attempts=0;const h=harness({api:(route)=>{if(route==='/api/plans'&&++attempts===1)throw fail();return {ok:true}}});
 await h.submit();assert.equal(h.state.saveStage,'plan');assert.equal(h.references.attempt.current.profileSaved,true);
 await h.submit();assert.equal(h.calls.filter(n=>n.method==='PUT').length,1);assert.equal(h.calls.filter(n=>n.route==='/api/plans').length,2);
});
test('cancelled overwrite keeps a partial-success notice state, not a fake error',async()=>{
 const h=harness({confirm:false,api:route=>{if(route==='/api/plans')throw fail(409,'PLAN_EXISTS');return {ok:true}}});
 await h.submit();assert.equal(h.state.error,null);assert.equal(h.state.saveStage,'plan');assert.equal(h.references.attempt.current.profileSaved,true);assert.equal(h.navigations.length,0);
});
test('accepted overwrite still uses the existing confirmation request contract',async()=>{
 const h=harness({api:(route,args)=>{if(route==='/api/plans'&&!args.body.confirmOverwrite)throw fail(409,'PLAN_EXISTS');return {ok:true}}});
 await h.submit();const posts=h.calls.filter(n=>n.route==='/api/plans');assert.equal(posts.length,2);assert.equal(posts[1].body.confirmOverwrite,true);assert.equal(h.navigations.length,1);
});
test('unrelated 409 is not treated as cancellation',async()=>{
 const h=harness({confirm:false,api:route=>{if(route==='/api/plans')throw fail(409,'OTHER');return {ok:true}}});await h.submit();assert.equal(h.state.error.code,'OTHER');
});
test('refresh failure retry makes only a read and keeps inputs locked',async()=>{
 let reads=0;const h=harness({refresh:()=>{if(++reads===1)throw fail()}});
 await h.submit();h.set({dailyHours:6});h.previousStep();assert.equal(h.state.form.dailyHours,2);assert.equal(h.state.step,3);
 await h.submit();assert.equal(h.calls.filter(n=>n.method==='PUT').length,1);assert.equal(h.calls.filter(n=>n.route==='/api/plans').length,1);
 assert.equal(reads,2);assert.equal(h.navigations.length,1);
});
test('duplicate refresh retries do not duplicate reads',async()=>{
 let reads=0;const wait=deferred();const h=harness({refresh:()=>{if(++reads===1)throw fail();return wait.promise}});
 await h.submit();const a=h.submit();await h.submit();assert.equal(reads,2);wait.resolve();await a;
});
test('editing after plan failure starts a new explicitly changed profile',async()=>{
 let plan=0;const h=harness({api:route=>{if(route==='/api/plans'&&++plan===1)throw fail();return {ok:true}}});
 await h.submit();h.set({dailyHours:3});assert.equal(h.references.attempt.current,null);await h.submit();
 const writes=h.calls.filter(n=>n.method==='PUT');assert.equal(writes.length,2);assert.equal(writes[1].body.dailyHours,3);
});
test('date is revalidated when retrying a plan after midnight',async()=>{
 const h=harness({state:{form:{...form(),customDate:'2026-10-18'}},api:route=>{if(route==='/api/plans')throw fail();return {ok:true}}});
 await h.submit();const before=h.calls.length;h.scope.today='2026-10-18';await h.submit();assert.equal(h.calls.length,before);assert.equal(h.state.step,0);
});
test('unmount after profile save stops further mutations',async()=>{
 const write=deferred();const h=harness({api:()=>write.promise});const a=h.submit();h.references.mounted.current=false;write.resolve({ok:true});await a;assert.equal(h.calls.length,1);assert.equal(h.navigations.length,0);
});
test('account switch after profile save stops plan creation for another user',async()=>{
 const write=deferred();const h=harness({api:()=>write.promise});const a=h.submit();h.references.owner.current='different-user';write.resolve({ok:true});await a;assert.equal(h.calls.length,1);assert.equal(h.navigations.length,0);
});
test('guest preview success never calls account write endpoints',async()=>{
 const h=harness({guest:true});await h.submit();assert.deepEqual(h.calls.map(n=>n.route),['/api/plans/preview']);assert.equal(h.guest.length,1);assert.equal(h.navigations.length,1);
});
test('failed guest preview retains input and retries the preview endpoint',async()=>{
 let count=0;const h=harness({guest:true,api:()=>{if(++count===1)throw fail();return {plan:{id:'qa'},tasks:[]}}});
 await h.submit();assert.equal(h.guest.length,0);assert.equal(h.state.form.dailyHours,2);await h.submit();assert.equal(h.calls.length,2);assert.equal(h.navigations.length,1);
});
test('guest storage failure retries only storage after confirmed preview success',async()=>{
 let blocked=true;const h=harness({guest:true,loadGuest:()=>blocked?null:h.guest.at(-1)});
 await h.submit();assert.equal(h.state.saveStage,'guest');assert.match(h.state.error.message,/보관하지 못/);assert.equal(h.navigations.length,0);
 blocked=false;await h.submit();assert.equal(h.calls.length,1);assert.equal(h.navigations.length,1);
});

function render(overrides={},queries={},refValues={}){
 const cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file).exports;
  const m={exports:{}};cache.set(file,m);let si=0,ri=0,qi=0;
  function localRequire(id){
   if(id==='react'&&file===filename)return {...React,useState:initial=>{const key=states[si++];return[Object.hasOwn(overrides,key)?overrides[key]:key==='form'?form():initial,()=>{}]},useRef:initial=>{const key=refs[ri++];return {current:Object.hasOwn(refValues,key)?refValues[key]:initial}}};
   if(id==='react-router-dom')return{useNavigate:()=>()=>{},useLocation:()=>({pathname:'/onboarding'}),Link:({to,children,...p})=>React.createElement('a',{href:to,...p},children)};
   if(file===filename&&id==='../context/AuthContext')return{useAuth:()=>({user:{uid:'qa-user'},refreshMe:async()=>{}})};
   if(file===filename&&id==='../api/client')return{};
   if(file===filename&&id==='../lib/guest')return{};
   if(file===filename&&id==='../hooks/useApi')return{useApi:()=>{const key=['exams','subjects','existing'][qi++];return {data:key==='exams'?{items:[]}:key==='subjects'?{items:subjects}:{profile:null},loading:false,error:null,reload(){},...queries[key]}}};
   if(!id.startsWith('.'))return req(id);
   const base=path.resolve(path.dirname(file),id),p=[base,base+'.jsx',base+'.js'].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
   const result=load(p);return id==='../lib/format'?{...result,todayKST:()=> '2026-10-17'}:result;
  }
  vm.runInNewContext(esbuild.transformSync(fs.readFileSync(file,'utf8'),{loader:'jsx',format:'cjs',jsx:'automatic'}).code,{module:m,exports:m.exports,require:localRequire,console,Intl,Date},{filename:file});
  return m.exports;
 }
 return renderToStaticMarkup(React.createElement(load(filename).default));
}
test('profile read failure renders retry but not default form',()=>{
 const html=render({}, {existing:{data:null,error:fail()}});assert.match(html,/기존 학습 조건을 불러오지 못/);assert.match(html,/다시 시도/);assert.doesNotMatch(html,/학습 계획 만들기/);
});
test('exam error offers retry without hiding manual date',()=>{
 const html=render({}, {exams:{data:null,error:fail()}});assert.match(html,/role="alert"/);assert.match(html,/type="date"/);assert.match(html,/다시 시도/);
});
for(const [name,q] of [['error',{data:null,error:fail()}],['empty',{data:{items:[]}}],['loading',{data:null,loading:true}]]){
 test('subject '+name+' disables submit and never renders stale inputs',()=>{
  const html=render({step:3},{subjects:q});assert.match(html,/<button[^>]*disabled="">저장하고 스케줄 만들기/);assert.doesNotMatch(html,/소프트웨어 설계 진도/);if(name!=='loading')assert.match(html,/다시 시도/);
 });
}
test('saving disables the complete fieldset and announces work',()=>{
 const html=render({step:3,saving:true,saveStage:'plan'});assert.match(html,/<fieldset[^>]*disabled=""/);assert.match(html,/aria-busy="true"/);assert.match(html,/스케줄 만드는 중/);
});
test('refresh-only failure explains confirmed success and keeps fields locked',()=>{
 const html=render({step:3,saveStage:'refresh',error:fail()}, {}, {attempt:{owner:'qa-user',planCreated:true}});
 assert.match(html,/스케줄은 만들어졌어요/);assert.match(html,/사용자 정보 다시 불러오기/);assert.match(html,/<fieldset[^>]*disabled=""/);
});
test('cancelled plan creation explicitly states profile was saved',()=>{
 const html=render({step:3,saveStage:'plan'},{},{attempt:{owner:'qa-user',profileSaved:true}});assert.match(html,/학습 조건은 저장됐어요/);assert.match(html,/스케줄 생성 다시 시도/);assert.doesNotMatch(html,/role="alert"/);
});
test('expired catalog selection has an explicit option label',()=>{
 const html=render({form:{...form(),examId:'expired'}});assert.match(html,/이전 시험 회차/);
});
test('401 still directs to login instead of retrying writes',()=>{
 const html=render({step:3,saveStage:'profile',error:fail(401)});assert.match(html,/다시 로그인/);assert.doesNotMatch(html,/>다시 시도</);
});
test('onboarding CSS alone changes and previous styles are byte-preserved',()=>{
 const css=require('../2026-10-19-header-qa/2026-10-19-header-css.cjs').stripHeaderCSS(fs.readFileSync(path.join(root,'client/src/styles.css'),'utf8'));
 const rule='.onboarding .onboarding-fields {\n  border: 0;\n  padding: 0;\n  margin: 0;\n  min-width: 0;\n}\n.onboarding .seg-item,\n.onboarding .day {\n  min-height: 44px;\n}\n';
 assert.equal(css.split(rule).length,2);
 // CSS baseline from b0a8418; no local QA snapshot or account data is required.
 const baselineCssHash='183a011361aab1c118cc204fee6c75c12ee9ab961ef4f1d0c5ec86b8cf82aca4';
 assert.equal(crypto.createHash('sha256').update(css.replace(rule,'')).digest('hex'),baselineCssHash);
});
