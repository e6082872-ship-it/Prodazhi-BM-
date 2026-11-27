const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'auth.js'),'utf8').replace(/^import .*;\n/gm,'').replace(/\bexport /g,'');
function page(options={}){
 const elements={};const el=id=>elements[id]||=(id==='auth-remember'?{checked:options.remember!==false}:{value:'',textContent:'',disabled:false});
 el('auth-email').value='  owner@example.test  ';el('auth-password').value='Synthetic-only-password';
 const events=[],context=vm.createContext({firebaseConfig:{},initializeApp:()=>({}),getAuth:()=>({}),databaseSdk:{getDatabase:()=>({}),ref:(_,p)=>p,get:async()=>({val:()=>options.access||{enabled:true,profile:'boss'}})},createStore:()=>({close(){},read:async()=>({profile:'boss',data:{sales:[],activity:[],plans:{}}})}),document:{getElementById:el},browserLocalPersistence:'LOCAL',browserSessionPersistence:'SESSION',setPersistence:async(_,p)=>{events.push(['persistence',p]);if(options.blockStorage)throw Error('storage unavailable');},signInWithEmailAndPassword:async(_,email,password)=>{events.push(['signin',email]);assert.equal(password,'Synthetic-only-password');if(options.signIn)await options.signIn();},onAuthStateChanged:(_,cb)=>{context.authChanged=cb;},console});
 vm.runInContext(source,context);
 return {events,el,context,run:s=>vm.runInContext(s,context)};
}
test('remembered login selects durable storage before authentication, and clears the password field',async()=>{
 const p=page();await p.run('login()');assert.deepEqual(p.events,[['persistence','LOCAL'],['signin','owner@example.test']]);assert.equal(p.el('auth-password').value,'');assert.equal(p.el('auth-submit').disabled,false);
});
test('unchecking remember keeps login limited to the browser session',async()=>{
 const p=page({remember:false});await p.run('login()');assert.equal(p.events[0][1],'SESSION');
});
test('blocked storage does not pretend that login was remembered or submit credentials',async()=>{
 const p=page({blockStorage:true});await p.run('login()');assert.equal(p.events.length,1);assert.ok(p.el('auth-message').textContent.includes('снимите галочку'));assert.equal(p.el('auth-password').value,'');
});
test('rapid repeated login submits credentials only once and restores the button',async()=>{
 let release;const waiting=new Promise(r=>release=r);const p=page({signIn:()=>waiting});const first=p.run('login()');await new Promise(r=>setImmediate(r));await p.run('login()');assert.equal(p.events.filter(e=>e[0]==='signin').length,1);assert.equal(p.el('auth-submit').disabled,true);release();await first;assert.equal(p.el('auth-submit').disabled,false);
});
test('an existing verified session opens the permitted profile without another password submission',async()=>{
 const p=page();let opened; p.context.ready=result=>opened=result;p.context.clear=()=>{};p.run('boot(ready,clear)');await p.context.authChanged({uid:'synthetic-owner',emailVerified:true,getIdToken:async()=> 'synthetic-token'});assert.equal(opened.profile,'boss');assert.equal(p.events.length,0);
});
test('remembered session without an enabled grant cannot open the dashboard',async()=>{
 const p=page({access:{enabled:false,profile:'boss'}});let opened=false;p.context.ready=()=>opened=true;p.context.clear=()=>{};p.run('boot(ready,clear)');await p.context.authChanged({uid:'synthetic-owner',emailVerified:true,getIdToken:async()=> 'synthetic-token'});assert.equal(opened,false);assert.ok(p.el('auth-message').textContent.includes('Доступ не выдан'));
});
