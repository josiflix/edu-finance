/**
 * EduFinance Pocket Backend (Google Apps Script)
 *
 * Required sheets:
 * - Movimientos (row 1 headers):
 *   id, date, accounting_month, type, raw_category, amount, note, created_at
 * - Mapa_Categorias (row 1 headers):
 *   RawCategory, StdCategory, Bucket, Active?
 * - Settings (row 1 headers):
 *   Key, Value
 * - Presupuestos (optional) (row 1 headers):
 *   Bucket, MonthlyLimit
 */

// === CONFIG ===
const SPREADSHEET_ID = "https://script.google.com/macros/s/AKfycbzUBx0P-TJUJ0ND6R6OMOI9zZEDWKJVefsCDlku2TGkJSc4srDrS8MR_joZLCxyU5EG/exec";
const API_KEY = "1234567890111213141516171819202122232425";

// -------------------- ENTRY POINTS --------------------

function doGet(e) {
  try {
    const p = (e && e.parameter) ? e.parameter : {};
    if (String(p.api_key || "") !== API_KEY) {
      return jsonpOrJson_(p, { ok: false, error: "Unauthorized (API_KEY)" }, 401);
    }

    const path = String(p.path || "").toLowerCase();
    const month = String(p.month || "");

    switch (path) {
      case "/settings":
        return jsonpOrJson_(p, { ok: true, settings: getSettings_() }, 200);

      case "/categories":
        return jsonpOrJson_(p, { ok: true, categories: getCategories_() }, 200);

      case "/budgets":
        return jsonpOrJson_(p, { ok: true, budgets: getBudgets_() }, 200);

      case "/summary":
        return jsonpOrJson_(p, { ok: true, summary: getSummary_(month) }, 200);

      case "/movements":
        return jsonpOrJson_(p, { ok: true, movements: getMovements_(month) }, 200);

      default:
        return jsonpOrJson_(
          p,
          { ok: false, error: "Unknown path. Use ?path=/settings|/categories|/budgets|/summary|/movements" },
          400
        );
    }
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) }, 500);
  }
}

function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "{}";
    const data = JSON.parse(raw || "{}");

    if (String(data.api_key || "") !== API_KEY) {
      return jsonOut_({ ok: false, error: "Unauthorized (API_KEY)" }, 401);
    }

    const path = String(data.path || "").toLowerCase();

    switch (path) {
      case "/add":
        return jsonOut_({ ok: true, movement: addMovement_(data) }, 200);

      case "/update":
        return jsonOut_({ ok: true, movement: updateMovement_(data) }, 200);

      case "/delete":
        return jsonOut_({ ok: true, deleted: deleteMovement_(String(data.id || "")) }, 200);

      default:
        return jsonOut_({ ok: false, error: "Unknown path. Use {path:'/add'|'/update'|'/delete'}" }, 400);
    }
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) }, 500);
  }
}

// -------------------- RESPONSES --------------------

function jsonOut_(obj, code) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * JSONP support (bypass CORS from GitHub Pages).
 * If ?callback=foo -> returns: foo(<json>);
 * else -> normal JSON.
 */
function jsonpOrJson_(params, obj, code) {
  const cb = String((params && params.callback) ? params.callback : "");
  if (cb) {
    const safeCb = cb.replace(/[^\w$.]/g, "");
    const js = `${safeCb}(${JSON.stringify(obj)});`;
    return ContentService.createTextOutput(js).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return jsonOut_(obj, code || 200);
}

// -------------------- SHEET HELPERS --------------------

function ss_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error(`Missing sheet: ${name}`);
  return sh;
}

function headersIndex_(headers, required) {
  const out = {};
  required.forEach((k) => {
    const i = headers.indexOf(k);
    if (i < 0) throw new Error(`Missing column: ${k}`);
    out[k] = i;
  });
  return out;
}

// -------------------- NORMALIZERS (CLAVE) --------------------

function isDate_(v) {
  return Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v);
}

function normMonth_(v) {
  if (!v) return "";
  if (isDate_(v)) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM");
  }
  const s = String(v).trim();
  // Si viene como "2026-01-01" -> "2026-01"
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 7);
  // Si ya viene "YYYY-MM"
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  return s;
}

