import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js';
import {getAuth,setPersistence,browserLocalPersistence,browserSessionPersistence,signInWithEmailAndPassword,signOut,onAuthStateChanged,sendPasswordResetEmail,sendEmailVerification,reload} from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js';
import * as databaseSdk from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-database.js';
import {createStore} from './store.mjs?v=1fc64018bcec';
import {firebaseConfig} from './config.js?v=1fc64018bcec';
const app=initializeApp(firebaseConfig),auth=getAuth(app),database=databaseSdk.getDatabase(app);
let onReady=()=>{},onClear=()=>{},identity=null,epoch=0,store=null,signingIn=false;
const message = text => {const el=document.getElementById('auth-message');if(el)el.textContent=text;};
export const getIdentity = () => identity;
export async function read(){if(!store)throw Error('Войдите заново.');return store.read();}
export async function save(request){if(!store)throw Error('Войдите заново.');return store.save(request);}
export async function teamFinance(){if(!store)throw Error('Войдите заново.');return store.teamFinance();}
export async function history(){if(!store)throw Error('Войдите заново.');return store.history();}
export async function downloadBackup(){
 if(!store)throw Error('Войдите заново.');
 const data=await store.backup(),blob=new Blob([JSON.stringify(data)],{type:'application/json'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='BM-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function activate(user) {
  const ticket=++epoch;store?.close();store=null;identity=null;onClear();
  if(!user){message('Войдите по рабочей почте и паролю.');return;}
  if(!user.emailVerified){message('Почта не подтверждена. Нажмите «Подтвердить почту», перейдите по письму, затем «Проверить подтверждение».');return;}
  try {
    await user.getIdToken(true);
    const entry=(await databaseSdk.get(databaseSdk.ref(database,'spark/access/'+user.uid))).val();
    if(ticket!==epoch)return;
    if(!entry?.enabled||!['boss','ilya','filip','artg','arts','vlad','felix'].includes(entry.profile))throw Error('Доступ не выдан. Обратитесь к руководителю.');
    const next=createStore(databaseSdk,database,{uid:user.uid,profile:entry.profile});
    store=next;
    const result=await next.read();
    if(ticket!==epoch){next.close();return;}
    identity={...result,uid:user.uid}; onReady(result);
  }catch(e){if(ticket===epoch){store?.close();store=null;message(e.message||'Доступ не выдан.');}}
}
export function boot(ready,clear) {
  onReady=ready;onClear=clear;
  onAuthStateChanged(auth,user=>activate(user));
}
export async function login() {
  if(signingIn)return;
  signingIn=true;
  const button=document.getElementById('auth-submit');
  if(button){button.disabled=true;button.textContent='Входим…';}
  let settingPersistence=true;
  try {
    const email=document.getElementById('auth-email').value.trim();
    const password=document.getElementById('auth-password').value;
    const remember=document.getElementById('auth-remember')?.checked!==false;
    message('Проверяем вход…');
    await setPersistence(auth,remember?browserLocalPersistence:browserSessionPersistence);
    settingPersistence=false;
    await signInWithEmailAndPassword(auth,email,password);
  }catch(e){
    if(settingPersistence)message('Браузер не разрешил сохранить вход. Разрешите хранение данных сайта или снимите галочку «Запомнить вход» и повторите.');
    else if(e.code==='auth/too-many-requests')message('Слишком много попыток входа. Подождите и повторите позже.');
    else if(e.code==='auth/network-request-failed')message('Не удалось связаться с сервисом входа. Проверьте соединение и повторите.');
    else message('Не удалось войти. Проверьте рабочую почту и пароль, который создали для дашборда.');
  }finally{
    const passwordField=document.getElementById('auth-password');if(passwordField)passwordField.value='';
    if(button){button.disabled=false;button.textContent='Войти';}
    signingIn=false;
  }
}
export async function logout(){epoch++;store?.close();store=null;identity=null;await signOut(auth);}
export async function resetPassword(){
  const email=document.getElementById('auth-email').value.trim();
  if(!email){message('Сначала введите рабочую почту.');return;}
  try{await sendPasswordResetEmail(auth,email);message('Запрос принят. Проверьте «Входящие» и «Спам» в указанной почте. Пароль задаётся по ссылке из письма. Если письма нет, обратитесь к руководителю.');}
  catch{message('Не удалось отправить письмо. Повторите позже.');}
}
export async function verifyEmail(){
  if(!auth.currentUser){message('Сначала войдите по почте и паролю.');return;}
  try{await sendEmailVerification(auth.currentUser);message('Письмо отправлено. После подтверждения нажмите «Проверить подтверждение».');}
  catch{message('Письмо не отправлено. Повторите позже.');}
}
export async function checkVerification(){if(auth.currentUser){await reload(auth.currentUser);await activate(auth.currentUser);}}
