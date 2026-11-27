const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {randomUUID} = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../protection/legacy/index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\ninit\(\);\s*$/, '');
const copy = x => JSON.parse(JSON.stringify(x));
function server(initial = {sales: [], activity: [], plans: {}}) {
  let data = copy(initial), version = 0;
  return {
    get data() { return copy(data); },
    status: 0, dropResponse: false, conflicts: 0, writes: 0,
    async fetch(url, options = {}) {
      if (this.status) return {ok: false, status: this.status};
      if (options.method !== 'PUT') {
        const snapshot = copy(data), etag = String(version);
        return {ok: true, json: async () => snapshot, headers: {get: () => etag}};
      }
      if (options.headers['if-match'] !== String(version)) {
        this.conflicts++;
        return {ok: false, status: 412};
      }
      data = JSON.parse(options.body); version++; this.writes++;
      if (this.dropResponse) { this.dropResponse = false; throw Error('Connection lost'); }
      return {ok: true, status: 200};
    }
  };
}
function client(db, {realMetrics = false} = {}) {
  const elements = new Map(), alerts = [];
  const el = id => {
    if (!elements.has(id)) elements.set(id, {value: '', style: {}, classList: {add() {}, remove() {}}, focus() {}, select() {}, setAttribute() {}, removeAttribute() {}, textContent: ''});
    return elements.get(id);
  };
  const context = vm.createContext({fetch: db.fetch.bind(db), crypto: {randomUUID}, document: {getElementById: el, addEventListener() {}, querySelectorAll: () => []}, alert: x => alerts.push(x), confirm: () => true, setTimeout() {}, setInterval() {}, console});
  vm.runInContext(source, context);
  for (const name of ['renderMySales','renderMyMetrics','renderDayHistory','showReimburseDeals','renderBossMetrics','renderPlansForm','renderPlansProgress','renderBossRanking']) { if (realMetrics && name === 'renderMyMetrics') continue; vm.runInContext(`${name} = () => {}`, context); }
  return {run: code => vm.runInContext(code, context), el, alerts};
}
const sale = {mgr: 'ilya', client: 'Original', ts: 1, company: 'КТ'};

