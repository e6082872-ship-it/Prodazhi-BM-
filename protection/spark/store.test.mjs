import test from 'node:test';import assert from 'node:assert/strict';import {createStore}from'./store.mjs';
test('personal read and save remain available while the shared view has not been granted',async()=>{
 const sale={id:'s1',mgr:'ilya',sum:10,margin:2,type:'АВ',status:'Закрыта'},writes=[];
 const sdk={ref:(_,path='')=>path,serverTimestamp:()=>1,onValue:(path,next,error)=>{if(path==='spark/teamView')error(Error('permission_denied'));else next({val:()=>path==='spark/claims'?{}:{sales:{s1:{head:0,versions:{0:{payload:sale,deleted:false}}}}}});return()=>{};},update:async(_,updates)=>writes.push(updates)};
 const store=createStore(sdk,{}, {uid:'test',profile:'ilya'});const before=(await store.read()).data;assert.equal(before.sales.length,1);await assert.rejects(()=>store.teamFinance(),/подключается/);const after=structuredClone(before);after.sales[0].sum=12;await store.save({id:'test_operation',action:'save',before,after});assert.ok(Object.keys(writes[0]).every(path=>!path.startsWith('spark/teamView/')));assert.ok(Object.keys(writes[0]).some(path=>path.includes('/versions/1')));store.close();
});
