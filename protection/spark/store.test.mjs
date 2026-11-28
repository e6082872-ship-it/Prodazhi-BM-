import test from 'node:test';import assert from 'node:assert/strict';import {createStore}from'./store.mjs';
test('personal read and save remain available while the shared view has not been granted',async()=>{
 const sale={id:'s1',mgr:'ilya',sum:10,margin:2,type:'АВ',status:'Закрыта'},writes=[];
 const sdk={ref:(_,path='')=>path,serverTimestamp:()=>1,onValue:(path,next,error)=>{if(path==='spark/teamView')error(Error('permission_denied'));else next({val:()=>path==='spark/claims'?{}:{sales:{s1:{head:0,versions:{0:{payload:sale,deleted:false}}}}}});return()=>{};},update:async(_,updates)=>writes.push(updates)};
 const store=createStore(sdk,{}, {uid:'test',profile:'ilya'});const before=(await store.read()).data;assert.equal(before.sales.length,1);await assert.rejects(()=>store.teamFinance(),/подключается/);const after=structuredClone(before);after.sales[0].sum=12;await store.save({id:'test_operation',action:'save',before,after});assert.ok(Object.keys(writes[0]).every(path=>!path.startsWith('spark/teamView/')));assert.ok(Object.keys(writes[0]).some(path=>path.includes('/versions/1')));store.close();
});
test('first save waits for shared-view readiness and publishes the same status time atomically',async()=>{
 const sale={id:'s1',mgr:'ilya',sum:10,margin:2,type:'АВ',status:'В работе',ts:1},writes=[];let deliverTeam;
 const sdk={ref:(_,path='')=>path,serverTimestamp:()=>123,onValue:(path,next)=>{if(path==='spark/teamView')deliverTeam=next;else next({val:()=>path==='spark/claims'?{}:{sales:{s1:{head:0,versions:{0:{payload:sale,deleted:false}}}}}});return()=>{};},update:async(_,updates)=>writes.push(updates)};
 const store=createStore(sdk,{}, {uid:'test',profile:'ilya'}),before=(await store.read()).data,after=structuredClone(before);after.sales[0].status='Аванс получен';
 const saving=store.save({id:'status_operation',action:'save',before,after});await new Promise(setImmediate);assert.equal(writes.length,0);
 deliverTeam({val:()=>({enabled:true})});await saving;
 assert.equal(writes[0]['spark/profiles/ilya/sales/s1/versions/1'].payload.statusChangedAt,123);assert.equal(writes[0]['spark/teamView/sales/ilya/s1'].statusChangedAt,123);store.close();
});
