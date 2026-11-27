const {createHash}=require('node:crypto');
const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
function migrate(legacy){
 const data=JSON.parse(JSON.stringify(legacy||{}));
 data.sales=(data.sales||[]).filter(Boolean).map((sale,i)=>({...sale,id:sale.id||'legacy_'+createHash('sha256').update(stable([i,sale])).digest('hex').slice(0,32),stockNo:sale.stockNo||'BM-'+String(i+1).padStart(5,'0')}));
 data.activity=(data.activity||[]).filter(Boolean);data.plans||={};return {data};
}
module.exports={migrate};
