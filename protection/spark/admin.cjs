// Owner credentials only. No passwords, emails or notifications are sent by this script.
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const req=createRequire(path.resolve(__dirname,'package.json'));
const {initializeApp,applicationDefault}=req('firebase-admin/app'),{getDatabase}=req('firebase-admin/database'),{getAuth}=req('firebase-admin/auth');
const {migrate}=require('./legacy.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
function convert(legacy){
 const normalized=migrate(legacy).data,profiles={},claims={vin:{},stockNo:{}};
 const add=(profile,kind,id,payload)=>{
  if(!['ilya','filip','artg','arts','vlad','felix'].includes(profile)||!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw Error('Unknown profile or invalid record ID');
  profiles[profile]||={};profiles[profile][kind]||={};
  if(profiles[profile][kind][id])throw Error('Duplicate record ID; review before migration');
  profiles[profile][kind][id]={head:0,versions:{0:{at:Date.now(),uid:'migration',op:'migration',deleted:false,payload:clone(payload)}}};
 };
 for(const sale of normalized.sales){
  if(sale.company==='БМ')sale.company='КТ'; // Existing display alias, never change financial fields.
  add(sale.mgr,'sales',sale.id,sale);
  if(sale.type!=='АВ')for(const field of ['vin','stockNo'])if(sale[field]){
   if(!(field==='vin'?/^[A-HJ-NPR-Z0-9]{17}$/:/^[A-Z0-9_-]{1,80}$/).test(sale[field]))throw Error('Existing vehicle identifier needs review');
   if(claims[field][sale[field]])throw Error('Duplicate vehicle identifier; no automatic deletion');
   claims[field][sale[field]]={profile:sale.mgr,id:sale.id};
  }
 }
 for(const activity of normalized.activity)add(activity.mgr,'activity',activity.date,activity);
 for(const [key,plan]of Object.entries(normalized.plans)){const i=key.indexOf('_');add(key.slice(0,i),'plans',key.slice(i+1),plan);}
 return {schemaVersion:3,profiles,claims};
}
async function main(){
 const input=process.argv.find(a=>a.startsWith('--input='));
 if(input){
  const legacy=JSON.parse(fs.readFileSync(input.slice(8),'utf8')),state=convert(legacy);
  const {view}=await import('./model.mjs');const actual=view(state.profiles);
  const oldSales=legacy.sales.filter(Boolean);
  if(actual.sales.length!==oldSales.length||actual.sales.reduce((a,s)=>a+s.sum,0)!==oldSales.reduce((a,s)=>a+s.sum,0))throw Error('Migration totals differ');
  fs.writeFileSync(path.resolve(__dirname,'migration.private.json'),JSON.stringify(state),{mode:0o600});
  console.log('Dry run verified: '+actual.sales.length+' sales; amounts preserved; no live changes.');return;
 }
 if(!process.argv.includes('--apply'))throw Error('Use --input=FILE for dry run, or --apply provision/migrate with owner ADC.');
 let credential;
 if(process.env.BM_USE_FIREBASE_LOGIN==='1'){
  const {configstore}=req('firebase-tools/lib/configstore'),cliAuth=req('firebase-tools/lib/auth');
  const refresh=configstore.get('tokens')?.refresh_token;if(!refresh)throw Error('Run firebase login first; never paste passwords into chat.');
  credential={getAccessToken:async()=>{const t=await cliAuth.getAccessToken(refresh,['https://www.googleapis.com/auth/cloud-platform','https://www.googleapis.com/auth/firebase','https://www.googleapis.com/auth/userinfo.email']);return {access_token:t.access_token,expires_in:Math.max(1,Math.floor((t.expires_at-Date.now())/1000))};}};
 }else credential=applicationDefault();initializeApp({projectId:'bm-avto',databaseURL:'https://bm-avto-default-rtdb.firebaseio.com',credential});
 const database=getDatabase();
 if(process.argv.includes('provision')){
  const emails=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../access.private.json'),'utf8'));
  for(const [profile,email]of Object.entries(emails)){
   if(!['boss','ilya','filip','artg','arts','vlad','felix'].includes(profile)||!/^\S+@\S+\.\S+$/.test(email))throw Error('Invalid access list');
   let user;try{user=await getAuth().getUserByEmail(email);}catch(e){if(e.code!=='auth/user-not-found')throw e;user=await getAuth().createUser({email,emailVerified:false});}
   if(user.disabled)throw Error('Disabled account; review manually');
   const ref=database.ref('spark/access/'+user.uid),prior=(await ref.get()).val();
   if(prior&&prior.profile!==profile)throw Error('Existing role mismatch; review manually');
   await ref.set({profile,enabled:true,email});console.log('Prepared '+profile+'; no password assigned and no message sent.');
  }
 }else if(process.argv.includes('migrate')){
  if(!process.argv.includes('--legacy-writes-locked')||!process.argv.includes('--owner-ready'))throw Error('Require locked legacy writes and tested owner login.');
  const token=await credential.getAccessToken();
  const response=await fetch('https://bm-avto-default-rtdb.firebaseio.com/.settings/rules.json',{headers:{Authorization:'Bearer '+token.access_token}});
  if(!response.ok)throw Error('Cannot verify active database rules');
  const rules=(await response.json()).rules;
  if(rules['.write']!==false||rules.dashboard?.['.write']!==false)throw Error('Legacy writes are not explicitly locked');
  const legacy=(await database.ref('dashboard').get()).val();if(!legacy?.sales)throw Error('No legacy source');
  const backup=path.resolve(__dirname,'../../../backups/dashboard-spark-cutover-'+Date.now()+'.json');fs.mkdirSync(path.dirname(backup),{recursive:true});fs.writeFileSync(backup,JSON.stringify(legacy),{mode:0o600});
  const next=convert(legacy);
  const result=await database.ref('spark').transaction(current=>current?.profiles?undefined:{...(current||{}),...next});
  if(!result.committed)throw Error('Spark already contains data; refusing overwrite');
  const {view,equal}=await import('./model.mjs');
  const actual=view((await database.ref('spark/profiles').get()).val());
  if(!equal(actual,view(next.profiles)))throw Error('Migration readback failed; keep writes locked and reconcile');
  console.log('Spark migration verified; legacy data retained.');
 }else throw Error('Choose provision or migrate');
}
if(require.main===module)main().then(()=>process.exit(0),e=>{console.error(e.message);process.exit(1);});
module.exports={convert};
