// === CONFIG ===
const ENDPOINT = "https://script.google.com/macros/s/AKfycbxktnVK58sdnk9dQxTkl4lzwxwRYAQgk6RlMwj1M77Xjb3ZKHJiSF32Yk70oR8cmdFj/exec"; // <-- PEGA TU NUEVA URL AQUÍ AL DEPLOYAR
const API_KEY  = "1234567890111213141516171819202122232425";

// === STATE ===
let state = {
  month: new Date().toISOString().slice(0, 7), // YYYY-MM
  categories: []
};

// === INIT ===
document.addEventListener("DOMContentLoaded", async () => {
  setupMonthPicker();
  document.getElementById("inpDate").value = new Date().toISOString().slice(0,10);
  
  // Load initial data
  await loadCategories();
  refresh();
});

// === CORE FUNCTIONS ===

async function refresh() {
  document.body.style.opacity = "0.7"; // Subtle loading feedback
  try {
    const [summaryData, movesData] = await Promise.all([
      fetchAPI("/summary", { month: state.month }),
      fetchAPI("/movements", { month: state.month })
    ]);
    
    renderHero(summaryData.summary);
    renderList(movesData.movements);
  } catch (e) {
    alert("Error de conexión: " + e.message);
  } finally {
    document.body.style.opacity = "1";
  }
}

async function submitTx() {
  const amt = document.getElementById("inpAmount").value;
  const cat = document.getElementById("inpCat").value;
  if(!amt || !cat) return alert("Faltan datos");

  const btn = document.querySelector(".btn-primary");
  const originalText = btn.innerText;
  btn.innerText = "Guardando...";

  try {
    const payload = {
      path: "/add",
      amount: amt,
      type: document.getElementById("inpType").value,
      raw_category: cat,
      note: document.getElementById("inpNote").value,
      date: document.getElementById("inpDate").value,
      accounting_month: calcAccountingMonth(document.getElementById("inpDate").value)
    };
    
    // Send via POST No-CORS (Blind fire for speed) or Proxy if you setup one.
    // Here using standard fetch text/plain to bypass CORS preflight issues with GAS
    await fetch(ENDPOINT, {
      method: "POST",
      body: JSON.stringify({ ...payload, api_key: API_KEY }),
      mode: "no-cors" // We assume success to be snappy
    });

    // Optimistic Update? Or just wait. Let's wait for reliability first.
    // For no-cors we can't read response, so we just wait a bit and refresh.
    await new Promise(r => setTimeout(r, 1000)); 
    
    closeModal();
    // Clear fields
    document.getElementById("inpAmount").value = "";
    document.getElementById("inpNote").value = "";
    
    refresh();

  } catch(e) {
    alert("Error: " + e.message);
  } finally {
    btn.innerText = originalText;
  }
}

async function loadCategories() {
  const res = await fetchAPI("/categories");
  state.categories = res.categories || [];
  const sel = document.getElementById("inpCat");
  sel.innerHTML = state.categories.map(c => `<option value="${c.raw}">${c.raw}</option>`).join("");
}

// === UTILS ===

// Generic fetch wrapper for GET (using JSONP if needed, but standard GET usually works if Web App is 'Anyone')
async function fetchAPI(path, params = {}) {
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({ ...params, path, api_key: API_KEY, _t: Date.now() });
  
  const res = await fetch(url);
  const data = await res.json();
  if(!data.ok && !data.summary && !data.movements) throw new Error(data.error || "API Error");
  return data;
}

function calcAccountingMonth(dateStr) {
  // Logic: If day > 10, next month. 
  // User wants this robust.
  const d = new Date(dateStr);
  const day = d.getDate();
  if (day >= 10) {
    d.setMonth(d.getMonth() + 1);
  }
  return d.toISOString().slice(0, 7); // YYYY-MM
}

function fmtMoney(n) {
  return Number(n).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

// === UI RENDERING ===

function renderHero(summary) {
  if (!summary) return;
  document.getElementById("lblIn").innerText = fmtMoney(summary.income);
  document.getElementById("lblOut").innerText = fmtMoney(summary.expense);
  document.getElementById("lblNet").innerText = fmtMoney(summary.forecast); // Using forecast (colchon) as main metric?
  
  // Dynamic color for balance
  const el = document.getElementById("lblNet");
  el.style.color = summary.forecast >= 0 ? "var(--success)" : "var(--danger)";
}

function renderList(list) {
  const box = document.getElementById("txList");
  if (!list || list.length === 0) {
    box.innerHTML = `<div style="padding:20px;text-align:center;color:#666">Sin movimientos este mes.</div>`;
    return;
  }

  box.innerHTML = list.map(m => {
    const isIngreso = m.type === "Ingreso";
    const colorClass = isIngreso ? "text-green" : "";
    const sign = isIngreso ? "+" : "";
    
    return `
    <div class="row">
      <div class="row-left">
        <div class="row-cat">${m.raw_category}</div>
        <div class="row-note">${m.note || m.date}</div>
      </div>
      <div class="row-right">
        <div class="row-amount ${colorClass}">${sign}${fmtMoney(m.amount)}</div>
        <div class="row-date">${m.accounting_month}</div>
      </div>
    </div>`;
  }).join("");
}

function setupMonthPicker() {
  const sel = document.getElementById("monthPicker");
  const now = new Date();
  // Generate range: -3 months to +3 months
  for (let i = -3; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const val = d.toISOString().slice(0, 7);
    const opt = document.createElement("option");
    opt.value = val;
    opt.text = val; // Or format "Ene 2026"
    if (val === state.month) opt.selected = true;
    sel.appendChild(opt);
  }
  
  sel.addEventListener("change", (e) => {
    state.month = e.target.value;
    refresh();
  });
}

function openModal() { document.getElementById("addModal").classList.add("open"); }
function closeModal() { document.getElementById("addModal").classList.remove("open"); }