function normDate_(v) {
  if (!v) return "";
  if (isDate_(v)) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  const s = String(v).trim();
  // Si viene con hora o más texto, recorta a YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

// -------------------- READS --------------------

function getSettings_() {
  const sh = sheet_("Settings");
  const values = sh.getDataRange().getValues();
  const out = {};

  for (let i = 1; i < values.length; i++) {
    const k = String(values[i][0] || "").trim();
    const v = String(values[i][1] || "").trim();
    if (k) out[k] = v;
  }

  // defaults
  if (!out["contable_day_switch"]) out["contable_day_switch"] = "10";
  if (!out["writes_enabled"]) out["writes_enabled"] = "TRUE";
  if (!out["starting_total"]) out["starting_total"] = "2500";
  if (!out["goal_base"]) out["goal_base"] = "5000";

  return out;
}

function getCategories_() {
  const sh = sheet_("Mapa_Categorias");
  const values = sh.getDataRange().getValues();
  if (!values.length) return [];

  const headers = values[0].map(String);
  const idx = {
    raw: headers.indexOf("RawCategory"),
    std: headers.indexOf("StdCategory"),
    bucket: headers.indexOf("Bucket"),
    active: headers.indexOf("Active?")
  };

  if (idx.raw < 0 || idx.std < 0 || idx.bucket < 0 || idx.active < 0) {
    throw new Error("Mapa_Categorias headers must be: RawCategory, StdCategory, Bucket, Active?");
  }

  const cats = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const active = String(row[idx.active] || "").trim().toUpperCase() === "YES";
    if (!active) continue;

    const raw = String(row[idx.raw] || "").trim();
    if (!raw) continue;

    cats.push({
      raw,
      std: String(row[idx.std] || "").trim(),
      bucket: String(row[idx.bucket] || "").trim()
    });
  }
  return cats;
}

function getBudgets_() {
  const sh = ss_().getSheetByName("Presupuestos");
  if (!sh) return [];
  const values = sh.getDataRange().getValues();
  if (!values.length) return [];

  const headers = values[0].map(String);
  const b = headers.indexOf("Bucket");
  const m = headers.indexOf("MonthlyLimit");
  if (b < 0 || m < 0) return [];

  const out = [];
  for (let i = 1; i < values.length; i++) {
    const bucket = String(values[i][b] || "").trim();
    const limit = Number(values[i][m] || 0);
    if (bucket) out.push({ bucket, monthlyLimit: limit });
  }
  return out;
}

function getMovements_(month) {
  const sh = sheet_("Movimientos");
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return [];

  const headers = values[0].map(String);
  const idx = headersIndex_(headers, [
    "id", "date", "accounting_month", "type", "raw_category", "amount", "note", "created_at"
  ]);

  const out = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];

    // ✅ NORMALIZAR (lo que te está rompiendo ahora)
    const m = normMonth_(row[idx.accounting_month]);
    if (month && m !== month) continue;

    out.push({
      id: String(row[idx.id] || ""),
      date: normDate_(row[idx.date]),
      accounting_month: m,
      type: String(row[idx.type] || ""),
      raw_category: String(row[idx.raw_category] || ""),
      amount: Number(row[idx.amount] || 0),
      note: String(row[idx.note] || ""),
      created_at: String(row[idx.created_at] || "")
    });
  }

  out.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  return out;
}

function getSummary_(month) {
  const cats = getCategories_();
  const map = {};
  cats.forEach((c) => map[c.raw] = c);

  const moves = getMovements_(month);

  let ingresos = 0;
  let gastos = 0;
  const byBucket = {};

  for (const mv of moves) {
    const amt = Number(mv.amount || 0);
    const isIncome = String(mv.type || "").toLowerCase() === "ingreso";

    if (isIncome) ingresos += amt;
    else gastos += amt;

    if (!isIncome) {
      const cat = map[mv.raw_category] || null;
      const bucket = cat ? (cat.bucket || "Sin_categoria") : "Sin_categoria";
      byBucket[bucket] = (byBucket[bucket] || 0) + amt;
    }
  }

  const neto = ingresos - gastos;

  const settings = getSettings_();
  const starting = Number(settings.starting_total || 0);
  const goal = Number(settings.goal_base || 5000);

  return {
    month,
    ingresos: round2_(ingresos),
    gastos: round2_(gastos),
    neto: round2_(neto),
    byBucket,
    starting_total: starting,
    goal_base: goal,
    colchon_est: round2_(starting + neto)
  };
}

