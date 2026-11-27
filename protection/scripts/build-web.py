from pathlib import Path
import re
import sys
import shutil
root=Path(__file__).resolve().parents[2]
s=(root/'index.html').read_text()
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
s=s.replace('  editRecord = clone(updated);','  editRecord = clone(updated);\n  window.bmDrafts.resetDirty();')
s=s.replace('    <div class="topbar-title">Дашборд руководителя</div>','    <div class="topbar-title">Дашборд руководителя</div><button class="btn" onclick="showProtectionHistory()">История и корзина</button>')
s=s.replace('<span>Редактировать сделку</span>','<span>Редактировать сделку</span><button type="button" id="trash-current-sale" class="btn" onclick="trashCurrentSale()" hidden>В корзину</button>')
s=s.replace('<script>','''<div id="protection-message" role="status" hidden style="position:fixed;bottom:12px;left:12px;right:12px;background:#fff3d6;padding:12px;border:1px solid #d69b16;z-index:2000" onclick="this.hidden=true"></div>
<div class="modal-overlay" id="protection-history"><div class="modal" style="max-width:900px"><div class="modal-title"><span>История изменений и корзина</span><button class="modal-close" onclick="document.getElementById('protection-history').classList.remove('on')">×</button></div><div id="protection-history-content"></div></div></div>
<script>''',1)
# Append to the same classic script so lexical db/currentUser stay shared.
marker='\ninit();\n</script>'
assert marker in s
extra=(root/'protection/web/guards.js').read_text()+'\n'+(root/'protection/web/bridge.js').read_text()
s=s.replace(marker,'\n'+extra+marker)
# No legacy network endpoint or PIN bypass in this build.
assert 'fetch(DB_URL' not in s and 'BOSS_PIN' not in s
output=root/'protection/spark' if '--spark' in sys.argv else root/'protection/web'
if '--spark' in sys.argv:
 s=s.replace('<button class="btn" onclick="showProtectionHistory()">История и корзина</button>','<button class="btn" onclick="showProtectionHistory()">История и корзина</button><button class="btn" onclick="secureAuth.downloadBackup().catch(e=>showProtectionMessage(e.message))">Скачать резервную копию</button>')
(output/'index.html').write_text(s)
print('Generated protected web/index.html')
