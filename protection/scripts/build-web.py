from pathlib import Path
import re
import sys
import shutil
import hashlib
root=Path(__file__).resolve().parents[2]
if '--spark' in sys.argv:
 modules={name:(root/'protection/spark'/name).read_text() for name in ['auth.js','store.mjs','model.mjs']}
 pattern=r"from '(\./(?:store\.mjs|model\.mjs|config\.js))(?:\?v=[^']*)?'"
 canonical={name:re.sub(pattern,r"from '\1'",text) for name,text in modules.items()}
 revision=hashlib.sha256(''.join(canonical.values()).encode()).hexdigest()[:12]
 for name,text in canonical.items():
  stamped=re.sub(pattern,lambda m:"from '"+m.group(1)+"?v="+revision+"'",text)
  (root/'protection/spark'/name).write_text(stamped)
  (root/name).write_text(stamped)

template=root/'protection/legacy/index.html'
s=(template if template.exists() else root/'index.html').read_text()
s=s.replace('<div style="font-size:12px;color:#666">Выберите свой профиль</div>','<div id="login-subtitle" style="font-size:12px;color:#666">Выберите свой профиль</div>')
s=s.replace('</style>','.metric-drilldown{width:100%;border:0;font:inherit;color:inherit;cursor:pointer}.metric-drilldown .m-l::after{content:" ↗";color:#888;font-size:11px}.metric-drilldown:hover{background:#edf2ff}.metric-drilldown:focus-visible{outline:2px solid #185FA5;outline-offset:2px}</style>')
s=s.replace('.topbar{display:flex;', '.topbar{display:flex;flex-wrap:wrap;')
# Code-native fleet illustration and visual identity; no business logic changes.
hero=(root/'protection/web/brand-hero.html').read_text().replace('<!-- BM_FLEET -->',(root/'protection/web/fleet.svg').read_text())
start=s.index('  <div style="text-align:center;padding:20px 0 16px">',s.index('<div id="s-login"'))
end=s.index('  <div class="login-wrap"',start)
s=s[:start]+hero+'\n'+s[end:]
masthead='<header class="bm-masthead"><div class="bm-mark" aria-label="BM">BM</div><div class="bm-wordmark">Продажи техники<small>Самосвалы · Тягачи · Полуприцепы</small></div><div class="bm-masthead-note">РАБОЧЕЕ ПРОСТРАНСТВО КОМАНДЫ</div></header>'
s=s.replace('<div class="app" id="app">',masthead+'\n<div class="app" id="app">',1)
s=s.replace('</style>',(root/'protection/web/industrial-theme.css').read_text()+'\n</style>',1)
s=s.replace('<button class="btn" onclick="logout()"', '<button class="btn" onclick="goStartScreen()" style="padding:5px 10px;font-size:11px">Профили</button>\n    <button class="btn" onclick="logout()"')
s=re.sub(r"const DB_URL = .*?;\n",'',s)
s=re.sub(r"const BOSS_PIN = .*?\n",'',s)
# Remove direct database traffic; the secure bridge supplies authenticated functions.
a=s.index('async function loadDB()');b=s.index('\nfunction setSyncDot',a)
s=s[:a]+'let loadDB = async () => false;\nlet saveDB = async () => false;\n'+s[b:]
a=s.index('function submitBossLogin()');b=s.index('\nfunction logout()',a)
s=s[:a]+"function submitBossLogin() {}\n"+s[b:]
s=s.replace("    tech: document.getElementById('s-tech').value,", "    tech: document.getElementById('s-tech').value,\n    vin: document.getElementById('s-vin').value.trim().toUpperCase(),\n    stockNo: document.getElementById('s-stock-no').value.trim().toUpperCase(),")
s=s.replace("    tech: document.getElementById('e-tech').value,", "    tech: document.getElementById('e-tech').value,\n    vin: document.getElementById('e-vin').value.trim().toUpperCase(),\n    stockNo: document.getElementById('e-stock-no').value.trim().toUpperCase(),")
for prefix in ['s','e']:
 marker='<div class="fl span2"><label>Техника</label>' if prefix=='e' else '<div class="fl span2"><label>Техника</label>'
 # Insert immediately before the actual technique input's wrapping div.
 tag=re.search(r'<div class="fl span2"><label>Техника[^<]*</label><input[^>]+id="'+prefix+'-tech"[^>]*></div>',s)
 assert tag,prefix
 fields='<div class="fl"><label for="'+prefix+'-vin">VIN</label><input id="'+prefix+'-vin" maxlength="17" placeholder="17 символов"></div><div class="fl"><label for="'+prefix+'-stock-no">Внутренний номер машины</label><input id="'+prefix+'-stock-no" maxlength="80" placeholder="Укажите, если VIN неизвестен"></div>'
 s=s[:tag.start()]+fields+s[tag.start():]
