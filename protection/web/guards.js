// Authenticated profile is the only source of ownership. Drafts stay in this browser session.
(() => {
  const fields = () => [...document.querySelectorAll('#t-sales input, #t-sales select, #t-sales textarea, #t-day input, #t-day textarea')];
  const key = profile => 'bm-draft-v2:'+profile;
  const reset = () => {
    for(const el of fields()) {
      if(el.tagName==='SELECT')el.selectedIndex=0;
      else if(el.type==='checkbox')el.checked=false;
      else el.value='';
    }
  };
  let dirty=false;
  window.bmDrafts={
    beforeChange(){if(currentUser && currentUser!=='boss')this.persist();reset();dirty=false;},
    persist(){
      if(!currentUser || currentUser==='boss')return;
      const values=Object.fromEntries(fields().map(el=>[el.id,el.type==='checkbox'?el.checked:el.value]));
      try{sessionStorage.setItem(key(currentUser),JSON.stringify({values,day:today()}));}catch{}
    },
    restore(profile){
      try{
        const draft=JSON.parse(sessionStorage.getItem(key(profile))||'null');
        if(!draft)return;
        for(const el of fields()) {
          if(el.id.startsWith('d-') && draft.day!==today())continue;
          if(Object.prototype.hasOwnProperty.call(draft.values,el.id))el.value=draft.values[el.id];
        }
      }catch{}
    },
    clearSaved(prefix){
      try{
        const draft=JSON.parse(sessionStorage.getItem(key(currentUser))||'null');
        if(draft){for(const name of Object.keys(draft.values))if(name.startsWith(prefix))delete draft.values[name];sessionStorage.setItem(key(currentUser),JSON.stringify(draft));}
      }catch{}
    },
    isDirty:()=>dirty,
    resetDirty:()=>{dirty=false;}
  };
  document.addEventListener('input',event=>{
    if(event.target.closest('#edit-modal'))dirty=true;
    if(event.target.closest('#t-sales, #t-day'))window.bmDrafts.persist();
  });
  document.addEventListener('change',event=>{if(event.target.closest('#t-sales, #t-day'))window.bmDrafts.persist();});
  window.addEventListener('beforeunload',event=>{
    window.bmDrafts.persist();
    if(dirty||saving){event.preventDefault();event.returnValue='';}
  });
})();
