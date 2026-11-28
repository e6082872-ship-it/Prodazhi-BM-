// Shared finance is a read-only projection; personal records and editing keep their existing scope.
let teamFinanceSnapshot=null,teamFinanceRequest=0;
function teamFinanceMetric(data,kind,month,now=Date.now()){
  const closed=filterSalesByMonth(data.sales.filter(s=>s.status==='Закрыта'),month),normal=closed.filter(s=>s.type!=='АВ');
  const labels={revenue:'Оборот',sales:'Продаж закрыто',open:'Текущих сделок',stale:'Зависшие сделки',margin:'Маржа (всего)',marginKT:'Маржа КТ',marginAS:'Маржа АС',av:'АВ',bonus:'Бонусы всего',bonusFirst:'К выплате до 15',bonusSecond:'К выплате с 15',reimburse:'К возврату менеджерам',investor:'Доля инвестора',missingShip:'Без даты отгрузки'};
  if(!labels[kind])throw Error('Неизвестный показатель.');
  let rows,field='margin',money=true,allPeriods=false,note='';
  if(['revenue','sales','margin'].includes(kind)){rows=normal;field=kind==='margin'?'margin':'sum';money=kind!=='sales';}
  else if(kind==='marginKT')rows=normal.filter(s=>['КТ','БМ'].includes(s.company||'КТ'));
  else if(kind==='marginAS')rows=normal.filter(s=>s.company==='АС');
  else if(kind==='av')rows=closed.filter(s=>s.type==='АВ');
  else if(['bonus','bonusFirst','bonusSecond'].includes(kind)){
    rows=closed.filter(s=>Number(s.bonus||0)!==0);field='bonus';
    if(kind!=='bonus'){rows=rows.filter(s=>{const day=Number(saleDate(s).split('-')[2]);return kind==='bonusFirst'?day>=1&&day<=15:day>15;});note=kind==='bonusFirst'?'По дате отгрузки (либо сделки): с 1-го по 15-е включительно.':'По дате отгрузки (либо сделки): с 16-го до конца месяца.';}
  }else if(kind==='investor'){rows=closed.filter(s=>Number(s.investorShare||0)>0);field='investorShare';}
  else if(kind==='reimburse'){rows=data.sales.filter(s=>Number(s.reimburse||0)>0&&!s.reimbursed);field='reimburse';allPeriods=true;}
  else if(kind==='missingShip'){rows=data.sales.filter(s=>s.status==='Закрыта'&&!s.shipDate);money=false;allPeriods=true;}
  else{rows=data.sales.filter(s=>s.status==='В работе'||s.status==='Аванс получен');money=false;allPeriods=true;if(kind==='stale'){rows=rows.filter(s=>isStaleSale(s,now));note='Статус не менялся больше 14 дней. Отсчёт — от последней смены статуса либо добавления старой записи без изменений.';}}
  const records=[...rows].sort((a,b)=>saleDate(b).localeCompare(saleDate(a)));
  return {team:true,kind,month,title:labels[kind],records,field,money,activity:false,allPeriods,note,total:money?records.reduce((n,s)=>n+Number(s[field]||0),0):records.length};
}
function clearTeamFinance(){teamFinanceRequest++;teamFinanceSnapshot=null;}
function filterTeamFinance(data,profile){return profile?{sales:data.sales.filter(s=>s.mgr===profile),activity:[],plans:Object.fromEntries(Object.entries(data.plans).filter(([key])=>key.startsWith(profile+'_')))}:data;}
function openTeamFinance(){
  const actor=secureAuth?.getIdentity();if(!actor){showProtectionMessage('Для общего обзора войдите в личный кабинет.');return;}
  if(saving){showProtectionMessage('Дождитесь завершения сохранения.');return;}
  if(window.bmDrafts.isDirty()&&!confirm('В редактировании есть несохранённые изменения. Открыть обзор без сохранения?'))return;
  window.bmDrafts.persist();window.bmDrafts.resetDirty();editRecord=null;currentUser=actor.profile;selectedProfile=null;
  ['s-login','s-mgr','s-boss','edit-modal','manager-metric-modal','open-deals-modal'].forEach(id=>show(id,false));
  show('s-team-finance',true);renderTeamFinance();
}
async function renderTeamFinance(){
  const actor=secureAuth?.getIdentity();if(!actor||currentUser!==actor.profile)return;
  const ticket=++teamFinanceRequest,epoch=secureAuthEpoch;
  const managerInput=document.getElementById('team-finance-manager'),selectedManager=managerInput.value||'';
  const monthInput=document.getElementById('team-finance-month'),chosen=monthInput.value||today().slice(0,7),container=document.getElementById('team-finance-content');
  if(!teamFinanceSnapshot)container.innerHTML='<div class="loading">Загрузка общей сводки…</div>';
  try{
    const data=await secureAuth.teamFinance();if(ticket!==teamFinanceRequest||epoch!==secureAuthEpoch||!document.getElementById('s-team-finance').classList.contains('on'))return;
    teamFinanceSnapshot=data;
    const months=new Set([today().slice(0,7)]);data.sales.forEach(s=>{if(/^\d{4}-\d{2}/.test(saleDate(s)))months.add(saleDate(s).slice(0,7));});
    Object.keys(data.plans).forEach(key=>{const m=key.slice(-7);if(/^\d{4}-\d{2}$/.test(m))months.add(m);});
    monthInput.innerHTML=[...months].sort().reverse().map(m=>`<option value="${m}">${new Date(m+'-01T12:00:00').toLocaleDateString('ru-RU',{month:'long',year:'numeric'})}</option>`).join('');
    monthInput.value=months.has(chosen)?chosen:today().slice(0,7);
    managerInput.innerHTML='<option value="">Все менеджеры</option>'+MANAGERS.map(m=>`<option value="${m.id}">${safeText(m.name)}</option>`).join('');managerInput.value=selectedManager;
    const scoped=filterTeamFinance(data,selectedManager);
    const month=monthInput.value,plan=MANAGERS.reduce((n,m)=>n+Number(scoped.plans[m.id+'_'+month]?.margin||0),0);
    const kinds=['revenue','sales','open','stale','margin','marginKT','marginAS','av','bonus','bonusFirst','bonusSecond','reimburse','investor','missingShip'];
    container.innerHTML='<div class="metrics">'+kinds.map(kind=>{
      const metric=teamFinanceMetric(scoped,kind,month);let sub='';
      if(kind==='margin'&&plan>0)sub='план '+Math.round(metric.total/plan*100)+'%';
      else if(['marginKT','marginAS','reimburse','investor'].includes(kind))sub='Записей: '+metric.records.length;
      else if(kind==='stale')sub='без смены статуса >14 дней';
      return `<button type="button" class="m metric-drilldown" onclick="showTeamFinanceMetric('${kind}')" aria-haspopup="dialog" aria-controls="manager-metric-modal"><div class="m-v">${metric.money?'₽':''}${fmt(metric.total)}</div><div class="m-l">${metric.title}</div>${sub?'<div class="m-s">'+sub+'</div>':''}</button>`;
    }).join('')+'</div>';
  }catch(e){if(ticket===teamFinanceRequest&&epoch===secureAuthEpoch)container.textContent=e.message||'Общую сводку пока не удалось загрузить.';}
}
async function showTeamFinanceMetric(kind){
  const actor=secureAuth?.getIdentity();if(!actor||currentUser!==actor.profile||!document.getElementById('s-team-finance').classList.contains('on'))return;
  const epoch=secureAuthEpoch,month=document.getElementById('team-finance-month').value,selectedManager=document.getElementById('team-finance-manager').value;
  try{
    const data=await secureAuth.teamFinance();if(epoch!==secureAuthEpoch||currentUser!==actor.profile)return;
    const metric=teamFinanceMetric(filterTeamFinance(data,selectedManager),kind,month);metric.subject=selectedManager?profileName(selectedManager):'Вся команда';managerMetricTrigger=document.activeElement;
    document.getElementById('manager-metric-title').textContent=metric.title+' — '+metric.subject;
    document.getElementById('manager-metric-content').innerHTML=renderManagerMetricDetails(metric);
    document.getElementById('manager-metric-modal').classList.add('on');document.getElementById('manager-metric-close').focus();
  }catch(e){showProtectionMessage(e.message);}
}
const teamOriginalLoad=loadDB;
loadDB=async function(){const ok=await teamOriginalLoad();if(ok&&document.getElementById('s-team-finance').classList.contains('on'))renderTeamFinance();return ok;};

function teamFinanceEntry(){return secureAuth?.getIdentity()?'<button type="button" class="btn" style="margin-bottom:8px" onclick="openTeamFinance()">Обзор команды</button>':'';}
