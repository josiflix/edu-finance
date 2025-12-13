// EduFinance Pocket - Frontend (GitHub Pages)
// Lecturas por JSONP (sin CORS). Escrituras por POST no-cors.

const BACKEND_URL = "https://script.google.com/macros/s/AKfycbxMxHKEDAKeKZMn2yBfxldjerWxok0H9cOq7zOemqQQdS-lEW1opbtCqUWLeGrIZ5Ih/exec";
const API_KEY     = "1234567890111213141516171819202122232425";

const $ = (id) => document.getElementById(id);
const fmtEUR = (n) => (Number(n)||0).toLocaleString("es-ES",{style:"currency",currency:"EUR"});
const todayISO = () => new Date().toISOString().slice(0,10);
const monthOf = (isoDate) => String(isoDate || "").slice(0,7);

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function setStatus(msg, kind=""){
  const el = $("status");
  if (!el) return;
  el.textContent = msg;
  el.className = "status " + kind;
}

function updateOfflineCount(){
  const el = $("offlineCount");
  if (!el) return;
  el.textContent = String(getQueue().length);
}

// ---------- JSONP (READS) ----------
function jsonp(path, params = {}){
  return new Promise((resolve, reject) => {
    const cbName = "__edf_cb_" + Math.random().toString(16).slice(2);
    const qs = new URLSearchParams({
      api_key: API_KEY,
      path,
      callback: cbName,
      ...params,
    });

    const script = document.createElement("script");
    script.src = `${BACKEND_URL}?${qs.toString()}`;
    script.async = true;

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout JSONP"));
    }, 15000);

    function cleanup(){
      clearTimeout(timer);
      if (script.parentNode) script.parentNode.removeChild(script);
      try { delete window[cbName]; } catch { window[cbName] = undefined; }
    }

    window[cbName] = (data) => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("JSONP load error"));
    };

    document.body.appendChild(script);
  });
}

// ---------- WRITES (POST no-cors) ----------
async function postNoCors(payload){
  // mode:no-cors => no podemos leer respuesta, pero la petición se envía.
  await fetch(BACKEND_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...payload, api_key: API_KEY }),
  });
}

// ---------- Offline queue ----------
const OFFLINE_KEY = "eduf_offline_queue_v1";

function getQueue(){
  try { return JSON.parse(localStorage.getItem(OFFLINE_KEY) || "[]"); }
  catch { return []; }
}
function setQueue(q){
  localStorage.setItem(OFFLINE_KEY, JSON.stringify(q || []));
  updateOfflineCount();
}
function enqueue(item){
  const q = getQueue();
  q.push({ ...item, queued_at: Date.now() });
  setQueue(q);
}
function clearQueue(){
  setQueue([]);
}

// ---------- State ----------
let settings = {};
let categories = [];
let activeMonth = "";

// ---------- Month logic ----------
function calcAccountingMonth(dateISO){
  const daySwitch = Number(settings?.contable_day_switch || 10);
  const isContable = $("contableToggle")?.checked ?? false;
  if (!isContable) return monthOf(dateISO);

  const d = new Date(dateISO + "T00:00:00");
  const day = d.getDate();
  if (day >= daySwitch){
    const nm = new Date(d.getFullYear(), d.getMonth()+1, 1);
    return `${nm.getFullYear()}-${String(nm.getMonth()+1).padStart(2,"0")}`;
  }
  return monthOf(dateISO);
}

function buildMonthOptions(){
  const sel = $("monthSelect");
  if (!sel) return;

  const now = new Date();
  const months = [];
  for (let d=-6; d<=12; d++){
    const tmp = new Date(now.getFullYear(), now.getMonth()+d, 1);
    months.push(`${tmp.getFullYear()}-${String(tmp.getMonth()+1).padStart(2,"0")}`);
  }

  sel.innerHTML = months.map(m => `<option value="${m}">${m}</option>`).join("");
  const def = calcAccountingMonth(todayISO());
  activeMonth = def;
  sel.value = def;
}

