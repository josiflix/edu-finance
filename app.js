// === CONFIG ===
// ⚠️ IMPORTANTE: Asegúrate de que esta URL es la de tu ÚLTIMA implementación (Versión Nueva)
const ENDPOINT = "https://script.google.com/macros/s/AKfycbxktnVK58sdnk9dQxTkl4lzwxwRYAQgk6RlMwj1M77Xjb3ZKHJiSF32Yk70oR8cmdFj/exec"; 
const API_KEY  = "1234567890111213141516171819202122232425";

// === STATE ===
let state = {
  month: new Date().toISOString().slice(0, 7), // YYYY-MM
  categories: []
};

// === INIT ===
document.addEventListener("DOMContentLoaded", async () => {
  setupMonthPicker();
  
  // Set default date to today
  const today = new Date().toISOString().slice(0,10);
  document.getElementById("inpDate").value = today;
  
  try {
    await loadCategories();
    refresh();
  } catch(e) {
    document.getElementById("txList").innerHTML = 
      `<div style="padding:20px; text-align:center; color:#ff453a;">${e.message}</div>`;
  }
});

// === CORE FUNCTIONS ===

async function refresh() {
  const container = document.getElementById("txList");
  // Don't wipe list if we already have one, just update opacity
  if(container.children.length > 1) container.style.opacity = "0.5";
  
  try {
    // Parallel fetch for speed
    const [summaryRes, movesRes] = await Promise.all([
      fetchAPI("/summary", { month: state.month }),
      fetchAPI("/movements", { month: state.month })
    ]);
    
    renderHero(summaryRes.summary);
    renderList(movesRes.movements);
  } catch (e) {
    console.error(e);
    // Don't alert aggressively, show in UI
  } finally {
    container.style.opacity = "1";
  }
}

async function submitTx() {
  const amt = document.getElementById("inpAmount").value;
  const cat = document.getElementById("inpCat").value;
  
  if(!amt) return alert("Introduce un importe.");
  if(!cat) return alert("Selecciona una categoría.");

  const btn = document.querySelector(".btn-primary");
  const originalText = btn.innerText;
  btn.innerText = "Guardando...";
  btn.style.opacity = "0.7";
  btn.disabled = true;

  try {
    const dateVal = document.getElementById("inpDate").value;
    const payload = {
      path: "/add",
      amount: amt,
      type: document.getElementById("inpType").value,
      raw_category: cat,
      note: document.getElementById("inpNote").value,
      date: dateVal,
      accounting_month: calcAccountingMonth(dateVal)
    };
    
    // Using no-cors for speed and to avoid preflight checks
    await fetch(ENDPOINT, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ ...payload, api_key: API_KEY }),
    });

    // Artificial delay to allow Sheets to process (since we can't await no-cors response)
    await new Promise(r => setTimeout(r, 1500)); 
    
    closeModal();
    
    // Reset form
    document.getElementById("inpAmount").value = "";
    document.getElementById("inpNote").value = "";
    
    refresh();

  } catch(e) {
    alert("Error guardando: " + e.message);
  } finally {
    btn.innerText = originalText;
    btn.style.opacity = "1";
    btn.disabled = false;
  }
}

async function loadCategories() {
  const res = await fetchAPI("/categories");
  // Handle both {ok:true, categories:[]} and just {categories:[]}
  const cats = res.categories || (res.data ? res.data.categories : []) || [];
  
  state.categories = cats;
  const sel = document.getElementById("inpCat");
  
  if (cats.length === 0) {
    sel.innerHTML = `<option>Error: Sin categorías</option>`;
    return;
  }

  // Sort alphabetically
  cats.sort((a,b) => a.raw.localeCompare(b.raw));
  sel.innerHTML = `<option value="" disabled selected>Categoría...</option>` + 
    cats.map(c => `<option value="${c.raw}">${c.raw}</option>`).join("");
}

// === API ENGINE (FIXED) ===

async function fetchAPI(path, params = {}) {
  const url = new URL(ENDPOINT);
  const q = { ...params, path, api_key: API_KEY, _t: Date.now() };
  Object.keys(q).forEach(k => url.searchParams.append(k, q[k]));
  
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Server Error: ${res.status}`);
  
  const data = await res.json();
  
  // FIX: Solo lanzamos error si la API explícitamente nos dice "error"
  if (data.error) throw new Error(data.error);
  
  return data;
}

// === LOGIC UTILS ===

function calcAccountingMonth(dateStr) {
  if (!dateStr) return state.month;
  const d = new Date(dateStr);
  const day = d.getDate();
  // Regla de negocio: Si es día >= 10, pasa al mes siguiente
  if (day >= 10) {
    d.setMonth(d.getMonth() + 1);
  }
  return d.toISOString().slice(0, 7);
}

function fmtMoney(n) {
  return Number(n).toLocaleString("es-ES", { 
    style: "currency", 
    currency: "EUR",
    minimumFractionDigits: 2 
  });
}

// === UI HELPERS ===

function renderHero(summary) {
  if (!summary) return;
  document.getElementById("lblIn").innerText = fmtMoney(summary.income);
  document.getElementById("lblOut").innerText = fmtMoney(summary.expense);
  
  const netEl = document.getElementById("lblNet");
  netEl.innerText = fmtMoney(summary.forecast);
  netEl.style.color = summary.forecast >= 0 ? "var(--text-main)" : "var(--danger)";
}

function renderList(list) {
  const box = document.getElementById("txList");
  if (!list || list.length === 0) {
    box.innerHTML = `<div style="padding:40px; text-align:center; color:var(--text-sec);">No hay movimientos en ${state.month}</div>`;
    return;
  }

  box.innerHTML = list.map(m => {
    const isIngreso = m.type === "Ingreso";
    const amountClass = isIngreso ? "text-green" : "";
    const sign = isIngreso ? "+" : "";
    
    // Parse date for display (YYYY-MM-DD -> DD/MM)
    const day = m.date.slice(8,10);
    
    return `
    <div class="row">
      <div class="row-left">
        <div class="row-cat">${m.raw_category}</div>
        <div class="row-note">${m.note || "Sin nota"}</div>
      </div>
      <div class="row-right">
        <div class="row-amount ${amountClass}">${sign}${fmtMoney(m.amount)}</div>
        <div class="row-date">Día ${day}</div>
      </div>
    </div>`;
  }).join("");
}

function setupMonthPicker() {
  const sel = document.getElementById("monthPicker");
  const now = new Date();
  
  // Limpiamos y generamos rango: -5 meses a +6 meses
  sel.innerHTML = "";
  
  for (let i = -5; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const val = d.toISOString().slice(0, 7); // YYYY-MM
    
    // Formato bonito: "ene. 2026"
    const label = d.toLocaleDateString("es-ES", { month: "short", year: "numeric" });
    
    const opt = document.createElement("option");
    opt.value = val;
    opt.text = label.charAt(0).toUpperCase() + label.slice(1); // Capitalize
    
    if (val === state.month) opt.selected = true;
    sel.appendChild(opt);
  }
  
  sel.addEventListener("change", (e) => {
    state.month = e.target.value;
    refresh();
  });
}

function openModal() { 
  document.getElementById("addModal").classList.add("open");
  document.getElementById("inpAmount").focus();
}
function closeModal() { 
  document.getElementById("addModal").classList.remove("open"); 
}
