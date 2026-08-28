// ============ State ============
const STORAGE_KEY = "invoiceGeneratorState";

// Each item row: date (session date), desc (subject/session tutor), note,
// price (fee tutor), additionalFee. No per-row subtotal anymore — only a
// single grand Total Fee at the bottom of the table.
let items = [
  { date: "", desc: "Math: Functions", note: "", price: 100000, additionalFee: 0 },
];
let qrisDataUrl = null;

// ============ Helpers ============
function formatRupiah(n) {
  n = Number(n) || 0;
  return "Rp" + n.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

// Invoice header date = billing month (input type="month" gives "YYYY-MM").
function formatDateEN(monthStr) {
  if (!monthStr) return "—";
  const d = new Date(monthStr + "-01T00:00:00");
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// Per-session date (input type="date"). en-GB locale gives "Tuesday, 18 August 2026"
// (day before month), matching the original design.
function formatSessionDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function el(id) { return document.getElementById(id); }

// ============ Cache (localStorage) ============
function collectState() {
  return {
    fromName: el("fromName").value,
    fromContact: el("fromContact").value,
    clientName: el("clientName").value,
    invoiceNumber: el("invoiceNumber").value,
    invoiceDate: el("invoiceDate").value,
    bankName: el("bankName").value,
    bankAccount: el("bankAccount").value,
    bankHolder: el("bankHolder").value,
    closingNote: el("closingNote").value,
    items: items,
    qrisDataUrl: qrisDataUrl,
  };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collectState()));
  } catch (e) {
    console.warn("Failed saving cache:", e);
  }
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
    el("bankName").value = state.bankName ?? "";
    el("bankAccount").value = state.bankAccount ?? "";
    el("bankHolder").value = state.bankHolder ?? "";
    el("closingNote").value = state.closingNote ?? el("closingNote").value;
    if (Array.isArray(state.items) && state.items.length) items = state.items;
    qrisDataUrl = state.qrisDataUrl || null;
    if (qrisDataUrl) el("removeQrisBtn").hidden = false;
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

// ============ Line items (form side) ============
// Row fields: date | desc (subject) | note | price (fee tutor) | additionalFee
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

function escapeAttr(str) {
  return String(str).replace(/"/g, "&quot;");
}
function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str == null ? "" : str;
  return d.innerHTML;
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

  // items — table: No | Date | Subject | Note | Fee Tutor | Additional Fee
  const body = el("prevItemsBody");
  body.innerHTML = "";

  let total = 0;
  items.forEach((item, i) => {
    total += (Number(item.price) || 0) + (Number(item.additionalFee) || 0);
    const tr = document.createElement("tr");
    tr.innerHTML = `
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

  // payment
  const bank = el("bankName").value;
  const bankAcc = el("bankAccount").value;
  const bankHolder = el("bankHolder").value;
  const optionsWrap = el("paymentOptions");
  optionsWrap.innerHTML = "";

  const hasQris = !!qrisDataUrl;
  const hasBank = bank || bankAcc || bankHolder;

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
          ${escapeHtml(bank)} ${escapeHtml(bankAcc)}<br>
          Account holder: ${escapeHtml(bankHolder)}
        </div>
      `;
      optionsWrap.appendChild(block);
    }
  }

  // footer
  el("prevClosingNote").textContent = el("closingNote").value || "—";
  el("prevContact").textContent = el("fromContact").value || "";
  el("prevSignature").textContent = el("fromName").value || "—";

  saveState();
}

// ============ Wire up live inputs ============
[
  "fromName", "fromContact", "clientName", "invoiceNumber", "invoiceDate",
  "bankName", "bankAccount", "bankHolder", "closingNote",
].forEach((id) => {
  el(id).addEventListener("input", renderPreview);
});