function setDefaultDate(){
  const dateEl = $("date");
  if (dateEl) dateEl.value = todayISO();
}

// ---------- Render ----------
function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function renderCategories(){
  const sel = $("category");
  if (!sel) return;
  sel.innerHTML = `<option value="">Selecciona…</option>` +
    categories.map(c => `<option value="${escapeHtml(c.raw)}">${escapeHtml(c.raw)}</option>`).join("");
}

function renderSummary(summary){
  if ($("kpiIn")) $("kpiIn").textContent = fmtEUR(summary.ingresos);
  if ($("kpiOut")) $("kpiOut").textContent = fmtEUR(summary.gastos);
  if ($("kpiNet")) $("kpiNet").textContent = fmtEUR(summary.neto);
  if ($("kpiGoal")) $("kpiGoal").textContent = `${fmtEUR(summary.colchon_est)} / ${fmtEUR(summary.goal_base)}`;

  const bucketsEl = $("buckets");
  const byBucket = summary.byBucket || {};
  const entries = Object.entries(byBucket).sort((a,b)=>b[1]-a[1]);

  if (bucketsEl){
    bucketsEl.innerHTML = entries.length
      ? entries.map(([bucket, amt]) => `
          <div class="bucket">
            <div>
              <b>${escapeHtml(bucket)}</b>
              <div class="meta">Gasto</div>
            </div>
            <div><b>${fmtEUR(amt)}</b></div>
          </div>
        `).join("")
      : `<div class="meta">Sin datos de gasto por bucket.</div>`;
  }
}

function renderMovements(items){
  const wrap = $("movList");
  if (!wrap) return;

  if (!items || items.length === 0){
    wrap.innerHTML = `<div class="meta">No hay movimientos en ${escapeHtml(activeMonth)}.</div>`;
    return;
  }

  wrap.innerHTML = items.map(m => {
    const isIncome = String(m.type||"").toLowerCase() === "ingreso";
    const sign = isIncome ? "+" : "-";
    return `
      <div class="mov">
        <div>
          <div><b>${escapeHtml(m.date)}</b></div>
          <div class="meta">${escapeHtml(m.accounting_month)}</div>
        </div>
        <div>
          <div><b>${escapeHtml(m.raw_category)}</b></div>
          <div class="meta">${escapeHtml(m.note||"")}</div>
        </div>
        <div class="amt">${sign}${fmtEUR(m.amount)}</div>
        <div class="actions">
          <button class="btn ghost" data-del="${escapeHtml(m.id)}">Borrar</button>
        </div>
      </div>
    `;
  }).join("");

  wrap.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del");
      if (!id) return;
      if (!confirm("¿Borrar este movimiento?")) return;
      try{
        if (navigator.onLine){
          await postNoCors({ path:"/delete", id });
          await sleep(700);
          await refreshAll();
          setStatus("Borrado ✅","ok");
        } else {
          enqueue({ op:"delete", payload:{ id } });
          setStatus("Guardado offline (se borrará al sincronizar) ✅","ok");
        }
      } catch(e){
        console.error(e);
        setStatus("Error borrando.","err");
      }
    });
  });
}

// ---------- Data flow ----------
async function loadBoot(){
  setStatus("Conectando…");

  const s = await jsonp("/settings");
  if (!s?.ok) throw new Error(s?.error || "Settings error");
  settings = s.settings || {};

  const c = await jsonp("/categories");
  if (!c?.ok) throw new Error(c?.error || "Categories error");
  categories = c.categories || [];

  buildMonthOptions();
  renderCategories();
  setDefaultDate();
  updateOfflineCount();

  await refreshAll();
  setStatus("Listo ✅", "ok");
}

async function refreshAll(){
  const sel = $("monthSelect");
  if (sel) activeMonth = sel.value;

  setStatus("Actualizando…");

  const sumRes = await jsonp("/summary", { month: activeMonth });
  if (!sumRes?.ok) throw new Error(sumRes?.error || "Summary error");

  const movRes = await jsonp("/movements", { month: activeMonth });
  if (!movRes?.ok) throw new Error(movRes?.error || "Movements error");

  renderSummary(sumRes.summary);
  renderMovements(movRes.movements);

  setStatus("Listo ✅", "ok");
}