// -------------------- WRITES --------------------

function addMovement_(data) {
  const settings = getSettings_();
  if (String(settings.writes_enabled || "TRUE").toUpperCase() !== "TRUE") {
    throw new Error("writes_enabled is FALSE in Settings");
  }

  const sh = sheet_("Movimientos");
  const values = sh.getDataRange().getValues();
  const headers = values[0].map(String);
  const idx = headersIndex_(headers, [
    "id", "date", "accounting_month", "type", "raw_category", "amount", "note", "created_at"
  ]);

  const id = String(Date.now());
  const date = String(data.date || "");
  const accounting_month = String(data.accounting_month || "");
  const type = String(data.type || "Gasto");
  const raw_category = String(data.raw_category || "");
  const amount = Number(data.amount || 0);
  const note = String(data.note || "");
  const created_at = new Date().toISOString();

  const row = new Array(headers.length).fill("");
  row[idx.id] = id;
  row[idx.date] = date;

  // ✅ FORZAR TEXTO PARA QUE SHEETS NO LO CONVIERTA A FECHA
  row[idx.accounting_month] = "'" + accounting_month;

  row[idx.type] = type;
  row[idx.raw_category] = raw_category;
  row[idx.amount] = amount;
  row[idx.note] = note;
  row[idx.created_at] = created_at;

  sh.appendRow(row);

  return { id, date, accounting_month, type, raw_category, amount, note, created_at };
}

function updateMovement_(data) {
  const settings = getSettings_();
  if (String(settings.writes_enabled || "TRUE").toUpperCase() !== "TRUE") {
    throw new Error("writes_enabled is FALSE in Settings");
  }

  const id = String(data.id || "");
  if (!id) throw new Error("Missing id");

  const sh = sheet_("Movimientos");
  const values = sh.getDataRange().getValues();
  const headers = values[0].map(String);
  const idx = headersIndex_(headers, [
    "id", "date", "accounting_month", "type", "raw_category", "amount", "note", "created_at"
  ]);

  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idx.id] || "") === id) {

      if (data.date != null) values[r][idx.date] = String(data.date);

      // ✅ si actualizas accounting_month, también lo forzamos a texto
      if (data.accounting_month != null) values[r][idx.accounting_month] = "'" + String(data.accounting_month);

      if (data.type != null) values[r][idx.type] = String(data.type);
      if (data.raw_category != null) values[r][idx.raw_category] = String(data.raw_category);
      if (data.amount != null) values[r][idx.amount] = Number(data.amount);
      if (data.note != null) values[r][idx.note] = String(data.note);

      sh.getRange(r + 1, 1, 1, headers.length).setValues([values[r]]);

      return {
        id,
        date: normDate_(values[r][idx.date]),
        accounting_month: normMonth_(values[r][idx.accounting_month]),
        type: String(values[r][idx.type] || ""),
        raw_category: String(values[r][idx.raw_category] || ""),
        amount: Number(values[r][idx.amount] || 0),
        note: String(values[r][idx.note] || ""),
        created_at: String(values[r][idx.created_at] || "")
      };
    }
  }

  throw new Error("Movement id not found");
}

function deleteMovement_(id) {
  const settings = getSettings_();
  if (String(settings.writes_enabled || "TRUE").toUpperCase() !== "TRUE") {
    throw new Error("writes_enabled is FALSE in Settings");
  }

  if (!id) throw new Error("Missing id");

  const sh = sheet_("Movimientos");
  const values = sh.getDataRange().getValues();
  const headers = values[0].map(String);
  const idx = headersIndex_(headers, ["id"]);

  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idx.id] || "") === id) {
      sh.deleteRow(r + 1);
      return true;
    }
  }
  return false;
}

// -------------------- UTILS --------------------

function round2_(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}
