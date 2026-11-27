import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js';
import {getAuth,signInWithEmailAndPassword,signOut,onAuthStateChanged,sendPasswordResetEmail,sendEmailVerification,reload} from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js';
import * as databaseSdk from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-database.js';
import {createStore} from './store.mjs';
import {firebaseConfig} from './config.js';
const app=initializeApp(firebaseConfig),auth=getAuth(app),database=databaseSdk.getDatabase(app);
let onReady=()=>{},onClear=()=>{},identity=null,epoch=0,store=null;
const message = text => {const el=document.getElementById('auth-message');if(el)el.textContent=text;};
export const getIdentity = () => identity;
export async function read(){if(!store)throw Error('Войдите заново.');return store.read();}
export async function save(request){if(!store)throw Error('Войдите заново.');return store.save(request);}
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
  try {
    const email=document.getElementById('auth-email').value.trim();
    const password=document.getElementById('auth-password').value;
    await signInWithEmailAndPassword(auth,email,password);
  }catch{message('Не удалось войти. Проверьте почту и пароль.');}
  finally{document.getElementById('auth-password').value='';}
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