// ---------- Actions ----------
async function onAdd(){
  try{
    const amountStr = String($("amount")?.value || "").replace(",", ".");
    const amount = Number(amountStr);
    const type = $("type")?.value || "Gasto";
    const raw_category = $("category")?.value || "";
    const date = $("date")?.value || todayISO();
    const note = $("note")?.value || "";

    if (!raw_category) return setStatus("Selecciona una categoría.","err");
    if (!amount || isNaN(amount)) return setStatus("Importe inválido.","err");

    const accounting_month = calcAccountingMonth(date);
    const payload = { path:"/add", amount, type, raw_category, date, accounting_month, note };

    if (navigator.onLine){
      await postNoCors(payload);
      await sleep(800);
      await refreshAll();
      setStatus("Añadido ✅","ok");
    } else {
      enqueue({ op:"add", payload });
      setStatus("Sin conexión: guardado offline ✅","ok");
    }

    if ($("amount")) $("amount").value = "";
    if ($("note")) $("note").value = "";
  } catch(e){
    console.error(e);
    setStatus("Error al añadir.","err");
  }
}

async function syncOffline(){
  const q = getQueue();
  if (!q.length) return setStatus("No hay pendientes ✅","ok");
  if (!navigator.onLine) return setStatus("Sin conexión.","err");

  try{
    setStatus(`Sincronizando ${q.length}…`);
    for (const item of q){
      if (item.op === "add") await postNoCors(item.payload);
      if (item.op === "delete") await postNoCors({ path:"/delete", id: item.payload.id });
      await sleep(250);
    }
    clearQueue();
    await sleep(800);
    await refreshAll();
    setStatus("Sincronizado ✅","ok");
  } catch(e){
    console.error(e);
    setStatus("Error sincronizando.","err");
  }
}

function clearOffline(){
  if (!confirm("¿Vaciar cola offline?")) return;
  clearQueue();
  setStatus("Cola offline vaciada ✅","ok");
}

function exportCSV(){
  jsonp("/movements", { month: activeMonth })
    .then(res => {
      if (!res?.ok) throw new Error(res?.error || "Export error");
      const rows = res.movements || [];
      const header = ["id","date","accounting_month","type","raw_category","amount","note","created_at"];
      const csv = [
        header.join(","),
        ...rows.map(r => header.map(k => csvCell(r[k])).join(","))
      ].join("\n");

      const blob = new Blob([csv], { type:"text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `edufinance_${activeMonth}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    })
    .catch(e => {
      console.error(e);
      setStatus("No se pudo exportar CSV.","err");
    });
}
function csvCell(v){
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replaceAll('"','""')}"`;
  return s;
}

// ---------- Wire UI ----------
function wire(){
  $("addBtn")?.addEventListener("click", onAdd);
  $("syncBtn")?.addEventListener("click", syncOffline);
  $("refreshBtn")?.addEventListener("click", refreshAll);
  $("exportBtn")?.addEventListener("click", exportCSV);
  $("clearOfflineBtn")?.addEventListener("click", clearOffline);

  $("monthSelect")?.addEventListener("change", refreshAll);
  $("contableToggle")?.addEventListener("change", () => {
    buildMonthOptions();
    refreshAll();
  });

  // Quick + buttons: data-add="10"/"20" in your HTML
  document.querySelectorAll("[data-add]").forEach(btn => {
    btn.addEventListener("click", () => {
      const delta = Number(btn.getAttribute("data-add") || 0);
      const a = $("amount");
      if (!a) return;
      const cur = Number(String(a.value || "0").replace(",", ".") || 0);
      a.value = (cur + delta).toFixed(2);
    });
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  try{
    wire();
    await loadBoot();
  } catch(e){
    console.error(e);
    setStatus("No carga datos: revisa (1) Web App = Anyone (2) Sheets: pestañas y headers (3) Active? = YES", "err");
  }
});
