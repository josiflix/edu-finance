// CONFIGURACIÓN (Actualiza ENDPOINT tras el deploy)
const ENDPOINT = "https://script.google.com/macros/s/AKfycbw7d0SQ2ZJo9zZS8Cp0N5rQk0pwKRxxQCrd-eOGNwjZuux9Pd4pdmw2e_6twRioXt1I/exec";
const API_KEY = "1234567890111213141516171819202122232425";

let state = {
  month: new Date().toISOString().slice(0, 7),
  categories: [],
  movements: [] // Caché local para edición instantánea
};

document.addEventListener("DOMContentLoaded", async () => {
  initPicker();
  
  // Set hoy en el modal
  document.getElementById("inpDate").value = new Date().toISOString().slice(0,10);
  
  try {
    // Carga inicial (Config + Datos)
    const initRes = await api('/init');
    state.categories = initRes.categories;
    renderCatSelect();
    
    await loadData();
  } catch(e) {
    alert("Error de conexión: " + e.message);
  }
});

async function loadData() {
  document.body.style.cursor = "wait";
  const data = await api('/data', { month: state.month });
  state.movements = data.movements;
  
  renderHome(data.summary, data.movements);
  renderAnalysis(data.summary);
  document.body.style.cursor = "default";
}

// --- ACTIONS ---

function navTo(view) {
  // Cambio de pestañas
  document.querySelectorAll('[id^="view-"]').forEach(el => el.classList.add('hidden'));
  document.getElementById('view-' + view).classList.remove('hidden');
  
  // Estado de botones
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const idx = view === 'home' ? 0 : 1;
  document.querySelectorAll('.nav-item')[idx].classList.add('active');
}

function openModal(id = null) {
  const modal = document.getElementById('dialog');
  const title = document.getElementById('modalTitle');
  const btnDel = document.getElementById('btnDel');
  
  if (id) {
    // Modo Edición
    const m = state.movements.find(x => x.id === id);
    if (!m) return;
    title.innerText = "Editar";
    document.getElementById('inpId').value = id;
    document.getElementById('inpAmt').value = m.amount;
    document.getElementById('inpType').value = m.type;
    document.getElementById('inpCat').value = m.raw_category;
    document.getElementById('inpNote').value = m.note;
    document.getElementById('inpDate').value = m.date;
    btnDel.style.display = 'block';
  } else {
    // Modo Nuevo
    title.innerText = "Nuevo Movimiento";
    document.getElementById('inpId').value = "";
    document.getElementById('inpAmt').value = "";
    document.getElementById('inpNote').value = "";
    btnDel.style.display = 'none';
  }
  
  modal.classList.add('open');
}

function closeModal() {
  document.getElementById('dialog').classList.remove('open');
}

async function save() {
  const id = document.getElementById('inpId').value;
  const payload = {
    id: id || null,
    amount: document.getElementById('inpAmt').value,
    type: document.getElementById('inpType').value,
    raw_category: document.getElementById('inpCat').value,
    note: document.getElementById('inpNote').value,
    date: document.getElementById('inpDate').value,
    accounting_month: calcMonth(document.getElementById('inpDate').value)
  };
  
  if (!payload.amount) return alert("Falta el importe");

  // UX Optimista: Cerrar modal inmediatamente
  closeModal();
  
  const path = id ? '/update' : '/add';
  await api(path, payload, 'POST');
  
  // Recargar datos para confirmar
  await loadData();
}

async function del() {
  if(!confirm("¿Borrar?")) return;
  const id = document.getElementById('inpId').value;
  closeModal();
  await api('/delete', { id }, 'POST');
  await loadData();
}

// --- RENDERING ---

