// Read-only drill-downs use the same contributors as calcKpd and personal totals.
const managerMetricLabels={sales:'Продажи',revenue:'Оборот',margin:'Маржа',av:'АВ',avCount:'АВ-сделки',bonus:'Бонусы',contacts:'Контакты',bookings:'Бронирования',ads:'Объявления',days:'Дневные отчёты',open:'Текущие сделки',reimburse:'К возврату менеджеру'};
function managerMetricDetails(data,id,kind,month){
  if(!mgrById(id)||!managerMetricLabels[kind])throw new Error('Неизвестный показатель.');
  const sales=data.sales.filter(s=>s.mgr===id);
  const closed=filterSalesByMonth(sales.filter(s=>s.status==='Закрыта'),month);
  const reports=filterByMonth(data.activity.filter(a=>a.mgr===id),'date',month);
  let records,field,activity=false,allPeriods=false,money=true;
  if(['sales','revenue','margin'].includes(kind)){
    records=closed.filter(s=>s.type!=='АВ');field=kind==='margin'?'margin':'sum';money=kind!=='sales';
  }else if(kind==='av'||kind==='avCount'){
    records=closed.filter(s=>s.type==='АВ');field='margin';money=kind!=='avCount';
  }else if(kind==='bonus'){
    records=closed.filter(s=>Number(s.bonus||0)!==0);field='bonus';
  }else if(kind==='open'){
    records=sales.filter(s=>s.status==='В работе'||s.status==='Аванс получен');field='sum';allPeriods=true;money=false;
  }else if(kind==='reimburse'){
    records=sales.filter(s=>Number(s.reimburse||0)>0&&!s.reimbursed);field='reimburse';allPeriods=true;
  }else{
    activity=true;money=false;field=kind;
    const value=a=>kind==='contacts'?Number(a.newc||0)+Number(a.rep||0):kind==='bookings'?Number(a.book||0):kind==='ads'?Number(a.ads||0)+Number(a.upd||0):1;
    records=reports.filter(a=>kind==='days'||value(a)!==0);
    records=[...records].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    return {id,kind,month,title:managerMetricLabels[kind],records,total:records.reduce((n,a)=>n+value(a),0),activity,money,allPeriods};
  }
  records=[...records].sort((a,b)=>saleDate(b).localeCompare(saleDate(a)));
  const total=money?records.reduce((n,s)=>n+Number(s[field]||0),0):records.length;
  return {id,kind,month,title:managerMetricLabels[kind],records,total,activity,money,allPeriods,field};
}
function renderManagerMetricDetails(model){
  const e=safeText,amount=value=>'₽'+fmt(value||0);
  const period=model.allPeriods?'Все периоды':model.month&&model.month!=='all'?new Date(model.month+'-01T12:00:00').toLocaleDateString('ru-RU',{month:'long',year:'numeric'}):'Все периоды';
  let html=`<p style="margin-bottom:10px;color:#666">${e(mgrById(model.id).name)} · ${e(period)}</p><p style="margin-bottom:12px"><strong>Итого: ${e(model.money?amount(model.total):fmt(model.total))}</strong> · ${model.records.length} ${model.activity?'дневных отчётов':'записей'}</p>`;
  if(model.allPeriods&&model.kind==='open')html+='<p style="margin-bottom:12px;color:#666">Все сделки в работе и с полученным авансом, независимо от месяца.</p>';
  if(!model.records.length)return html+'<div class="empty">Нет записей для этого показателя.</div>';
  const td=value=>'<td style="white-space:normal;overflow-wrap:anywhere">'+e(value??'—')+'</td>';
  if(model.activity){
    html+='<div style="overflow-x:auto"><table style="table-layout:auto;min-width:620px"><thead><tr><th>Дата</th><th>Новые</th><th>Повторные</th><th>Контакты</th><th>Брони</th><th>Объявления</th><th>Комментарий</th></tr></thead><tbody>';
    for(const a of model.records)html+='<tr>'+td(fmtDate(a.date))+td(Number(a.newc||0))+td(Number(a.rep||0))+td(Number(a.newc||0)+Number(a.rep||0))+td(Number(a.book||0))+td(Number(a.ads||0)+Number(a.upd||0))+td(a.comm||'—')+'</tr>';
  }else{
    const extra=model.kind==='bonus'?'Бонус':model.kind==='reimburse'?'К возврату':'Маржа';
    html+='<div style="overflow-x:auto"><table style="table-layout:auto;min-width:740px"><thead><tr><th>Дата сделки</th><th>Отгрузка</th><th>Клиент</th><th>Техника</th><th>Сумма</th><th>'+extra+'</th><th>Тип</th><th>Статус</th></tr></thead><tbody>';
    for(const s of model.records)html+='<tr>'+td(fmtDate(s.date))+td(fmtDate(s.shipDate)||'—')+td(s.client||'—')+td(s.tech||'—')+td(amount(s.sum))+td(amount(s[model.kind==='bonus'?'bonus':model.kind==='reimburse'?'reimburse':'margin']))+td(s.type||'—')+td(s.status||'—')+'</tr>';
  }
  return html+'</tbody></table></div>';
}
let managerMetricTrigger=null;
function showManagerMetric(id,kind,month,trigger){
  const actor=secureAuth?.getIdentity();
  if(!actor||currentUser!==actor.profile||actor.profile!=='boss'&&actor.profile!==id){showProtectionMessage('Нет доступа к этому показателю. Войдите в свой кабинет.');return;}
  const model=managerMetricDetails(db,id,kind,month);
  managerMetricTrigger=trigger||document.activeElement;
  document.getElementById('manager-metric-title').textContent=model.title+' — '+mgrById(id).name;
  document.getElementById('manager-metric-content').innerHTML=renderManagerMetricDetails(model);
  document.getElementById('manager-metric-modal').classList.add('on');
  document.getElementById('manager-metric-close').focus();
}
function closeManagerMetric(){
  document.getElementById('manager-metric-modal').classList.remove('on');
  if(managerMetricTrigger?.isConnected)managerMetricTrigger.focus();managerMetricTrigger=null;
}
function bindManagerMetrics(root,id,month){
  const kinds={'Продаж':'sales','Продаж закрыто':'sales','Оборот':'revenue','Маржа':'margin','АВ':'av','АВ-сделок':'avCount','Маржа АВ':'av','Бонусы':'bonus','Контактов':'contacts','Бронирований':'bookings','Объявлений':'ads','Дней внесено':'days','Текущих сделок':'open','Вам должны вернуть':'reimburse'};
  root?.querySelectorAll('.m').forEach(tile=>{
    const label=tile.querySelector('.m-l')?.textContent.trim(),kind=kinds[label];if(!kind)return;
    const button=document.createElement('button');button.type='button';button.className=tile.className+' metric-drilldown';button.innerHTML=tile.innerHTML;button.style.cssText=tile.style.cssText;
    button.title='Показать расшифровку: '+label;button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','manager-metric-modal');
    if(kind==='days')button.querySelector('.m-v').textContent=String(filterByMonth(db.activity.filter(a=>a.mgr===id),'date',month).length);
    button.onclick=()=>showManagerMetric(id,kind,month,button);tile.replaceWith(button);
  });
}
let metricManagerId=null;
const metricOriginalBossOpen=bossOpenMgr;
bossOpenMgr=function(id){metricOriginalBossOpen(id);metricManagerId=id;bindManagerMetrics(document.getElementById('team-detail'),id,currentMonth());};
const metricOriginalMy=renderMyMetrics;
renderMyMetrics=function(id){metricOriginalMy(id);bindManagerMetrics(document.getElementById('my-metrics'),id,today().slice(0,7));};
const metricOriginalStat=renderStat;
renderStat=function(id){metricOriginalStat(id);bindManagerMetrics(document.getElementById('stat-content'),id,today().slice(0,7));};
const metricOriginalMonthChange=onMonthChange;
onMonthChange=function(){metricOriginalMonthChange();if(currentUser==='boss'&&metricManagerId&&document.getElementById('b-team').classList.contains('on'))bossOpenMgr(metricManagerId);};
