import {view,differences,makeUpdates,history,current,teamFinanceData} from './model.mjs?v=1fc64018bcec';
export function createStore(sdk,database,actor){
 let profiles={},claims={},teamView={},closed=false,failure=null,teamFailure=null;
 const stops=[];
 const watch=(path,assign,optional=false)=>new Promise((resolve,reject)=>{stops.push(sdk.onValue(sdk.ref(database,path),snapshot=>{if(closed)return;assign(snapshot.val()||{});resolve();},error=>{if(optional)teamFailure=error;else failure=error;reject(error);}));});
 const ready=Promise.all([
  watch(actor.profile==='boss'?'spark/profiles':'spark/profiles/'+actor.profile,value=>{profiles=actor.profile==='boss'?value:{[actor.profile]:value};}),
  watch('spark/claims',value=>{claims=value;})
 ]);
 let teamReady=watch('spark/teamView',value=>{teamFailure=null;teamView=value;},true).catch(()=>{});
 const result=()=>({profile:actor.profile,data:view(profiles)});
 return {
  async read(){await ready;if(failure)throw failure;if(closed)throw Error('Сеанс завершён.');return result();},
  async save(request){
   await ready;await teamReady;if(failure)throw failure;if(closed)throw Error('Сеанс завершён.');
   let changes;
   if(request.action==='restore'){
    if(actor.profile!=='boss')throw Error('Нет доступа.');
    let found;
    for(const [profile,kinds]of Object.entries(profiles)){const v=current(kinds.sales?.[request.saleId]);if(v?.deleted)found={profile,kind:'sales',id:request.saleId,before:null,after:v.payload};}
    if(!found)throw Error('Запись уже восстановлена или отсутствует.');changes=[found];
   }else if(request.action==='save')changes=differences(request.before,request.after);
   else throw Error('Неизвестное действие.');
   const updates=makeUpdates(profiles,claims,changes,actor,request.id,sdk.serverTimestamp(),teamView.enabled===true);
   if(Object.keys(updates).length)await sdk.update(sdk.ref(database),updates);
   if(closed)throw Error('Сеанс завершён.');return result();
  },
  async teamFinance(){await ready;if(failure)throw failure;if(closed)throw Error('Сеанс завершён.');if(teamFailure){teamFailure=null;teamReady=watch('spark/teamView',value=>{teamFailure=null;teamView=value;},true).catch(()=>{});}await teamReady;if(teamFailure)throw Error('Обзор команды ещё подключается. Обновите страницу после подключения.');return teamFinanceData(teamView);},
  async history(){await ready;if(failure)throw failure;if(actor.profile!=='boss')throw Error('Нет доступа.');return history(profiles);},
  async backup(){await ready;if(failure)throw failure;if(actor.profile!=='boss')throw Error('Нет доступа.');return {schemaVersion:3,exportedAt:new Date().toISOString(),profiles,claims};},
  close(){closed=true;stops.forEach(stop=>stop());}
 };
}
