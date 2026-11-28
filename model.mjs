export const managers=['ilya','filip','artg','arts','vlad','felix'];
export const empty=()=>({sales:[],activity:[],plans:{}});
export const equal=(a,b)=>JSON.stringify(canonical(a??null))===JSON.stringify(canonical(b??null));
function canonical(a){return Array.isArray(a)?a.map(canonical):a&&typeof a==='object'?Object.fromEntries(Object.keys(a).sort().map(k=>[k,canonical(a[k])])):a;}
export const current=r=>r?.versions?.[r.head]||null;
export function view(profiles){
 const data=empty();
 for(const [profile,kinds] of Object.entries(profiles||{}))for(const [kind,records]of Object.entries(kinds))for(const [id,record]of Object.entries(records||{})){
  const v=current(record);if(!v||v.deleted)continue;
  if(kind==='plans')data.plans[profile+'_'+id]=v.payload;else data[kind]?.push(v.payload);
 }
 data.sales.sort((a,b)=>(b.ts||0)-(a.ts||0)||String(a.id).localeCompare(String(b.id)));data.activity.sort((a,b)=>b.date.localeCompare(a.date)||a.mgr.localeCompare(b.mgr));return JSON.parse(JSON.stringify(data));
}
export function differences(before,after){
 const changes=[];
 for(const kind of ['sales','activity','plans']){
  const map=data=>kind==='plans'?new Map(Object.entries(data.plans||{}).map(([key,v])=>{const i=key.indexOf('_');return [key,{profile:key.slice(0,i),id:key.slice(i+1),payload:v}];})):new Map((data[kind]||[]).map(v=>[kind==='sales'?v.id:v.mgr+'_'+v.date,{profile:v.mgr,id:kind==='sales'?v.id:v.date,payload:v}]));
  const a=map(before),b=map(after);
  for(const key of new Set([...a.keys(),...b.keys()])){const prior=a.get(key),next=b.get(key);if(equal(prior,next))continue;const meta=next||prior;if(prior&&next&&(prior.profile!==next.profile))throw Error('Перенос сделки между сотрудниками запрещён.');if(!managers.includes(meta.profile)||!/^[A-Za-z0-9_-]{1,100}$/.test(meta.id||''))throw Error('Некорректный идентификатор записи.');changes.push({...meta,kind,before:prior?.payload||null,after:next?.payload||null});}
 }
 if(changes.length>100)throw Error('Слишком много изменений одновременно.');return changes;
}
export const teamSaleFields=['id','mgr','company','date','shipDate','client','tech','sum','margin','type','status','bonus','reimburse','reimbursed','investorShare','investorPaid','ts','statusChangedAt'];
export function projectTeamSale(sale){return Object.fromEntries(teamSaleFields.filter(key=>sale[key]!==undefined&&sale[key]!==null).map(key=>[key,sale[key]]));}
export function buildTeamView(profiles){
 const result={enabled:true,sales:{},plans:{}};
 for(const [profile,kinds]of Object.entries(profiles||{}))for(const kind of ['sales','plans'])for(const [id,record]of Object.entries(kinds[kind]||{})){
  const v=current(record);if(!v||v.deleted)continue;result[kind][profile]||={};result[kind][profile][id]=kind==='sales'?projectTeamSale(v.payload):{margin:v.payload.margin,av:v.payload.av};
 }
 return result;
}
export function teamFinanceData(projection){
 if(projection?.enabled!==true)throw Error('Обзор команды ещё подключается. Повторите позже.');
 const data=empty();for(const rows of Object.values(projection.sales||{}))data.sales.push(...Object.values(rows));
 for(const [profile,months]of Object.entries(projection.plans||{}))for(const [month,plan]of Object.entries(months))data.plans[profile+'_'+month]=plan;
 return JSON.parse(JSON.stringify(data));
}
export function makeUpdates(profiles,claims,changes,actor,op,timestamp,publishTeam=true){
 const updates={};
 for(const c of changes){
  if(c.kind==='plans'&&c.after)c.after={...c.after,margin:c.after.margin??0,av:c.after.av??0};
  if(actor.profile!=='boss'&&(actor.profile!==c.profile||c.kind==='plans'||!c.after))throw Error('Недостаточно прав.');
  const record=profiles?.[c.profile]?.[c.kind]?.[c.id],v=current(record);
  const intent=p=>c.kind==='sales'&&p?Object.fromEntries(Object.entries(p).filter(([key])=>key!=='statusChangedAt')):p;
  if(v?.op===op&&equal(intent(v.deleted?null:v.payload),intent(c.after)))continue;
  if(!equal(v?.deleted?null:v?.payload,c.before))throw Error('Запись уже изменена. Откройте её заново и сверяйте данные.');
  const head=(record?.head||0)+1,path=`spark/profiles/${c.profile}/${c.kind}/${c.id}`;
  let payload=c.after||c.before;
  if(!payload)throw Error('Нет записи для сохранения.');
  if(c.kind==='sales'&&c.after){
   payload={...payload};
   if(!v||v.deleted||v.payload.status!==payload.status)payload.statusChangedAt=timestamp;
   else if(v.payload.statusChangedAt!==undefined)payload.statusChangedAt=v.payload.statusChangedAt;
   else delete payload.statusChangedAt;
  }
  if(c.kind==='sales'&&c.after&&payload.type!=='АВ'){
   for(const field of ['vin','stockNo'])if(payload[field]){
    const key=payload[field];if(!(field==='vin'?/^[A-HJ-NPR-Z0-9]{17}$/:/^[A-Z0-9_-]{1,80}$/).test(key))throw Error(field==='vin'?'Проверьте VIN: нужно 17 символов.':'Внутренний номер: латинские буквы, цифры, дефис или подчёркивание.');
    const owner=claims?.[field]?.[key];if(owner&&(owner.profile!==c.profile||owner.id!==c.id))throw Error('Этот VIN или номер уже закреплён за другой сделкой. Обратитесь к руководителю.');
    if(!owner)updates[`spark/claims/${field}/${key}`]={profile:c.profile,id:c.id};
   }
  }
  updates[path+'/head']=head;
  updates[path+'/versions/'+head]={uid:actor.uid,at:timestamp,op,deleted:!c.after,payload};
  if(publishTeam&&(c.kind==='sales'||c.kind==='plans'))updates[`spark/teamView/${c.kind}/${c.profile}/${c.id}`]=c.after?(c.kind==='sales'?projectTeamSale(payload):{margin:c.after.margin,av:c.after.av}):null;
 }
 return updates;
}
export function history(profiles){
 const events=[],trash={};
 for(const [profile,kinds]of Object.entries(profiles||{}))for(const [kind,records]of Object.entries(kinds))for(const [id,r]of Object.entries(records||{})){
  const v=current(r);if(kind==='sales'&&v?.deleted)trash[id]={record:v.payload,profile};
  for(const [n,item]of Object.entries(r.versions||{}))if(Number(n)>0)events.push({at:item.at,actor:{email:profile+' · '+item.uid},changes:[{kind:item.deleted?'delete':r.versions[Number(n)-1]?.deleted?'restore':kind,id,before:r.versions[Number(n)-1]?.deleted?null:r.versions[Number(n)-1]?.payload||null,after:item.deleted?null:item.payload}]});
 }
 return {trash,history:events.sort((a,b)=>b.at-a.at).slice(0,200)};
}
