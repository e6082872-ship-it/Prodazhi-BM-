let secureAuth,secureOperation=null,secureAuthEpoch=0;
function safeText(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function showProtectionMessage(message){
  const el=document.getElementById('protection-message');
  el.textContent=message;el.hidden=false;
}
let selectedProfile=null;
const originalProfileLanding=buildLogin;
function profileName(profile){return profile==='boss'?'Руководитель':mgrById(profile)?.name||'';}
function buildProfileLanding(){
  document.getElementById('login-subtitle').textContent='Выберите свой профиль';
  if(secureAuth?.getIdentity()?.profile==='boss'){
    originalProfileLanding();
    document.querySelectorAll('#login-list .mgr-card').forEach(card=>{
      card.setAttribute('role','button');card.tabIndex=0;
      card.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();card.click();}});
    });
    return;
  }
  const profiles=[...MANAGERS,{id:'boss',name:'Руководитель',cls:'av-boss'}];
  document.getElementById('login-list').innerHTML=profiles.map(m=>`<button type="button" class="mgr-card" onclick="chooseProfile('${m.id}')" style="width:100%;text-align:left;font:inherit;color:inherit">
    <span class="avatar ${m.cls}" style="width:40px;height:40px;font-size:14px">${m.id==='boss'?'РУ':safeText(m.name[0])}</span>
    <span class="mgr-info"><span class="mgr-name" style="display:block">${safeText(m.name)}</span><span class="mgr-sub" style="display:block">${m.id==='boss'?'Полный доступ к дашборду':'Личный кабинет менеджера'}</span></span>
    <span class="role-badge ${m.id==='boss'?'role-boss':'role-mgr'}">${m.id==='boss'?'Руководитель':'Менеджер'}</span>
  </button>`).join('');
}
function goStartScreen(){
  if(saving){showProtectionMessage('Дождитесь завершения сохранения.');return;}
  if(window.bmDrafts.isDirty()&&!confirm('В форме редактирования есть несохранённые изменения. Вернуться к профилям без сохранения?'))return;
  window.bmDrafts.beforeChange();currentUser=null;selectedProfile=null;editRecord=null;
  ['s-mgr','s-boss','edit-modal','protection-history'].forEach(id=>show(id,false));
  show('s-login',true);buildProfileLanding();
}
function chooseProfile(profile){
  if(!profileName(profile))return;
  const who=secureAuth?.getIdentity();
  selectedProfile=profile;
  if(!who||who.profile!==profile&&who.profile!=='boss'){
    authForm(profile);
    if(who)document.getElementById('auth-message').textContent='Сейчас вы вошли как '+profileName(who.profile)+'. Для выбранного профиля нужен другой личный аккаунт.';
    return;
  }
  currentUser=who.profile;selectedProfile=null;show('s-login',false);
  if(who.profile==='boss'){
    show('s-boss',true);buildBoss();
    if(profile!=='boss')bossOpenMgr(profile);
  }else{show('s-mgr',true);buildMgr(profile);window.bmDrafts.restore(profile);}
}

