// ============ Firebase (ganti dengan config kamu sendiri dari Firebase Console) ============
const firebaseConfig = {
  apiKey: "AIzaSyCXLU-FyQU2MjaPuatwEcmp8JbqVURCY18",
  authDomain: "invoice-key-28ad0.firebaseapp.com",
  projectId: "invoice-key-28ad0",
  storageBucket: "invoice-key-28ad0.firebasestorage.app",
  messagingSenderId: "409215803176",
  appId: "1:409215803176:web:0c2b1197681b21163a3a1d",
  measurementId: "G-G3T7RYCW3P"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
let currentUser = null;
let cloudSaveTimer = null;

// ============ State ============
const STORAGE_KEY = "invoiceGeneratorState";

let items = [
  { date: "", desc: "Math: Functions", note: "", price: 100000, additionalFee: 0 },
];
let qrisDataUrl = null;
let additionalMode = false;
let additionalItems = [{ date: "", type: "", qty: 1, price: 0 }];

function el(id) { return document.getElementById(id); }
function escapeAttr(str) { return String(str).replace(/"/g, "&quot;"); }
function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str == null ? "" : str;
  return d.innerHTML;
}

// ============ Helpers ============
function formatRupiah(n) {
  n = Number(n) || 0;
  return "Rp" + n.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}
function formatDateEN(monthStr) {
  if (!monthStr) return "—";
  const d = new Date(monthStr + "-01T00:00:00");
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
function formatSessionDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// ============ Additional Mode (Titipan) — separate table, form side ============
function renderAdditionalItemRows() {
  const list = el("additionalItemsList");
  if (!list) return;
  list.innerHTML = "";
  additionalItems.forEach((item, idx) => {
    const row = document.createElement("div");
    row.className = "item-row item-row-titipan";
    row.innerHTML = `
      <input class="f-type" type="text" data-idx="${idx}" data-field="type" placeholder="Jenis titipan" value="${escapeAttr(item.type || "")}">
      <input class="f-date" type="date" data-idx="${idx}" data-field="date" value="${escapeAttr(item.date || "")}">
      <input class="f-qty" type="number" min="0" step="1" data-idx="${idx}" data-field="qty" value="${item.qty || 0}">
      <input class="f-price" type="number" min="0" step="1000" data-idx="${idx}" data-field="price" value="${item.price || 0}">
      <button type="button" class="item-remove" data-idx="${idx}" aria-label="Remove row">✕</button>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", (e) => {
      const idx = Number(e.target.dataset.idx);
      const field = e.target.dataset.field;
      const isText = field === "type" || field === "date";
      additionalItems[idx][field] = isText ? e.target.value : Number(e.target.value);
      renderPreview();
    });
  });
  list.querySelectorAll(".item-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.currentTarget.dataset.idx);
      additionalItems.splice(idx, 1);
      renderAdditionalItemRows();
      renderPreview();
    });
  });
}

if (el("addAdditionalItemBtn")) {
  el("addAdditionalItemBtn").addEventListener("click", () => {
    additionalItems.push({ date: "", type: "", qty: 1, price: 0 });
    renderAdditionalItemRows();
    renderPreview();
  });
}

if (el("additionalModeToggle")) {
  el("additionalModeToggle").addEventListener("change", (e) => {
    additionalMode = e.target.checked;
    if (el("additionalItemsList")) el("additionalItemsList").hidden = !additionalMode;
    if (el("addAdditionalItemBtn")) el("addAdditionalItemBtn").hidden = !additionalMode;
    if (el("additionalTableWrap")) el("additionalTableWrap").hidden = !additionalMode;
    renderPreview();
  });
}

// ============ Main table skeleton ============
function renderMainTable() {
  const wrap = el("mainTableWrap");
  if (!wrap) return;
  if (!additionalMode) {
    wrap.innerHTML = `
      <table class="sheet-table">
        <thead>
          <tr>
            <th>No</th><th>Date</th><th>Subject / Session Tutor</th><th>Note</th>
            <th class="num">Fee Tutor</th><th class="num">Additional Fee</th>
          </tr>
        </thead>
        <tbody id="prevItemsBody"></tbody>
        <tfoot>
          <tr class="total-row"><td colspan="5">Total Fee</td><td class="num" id="prevTotal">Rp0</td></tr>
        </tfoot>
      </table>
    `;
  } else {
    wrap.innerHTML = `
      <table class="sheet-table">
        <thead>
          <tr>
            <th>No</th><th>Date</th><th>Subject / Session Tutor</th><th>Note</th>
            <th class="num">Fee Tutor</th>
          </tr>
        </thead>
        <tbody id="prevItemsBody"></tbody>
        <tfoot>
          <tr class="total-row"><td colspan="4">Total Fee</td><td class="num" id="prevTotal">Rp0</td></tr>
        </tfoot>
      </table>
    `;
  }
}

// ============ Cache (localStorage) ============
function collectState() {
  return {
    fromName: el("fromName").value,
    fromContact: el("fromContact").value,
    clientName: el("clientName").value,
    invoiceNumber: el("invoiceNumber").value,
    invoiceDate: el("invoiceDate").value,
    bankAccount: el("bankAccount").value,
    bankHolder: el("bankHolder").value,
    closingNote: el("closingNote").value,
    signatureName: el("signatureName").value,
    items: items,
    qrisDataUrl: qrisDataUrl,
    additionalMode: additionalMode,
    additionalItems: additionalItems,
  };
}

function scheduleCloudSave() {
  if (!currentUser) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => {
    db.collection("users").doc(currentUser.uid).set({
      invoice: collectState(),
      titipan: titipanClients,
      tracker: trackerClients,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }).catch((e) => console.warn("Cloud save failed:", e));
  }, 1200);
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collectState()));
    scheduleCloudSave();
  } catch (e) {
    console.warn("Failed saving cache:", e);
  }
}

function applyInvoiceState(state) {
  el("fromName").value = state.fromName ?? el("fromName").value;
  el("fromContact").value = state.fromContact ?? "";
  el("clientName").value = state.clientName ?? "";
  el("invoiceNumber").value = state.invoiceNumber ?? "";
  el("invoiceDate").value = state.invoiceDate ?? new Date().toISOString().slice(0, 7);
  el("bankAccount").value = state.bankAccount ?? "";
  el("bankHolder").value = state.bankHolder ?? "";
  el("closingNote").value = state.closingNote ?? el("closingNote").value;
  el("signatureName").value = state.signatureName ?? el("fromName").value;
  if (Array.isArray(state.items) && state.items.length) items = state.items;
  qrisDataUrl = state.qrisDataUrl || null;
  if (qrisDataUrl) el("removeQrisBtn").hidden = false;

  additionalMode = !!state.additionalMode;
  if (Array.isArray(state.additionalItems) && state.additionalItems.length) {
    additionalItems = state.additionalItems;
  }
  if (el("additionalModeToggle")) el("additionalModeToggle").checked = additionalMode;
  if (el("additionalItemsList")) el("additionalItemsList").hidden = !additionalMode;
  if (el("addAdditionalItemBtn")) el("addAdditionalItemBtn").hidden = !additionalMode;
  if (el("additionalTableWrap")) el("additionalTableWrap").hidden = !additionalMode;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const state = JSON.parse(raw);
    el("fromName").value = state.fromName ?? el("fromName").value;
    el("fromContact").value = state.fromContact ?? "";
    el("clientName").value = state.clientName ?? "";
    el("invoiceNumber").value = state.invoiceNumber ?? "";
    el("invoiceDate").value = state.invoiceDate ?? new Date().toISOString().slice(0, 7);
    el("bankAccount").value = state.bankAccount ?? "";
    el("bankHolder").value = state.bankHolder ?? "";
    el("closingNote").value = state.closingNote ?? el("closingNote").value;
    el("signatureName").value = state.signatureName ?? el("fromName").value;
    if (Array.isArray(state.items) && state.items.length) items = state.items;
    qrisDataUrl = state.qrisDataUrl || null;
    if (qrisDataUrl) el("removeQrisBtn").hidden = false;

    additionalMode = !!state.additionalMode;
    if (Array.isArray(state.additionalItems) && state.additionalItems.length) {
      additionalItems = state.additionalItems;
    }
    if (el("additionalModeToggle")) el("additionalModeToggle").checked = additionalMode;
    if (el("additionalItemsList")) el("additionalItemsList").hidden = !additionalMode;
    if (el("addAdditionalItemBtn")) el("addAdditionalItemBtn").hidden = !additionalMode;
    if (el("additionalTableWrap")) el("additionalTableWrap").hidden = !additionalMode;

    return true;
  } catch (e) {
    console.warn("Failed to load cache:", e);
    return false;
  }
}

function clearState() {
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
}

// ============ Session Details (main table, form side) ============
function renderItemRows() {
  const list = el("itemsList");
  list.innerHTML = "";
  items.forEach((item, idx) => {
    const row = document.createElement("div");
    row.className = "item-row";
    row.innerHTML = `
      <input class="f-date" type="date" data-idx="${idx}" data-field="date" value="${escapeAttr(item.date || "")}">
      <input class="f-subject" type="text" data-idx="${idx}" data-field="desc" placeholder="Subject / session tutor" value="${escapeAttr(item.desc)}">
      <input class="f-note" type="text" data-idx="${idx}" data-field="note" placeholder="Note" value="${escapeAttr(item.note || "")}">
      <input class="f-price" type="number" min="0" step="1000" data-idx="${idx}" data-field="price" value="${item.price}">
      <input class="f-fee" type="number" min="0" step="1000" data-idx="${idx}" data-field="additionalFee" value="${item.additionalFee || 0}">
      <button type="button" class="item-remove" data-idx="${idx}" aria-label="Remove row">✕</button>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", (e) => {
      const idx = Number(e.target.dataset.idx);
      const field = e.target.dataset.field;
      const isText = field === "desc" || field === "note" || field === "date";
      items[idx][field] = isText ? e.target.value : Number(e.target.value);
      renderPreview();
    });
  });
  list.querySelectorAll(".item-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.currentTarget.dataset.idx);
      items.splice(idx, 1);
      renderItemRows();
      renderPreview();
    });
  });
}