s=s.replace("  const ok = document.getElementById('sale-ok');", "  window.bmDrafts.clearSaved('s-');\n  document.getElementById('s-vin').value='';\n  document.getElementById('s-stock-no').value='';\n  const ok = document.getElementById('sale-ok');")
s=s.replace("  const ok = document.getElementById('day-ok');", "  window.bmDrafts.clearSaved('d-');\n  const ok = document.getElementById('day-ok');")
saved_edit='  editRecord = clone(db.sales.find(s => s.id === updated.id) || updated);'
assert saved_edit in s
s=s.replace(saved_edit,saved_edit+'\n  window.bmDrafts.resetDirty();')
s=s.replace('    <div class="topbar-title">Дашборд руководителя</div>','    <div class="topbar-title">Дашборд руководителя</div><button class="btn" onclick="showProtectionHistory()">История и корзина</button>')
s=s.replace('<span>Редактировать сделку</span>','<span>Редактировать сделку</span><button type="button" id="trash-current-sale" class="btn" onclick="trashCurrentSale()" hidden>В корзину</button>')
team_screen='<div id="s-team-finance" class="screen"><div class="topbar"><div class="topbar-title">Обзор команды</div><span class="badge bb">Только просмотр</span><button class="btn" onclick="chooseProfile(secureAuth.getIdentity()?.profile)">Мой кабинет</button><button class="btn" onclick="goStartScreen()">Профили</button></div><div class="card"><label for="team-finance-month">Период: </label><select id="team-finance-month" onchange="renderTeamFinance()" style="max-width:250px"></select></div><div class="card"><label for="team-finance-manager">Менеджер: </label><select id="team-finance-manager" onchange="renderTeamFinance()" style="max-width:250px"><option value="">Все менеджеры</option></select></div><div id="team-finance-content"></div></div>'
s=s.replace('<div id="s-boss" class="screen">',team_screen+'\n<div id="s-boss" class="screen">')
s=s.replace("<button class=\"nav-btn\" onclick=\"mgrTab('clients',this)\">", "<button class=\"nav-btn\" onclick=\"openTeamFinance()\">Обзор команды</button><button class=\"nav-btn\" onclick=\"mgrTab('clients',this)\">")
s=s.replace('<script>','''<div id="protection-message" role="status" hidden style="position:fixed;bottom:12px;left:12px;right:12px;background:#fff3d6;padding:12px;border:1px solid #d69b16;z-index:2000" onclick="this.hidden=true"></div>
<div class="modal-overlay" id="protection-history"><div class="modal" style="max-width:900px"><div class="modal-title"><span>История изменений и корзина</span><button class="modal-close" onclick="document.getElementById('protection-history').classList.remove('on')">×</button></div><div id="protection-history-content"></div></div></div>
<div class="modal-overlay" id="manager-metric-modal" onclick="if(event.target===this)closeManagerMetric()" onkeydown="if(event.key==='Escape')closeManagerMetric()"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="manager-metric-title" style="max-width:920px"><div class="modal-title"><span id="manager-metric-title"></span><button type="button" id="manager-metric-close" class="modal-close" aria-label="Закрыть расшифровку" onclick="closeManagerMetric()">×</button></div><div id="manager-metric-content"></div></div></div>
<script>''',1)
# Append to the same classic script so lexical db/currentUser stay shared.
marker='\ninit();\n</script>'
assert marker in s
extra=(root/'protection/web/guards.js').read_text()+'\n'+(root/'protection/web/bridge.js').read_text()+'\n'+(root/'protection/web/drilldowns.js').read_text()+'\n'+(root/'protection/web/team-finance.js').read_text()
s=s.replace(marker,'\n'+extra+marker)
# No legacy network endpoint or PIN bypass in this build.
assert 'fetch(DB_URL' not in s and 'BOSS_PIN' not in s
output=root/'protection/spark' if '--spark' in sys.argv else root/'protection/web'
if '--spark' in sys.argv:
 revision=hashlib.sha256((root/'protection/spark/auth.js').read_bytes()).hexdigest()[:12]
 s=s.replace("await import('./auth.js')","await import('./auth.js?v="+revision+"')")
 s=s.replace('<button class="btn" onclick="showProtectionHistory()">История и корзина</button>','<button class="btn" onclick="showProtectionHistory()">История и корзина</button><button class="btn" onclick="secureAuth.downloadBackup().catch(e=>showProtectionMessage(e.message))">Скачать резервную копию</button>')
(output/'index.html').write_text(s)
print('Generated protected web/index.html')