// ============ Load cache (if any), fallback to current month ============
const hadSavedState = loadState();
if (!hadSavedState) {
  el("invoiceDate").value = new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

el("clearCacheBtn").addEventListener("click", () => {
  if (confirm("Delete all data saved from this browser?")) clearState();
});

// ============ PDF export ============
// Always exports on real A4 paper size. If the invoice content is taller
// than one A4 page (e.g. ~10+ session rows), it automatically continues
// onto page 2, 3, etc. — text stays full-size, it never shrinks to fit.
//
// To avoid any issue with mobile scroll position / narrow viewport, we
// build an OFF-SCREEN CLONE of the invoice at a fixed desktop-like width
// and capture that instead of the visible (possibly scrolled/narrow) sheet.
function getPageBreakpoints(sheetEl, scale) {
  const sheetTop = sheetEl.getBoundingClientRect().top;
  const points = new Set([0]);

  Array.from(sheetEl.children).forEach((child) => {
    const rect = child.getBoundingClientRect();
    points.add(Math.round((rect.top - sheetTop) * scale));
    points.add(Math.round((rect.bottom - sheetTop) * scale));
  });

  const tbody = sheetEl.querySelector("#prevItemsBody");
  if (tbody) {
    Array.from(tbody.children).forEach((tr) => {
      const rect = tr.getBoundingClientRect();
      points.add(Math.round((rect.top - sheetTop) * scale));
      points.add(Math.round((rect.bottom - sheetTop) * scale));
    });
  }

  points.add(Math.round(sheetEl.scrollHeight * scale));
  return Array.from(points).sort((a, b) => a - b);
}

el("downloadBtn").addEventListener("click", async () => {
  const btn = el("downloadBtn");
  const originalLabel = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "Preparing PDF...";

  // --- Build an off-screen clone at a fixed width ---
  const original = el("invoiceSheet");
  const clone = original.cloneNode(true);
  clone.id = "invoiceSheetExportClone";
  clone.style.position = "fixed";
  clone.style.top = "0";
  clone.style.left = "-10000px";
  clone.style.width = "800px";
  clone.style.margin = "0";
  clone.style.zIndex = "-1";

  // Inside the clone, remove the mobile scroll restriction entirely —
  // it doesn't need to scroll, it just needs to show everything.
  const cloneScrollWrap = clone.querySelector(".table-scroll");
  const cloneTable = clone.querySelector(".sheet-table");
  if (cloneScrollWrap) cloneScrollWrap.style.overflow = "visible";
if (cloneTable) cloneTable.style.minWidth = "0";

// Force "desktop" appearance on the clone no matter how narrow the phone's
// actual screen is — media queries check the real browser viewport, not
// this clone's own width, so without this the mobile @media rules still
// sneak in and wreck the layout (stacked title/date, left-aligned footer).
const cloneHead = clone.querySelector(".sheet-head");
const cloneTitle = clone.querySelector(".sheet-title");
const cloneMeta = clone.querySelector(".sheet-meta");
const cloneFooter = clone.querySelector(".sheet-footer");
const cloneFooterNote = clone.querySelector(".footer-note");
const cloneFooterSign = clone.querySelector(".footer-sign");

clone.style.padding = "40px";
if (cloneHead) { cloneHead.style.flexDirection = "row"; cloneHead.style.alignItems = "flex-start"; cloneHead.style.gap = "0"; }
if (cloneTitle) cloneTitle.style.fontSize = "44px";
if (cloneMeta) cloneMeta.style.textAlign = "right";
if (cloneFooter) { cloneFooter.style.flexDirection = "row"; cloneFooter.style.alignItems = "flex-end"; cloneFooter.style.gap = "24px"; }
if (cloneFooterNote) cloneFooterNote.style.maxWidth = "60%";
if (cloneFooterSign) cloneFooterSign.style.textAlign = "right";

document.body.appendChild(clone);
  // Force layout to settle before measuring/capturing.
  void clone.offsetHeight;

  try {
    const scale = 2;
    const canvas = await html2canvas(clone, {
      scale,
      backgroundColor: "#ffffff",
    });

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: "mm", format: "a4" });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - margin * 2;
    const contentHeight = pageHeight - margin * 2;

    const pxToMm = contentWidth / canvas.width;
    const scaledHeightMm = canvas.height * pxToMm;

    if (scaledHeightMm <= contentHeight) {
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", margin, margin, contentWidth, scaledHeightMm);
    } else {
      const pageHeightPx = contentHeight / pxToMm;
      const breakpoints = getPageBreakpoints(clone, scale);
      let renderedPx = 0;
      let pageIndex = 0;

      while (renderedPx < canvas.height) {
        const hardLimit = Math.min(renderedPx + pageHeightPx, canvas.height);
        let cut = hardLimit;
        for (let i = breakpoints.length - 1; i >= 0; i--) {
          if (breakpoints[i] <= hardLimit && breakpoints[i] > renderedPx) {
            cut = breakpoints[i];
            break;
          }
        }
        const sliceHeightPx = cut - renderedPx;

        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = canvas.width;
        pageCanvas.height = sliceHeightPx;
        pageCanvas.getContext("2d").drawImage(
          canvas,
          0, renderedPx, canvas.width, sliceHeightPx,
          0, 0, canvas.width, sliceHeightPx
        );

        if (pageIndex > 0) pdf.addPage();
        pdf.addImage(pageCanvas.toDataURL("image/png"), "PNG", margin, margin, contentWidth, sliceHeightPx * pxToMm);

        renderedPx = cut;
        pageIndex++;
      }
    }

    const fileName = (el("invoiceNumber").value || "invoice").replace(/[^\w-]+/g, "_");
    pdf.save(`${fileName}.pdf`);
  } catch (err) {
    console.error(err);
    alert("Failed to make PDF. Please try again.");
  } finally {
    document.body.removeChild(clone);
    btn.disabled = false;
    btn.innerHTML = originalLabel;
  }
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

// ============ TAB 2: kalkulatorrrr titipan ============
const TITIPAN_STORAGE_KEY = "titipanCalculatorState";

let titipanClients = [
  { name: "", items: [{ date: "", type: "", price: 0, note: "" }] },
];

function saveTitipanState() {
  try {
    localStorage.setItem(TITIPAN_STORAGE_KEY, JSON.stringify(titipanClients));
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
          <td class="num"><input type="number" min="0" step="1000" data-c="${cIdx}" data-i="${iIdx}" data-field="price" value="${item.price || 0}"></td>
          <td><input type="text" data-c="${cIdx}" data-i="${iIdx}" data-field="note" placeholder="Note" value="${escapeAttr(item.note || "")}"></td>
          <td><button type="button" class="item-remove remove-titipan-row-btn" data-c="${cIdx}" data-i="${iIdx}" aria-label="Remove row">✕</button></td>
        </tr>`
      )
      .join("");

    const total = client.items.reduce((sum, item) => sum + (Number(item.price) || 0), 0);

    block.innerHTML = `
      <div class="client-block-head">
        <input type="text" class="client-name-input" data-c="${cIdx}" placeholder="Student name" value="${escapeAttr(client.name || "")}">
        <button type="button" class="btn-ghost btn-sm remove-client-btn" data-c="${cIdx}">
          <i class="ti ti-trash" aria-hidden="true"></i> Remove student
        </button>
      </div>
      <table class="titipan-table">
        <thead>
          <tr><th>No</th><th>Date</th><th>Type</th><th class="num">Price</th><th>Note</th><th></th></tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot>
          <tr><td colspan="3">Total</td><td class="num">${formatRupiah(total)}</td><td colspan="2"></td></tr>
        </tfoot>
      </table>
      <button type="button" class="btn-ghost btn-sm add-titipan-row-btn" data-c="${cIdx}">
        <i class="ti ti-plus" aria-hidden="true"></i> Add item
      </button>
    `;
    wrap.appendChild(block);
  });

  // client name inputs
  wrap.querySelectorAll(".client-name-input").forEach((input) => {
    input.addEventListener("input", (e) => {
      titipanClients[Number(e.target.dataset.c)].name = e.target.value;
      saveTitipanState();
    });
  });

  // item field inputs — update data only, DON'T call renderTitipan() here.
  // Re-rendering on every keystroke rebuilds every <input> in the table,
  // which kicks focus out of the box you're typing in. We only touch the
  // Total number directly (via DOM), since that's the only visible thing
  // that needs to change while typing.
  wrap.querySelectorAll("tbody input").forEach((input) => {
    input.addEventListener("input", (e) => {
      const c = Number(e.target.dataset.c);
      const i = Number(e.target.dataset.i);
      const field = e.target.dataset.field;
      const isText = field === "date" || field === "type" || field === "note";
      titipanClients[c].items[i][field] = isText ? e.target.value : Number(e.target.value);

      const total = titipanClients[c].items.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
      const totalCell = wrap.children[c].querySelector("tfoot td.num");
      if (totalCell) totalCell.textContent = formatRupiah(total);

      saveTitipanState();
    });
  });

  // add row per client
  wrap.querySelectorAll(".add-titipan-row-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const c = Number(e.currentTarget.dataset.c);
      titipanClients[c].items.push({ date: "", type: "", price: 0, note: "" });
      renderTitipan();
    });
  });

  // remove row
  wrap.querySelectorAll(".remove-titipan-row-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const c = Number(e.currentTarget.dataset.c);
      const i = Number(e.currentTarget.dataset.i);
      titipanClients[c].items.splice(i, 1);
      if (titipanClients[c].items.length === 0) {
        titipanClients[c].items.push({ date: "", type: "", price: 0, note: "" });
      }
      renderTitipan();
    });
  });

  // remove whole student block
  wrap.querySelectorAll(".remove-client-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const c = Number(e.currentTarget.dataset.c);
      titipanClients.splice(c, 1);
      if (titipanClients.length === 0) {
        titipanClients.push({ name: "", items: [{ date: "", type: "", price: 0, note: "" }] });
      }
      renderTitipan();
    });
  });

  saveTitipanState();
}

if (el("addClientBtn")) {
  el("addClientBtn").addEventListener("click", () => {
    titipanClients.push({ name: "", items: [{ date: "", type: "", price: 0, note: "" }] });
    renderTitipan();
  });
}

loadTitipanState();

// ============ Init ============
renderItemRows();
renderPreview();
renderTitipan();