function authForm(profile){
  document.getElementById('login-subtitle').textContent='Вход: '+profileName(profile);
  const who=secureAuth?.getIdentity();

  document.getElementById('login-list').innerHTML=`<form onsubmit="event.preventDefault();if(secureAuth)secureAuth.login();else showProtectionMessage('Личный вход загружается. Повторите через несколько секунд.')" style="max-width:400px;margin:auto">
    <button class="btn" type="button" onclick="goStartScreen()" style="margin-bottom:12px">← К выбору профиля</button>
    ${who?`<div id="auth-current-account"><p style="margin-bottom:10px">Текущий аккаунт: ${safeText(profileName(who.profile))}</p><button class="btn" type="button" onclick="chooseProfile('${who.profile}')">Открыть мой кабинет</button><button class="btn" type="button" onclick="logout()">Сменить аккаунт</button></div>`:''}
    <div class="fl"><label for="auth-email">Рабочая почта</label><input type="email" id="auth-email" autocomplete="username" required></div>
    <div class="fl"><label for="auth-password">Пароль</label><input type="password" id="auth-password" autocomplete="current-password" required></div>
    <label style="display:flex;align-items:center;gap:8px;margin:12px 0;font-size:14px"><input type="checkbox" id="auth-remember" checked style="width:auto;margin:0"> Запомнить вход на этом устройстве</label>
    <p style="font-size:13px;color:#666;line-height:1.5">После первого входа кабинет будет открываться автоматически в этом браузере. Кнопка «Выйти» завершает сохранённый вход.</p>
    <p id="auth-message" role="status">Войдите по рабочей почте и паролю.</p>
    <button class="btn btn-p" id="auth-submit" type="submit">Войти</button>
    <button class="btn" type="button" onclick="secureAuth.resetPassword()">Получить / сбросить пароль</button>
    <button class="btn" type="button" onclick="secureAuth.verifyEmail()">Подтвердить почту</button>
    <button class="btn" type="button" onclick="secureAuth.checkVerification()">Проверить подтверждение</button>
  </form>`;
}
loadDB=async function(){
  if(!secureAuth?.getIdentity())return false;
  const revision=dbRevision,epoch=secureAuthEpoch;
  try{
    const result=await secureAuth.read();
    if(saving||revision!==dbRevision||epoch!==secureAuthEpoch)return false;
    db=normalizeDB(result.data);return true;
  }catch(e){setSyncDot('err');showProtectionMessage(e.message);return false;}
};
saveDB=async function(change){
  if(saving){showProtectionMessage('Дождитесь предыдущего сохранения.');return false;}
  const identity=secureAuth?.getIdentity();
  if(!identity || identity.profile!==currentUser){showProtectionMessage('Войдите заново в свой профиль.');return false;}
  saving=true;dbRevision++;setSyncDot('loading');
  const epoch=secureAuthEpoch;
  try{
    const before=clone(db),after=clone(db);change(after);
    const body={action:'save',before,after};
    const fingerprint=JSON.stringify(body);
    if(!secureOperation || secureOperation.fingerprint!==fingerprint)secureOperation={fingerprint,id:crypto.randomUUID()};
    const result=await secureAuth.save({...body,id:secureOperation.id});
    if(epoch!==secureAuthEpoch)throw new Error('Профиль изменился. Откройте свой кабинет заново.');
    db=normalizeDB(result.data);secureOperation=null;setSyncDot('ok');return true;
  }catch(e){setSyncDot('err');showProtectionMessage('Сохранение не подтверждено. '+e.message+' Введённые данные остаются в форме.');return false;}
  finally{saving=false;dbRevision++;}
};
buildLogin=buildProfileLanding;
login=chooseProfile;
loginBoss=function(){chooseProfile('boss');};
submitBossLogin=function(){chooseProfile('boss');};
logout=async function(){
  if(saving){showProtectionMessage('Дождитесь завершения сохранения.');return;}
  if(window.bmDrafts.isDirty()&&!confirm('В форме редактирования есть несохранённые изменения. Выйти без сохранения?'))return;
  await secureAuth.logout();
};
const originalOpenEdit=openEditModal, originalCloseEdit=closeEditModal;
openEditModal=function(handle){
  originalOpenEdit(handle);const s=saleFromHandle(handle);
  document.getElementById('e-vin').value=s.vin||'';
  document.getElementById('e-stock-no').value=s.stockNo||'';
  window.bmDrafts.resetDirty();
  document.getElementById('trash-current-sale').hidden=currentUser!=='boss';
};
closeEditModal=function(){
  if(window.bmDrafts.isDirty()&&!confirm('Закрыть без сохранения изменений?'))return;
  window.bmDrafts.resetDirty();originalCloseEdit();
};
async function trashCurrentSale(){
  if(currentUser!=='boss'||!editRecord)return;
  if(!confirm('Переместить сделку в корзину? Она исчезнет из итогов; её можно восстановить.'))return;
  const before=clone(editRecord);
  if(!await saveDB(data=>{
    const i=data.sales.findIndex(s=>s.id===before.id);
    if(i<0||!same(data.sales[i],before))throw new Error('Сделка изменена. Откройте её заново.');
    data.sales.splice(i,1);
  }))return;
  window.bmDrafts.resetDirty();closeEditModal();buildBoss();
}
async function showProtectionHistory(){
  if(currentUser!=='boss')return;
  try{
    const result=await secureAuth.history();
    const content=document.getElementById('protection-history-content');
    content.innerHTML='<h3>Корзина</h3>';
    const trash=Object.entries(result.trash);
    if(!trash.length)content.insertAdjacentHTML('beforeend','<p>Корзина пуста.</p>');
    for(const [id,item] of trash){
      const row=document.createElement('p');
      row.textContent=`${item.record.client||'Без клиента'} · ${item.record.tech||''} · ₽${fmt(item.record.sum||0)} `;
      const button=document.createElement('button');button.className='btn';button.textContent='Восстановить';
      button.onclick=async()=>{
        button.disabled=true;
        try{
          const restored=await secureAuth.save({id:crypto.randomUUID(),action:'restore',saleId:id});
          db=normalizeDB(restored.data);buildBoss();await showProtectionHistory();
        }catch(e){button.disabled=false;showProtectionMessage(e.message);}
      };
      row.append(button);content.append(row);
    }
    content.insertAdjacentHTML('beforeend','<h3>Последние 200 изменений</h3>');
    for(const event of result.history){
      const details=document.createElement('details'),summary=document.createElement('summary');
      summary.textContent=new Date(event.at).toLocaleString('ru-RU')+' · '+event.actor.email+' · '+event.changes.map(c=>c.kind).join(', ');
      const pre=document.createElement('pre');pre.style.whiteSpace='pre-wrap';pre.textContent=JSON.stringify(event.changes,null,2);
      details.append(summary,pre);content.append(details);
    }
    document.getElementById('protection-history').classList.add('on');
  }catch(e){showProtectionMessage(e.message);}
}
init=async function(){
  buildProfileLanding();
  try{
    secureAuth=await import('./auth.js');
    secureAuth.boot(result=>{
      db=normalizeDB(result.data);
      if(selectedProfile)chooseProfile(selectedProfile);else buildProfileLanding();
    },()=>{
      secureAuthEpoch++;window.bmDrafts.beforeChange();currentUser=null;secureOperation=null;
      db={sales:[],activity:[],plans:{}};editRecord=null;dbRevision++;
      ['s-mgr','s-boss','edit-modal','protection-history'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.remove('on');});
      for(const id of ['my-sales-body','my-metrics','stat-content','day-history','my-client-search-results','boss-metrics','boss-ranking','boss-insights','all-sales-body','all-sales-total','activity-body','team-grid','client-search-results','plans-form','plans-progress','protection-history-content']) {
        const el=document.getElementById(id);if(el)el.replaceChildren();
      }
      document.querySelectorAll('#edit-modal input, #edit-modal textarea').forEach(el=>{el.value='';});
      show('s-login',true);
      document.getElementById('boss-pin').value='';
      document.getElementById('auth-current-account')?.remove();
      const password=document.getElementById('auth-password');if(password)password.value='';
      if(!selectedProfile)buildProfileLanding();
    });
    setInterval(async()=>{
      if(!currentUser||saving||!await loadDB())return;
      if(currentUser==='boss'){
        renderBossMetrics();renderBossRanking();renderAllSales();renderActivity();buildTeamGrid();
      }else{renderMyMetrics(currentUser);renderDayHistory(currentUser);renderMySales(currentUser);}
    },30000);
  }catch{showProtectionMessage('Личный вход временно недоступен. Обновите страницу или обратитесь к руководителю.');}
};
