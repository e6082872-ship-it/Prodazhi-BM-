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
 const el=id=>{if(!elements.has(id))elements.set(id,{value:'',style:{},classList:{add(){},remove(){}},focus(){},replaceChildren(){},textContent:''});return elements.get(id);};
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
