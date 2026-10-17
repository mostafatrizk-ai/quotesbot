"""لوحة تحكم Admin بسيطة (HTML + fetch على REST API)."""
from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter()

PAGE = """<!doctype html><html dir="rtl"><head><meta charset="utf-8">
<title>WhatsApp Outreach — Admin</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
 body{font-family:Segoe UI,Tahoma,sans-serif;background:#f4f6f8;margin:0}
 header{background:#25D366;color:#fff;padding:14px 20px;font-size:20px;font-weight:bold}
 main{max-width:980px;margin:20px auto;padding:0 12px}
 .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
 .card{background:#fff;border-radius:10px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.12)}
 .card h3{margin:0;font-size:13px;color:#667} .card .num{font-size:26px;font-weight:700}
 table{width:100%;border-collapse:collapse;background:#fff;margin-top:14px;border-radius:8px;overflow:hidden}
 th,td{padding:8px 10px;border-bottom:1px solid #eee;font-size:14px;text-align:right}
 th{background:#eef7f1} button{background:#25D366;border:0;color:#fff;padding:8px 14px;border-radius:6px;cursor:pointer}
 input,textarea{width:100%;padding:8px;margin:4px 0;border:1px solid #ccc;border-radius:6px;box-sizing:border-box}
 section{background:#fff;border-radius:10px;padding:14px;margin-top:16px;box-shadow:0 1px 3px rgba(0,0,0,.12)}
</style></head><body>
<header>📡 WhatsApp Outreach System — لوحة التحكم</header>
<main>
 <div class="cards" id="stats"></div>
 <section><b>API Key:</b> <input type="password" id="apikey" placeholder="ضع مفتاح API هنا" style="max-width:300px;display:inline-block">
 <button onclick="refreshAll()">تحديث</button></section>
 <section><h2>الحملات</h2><table id="campaigns"><tr><th>#</th><th>الاسم</th><th>الحالة</th><th>إجمالي</th><th>تم</th><th>فشل</th><th>إجراء</th></tr></table></section>
 <section><h2>الرسائل الواردة (Inbox)</h2><table id="inbox"><tr><th>#</th><th>الرقم</th><th>الرسالة</th><th>قراءة</th></tr></table></section>
 <section><h2>إنشاء حملة سريعة</h2>
  <input id="c_name" placeholder="اسم الحملة"><input id="c_tpl" type="number" placeholder="Template ID">
  <input id="c_contacts" placeholder="Contact IDs مفصولة بفواصل، مثل 1,2,3">
  <button onclick="createCampaign()">إنشاء وبدء</button><div id="msg"></div></section>
 <section><h2>إنشاء قالب</h2>
  <input id="t_name" placeholder="اسم القالب"><textarea id="t_body" rows="3" placeholder="مرحبا {{name}}! عرضنا اليوم..."></textarea>
  <button onclick="createTemplate()">حفظ القالب</button></section>
</main>
<script>
const K=()=>document.getElementById('apikey').value;
const H=()=>({'X-API-Key':K(),'Content-Type':'application/json'});
async function j(u,o){const r=await fetch(u,o);return r.json();}
async function refreshAll(){
 const s=await j('/api/v1/stats');
 document.getElementById('stats').innerHTML=`
  <div class="card"><h3>جهات الاتصال</h3><div class="num">${s.contacts}</div></div>
  <div class="card"><h3>الحملات</h3><div class="num">${s.campaigns}</div></div>
  <div class="card"><h3>تم إرسالها</h3><div class="num">${(s.messages_by_status||{}).sent||0}</div></div>
  <div class="card"><h3>تم التسليم</h3><div class="num">${(s.messages_by_status||{}).delivered||0}</div></div>
  <div class="card"><h3>فشل</h3><div class="num">${(s.messages_by_status||{}).failed||0}</div></div>
  <div class="card"><h3>ردود غير مقروءة</h3><div class="num">${s.unread_inbox}</div></div>`;
 const cs=await j('/api/v1/campaigns');
 document.getElementById('campaigns').innerHTML='<tr><th>#</th><th>الاسم</th><th>الحالة</th><th>إجمالي</th><th>تم</th><th>فشل</th><th>إجراء</th></tr>'+
  cs.map(c=>`<tr><td>${c.id}</td><td>${c.name}</td><td>${c.status}</td><td>${c.total}</td><td>${c.sent}</td><td>${c.failed}</td>
   <td><button onclick="startC(${c.id})">بدء</button> <button onclick="pauseC(${c.id})">إيقاف مؤقت</button></td></tr>`).join('');
 const ib=await j('/api/v1/inbox');
 document.getElementById('inbox').innerHTML='<tr><th>#</th><th>الرقم</th><th>الرسالة</th><th>قراءة</th></tr>'+
  ib.map(i=>`<tr><td>${i.id}</td><td>${i.phone}</td><td>${i.text}</td><td>${i.read?'✅':'⬜'}</td></tr>`).join('');
}
async function startC(id){await j(`/api/v1/campaigns/${id}/start`,{method:'POST',headers:H()});refreshAll();}
async function pauseC(id){await j(`/api/v1/campaigns/${id}/pause`,{method:'POST',headers:H()});refreshAll();}
async function createCampaign(){
 const ids=document.getElementById('c_contacts').value.split(',').map(x=>+x).filter(Boolean);
 const r=await j('/api/v1/campaigns',{method:'POST',headers:H(),body:JSON.stringify({name:c_name.value,template_id:+c_tpl.value,contact_ids:ids})});
 msg.textContent=JSON.stringify(r); setTimeout(refreshAll,800);
}
async function createTemplate(){
 const r=await j('/api/v1/templates',{method:'POST',headers:H(),body:JSON.stringify({name:t_name.value,body:t_body.value})});
 msg.textContent=JSON.stringify(r);
}
refreshAll(); setInterval(refreshAll,5000);
</script></body></html>"""

@router.get("/", response_class=HTMLResponse)
def dashboard():
    return PAGE
