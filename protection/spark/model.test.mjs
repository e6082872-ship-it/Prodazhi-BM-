import test from 'node:test';import assert from 'node:assert/strict';import {createRequire}from'node:module';import vm from 'node:vm';import fs from 'node:fs';
import {view,differences,makeUpdates,equal}from'./model.mjs';
const require=createRequire(import.meta.url),{convert}=require('./admin.cjs');
const sale={id:'s1',mgr:'ilya',stockNo:'BM-001',sum:100,margin:20,type:'Безнал',status:'Закрыта',ts:1};
test('Spark migration preserves financial fields, activity, plans and stable IDs',()=>{const legacy={sales:[sale],activity:[{mgr:'ilya',date:'2026-11-27',found:2}],plans:{'ilya_2026-11':{margin:30,av:1}}};const migrated=convert(legacy);assert.deepEqual(view(migrated.profiles),legacy);assert.equal(migrated.claims.stockNo['BM-001'].id,'s1');});
test('stale edits fail while unrelated manager records do not conflict',()=>{const profiles=convert({sales:[sale]}).profiles;const after={sales:[{...sale,sum:110}],activity:[],plans:{}};const changes=differences(view(profiles),after);const good=makeUpdates(profiles,{stockNo:{'BM-001':{profile:'ilya',id:'s1'}}},changes,{uid:'u',profile:'ilya'},'operation1',1);assert.equal(good['spark/profiles/ilya/sales/s1/versions/1'].payload.sum,110);profiles.ilya.sales.s1.versions[0].payload.sum=200;assert.throws(()=>makeUpdates(profiles,{},changes,{uid:'u',profile:'ilya'},'operation1',1),/изменена/);});
test('moving sale to another profile is rejected',()=>{assert.throws(()=>differences({sales:[sale]},{sales:[{...sale,mgr:'artg'}]}),/Перенос/);});
test('migration refuses repeated vehicle identifiers without deleting either sale',()=>{assert.throws(()=>convert({sales:[sale,{...sale,id:'s2',mgr:'artg'}]}),/Duplicate vehicle/);});
test('Spark page compiles and has no callable functions, legacy endpoint or PIN access',()=>{const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);assert.ok(html.includes('Скачать резервную копию'));assert.ok(!html.includes('BOSS_PIN'));const auth=fs.readFileSync(new URL('./auth.js',import.meta.url),'utf8');assert.ok(!auth.includes('httpsCallable'));assert.ok(!auth.includes('firebase-functions'));});
function protectedPage(){
 const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8'),elements=new Map();
 const el=id=>{if(!elements.has(id))elements.set(id,{value:'',style:{},classList:{add(){},remove(){},toggle(){}},focus(){},replaceChildren(){},querySelectorAll:()=>[],textContent:''});return elements.get(id);};
 const context=vm.createContext({document:{getElementById:el,addEventListener(){},querySelectorAll:()=>[]},window:{addEventListener(){}},sessionStorage:{getItem(){return null;},setItem(){}},crypto:{randomUUID:()=> 'test-operation-id'},setTimeout(){},setInterval(){},console,confirm:()=>true});
 vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\ninit\(\);\s*$/,''),context);
 return {el,context,run:s=>vm.runInContext(s,context)};
}
test('protected page keeps current month totals for every manager and historical selector for owner',()=>{
 const c=protectedPage();c.run(`today=()=> '2026-11-27';db.sales=MANAGERS.flatMap(m=>[{mgr:m.id,status:'Закрыта',type:'Безнал',date:'2026-10-19',shipDate:'2026-11-24',sum:100,margin:30},{mgr:m.id,status:'Закрыта',type:'Безнал',date:'2026-07-01',sum:900,margin:300}]);`);
 c.el('month-filter').value='2026-07';
 for(const id of ['ilya','filip','artg','arts','vlad','felix']){c.run(`renderMyMetrics('${id}')`);assert.ok(c.el('my-metrics').innerHTML.includes('<div class="m-v">₽100</div><div class="m-l">Оборот</div>'));assert.equal(c.run(`calcKpd('${id}').rev`),900);}
});
test('protected page refuses a save under another profile',async()=>{
 const c=protectedPage();c.context.api={getIdentity:()=>({profile:'ilya'}),save:()=>{throw Error('must not call');}};
 c.run("secureAuth=api;currentUser='artg'");assert.equal(await c.run('saveDB(()=>{})'),false);assert.ok(c.el('protection-message').textContent.includes('свой профиль'));
});
test('migration verification tolerates Firebase reordering same-day activity records',()=>{
 const source={sales:[sale],activity:[{mgr:'ilya',date:'2026-11-27',found:2},{mgr:'artg',date:'2026-11-27',found:3}],plans:{}};
 const state=convert(source);const reordered=Object.fromEntries(Object.entries(state.profiles).reverse());assert.ok(equal(view(state.profiles),view(reordered)));
});
test('public start page shows all seven profile cards without reading cached financial metrics',()=>{
 const c=protectedPage();c.run("calcKpd=()=>{throw Error('Public landing must not render financial data');};db.sales=[{mgr:'ilya',client:'PRIVATE_BUYER',sum:9876543}];buildLogin();");
 const html=c.el('login-list').innerHTML;for(const name of ['Илья','Филипп','Артем Г','Артем Ш','Влад','Феликс','Руководитель'])assert.ok(html.includes(name),name);assert.equal((html.match(/class="mgr-card"/g)||[]).length,7);assert.ok(!html.includes('PRIVATE_BUYER'));assert.ok(!html.includes('9876543'));assert.equal(c.run('currentUser'),null);
});
test('choosing an anonymous profile opens its personal login form without opening a cabinet',()=>{
 const c=protectedPage();c.run("chooseProfile('boss')");assert.equal(c.run('currentUser'),null);assert.equal(c.el('login-subtitle').textContent,'Вход: Руководитель');assert.ok(c.el('login-list').innerHTML.includes('auth-remember'));assert.ok(!c.el('login-list').innerHTML.includes('boss-pin'));
});
test('a remembered manager cannot open another manager or the boss using a public card',()=>{
 const c=protectedPage();c.context.api={getIdentity:()=>({profile:'ilya'})};c.run("secureAuth=api;buildMgr=()=>{throw Error('Must not open another profile');};chooseProfile('artg')");assert.equal(c.run('currentUser'),null);assert.ok(c.el('auth-message').textContent.includes('Илья'));c.run("chooseProfile('boss')");assert.equal(c.run('currentUser'),null);
});
test('a remembered owner can inspect a manager while retaining owner identity',()=>{
 const c=protectedPage();c.context.api={getIdentity:()=>({profile:'boss'})};c.run("secureAuth=api;buildBoss=()=>{};bossOpenMgr=id=>{openedManager=id;};chooseProfile('arts')");assert.equal(c.run('currentUser'),'boss');assert.equal(c.run('openedManager'),'arts');
});
test('returning to profiles preserves a remembered manager session and reopens own cabinet',()=>{
 const c=protectedPage();c.context.api={getIdentity:()=>({profile:'ilya'}),logout:()=>{throw Error('Home must not sign out');}};c.run("secureAuth=api;buildMgr=()=>{};chooseProfile('ilya');goStartScreen()");assert.equal(c.run('currentUser'),null);assert.equal(c.el('login-subtitle').textContent,'Выберите свой профиль');c.run("chooseProfile('ilya')");assert.equal(c.run('currentUser'),'ilya');
});
test('the original financial summary is available on the authenticated owner start page',()=>{
 const c=protectedPage();c.context.api={getIdentity:()=>({profile:'boss'})};c.run('secureAuth=api;buildLogin()');assert.ok(c.el('login-list').innerHTML.includes('Команда — маржа'));assert.ok(c.el('login-list').innerHTML.includes('Руководитель'));
});
test('every manager drill-down reconciles to the same monthly KPIs including shipment dates, AV and bonuses',()=>{
 const c=protectedPage();c.run(`db.sales=MANAGERS.flatMap(m=>[
 {id:m.id+'a',mgr:m.id,status:'Закрыта',type:'Безнал',date:'2026-10-19',shipDate:'2026-11-24',sum:100,margin:30,bonus:10},
 {id:m.id+'b',mgr:m.id,status:'Закрыта',type:'Лизинг',date:'2026-11-02',sum:200,margin:-20,bonus:5},
 {id:m.id+'c',mgr:m.id,status:'Закрыта',type:'АВ',date:'2026-11-03',sum:40,margin:40,bonus:7},
 {id:m.id+'d',mgr:m.id,status:'Закрыта',type:'Безнал',date:'2026-10-02',sum:900,margin:90,bonus:9},
 {id:m.id+'e',mgr:m.id,status:'В работе',type:'Безнал',date:'2026-07-01',sum:700,margin:70},
 {id:m.id+'f',mgr:m.id,status:'Аванс получен',type:'Безнал',date:'2026-08-01',sum:800,margin:80},
 {id:m.id+'g',mgr:m.id,status:'Отменена',type:'Безнал',date:'2026-11-01',sum:999,margin:99}]);
 db.activity=MANAGERS.flatMap(m=>[{mgr:m.id,date:'2026-11-01',newc:5,rep:3,book:4,ads:2,upd:1},{mgr:m.id,date:'2026-10-01',newc:100,rep:100,book:100,ads:100}]);`);
 for(const id of ['ilya','filip','artg','arts','vlad','felix'])for(const [kind,key]of Object.entries({sales:'cnt',revenue:'rev',margin:'margin',av:'marginAV',avCount:'cntAV',bonus:'bonus',contacts:'contacts',bookings:'bookings',ads:'ads',open:'openDeals'})){
  const detail=c.run(`managerMetricDetails(db,'${id}','${kind}','2026-11')`);assert.equal(detail.total,c.run(`calcKpd('${id}','2026-11').${key}`),id+' '+kind);assert.ok(detail.records.every(r=>r.mgr===id));
 }
});
test('deal drill-downs include all contributors, rather than only the four preview sales',()=>{
 const c=protectedPage();c.run("db.sales=Array.from({length:12},(_,i)=>({id:'s'+i,mgr:'filip',status:'Закрыта',type:'Безнал',date:'2026-11-01',sum:100,margin:10}));");const model=c.run("managerMetricDetails(db,'filip','sales','2026-11')");assert.equal(model.total,12);assert.equal(model.records.length,12);
});
test('empty activity is zero and unpaid reimbursements retain their all-time scope',()=>{
 const c=protectedPage();assert.equal(c.run("managerMetricDetails(db,'ilya','days','2026-11').total"),0);c.run("db.sales=[{mgr:'ilya',date:'2026-07-01',reimburse:50,reimbursed:false},{mgr:'ilya',date:'2026-11-01',reimburse:80,reimbursed:true},{mgr:'artg',reimburse:900}]");assert.equal(c.run("managerMetricDetails(db,'ilya','reimburse','2026-11').total"),50);assert.equal(c.run("managerMetricDetails(db,'ilya','reimburse','2026-11').allPeriods"),true);
});
test('drill-down HTML escapes buyer names and report comments',()=>{
 const c=protectedPage();c.run(`db.sales=[{mgr:'ilya',status:'Закрыта',type:'Безнал',date:'2026-11-01',client:'<img src=x onerror=alert(1)>',tech:'Truck',sum:100,margin:10}];db.activity=[{mgr:'ilya',date:'2026-11-01',newc:1,comm:'<script>bad()</script>'}];`);const sale=c.run("renderManagerMetricDetails(managerMetricDetails(db,'ilya','sales','2026-11'))"),report=c.run("renderManagerMetricDetails(managerMetricDetails(db,'ilya','contacts','2026-11'))");assert.ok(!sale.includes('<img'));assert.ok(sale.includes('&lt;img'));assert.ok(!report.includes('<script>'));assert.ok(report.includes('&lt;script&gt;'));
});
test('a manager cannot open another employees metric details even by invoking its handler',()=>{
 const c=protectedPage();c.context.api={getIdentity:()=>({profile:'ilya'})};c.run("secureAuth=api;currentUser='ilya';managerMetricDetails=()=>{throw Error('Foreign data must not be read');};showManagerMetric('artg','sales','2026-11');");assert.ok(c.el('protection-message').textContent.includes('Нет доступа'));
});
test('team finance separates sales, AV, halves of the month, company margins and all-time debts',()=>{
 const c=protectedPage();c.run(`db.sales=[
 {mgr:'ilya',status:'Закрыта',company:'КТ',type:'Безнал',date:'2026-11-01',sum:100,margin:30,bonus:10,investorShare:5,reimburse:20},
 {mgr:'filip',status:'Закрыта',company:'АС',type:'Лизинг',date:'2026-10-17',shipDate:'2026-11-15',sum:200,margin:50,bonus:15,investorShare:7},
 {mgr:'artg',status:'Закрыта',company:'КТ',type:'Безнал',date:'2026-11-16',sum:300,margin:60,bonus:20},
 {mgr:'arts',status:'Закрыта',type:'АВ',date:'2026-11-20',sum:40,margin:40,bonus:8},
 {mgr:'vlad',status:'Отменена',type:'Безнал',date:'2026-11-02',sum:900,margin:900,bonus:900},
 {mgr:'felix',status:'В работе',type:'Безнал',date:'2026-10-01',ts:2000000000000-15*86400000},
 {mgr:'ilya',status:'Аванс получен',type:'Безнал',date:'2026-10-02',ts:2000000000000-14*86400000},
 {mgr:'ilya',status:'Закрыта',type:'Безнал',date:'2026-10-01',sum:999,bonus:999,reimburse:30}];`);
 for(const [key,total]of Object.entries({revenue:600,sales:3,margin:140,marginKT:90,marginAS:50,av:40,bonus:53,bonusFirst:25,bonusSecond:28,investor:12,reimburse:50,open:2,stale:1}))assert.equal(c.run(`teamFinanceMetric(db,'${key}','2026-11',2000000000000).total`),total,key);
 const html=c.run("renderManagerMetricDetails(teamFinanceMetric(db,'bonusFirst','2026-11',2000000000000))");assert.ok(html.includes('Вся команда'));assert.ok(html.includes('<th>Менеджер</th>'));assert.ok(html.includes('Филипп'));assert.ok(!html.includes('openEditModal'));
});
test('shared financial projection omits private contact details, purchase prices and history',()=>{
 const state=convert({sales:[{...sale,purchase:70,contactPhone:'PRIVATE_PHONE',contactName:'PRIVATE_CONTACT',comm:'PRIVATE_COMMENT'}],activity:[],plans:{}});
 return import('./model.mjs').then(({buildTeamView,teamFinanceData})=>{const projection=buildTeamView(state.profiles),shared=teamFinanceData(projection);assert.equal(shared.sales[0].sum,100);assert.equal(shared.sales[0].purchase,undefined);assert.equal(shared.sales[0].contactPhone,undefined);assert.equal(shared.sales[0].comm,undefined);assert.ok(!JSON.stringify(projection).includes('PRIVATE_'));assert.equal(view(state.profiles).sales[0].purchase,70);assert.throws(()=>teamFinanceData({}),/подключается/);});
});
test('shared review cannot be opened without a verified active identity',()=>{
 const c=protectedPage();c.run('openTeamFinance()');assert.equal(c.run('currentUser'),null);assert.ok(c.el('protection-message').textContent.includes('войдите'));assert.ok(!c.el('login-list').innerHTML);
});
test('a read-only team filter limits displayed sales and plans without changing the signed-in profile',()=>{
 const c=protectedPage();c.run("currentUser='ilya';db.sales=[{mgr:'ilya',sum:10},{mgr:'filip',sum:20}];db.plans={'ilya_2026-11':{margin:1},'filip_2026-11':{margin:2}};");const filtered=c.run("filterTeamFinance(db,'filip')");assert.equal(filtered.sales.length,1);assert.equal(filtered.sales[0].sum,20);assert.deepEqual(Object.keys(filtered.plans),['filip_2026-11']);assert.equal(c.run('currentUser'),'ilya');assert.equal(c.run('db.sales.length'),2);
});
test('a status transition resets staleness without changing creation time or financial fields and can be retried',()=>{
 const before={...sale,status:'В работе'},profiles=convert({sales:[before]}).profiles,after={...before,status:'Аванс получен'},changes=[{profile:'ilya',kind:'sales',id:before.id,before,after}],actor={uid:'u',profile:'ilya'};
 const updates=makeUpdates(profiles,{stockNo:{'BM-001':{profile:'ilya',id:'s1'}}},changes,actor,'status-op',5000);
 const row=updates['spark/profiles/ilya/sales/s1/versions/1'];assert.equal(row.payload.statusChangedAt,5000);assert.equal(row.payload.ts,before.ts);assert.equal(row.payload.sum,before.sum);assert.equal(row.payload.margin,before.margin);assert.equal(updates['spark/teamView/sales/ilya/s1'].statusChangedAt,5000);assert.equal(after.statusChangedAt,undefined);
 profiles.ilya.sales.s1.head=1;profiles.ilya.sales.s1.versions[1]=row;assert.deepEqual(makeUpdates(profiles,{},changes,actor,'status-op',9999),{});
 const edit={...row.payload,sum:120,statusChangedAt:99999};const next=makeUpdates(profiles,{},[{profile:'ilya',kind:'sales',id:'s1',before:row.payload,after:edit}],actor,'price-op',6000);assert.equal(next['spark/profiles/ilya/sales/s1/versions/2'].payload.statusChangedAt,5000);
});
test('new and restored sales receive server movement time while a plain edit of an old sale does not reset it',()=>{
 const before={...sale,status:'В работе'},profiles=convert({sales:[before]}).profiles,actor={uid:'u',profile:'boss'};
 const plainEdit=makeUpdates(profiles,{},[{profile:'ilya',kind:'sales',id:'s1',before,after:{...before,comm:'edited'}}],actor,'plain-op',6000);assert.equal(plainEdit['spark/profiles/ilya/sales/s1/versions/1'].payload.statusChangedAt,undefined);
 profiles.ilya.sales.s1.versions[0].deleted=true;
 const restored=makeUpdates(profiles,{},[{profile:'ilya',kind:'sales',id:'s1',before:null,after:before}],actor,'restore-op',7000);assert.equal(restored['spark/profiles/ilya/sales/s1/versions/1'].payload.statusChangedAt,7000);
 const added=makeUpdates({}, {},[{profile:'ilya',kind:'sales',id:'s2',before:null,after:{...sale,id:'s2',type:'АВ'}}],actor,'new-op',8000);assert.equal(added['spark/profiles/ilya/sales/s2/versions/1'].payload.statusChangedAt,8000);
});
test('boss and shared stale counts use last status change, ignore completed deals and honor the 14-day boundary',()=>{
 const c=protectedPage();c.run(`const statusNow=2000000000000;Date.now=()=>statusNow;db.sales=[
 {id:'changed',mgr:'filip',status:'Аванс получен',type:'Безнал',ts:statusNow-20*86400000,statusChangedAt:statusNow-86400000},
 {id:'old',mgr:'ilya',status:'В работе',type:'Безнал',ts:statusNow-20*86400000},
 {id:'edge',mgr:'ilya',status:'В работе',ts:statusNow-20*86400000,statusChangedAt:statusNow-14*86400000},
 {id:'closed',mgr:'ilya',status:'Закрыта',ts:statusNow-20*86400000},
 {id:'cancelled',mgr:'ilya',status:'Отменена',ts:statusNow-20*86400000}];`);
 assert.deepEqual(Array.from(c.run('db.sales.filter(s=>isStaleSale(s)).map(s=>s.id)')),['old']);assert.equal(c.run("teamFinanceMetric(db,'stale','2026-11',statusNow).total"),1);
 c.run('db.sales[1].statusChangedAt=statusNow;renderBossMetrics()');assert.ok(!c.el('boss-metrics').innerHTML.includes('Зависшие сделки'));assert.equal(c.run("teamFinanceMetric(db,'stale','2026-11',statusNow).total"),0);
 c.run('db.sales[2].statusChangedAt--');assert.equal(c.run('isStaleSale(db.sales[2])'),true);
});