function renderHome(sum, list) {
  const fmt = n => Number(n).toLocaleString('es-ES', {style:'currency', currency:'EUR'});
  
  document.getElementById('txtNet').innerText = fmt(sum.forecast);
  document.getElementById('txtIn').innerText = fmt(sum.income);
  document.getElementById('txtOut').innerText = fmt(sum.expense);
  
  const listEl = document.getElementById('listTx');
  if (list.length === 0) {
    listEl.innerHTML = "<div style='padding:20px; text-align:center; opacity:0.5'>Sin movimientos</div>";
    return;
  }
  
  listEl.innerHTML = list.map(m => {
    const isInc = m.type === 'Ingreso';
    const color = isInc ? 'var(--md-sys-color-tertiary)' : 'var(--md-sys-color-on-surface)';
    const icon = isInc ? 'arrow_downward' : 'arrow_upward';
    
    return `
    <div class="transaction-item" onclick="openModal('${m.id}')">
      <div style="display:flex; align-items:center;">
        <div class="tx-icon"><span class="material-symbols-rounded">${icon}</span></div>
        <div>
          <div style="font-weight:500;">${m.raw_category}</div>
          <div style="font-size:12px; opacity:0.7;">${m.note || m.date.slice(8)}</div>
        </div>
      </div>
      <div style="font-weight:600; font-size:16px; color:${color}">
        ${isInc ? '+' : ''}${fmt(m.amount)}
      </div>
    </div>`;
  }).join('');
}

function renderAnalysis(sum) {
  const fmt = n => Number(n).toLocaleString('es-ES', {style:'currency', currency:'EUR'});
  
  // Objetivo
  document.getElementById('txtGoalPercent').innerText = Math.round(sum.goal_percent) + "%";
  document.getElementById('barGoal').style.width = sum.goal_percent + "%";
  document.getElementById('txtGoalDetail').innerText = `Proyectado: ${fmt(sum.forecast)} / Meta: ${fmt(sum.goal_base)}`;
  
  // Categorías
  const listEl = document.getElementById('listCats');
  const cats = sum.analysis || [];
  
  if (cats.length === 0) {
    listEl.innerHTML = "<div style='padding:20px; opacity:0.5'>Sin datos</div>";
    return;
  }
  
  const max = Math.max(...cats.map(c => c.value));
  
  listEl.innerHTML = cats.map(c => `
    <div class="card" style="padding:16px; margin-bottom:8px;">
      <div class="bar-header"><span>${c.name}</span><span>${fmt(c.value)}</span></div>
      <div class="track">
        <div class="fill" style="width:${(c.value/max)*100}%; background:var(--md-sys-color-secondary);"></div>
      </div>
    </div>
  `).join('');
}

function renderCatSelect() {
  const el = document.getElementById('inpCat');
  el.innerHTML = state.categories
    .sort((a,b) => a.raw.localeCompare(b.raw))
    .map(c => `<option value="${c.raw}">${c.raw}</option>`).join('');
}

// --- UTILS ---

async function api(path, params={}, method='GET') {
  const url = new URL(ENDPOINT);
  const q = { ...params, path, api_key: API_KEY, _t: Date.now() };
  Object.keys(q).forEach(k => url.searchParams.append(k, q[k]));
  
  const opts = { method };
  if (method === 'POST') opts.mode = 'no-cors';
  
  const res = await fetch(url, opts);
  if (method === 'POST') return { ok: true };
  
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

function calcMonth(dStr) {
  const d = new Date(dStr);
  if (d.getDate() >= 10) d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 7);
}

function initPicker() {
  const sel = document.getElementById('monthSelector');
  const now = new Date();
  for(let i=-2; i<=4; i++) {
    const d = new Date(now.getFullYear(), now.getMonth()+i, 1);
    const val = d.toISOString().slice(0,7);
    const opt = document.createElement('option');
    opt.value = val;
    const name = d.toLocaleDateString('es-ES', {month:'long', year:'numeric'});
    opt.text = name.charAt(0).toUpperCase() + name.slice(1);
    if(val === state.month) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', e => {
    state.month = e.target.value;
    loadData();
  });
}