el("addItemBtn").addEventListener("click", () => {
  items.push({ date: "", desc: "", note: "", price: 0, additionalFee: 0 });
  renderItemRows();
  renderPreview();
});

// ============ QRIS upload ============
el("qrisUpload").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    qrisDataUrl = reader.result;
    el("removeQrisBtn").hidden = false;
    renderPreview();
  };
  reader.readAsDataURL(file);
});
el("removeQrisBtn").addEventListener("click", () => {
  qrisDataUrl = null;
  el("qrisUpload").value = "";
  el("removeQrisBtn").hidden = true;
  renderPreview();
});

// ============ Preview render ============
function renderPreview() {
  el("prevFromName").textContent = el("fromName").value || "—";
  el("prevClientName").textContent = el("clientName").value || "—";
  el("prevInvoiceNumber").textContent = el("invoiceNumber").value
    ? "Invoice No: " + el("invoiceNumber").value
    : "—";
  el("prevDate").textContent = formatDateEN(el("invoiceDate").value);

  renderMainTable();
  const body = el("prevItemsBody");
  let total = 0;
  items.forEach((item, i) => {
    total += Number(item.price) || 0;
    if (!additionalMode) total += Number(item.additionalFee) || 0;

    const tr = document.createElement("tr");
    tr.innerHTML = additionalMode
      ? `
        <td>${i + 1}</td>
        <td>${formatSessionDate(item.date)}</td>
        <td>${escapeHtml(item.desc) || "—"}</td>
        <td>${escapeHtml(item.note) || "—"}</td>
        <td class="num">${formatRupiah(item.price)}</td>
      `
      : `
        <td>${i + 1}</td>
        <td>${formatSessionDate(item.date)}</td>
        <td>${escapeHtml(item.desc) || "—"}</td>
        <td>${escapeHtml(item.note) || "—"}</td>
        <td class="num">${formatRupiah(item.price)}</td>
        <td class="num">${formatRupiah(item.additionalFee || 0)}</td>
      `;
    body.appendChild(tr);
  });
  el("prevTotal").textContent = formatRupiah(total);

  if (additionalMode) {
    const addBody = el("prevAdditionalBody");
    let addTotal = 0;
    if (addBody) {
      addBody.innerHTML = "";
      additionalItems.forEach((item, i) => {
        const qty = Number(item.qty) || 0;
        const price = Number(item.price) || 0;
        addTotal += qty * price;
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${i + 1}</td>
          <td>${formatSessionDate(item.date)}</td>
          <td>${escapeHtml(item.type) || "—"}</td>
          <td class="num">${qty}</td>
          <td class="num">${formatRupiah(price)}</td>
        `;
        addBody.appendChild(tr);
      });
    }
    if (el("prevAdditionalTotal")) el("prevAdditionalTotal").textContent = formatRupiah(addTotal);
    if (el("prevGrandTotal")) el("prevGrandTotal").textContent = formatRupiah(total + addTotal);
  }

  // Payment — single field "bankAccount" holds bank name + account number together.
  const bankAcc = el("bankAccount").value;
  const bankHolder = el("bankHolder").value;
  const optionsWrap = el("paymentOptions");
  optionsWrap.innerHTML = "";

  const hasQris = !!qrisDataUrl;
  const hasBank = bankAcc || bankHolder;

  if (!hasQris && !hasBank) {
    optionsWrap.innerHTML = `<div class="payment-empty">No payment method has been added yet.</div>`;
  } else {
    if (hasQris) {
      const block = document.createElement("div");
      block.className = "payment-block";
      block.innerHTML = `
        <img src="${qrisDataUrl}" alt="QRIS" class="qris-thumb">
        <div class="payment-text">
          <div class="payment-title">QRIS</div>
          Scan to pay
        </div>
      `;
      optionsWrap.appendChild(block);
    }
    if (hasBank) {
      const block = document.createElement("div");
      block.className = "payment-block";
      block.innerHTML = `
        <div class="payment-text">
          <div class="payment-title">Bank Transfer</div>
          <span class="payment-bank-line">${escapeHtml(bankAcc)}</span><br>
          Account holder: ${escapeHtml(bankHolder)}
        </div>
      `;
      optionsWrap.appendChild(block);
    }
  }

  el("prevClosingNote").textContent = el("closingNote").value || "—";
  el("prevContact").textContent = el("fromContact").value || "";
  el("prevSignature").textContent = el("signatureName").value || "—";

  saveState();
}

// ============ Wire up live inputs ============
[
  "fromName", "fromContact", "clientName", "invoiceNumber", "invoiceDate",
  "bankAccount", "bankHolder", "closingNote", "signatureName",
].forEach((id) => {
  el(id).addEventListener("input", renderPreview);
});

// ============ Load cache, fallback to current month ============
const hadSavedState = loadState();
if (!hadSavedState) {
  el("invoiceDate").value = new Date().toISOString().slice(0, 7);
}

el("clearCacheBtn").addEventListener("click", () => {
  if (confirm("Delete all data saved from this browser?")) clearState();
});

// ============ TABS ============
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    el(btn.dataset.tab).classList.add("active");
  });
});

// ============ TAB 2: Kalkulator Titipan ============
const TITIPAN_STORAGE_KEY = "titipanCalculatorState";
let titipanClients = [
  { name: "", items: [{ date: "", type: "", qty: 1, price: 0, note: "" }] },
];

function saveTitipanState() {
  try {
    localStorage.setItem(TITIPAN_STORAGE_KEY, JSON.stringify(titipanClients));
    scheduleCloudSave();
  } catch (e) {
    console.warn("Failed saving titipan cache:", e);
  }
}
function loadTitipanState() {
  try {
    const raw = localStorage.getItem(TITIPAN_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) titipanClients = parsed;
  } catch (e) {
    console.warn("Failed loading titipan cache:", e);
  }
}

function renderTitipanSummary() {
  const body = el("titipanSummaryBody");
  if (!body) return;
  body.innerHTML = titipanClients.map((client, idx) => {
    const total = client.items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.qty) || 1), 0);
    return `<tr><td>${idx + 1}</td><td><span class="summary-name-link" data-target="titipan-client-${idx}">${escapeHtml(client.name) || "—"}</span></td><td class="num">${formatRupiah(total)}</td></tr>`;
  }).join("");

  body.querySelectorAll(".summary-name-link").forEach((link) => {
    link.addEventListener("click", () => {
      const target = document.getElementById(link.dataset.target);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function renderTitipan() {
  const wrap = el("clientBlocks");
  if (!wrap) return;
  wrap.innerHTML = "";

  titipanClients.forEach((client, cIdx) => {
    const block = document.createElement("div");
    block.className = "client-block";

    const rowsHtml = client.items
      .map(
        (item, iIdx) => `
        <tr>
          <td>${iIdx + 1}</td>
          <td><input type="date" data-c="${cIdx}" data-i="${iIdx}" data-field="date" value="${escapeAttr(item.date || "")}"></td>
          <td><input type="text" data-c="${cIdx}" data-i="${iIdx}" data-field="type" placeholder="e.g. Textbook" value="${escapeAttr(item.type || "")}"></td>
          <td class="num"><input type="number" min="0" step="1" data-c="${cIdx}" data-i="${iIdx}" data-field="qty" value="${item.qty || 1}"></td>
          <td class="num"><input type="number" min="0" step="1000" data-c="${cIdx}" data-i="${iIdx}" data-field="price" value="${item.price || 0}"></td>
          <td><input type="text" data-c="${cIdx}" data-i="${iIdx}" data-field="note" placeholder="cth: Braun sudah bayar 1/2 kmrin" value="${escapeAttr(item.note || "")}"></td>
          <td><button type="button" class="item-remove remove-titipan-row-btn" data-c="${cIdx}" data-i="${iIdx}" aria-label="Remove row">✕</button></td>
        </tr>`
      )
      .join("");

    const total = client.items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.qty) || 1), 0);

    block.id = `titipan-client-${cIdx}`;
    block.innerHTML = `
      <div class="client-block-head">
        <span class="client-index-badge">${cIdx + 1}</span>
        <input type="text" class="client-name-input" data-c="${cIdx}" placeholder="Student name" value="${escapeAttr(client.name || "")}">
        <button type="button" class="btn-ghost btn-sm remove-client-btn" data-c="${cIdx}">Remove student</button>
      </div>
      <table class="titipan-table">
        <thead>
          <tr><th>No</th><th>Date</th><th>Type</th><th class="num">Qty</th><th class="num">Price</th><th>Note (optional)</th><th></th></tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot>
          <tr><td colspan="4">Total</td><td class="num">${formatRupiah(total)}</td><td colspan="2"></td></tr>
        </tfoot>
      </table>
      <button type="button" class="btn-ghost btn-sm add-titipan-row-btn" data-c="${cIdx}">+ Add item</button>
    `;
    wrap.appendChild(block);
  });

  wrap.querySelectorAll(".client-name-input").forEach((input) => {
    input.addEventListener("input", (e) => {
      titipanClients[Number(e.target.dataset.c)].name = e.target.value;
      renderTitipanSummary();
      saveTitipanState();
    });
  });

  wrap.querySelectorAll("tbody input").forEach((input) => {
    input.addEventListener("input", (e) => {
      const c = Number(e.target.dataset.c);
      const i = Number(e.target.dataset.i);
      const field = e.target.dataset.field;
      const isText = field === "date" || field === "type" || field === "note";
      titipanClients[c].items[i][field] = isText ? e.target.value : Number(e.target.value);

      const total = titipanClients[c].items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.qty) || 1), 0);
      const totalCell = wrap.children[c].querySelector("tfoot td.num");
      if (totalCell) totalCell.textContent = formatRupiah(total);

      renderTitipanSummary();
      saveTitipanState();
    });
  });

  wrap.querySelectorAll(".add-titipan-row-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const c = Number(e.currentTarget.dataset.c);
      titipanClients[c].items.push({ date: "", type: "", qty: 1, price: 0, note: "" });
      renderTitipan();
    });
  });

  wrap.querySelectorAll(".remove-titipan-row-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const c = Number(e.currentTarget.dataset.c);
      const i = Number(e.currentTarget.dataset.i);
      titipanClients[c].items.splice(i, 1);
      if (titipanClients[c].items.length === 0) {
        titipanClients[c].items.push({ date: "", type: "", qty: 1, price: 0, note: "" });
      }
      renderTitipan();
    });
  });

  wrap.querySelectorAll(".remove-client-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const c = Number(e.currentTarget.dataset.c);
      titipanClients.splice(c, 1);
      if (titipanClients.length === 0) {
        titipanClients.push({ name: "", items: [{ date: "", type: "", qty: 1, price: 0, note: "" }] });
      }
      renderTitipan();
    });
  });
  
  renderTitipanSummary();
  saveTitipanState();
}

if (el("addClientBtn")) {
  el("addClientBtn").addEventListener("click", () => {
    titipanClients.push({ name: "", items: [{ date: "", type: "", qty: 1, price: 0, note: "" }] });
    renderTitipan();
  });
}
loadTitipanState();

if (el("titipanSummaryToggle")) {
  el("titipanSummaryToggle").addEventListener("click", () => {
    const wrap = el("titipanSummaryWrap");
    if (wrap) wrap.hidden = !wrap.hidden;
  });
}

// ============ TAB 3: Session Tracker ============
const TRACKER_STORAGE_KEY = "sessionTrackerState";
let trackerClients = [
  { name: "", items: [{ date: "", desc: "", note: "", price: 0 }] },
];

function saveTrackerState() {
  try {
    localStorage.setItem(TRACKER_STORAGE_KEY, JSON.stringify(trackerClients));
    scheduleCloudSave();
  } catch (e) {
    console.warn("Failed saving tracker cache:", e);
  }
}
function loadTrackerState() {
  try {
    const raw = localStorage.getItem(TRACKER_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) trackerClients = parsed;
  } catch (e) {
    console.warn("Failed loading tracker cache:", e);
  }
}

function renderTrackerSummary() {
  const body = el("trackerSummaryBody");
  if (!body) return;
  let grandTotal = 0;
  body.innerHTML = trackerClients.map((client, idx) => {
    const total = client.items.reduce((sum, it) => sum + (Number(it.price) || 0), 0);
    grandTotal += total;
    return `<tr><td>${idx + 1}</td><td><span class="summary-name-link" data-target="tracker-client-${idx}">${escapeHtml(client.name) || "—"}</span></td><td class="num">${formatRupiah(total)}</td></tr>`;
  }).join("");
  if (el("trackerSummaryGrandTotal")) el("trackerSummaryGrandTotal").textContent = formatRupiah(grandTotal);

  body.querySelectorAll(".summary-name-link").forEach((link) => {
    link.addEventListener("click", () => {
      const target = document.getElementById(link.dataset.target);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function renderSessionTracker() {
  const wrap = el("trackerClientBlocks");
  if (!wrap) return;
  wrap.innerHTML = "";

  trackerClients.forEach((client, cIdx) => {
    const block = document.createElement("div");
    block.className = "client-block";

    const rowsHtml = client.items
      .map(
        (item, iIdx) => `
        <tr>
          <td>${iIdx + 1}</td>
          <td><input type="date" data-c="${cIdx}" data-i="${iIdx}" data-field="date" value="${escapeAttr(item.date || "")}"></td>
          <td><input type="text" data-c="${cIdx}" data-i="${iIdx}" data-field="desc" placeholder="Subject / session tutor" value="${escapeAttr(item.desc || "")}"></td>
          <td><input type="text" data-c="${cIdx}" data-i="${iIdx}" data-field="note" placeholder="Note" value="${escapeAttr(item.note || "")}"></td>
          <td class="num"><input type="number" min="0" step="1000" data-c="${cIdx}" data-i="${iIdx}" data-field="price" value="${item.price || 0}"></td>
          <td><button type="button" class="item-remove remove-tracker-row-btn" data-c="${cIdx}" data-i="${iIdx}" aria-label="Remove row">✕</button></td>
        </tr>`
      )
      .join("");

    const total = client.items.reduce((sum, item) => sum + (Number(item.price) || 0), 0);

    block.id = `tracker-client-${cIdx}`;
    block.innerHTML = `
      <div class="client-block-head">
        <span class="client-index-badge">${cIdx + 1}</span>
        <input type="text" class="client-name-input" data-c="${cIdx}" placeholder="Student name" value="${escapeAttr(client.name || "")}">
        <button type="button" class="btn-ghost btn-sm remove-tracker-client-btn" data-c="${cIdx}">Remove student</button>
      </div>
      <table class="tracker-table">
        <thead>
          <tr><th>No</th><th>Date</th><th>Subject</th><th>Note</th><th class="num">Fee Tutor</th><th></th></tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot>
          <tr><td colspan="4">Total</td><td class="num">${formatRupiah(total)}</td><td></td></tr>
        </tfoot>
      </table>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button type="button" class="btn-ghost btn-sm add-tracker-row-btn" data-c="${cIdx}">+ Add row</button>
        <button type="button" class="btn-primary send-tracker-btn" data-c="${cIdx}" style="width:auto;">→ Add to Main Table</button>
      </div>
    `;
    wrap.appendChild(block);
  });

  wrap.querySelectorAll(".client-name-input").forEach((input) => {
    input.addEventListener("input", (e) => {
      trackerClients[Number(e.target.dataset.c)].name = e.target.value;
      renderTrackerSummary();
      saveTrackerState();
    });
  });

  wrap.querySelectorAll("tbody input").forEach((input) => {
    input.addEventListener("input", (e) => {
      const c = Number(e.target.dataset.c);
      const i = Number(e.target.dataset.i);
      const field = e.target.dataset.field;
      const isText = field === "date" || field === "desc" || field === "note";
      trackerClients[c].items[i][field] = isText ? e.target.value : Number(e.target.value);

      const total = trackerClients[c].items.reduce((sum, it) => sum + (Number(it.price) || 0), 0);
      const totalCell = wrap.children[c].querySelector("tfoot td.num");
      if (totalCell) totalCell.textContent = formatRupiah(total);
      renderTrackerSummary();

      saveTrackerState();
    });
  });

  wrap.querySelectorAll(".add-tracker-row-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const c = Number(e.currentTarget.dataset.c);
      trackerClients[c].items.push({ date: "", desc: "", note: "", price: 0 });
      renderSessionTracker();
    });
  });

  wrap.querySelectorAll(".remove-tracker-row-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const c = Number(e.currentTarget.dataset.c);
      const i = Number(e.currentTarget.dataset.i);
      trackerClients[c].items.splice(i, 1);
      if (trackerClients[c].items.length === 0) {
        trackerClients[c].items.push({ date: "", desc: "", note: "", price: 0 });
      }
      renderSessionTracker();
    });
  });

  wrap.querySelectorAll(".remove-tracker-client-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const c = Number(e.currentTarget.dataset.c);
      trackerClients.splice(c, 1);
      if (trackerClients.length === 0) {
        trackerClients.push({ name: "", items: [{ date: "", desc: "", note: "", price: 0 }] });
      }
      renderSessionTracker();
    });
  });

  wrap.querySelectorAll(".send-tracker-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const c = Number(e.currentTarget.dataset.c);
      const client = trackerClients[c];

      items = client.items.map((it) => ({
        date: it.date || "",
        desc: it.desc || "",
        note: it.note || "",
        price: Number(it.price) || 0,
        additionalFee: 0,
      }));
      if (items.length === 0) items = [{ date: "", desc: "", note: "", price: 0, additionalFee: 0 }];

      el("clientName").value = client.name || "";

      renderItemRows();
      renderPreview();

      const invoiceTabBtn = document.querySelector('.tab-btn[data-tab="tab-invoice"]');
      if (invoiceTabBtn) invoiceTabBtn.click();
    });
  });

  renderTrackerSummary();
  saveTrackerState();
}

if (el("addTrackerClientBtn")) {
  el("addTrackerClientBtn").addEventListener("click", () => {
    trackerClients.push({ name: "", items: [{ date: "", desc: "", note: "", price: 0 }] });
    renderSessionTracker();
  });
}
loadTrackerState();


if (el("trackerSummaryToggle")) {
  el("trackerSummaryToggle").addEventListener("click", () => {
    const wrap = el("trackerSummaryWrap");
    if (wrap) wrap.hidden = !wrap.hidden;
  });
}


// ============ AUTH: Login / Sign Up / Sync ============
function updateAuthUI() {
  const area = el("authArea");
  if (!area) return;
  if (currentUser) {
    area.innerHTML = `
      <span class="auth-user-email">${escapeHtml(currentUser.email)}</span>
      <button type="button" class="auth-btn" id="logoutBtn">Logout</button>
    `;
    el("logoutBtn").addEventListener("click", () => auth.signOut());
  } else {
    area.innerHTML = `<button type="button" class="auth-btn" id="loginBtn">Login</button>`;
    el("loginBtn").addEventListener("click", openAuthModal);
  }
}

function openAuthModal() {
  el("authError").textContent = "";
  el("authModal").hidden = false;
}
function closeAuthModal() {
  el("authModal").hidden = true;
}

el("authPasswordToggle").addEventListener("click", () => {
  const input = el("authPassword");
  const btn = el("authPasswordToggle");
  const isHidden = input.type === "password";
  input.type = isHidden ? "text" : "password";
  btn.textContent = isHidden ? "👁" : "👁/";
});
el("authCancelBtn").addEventListener("click", closeAuthModal);

el("authLoginBtn").addEventListener("click", () => {
  const email = el("authEmail").value.trim();
  const password = el("authPassword").value;
  auth.signInWithEmailAndPassword(email, password)
    .then(() => closeAuthModal())
    .catch((e) => { el("authError").textContent = e.message; });
});

el("authSignupBtn").addEventListener("click", () => {
  const email = el("authEmail").value.trim();
  const password = el("authPassword").value;
  auth.createUserWithEmailAndPassword(email, password)
    .then(() => closeAuthModal())
    .catch((e) => { el("authError").textContent = e.message; });
});

auth.onAuthStateChanged((user) => {
  currentUser = user;
  updateAuthUI();
  if (user) {
    db.collection("users").doc(user.uid).get().then((snap) => {
      if (snap.exists) {
        const data = snap.data();
        if (data.invoice) applyInvoiceState(data.invoice);
        if (Array.isArray(data.titipan) && data.titipan.length) titipanClients = data.titipan;
        if (Array.isArray(data.tracker) && data.tracker.length) trackerClients = data.tracker;
      }
      renderItemRows();
      renderAdditionalItemRows();
      renderPreview();
      renderTitipan();
      renderSessionTracker();
    });
  }
});


// ============ PDF export (native text, NOT a screenshot) ============
// Uses jsPDF + jsPDF-AutoTable to draw real text/tables directly into the
// PDF — text is selectable/searchable/copyable. Color theme: lavender.
const PDF_LAVENDER = [124, 111, 224];
const PDF_LAVENDER_LIGHT = [237, 235, 252];
const PDF_INK = [46, 42, 71];
const PDF_INK_SOFT = [120, 113, 150];

function pdfCheckPageBreak(doc, y, neededHeight, margin, pageHeight) {
  if (y + neededHeight > pageHeight - margin) {
    doc.addPage();
    return margin;
  }
  return y;
}

el("downloadBtn").addEventListener("click", () => {
  const btn = el("downloadBtn");
  const originalLabel = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "Preparing PDF...";

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    doc.addFileToVFS("GreatVibes-Regular.ttf", GREATVIBES_FONT_BASE64);
    doc.addFont("GreatVibes-Regular.ttf", "GreatVibes", "normal");
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(26);
    doc.setTextColor(...PDF_LAVENDER);
    doc.text("INVOICE", margin, y + 8);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...PDF_INK_SOFT);
    doc.text("Tutoring session recap", margin, y + 14);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...PDF_INK);
    doc.text(formatDateEN(el("invoiceDate").value), pageWidth - margin, y + 6, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...PDF_INK_SOFT);
    const invNoText = el("invoiceNumber").value ? "Invoice No: " + el("invoiceNumber").value : "";
    if (invNoText) doc.text(invNoText, pageWidth - margin, y + 11, { align: "right" });

    y += 22;
    doc.setDrawColor(...PDF_LAVENDER_LIGHT);
    doc.setLineWidth(0.4);
    doc.line(margin, y, pageWidth - margin, y);
    y += 7;

    doc.setFontSize(10);
    doc.setTextColor(...PDF_INK_SOFT);
    doc.text("Invoice For", margin, y);
    doc.setTextColor(...PDF_INK);
    doc.text(el("clientName").value || "—", margin + 22, y);
    y += 5.5;
    doc.setTextColor(...PDF_INK_SOFT);
    doc.text("From", margin, y);
    doc.setTextColor(...PDF_INK);
    doc.text(el("fromName").value || "—", margin + 22, y);
    y += 9;

    const mainHead = additionalMode
      ? [["No", "Date", "Subject / Session Tutor", "Fee Tutor", "Note"]]
      : [["No", "Date", "Subject / Session Tutor", "Fee Tutor", "Note", "Additional Fee"]];

    let mainTotal = 0;
    const mainBody = items.map((item, i) => {
      mainTotal += Number(item.price) || 0;
      if (!additionalMode) mainTotal += Number(item.additionalFee) || 0;
      const row = [
        String(i + 1),
        formatSessionDate(item.date),
        item.desc || "—",
        formatRupiah(item.price),
        item.note || "—",
      ];
      if (!additionalMode) row.push(formatRupiah(item.additionalFee || 0));
      return row;
    });

    doc.autoTable({
      startY: y,
      head: mainHead,
      body: mainBody,
      foot: additionalMode
        ? [[{ content: "Total Fee", colSpan: 3 }, formatRupiah(mainTotal), ""]]
        : [[{ content: "Total Fee", colSpan: 3 }, formatRupiah(mainTotal), "", ""]],
      theme: "grid",
      margin: { left: margin, right: margin },
      styles: { fontSize: 8.5, textColor: PDF_INK, lineColor: PDF_LAVENDER_LIGHT, lineWidth: 0.2, cellPadding: 2.2 },
      headStyles: { fillColor: PDF_LAVENDER, textColor: 255, fontStyle: "bold", fontSize: 8 },
      footStyles: { fillColor: PDF_LAVENDER_LIGHT, textColor: PDF_INK, fontStyle: "bold", fontSize: 11 },
      columnStyles: additionalMode
        ? { 0: { cellWidth: 8 }, 2: { cellWidth: 42 }, 3: { cellWidth: 34, halign: "right" } }
        : { 0: { cellWidth: 8 }, 2: { cellWidth: 40 }, 3: { cellWidth: 28, halign: "right" }, 5: { halign: "right" } },
    });

    
    y = doc.lastAutoTable.finalY + 10;

    let grandTotal = mainTotal;
    if (additionalMode) {
      let addTotal = 0;
      const addBody = additionalItems.map((item, i) => {
        const qty = Number(item.qty) || 0;
        const price = Number(item.price) || 0;
        addTotal += qty * price;
        return [String(i + 1), formatSessionDate(item.date), item.type || "—", String(qty), formatRupiah(price)];
      });
      grandTotal = mainTotal + addTotal;

      doc.autoTable({
        startY: y,
        head: [["No", "Date", "Jenis Titipan", "Qty", "Harga"]],
        body: addBody,
        foot: [["", "", "", "Total Additional", formatRupiah(addTotal)]],
        theme: "grid",
        margin: { left: margin, right: margin },
        styles: { fontSize: 8.5, textColor: PDF_INK, lineColor: PDF_LAVENDER_LIGHT, lineWidth: 0.2, cellPadding: 2.2 },
        headStyles: { fillColor: PDF_LAVENDER, textColor: 255, fontStyle: "bold", fontSize: 8 },
        footStyles: { fillColor: PDF_LAVENDER_LIGHT, textColor: PDF_INK, fontStyle: "bold", fontSize: 8.5 },
        columnStyles: { 0: { cellWidth: 8 }, 3: { halign: "right" }, 4: { halign: "right" } },
      });
      y = doc.lastAutoTable.finalY + 6;

      y = pdfCheckPageBreak(doc, y, 10, margin, pageHeight);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(...PDF_LAVENDER);
      doc.text("GRAND TOTAL", margin, y);
      doc.text(formatRupiah(grandTotal), pageWidth - margin, y, { align: "right" });
      y += 10;
    }

    y = pdfCheckPageBreak(doc, y, 30, margin, pageHeight);
    doc.setDrawColor(...PDF_LAVENDER_LIGHT);
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...PDF_LAVENDER);
    doc.text("PAYMENT METHOD", margin, y);
    y += 6;

    const bankAcc = el("bankAccount").value;
    const bankHolder = el("bankHolder").value;
    const hasQris = !!qrisDataUrl;
    const hasBank = bankAcc || bankHolder;

    if (!hasQris && !hasBank) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.setTextColor(...PDF_INK_SOFT);
      doc.text("No payment method has been added yet.", margin, y);
      y += 8;
    } else {
      
      let qrisBottomY = y;
      if (hasQris) {
        const qrisSize = 34;
        const mime = qrisDataUrl.includes("image/png") ? "PNG" : "JPEG";
        try { doc.addImage(qrisDataUrl, mime, margin, y, qrisSize, qrisSize); } catch (e) { console.warn("QRIS embed failed:", e); }
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(...PDF_INK_SOFT);
        doc.text("Scan to pay", margin, y + qrisSize + 4);
        qrisBottomY = y + qrisSize + 8;
      }

      if (hasBank) {
        const bankX = hasQris ? margin + 40 : margin;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(...PDF_INK);
        doc.text(bankAcc || "—", bankX, y + 6);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        doc.setTextColor(...PDF_INK_SOFT);
        doc.text("Account holder: " + (bankHolder || "—"), bankX, y + 12);
      }

      y = Math.max(qrisBottomY, y + 16) + 4;
    }

    y = pdfCheckPageBreak(doc, y, 20, margin, pageHeight);
    doc.setDrawColor(...PDF_LAVENDER_LIGHT);
    doc.line(margin, y, pageWidth - margin, y);
    y += 7;

    const noteLines = doc.splitTextToSize(el("closingNote").value || "—", contentWidth * 0.6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...PDF_INK);
    doc.text(noteLines, margin, y);
    const contact = el("fromContact").value;
    if (contact) {
      doc.setFontSize(8.5);
      doc.setTextColor(...PDF_INK_SOFT);
      doc.text(contact, margin, y + noteLines.length * 4.5 + 3);
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...PDF_INK_SOFT);
    doc.text("Best regards,", pageWidth - margin, y, { align: "right" });
    doc.setFont("GreatVibes", "normal");
    doc.setFontSize(24);
    doc.setTextColor(...PDF_LAVENDER);
    doc.text(el("signatureName").value || "—", pageWidth - margin, y + 11, { align: "right" });
    const fileName = (el("invoiceNumber").value || "invoice").replace(/[^\w-]+/g, "_");
    doc.save(`${fileName}.pdf`);
  } catch (err) {
    console.error(err);
    alert("Failed to make PDF. Please try again.");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalLabel;
  }
});

// ============ Init ============
renderItemRows();
renderAdditionalItemRows();
renderPreview();
renderTitipan();
renderSessionTracker();

// ============ Scroll-to-top button (shows on all tabs after scrolling down) ============
const scrollTopBtn = el("scrollTopBtn");
if (scrollTopBtn) {
  window.addEventListener("scroll", () => {
    scrollTopBtn.hidden = window.scrollY < 300;
  });
  scrollTopBtn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}