test('simultaneous additions retry CAS and preserve both sales and unrelated data', async () => {
  const db = server({sales: [sale], activity: [{mgr:'filip', date:'2026-11-27'}], plans: {a:{margin:50}}});
  const a = client(db), b = client(db);
  const results = await Promise.all([a.run("saveDB(d => d.sales.unshift({id:'a'}))"), b.run("saveDB(d => d.sales.unshift({id:'b'}))")]);
  assert.deepEqual(results, [true, true]);
  assert.equal(db.conflicts, 1);
  assert.equal(db.data.sales.length, 3);
  assert.equal(db.data.activity[0].mgr, 'filip');
  assert.equal(db.data.plans.a.margin, 50);
});
test('editing survives array reordering and refuses a concurrent edit of the same record', async () => {
  const db = server({sales:[sale], activity:[], plans:{}}), a = client(db), b = client(db);
  a.run(`before = ${JSON.stringify(sale)}`); b.run(`before = ${JSON.stringify(sale)}`);
  await b.run("saveDB(d => d.sales.unshift({id:'new'}))");
  assert.equal(await a.run("saveDB(d => replaceSale(d, before, {...before, client:'Changed'}))"), true);
  assert.equal(db.data.sales[0].id, 'new');
  assert.equal(db.data.sales[1].client, 'Changed');
  assert.equal(await b.run("saveDB(d => replaceSale(d, before, {...before, client:'Stale'}))"), false);
  assert.equal(db.data.sales[1].client, 'Changed');
});
test('different daily reports coexist; a stale report cannot overwrite the same day', async () => {
  const db = server(), a = client(db), b = client(db);
  for (const [c,id] of [[a,'ilya'],[b,'filip']]) { c.run(`currentUser='${id}'`); c.el('d-newc').value='5'; }
  await Promise.all([a.run('saveDay()'),b.run('saveDay()')]);
  assert.equal(db.data.activity.length,2);
  const stale = client(db); stale.run("currentUser='ilya'"); stale.el('d-newc').value='99';
  await stale.run('saveDay()');
  assert.equal(db.data.activity.find(x => x.mgr==='ilya').newc,5);
  assert.equal(stale.el('d-newc').value,'99');
});
test('only dirty plan fields change and stale edits are rejected', async () => {
  const db=server(), a=client(db), b=client(db);
  for (const c of [a,b]) c.run("currentMonth=()=> '2026-11'");
  a.el('plan-margin-ilya').value='100'; b.el('plan-av-filip').value='200';
  await Promise.all([a.run('savePlans()'),b.run('savePlans()')]);
  assert.deepEqual(db.data.plans, {'ilya_2026-11': {margin:100}, 'filip_2026-11': {av:200}});
  assert.equal(db.data.plans['ilya_2026-11'].margin,100);
  assert.equal(db.data.plans['filip_2026-11'].av,200);
  const stale=client(db); stale.run("currentMonth=()=> '2026-11'"); stale.el('plan-margin-ilya').value='999';
  await stale.run('savePlans()');
  assert.equal(db.data.plans['ilya_2026-11'].margin,100);
});
test('HTTP failure preserves the form and does not display success', async () => {
  const db=server(), c=client(db); db.status=403;
  c.run("currentUser='ilya'"); c.el('s-client').value='Unsaved'; c.el('sale-ok').style.display='none';
  await c.run('saveSale()');
  assert.equal(c.el('s-client').value,'Unsaved');
  assert.equal(c.el('sale-ok').style.display,'none');
  assert.equal(db.writes,0); assert.equal(c.alerts.length,1);
});
test('a lost write response can be retried without creating a duplicate sale', async () => {
  const db=server(), c=client(db); db.dropResponse=true;
  c.run("currentUser='ilya'"); c.el('s-client').value='Retry';
  await c.run('saveSale()'); await c.run('saveSale()');
  assert.equal(db.data.sales.length,1);
  assert.equal(c.el('s-client').value,'');
});
test('polling started before a save cannot replace newer local data', async () => {
  const db=server(), c=client(db);
  const polling=c.run('loadDB()');
  const saving=c.run("saveDB(d => d.sales.push({id:'latest'}))");
  await Promise.all([polling,saving]);
  assert.equal(c.run('db.sales[0].id'),'latest');
});
test('sale handles preserve quotes and target the rendered record after polling', async () => {
  const db=server(), c=client(db);
  const original={...sale,client:`O'Brien "Buyer" <x>`};
  c.run(`original=${JSON.stringify(original)}`);
  const handle=c.run('saleHandle(original)');
  assert.equal(/["'<>]/.test(handle),false);
  c.run(`db.sales=[{id:'different'}]; openEditModal(${JSON.stringify(handle)})`);
  assert.equal(c.el('e-client').value,original.client);
});
test('loading legacy company names never triggers a migration write', async () => {
  const db=server({sales:[{...sale,company:'БМ'}],activity:[],plans:{}}), c=client(db);
  await c.run('loadDB()');
  assert.equal(c.run('db.sales[0].company'),'КТ'); assert.equal(db.writes,0);
});

test('boss login opens an in-page form, rejects incorrect PIN and accepts 2026', () => {
  const c=client(server());
  c.run("login = id => { currentUser=id; }; loginBoss()");
  assert.equal(c.el('boss-pin').value,'');
  c.el('boss-pin').value='0000'; c.run('submitBossLogin()');
  assert.equal(c.run('currentUser'),null);
  assert.equal(c.el('boss-login-error').style.display,'block');
  c.el('boss-pin').value='2026'; c.run('submitBossLogin()');
  assert.equal(c.run('currentUser'),'boss');
  assert.equal(c.el('boss-pin').value,'');
  assert.equal(c.alerts.length,0);
});
test('canceling boss login clears PIN and does not grant access', () => {
  const c=client(server());
  c.run('loginBoss()'); c.el('boss-pin').value='2026'; c.run('closeBossLogin()');
  assert.equal(c.run('currentUser'),null);
  assert.equal(c.el('boss-pin').value,'');
});

test('all manager totals use the current month regardless of the hidden boss filter', () => {
  const c=client(server(), {realMetrics:true});
  c.run(`today=()=> '2026-11-27'; db.sales=MANAGERS.flatMap(m=>[
    {mgr:m.id,status:'Закрыта',type:'Безнал',date:'2026-10-19',shipDate:'2026-11-24',sum:100,margin:30},
    {mgr:m.id,status:'Закрыта',type:'Безнал',date:'2026-07-01',shipDate:'2026-07-02',sum:900,margin:300},
    {mgr:m.id,status:'Закрыта',type:'АВ',date:'2026-11-01',sum:20,margin:20},
    {mgr:m.id,status:'В работе',type:'Безнал',date:'2026-11-01',sum:1000,margin:500}
  ]); db.activity=MANAGERS.flatMap(m=>[
    {mgr:m.id,date:'2026-11-10',newc:2,rep:1,book:4},
    {mgr:m.id,date:'2026-07-10',newc:90,rep:90,book:90}
  ]);`);
  for (const hiddenMonth of ['', '2026-07', '2026-11']) {
    c.el('month-filter').value=hiddenMonth;
    for (const id of ['ilya','filip','artg','arts','vlad','felix']) {
      c.run(`renderMyMetrics('${id}')`);
      const html=c.el('my-metrics').innerHTML;
      for (const [value,label] of [[1,'Продаж'],['₽100','Оборот'],['₽30','Маржа'],[3,'Контактов'],[4,'Бронирований'],['₽20','АВ']]) {
        assert.ok(html.includes(`<div class="m-v">${value}</div><div class="m-l">${label}</div>`),`${id}: ${label}, filter=${hiddenMonth}`);
      }
      assert.ok(html.includes('ноябрь 2026'));
    }
  }
});
test('boss calculations still respect the selected historical month', () => {
  const c=client(server());
  c.run(`db.sales=[{mgr:'arts',status:'Закрыта',type:'Безнал',date:'2026-07-01',sum:900,margin:300},{mgr:'arts',status:'Закрыта',type:'Безнал',date:'2026-11-01',sum:100,margin:30}];`);
  c.el('month-filter').value='2026-07';
  assert.equal(c.run("calcKpd('arts').rev"),900);
  c.el('month-filter').value='2026-11';
  assert.equal(c.run("calcKpd('arts').rev"),100);
});
test('manager totals advance to the new month when the calendar month changes', () => {
  const c=client(server(),{realMetrics:true});
  c.run(`today=()=> '2026-12-01'; db.sales=[{mgr:'arts',status:'Закрыта',type:'Безнал',date:'2026-11-27',sum:100,margin:30}]; renderMyMetrics('arts');`);
  assert.ok(c.el('my-metrics').innerHTML.includes('<div class="m-v">0</div><div class="m-l">Продаж</div>'));
  assert.ok(c.el('my-metrics').innerHTML.includes('декабрь 2026'));
});
