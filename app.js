import { startManaged } from "./managed.js";
import { isCostField, createCostGesture } from "./cost-crypto.js";
import { normalizeSearchMode, normalizeForCompare, buildSearchTokens, entryMatchesSearch } from "./search.js";
let managed;
let updateToastTimer;
let searchAuditTimer;
let auditedSearch = '';
async function auditSearch(term) {
  clearTimeout(searchAuditTimer);
  if (!managed?.allowed || !term || auditedSearch === term) return;
  auditedSearch = term;
  await managed.event('search', { query: term, resultCount: state.filteredEntries.length });
}


const APP_VERSION = new URL(import.meta.url).searchParams.get("v") ?? "?";

const DB_NAME = "local-price-pwa";
const DB_VERSION = 1;
const STORE_NAME = "kv";
const ACTIVE_DOCUMENT_KEY = "active-document";
const SEARCH_HISTORY_KEY = "search-history";
const SEARCH_MODE_KEY = "search-mode";
const SEARCH_HISTORY_LIMIT = 10;
const MAX_RESULTS_RENDER = 250;
const BUNDLE_VERSION = 32;
const DETAIL_ANIMATION_MS = 280;
const DETAIL_FIELD_CONFIG_KEY = "detail-field-config";
const COLUMN_DEFS = [
  { key: "sku", label: "型號", aliases: ["品編", "品号", "品號", "型號"] },
  { key: "retailPrice", label: "建議售價", aliases: ["建議售價", "建議價", "售價"] },
  { key: "bonus", label: "搭贈", aliases: ["搭贈", "贈品", "贈送"] },
  { key: "basePrice", label: "底價", aliases: ["底價"] },
  { key: "tierPrice", label: "量價", aliases: ["量價", "批價", "批發價"] },
  { key: "openingPrice", label: "開盤價", aliases: ["開盤價"] },
  { key: "note", label: "補充資訊", aliases: ["備註", "補充資訊", "說明", "備考"] },
];

const JSON_FIELD_MAP = {
  "型號": "sku",
  "中文品名": "productName",
  "搭贈": "bonus",
  "底價": "basePrice",
  "量價": "tierPrice",
  "開盤價": "openingPrice",
  "建議售價": "retailPrice",
  "補充資訊": "note",
  "備註": "note",
};

const COPYABLE_PRICE_KEYS = ["bonus", "basePrice", "tierPrice", "openingPrice"];
const COPY_LABELS = {
  bonus: "搭贈",
  basePrice: "特案價",
  tierPrice: "量價",
  openingPrice: "單價",
};

const state = {
  bundle: null,
  entries: [],
  filteredEntries: [],
  searchTerm: "",
  searchMode: "all",
  searchHistory: [],
  selectedEntry: null,
  beforeInstallPrompt: null,
  detailFieldConfig: [],
  costs: null,
};

const refs = {
  panelMoreOptions: document.querySelector(".panel-more-options"),
  clearHistoryButton: document.querySelector("#clear-history-button"),
  installButton: document.querySelector("#install-button"),
  appDocLabel: document.querySelector("#app-doc-label"),
  documentTitle: document.querySelector("#document-title"),
  searchForm: document.querySelector("#search-form"),
  searchInput: document.querySelector("#search-input"),
  searchModeSelect: document.querySelector("#search-mode-select"),
  searchModeButton: document.querySelector("#search-mode-button"),
  searchLabel: document.querySelector(".search-label"),
  historyList: document.querySelector("#history-list"),
  statusBanner: document.querySelector("#status-banner"),
  resultsTitle: document.querySelector("#results-title"),
  resultsSubtitle: document.querySelector("#results-subtitle"),
  resultsPanel: document.querySelector(".results-panel"),
  emptyState: document.querySelector("#empty-state"),
  resultsList: document.querySelector("#results-list"),
  toast: document.querySelector("#toast"),
  dockSearch: document.querySelector("#dock-search"),
  dockClear: document.querySelector("#dock-clear"),
  dockFirst: document.querySelector("#dock-first"),
  detailOverlay: document.querySelector("#detail-overlay"),
  detailBackdrop: document.querySelector("#detail-backdrop"),
  detailSheet: document.querySelector("#detail-sheet"),
  detailHead: document.querySelector("#detail-head"),
  detailHandle: document.querySelector("#detail-handle"),
  detailClose: document.querySelector("#detail-close"),
  detailTitle: document.querySelector("#detail-title"),
  detailSubtitle: document.querySelector("#detail-subtitle"),
  detailGrid: document.querySelector("#detail-grid"),
  copyActions: document.querySelector("#copy-actions"),
  settingsButton: document.querySelector("#settings-button"),
  fieldSettingsOverlay: document.querySelector("#field-settings-overlay"),
  fieldSettingsBackdrop: document.querySelector("#field-settings-backdrop"),
  fieldSettingsSheet: document.querySelector("#field-settings-sheet"),
  fieldSettingsClose: document.querySelector("#field-settings-close"),
  fieldSettingsList: document.querySelector("#field-settings-list"),
  fieldSettingsReset: document.querySelector("#field-settings-reset"),
  logoEl: document.querySelector(".app-logo"),
  modePillEl: document.querySelector(".app-mode-pill"),
  pinOverlay: document.querySelector("#pin-overlay"),
  pinInput: document.querySelector("#pin-input"),
  pinConfirm: document.querySelector("#pin-confirm"),
  pinCancel: document.querySelector("#pin-cancel"),
  pinError: document.querySelector("#pin-error"),
  pinDialogTitle: document.querySelector("#pin-dialog-title"),
  pinDialogHint: document.querySelector("#pin-dialog-hint"),
};

const detailSheetDrag = {
  active: false,
  startY: 0,
  startX: 0,
  distance: 0,
  startScrollTop: 0,
  lastY: 0,
  lastTime: 0,
  velocity: 0,
};

let detailCloseTimer = null;

init().catch((error) => {
  console.error(error);
  setStatus("初始化失敗，請重新整理頁面後再試一次。");
});

async function init() {
  const versionEl = document.querySelector(".app-version");
  if (versionEl) versionEl.textContent = `v${APP_VERSION}`;
  bindEvents();
  state.searchHistory = (await getValue(SEARCH_HISTORY_KEY)) || [];
  state.searchMode = normalizeSearchMode(await getValue(SEARCH_MODE_KEY));
  renderSearchMode();
  await loadDetailFieldConfig();
  renderHistory();
  renderShell();
  updateDockState();
  registerServiceWorker();
  detectInstallPrompt();
  managed = await startManaged({
    get: getValue, set: setValue, del: deleteValue,
    activate: async (rows, meta) => {
      const bundle = buildBundleFromJson(`產品料檔 ${meta.fetchedAt.slice(0,10)}`, rows, meta.version);
      await activateBundleFromJson(bundle);
    },
    clear: () => {
      lockCosts();
      state.bundle = null; state.entries = []; state.filteredEntries = []; state.searchHistory = [];
      state.selectedEntry = null; refs.searchInput.value = ''; state.searchTerm = '';
      refs.detailGrid.replaceChildren(); refs.copyActions.replaceChildren();
      closeDetail({immediate:true}); renderHistory(); renderResults(); renderShell();
    },
    status: setStatus,
    lockCosts,
    showCosts,
    toast: (message) => {
      let el=document.querySelector('.update-toast');
      if(!el){el=document.createElement('div');el.className='update-toast';el.setAttribute('role','status');document.body.append(el);}
      el.textContent=message;el.hidden=false;clearTimeout(updateToastTimer);updateToastTimer=setTimeout(()=>{el.hidden=true;},3000);
    }
  });
  const missing = document.querySelector('#missing-form');
  missing.addEventListener('submit',async event=>{
    event.preventDefault(); const button=missing.querySelector('button');button.disabled=true;
    try { const code=missing.elements.sku.value.trim();
      if(state.entries.some(e=>e.sku.toUpperCase()===code.toUpperCase())) throw new Error('這個型號已在目前料檔中。');
      document.querySelector('#missing-status').textContent=await managed.submit(code,missing.elements.note.value.trim());
      missing.reset();
    }catch(error){document.querySelector('#missing-status').textContent=error.message;}
    finally{button.disabled=false;}
  });
}

function bindEvents() {
  refs.settingsButton?.addEventListener("click", openFieldSettings);
  // 更多選項：點選任何按鈕後自動收回 <details>
  refs.panelMoreOptions?.addEventListener("click", (e) => {
    if (e.target.closest("button")) {
      requestAnimationFrame(() => {
        if (refs.panelMoreOptions) refs.panelMoreOptions.removeAttribute("open");
      });
    }
  });
  refs.fieldSettingsClose?.addEventListener("click", closeFieldSettings);
  refs.fieldSettingsBackdrop?.addEventListener("click", closeFieldSettings);
  refs.fieldSettingsReset?.addEventListener("click", resetFieldConfig);
  bindCostGesture();
  document.querySelector('#cost-unlock-form').addEventListener('submit', onCostPasswordSubmit);
  refs.pinCancel?.addEventListener("click", closePinDialog);
  refs.pinOverlay?.addEventListener("click", (e) => { if (e.target === refs.pinOverlay) closePinDialog(); });
  document.querySelector('#cost-lock-button').addEventListener('click', async () => {
    try { await managed.forgetCosts();showToast('成本已鎖回'); }
    catch { showToast('清除解鎖權限失敗，請重試'); }
  });
  refs.clearHistoryButton.addEventListener("click", clearSearchHistory);
  refs.searchForm.addEventListener("submit", onSearchSubmit);
  refs.searchInput.addEventListener("input", onSearchInput);
  refs.searchModeSelect.addEventListener("change", onSearchModeChange);
  refs.searchModeButton.addEventListener("click", toggleSearchMode);
  refs.resultsList.addEventListener("click", onResultsClick);
  refs.detailBackdrop.addEventListener("click", closeDetail);
  refs.detailClose.addEventListener("click", closeDetail);
  refs.detailSheet?.addEventListener("touchstart", onDetailTouchStart, { passive: true });
  refs.detailSheet?.addEventListener("touchmove", onDetailTouchMove, { passive: false });
  refs.detailSheet?.addEventListener("touchend", onDetailTouchEnd);
  refs.detailSheet?.addEventListener("touchcancel", onDetailTouchEnd);
  refs.installButton.addEventListener("click", installApp);
  refs.dockSearch?.addEventListener("click", focusSearch);
  refs.dockClear?.addEventListener("click", clearActiveSearch);
  refs.dockFirst?.addEventListener("click", scrollToFirstResult);
  let _ctrlBackslashLast = 0;
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !refs.detailOverlay.classList.contains("hidden")) {
      closeDetail();
    }
    if (event.key === "\\" && event.ctrlKey && !event.shiftKey && !event.altKey) {
      const now = Date.now();
      if (now - _ctrlBackslashLast < 800) {
        _ctrlBackslashLast = 0;
        openCostPasswordDialog();
      } else {
        _ctrlBackslashLast = now;
      }
    }
  });
}

function buildBundleFromJson(fileName, jsonData, hash) {
  const entries = jsonData.map((row, index) => {
    const entry = { searchAliases: [], extras: [] };
    for (const [col, val] of Object.entries(row)) {
      if (isCostField(col)) continue; // Defense in depth; costs never enter normal search/copy data.
      const key = JSON_FIELD_MAP[col];
      const strVal = val === null || val === undefined ? "" : String(val);
      if (key) {
        entry[key] = strVal;
      } else if (strVal) {
        entry.extras.push({ label: col, value: strVal });
      }
    }
    entry.sku = entry.sku || "";
    entry.productName = entry.productName || "";
    // 合併 extras 中的搭贈2/搭贈3 到 entry.bonus
    const bonusExtraIdxs = entry.extras.reduce((acc, ex, i) => {
      if (/^搭贈\d+$/.test(ex.label) && ex.value) acc.push(i);
      return acc;
    }, []);
    if (bonusExtraIdxs.length > 0) {
      const parts = [entry.bonus, ...bonusExtraIdxs.map(i => entry.extras[i].value)].filter(Boolean);
      entry.bonus = parts.join(" / ");
      entry.extras = entry.extras.filter((_, i) => !bonusExtraIdxs.includes(i));
    }
    const extrasText = entry.extras.map((e) => e.value).join(" ");
    entry.id = `json-${entry.sku || "row"}-${index}`;
    entry.searchText = normalizeForCompare(
      [entry.sku, entry.productName, entry.bonus, entry.basePrice,
       entry.tierPrice, entry.openingPrice, entry.retailPrice, entry.note, extrasText]
        .filter(Boolean).join(" "),
    );
    return entry;
  });

  return {
    id: ACTIVE_DOCUMENT_KEY,
    version: BUNDLE_VERSION,
    source: "json",
    fileName,
    hash,
    importedAt: new Date().toISOString(),
    nameMapHash: "",
    entries,
  };
}

async function activateBundleFromJson(bundle) {
  const selectedId = state.selectedEntry?.id;
  state.bundle = bundle;
  state.entries = bundle.entries || [];
  await syncDetailFieldConfig(state.entries);
  applySearch(state.searchTerm);
  renderShell();
  if (selectedId) {
    const selected = findEntry(selectedId);
    if (selected) openDetail(selected, {audit:false}); else closeDetail({immediate:true});
  }
}

function onSearchInput(event) {
  state.searchTerm = event.target.value.trim();
  applySearch(state.searchTerm);
  clearTimeout(searchAuditTimer);
  if (!state.searchTerm) auditedSearch = '';
  else searchAuditTimer = setTimeout(() => auditSearch(state.searchTerm), 900);
}

async function onSearchSubmit(event) {
  event.preventDefault();
  if(!managed?.allowed) return;
  const term = refs.searchInput.value.trim();
  state.searchTerm = term;
  applySearch(term);
  scrollToResultsTop();

  if (!term) {
    return;
  }

  await auditSearch(term);

  const nextHistory = [term, ...state.searchHistory.filter((item) => item !== term)].slice(
    0,
    SEARCH_HISTORY_LIMIT,
  );
  state.searchHistory = nextHistory;
  await setValue(SEARCH_HISTORY_KEY, nextHistory);
  renderHistory();
}

function applySearch(term) {
  const normalized = normalizeForCompare(term);
  const tokens = buildSearchTokens(term);
  state.filteredEntries = !normalized
    ? state.entries
    : state.entries.filter((entry) => entryMatchesSearch(entry, normalized, tokens, state.searchMode));

  renderResults();
  updateDockState();
}

function renderSearchMode() {
  const identityOnly = state.searchMode === "identity";
  refs.searchModeSelect.value = state.searchMode;
  refs.searchModeButton.textContent = `搜尋：${identityOnly ? "僅型號／中文品名" : "全部資訊"} · 切換`;
  refs.searchModeButton.setAttribute("aria-label", `目前搜尋模式：${identityOnly ? "僅型號／中文品名" : "全部資訊"}，點此切換`);
  refs.searchLabel.textContent = identityOnly
    ? "只比對型號與中文品名"
    : "可搜尋型號、中文品名、關鍵字或其他資訊";
  refs.searchInput.placeholder = identityOnly ? "例如：COB、崁燈、產品型號" : "例如：COB、崁燈、節標、57K";
}

async function onSearchModeChange() {
  await setSearchMode(refs.searchModeSelect.value, { closeOptions: true, focusButton: true });
}

async function toggleSearchMode() {
  const nextMode = state.searchMode === "identity" ? "all" : "identity";
  await setSearchMode(nextMode, { closeOptions: false, focusButton: false });
}

async function setSearchMode(mode, { closeOptions, focusButton }) {
  state.searchMode = normalizeSearchMode(mode);
  renderSearchMode();
  applySearch(state.searchTerm);
  clearTimeout(searchAuditTimer);
  auditedSearch = '';
  if (state.searchTerm) searchAuditTimer = setTimeout(() => auditSearch(state.searchTerm), 900);
  if (closeOptions) refs.panelMoreOptions.open = false;
  if (focusButton) refs.searchModeButton.focus();
  try {
    await setValue(SEARCH_MODE_KEY, state.searchMode);
    showToast("搜尋模式已記住");
  } catch {
    showToast("已切換，但無法記住設定；重新開啟後請再確認模式。");
  }
}

function renderShell() {
  const bundle = state.bundle;
  refs.documentTitle.textContent = bundle ? bundle.fileName : "尚未載入價格表";
  if (refs.appDocLabel) {
    refs.appDocLabel.textContent = bundle ? bundle.fileName : "尚未載入價格表";
  }
}

function focusSearch() {
  refs.searchInput.focus();
  refs.searchInput.scrollIntoView({
    block: "center",
    behavior: "smooth",
  });
}

function clearActiveSearch() {
  if (!state.searchTerm && !refs.searchInput.value.trim()) {
    return;
  }

  refs.searchInput.value = "";
  state.searchTerm = "";
  applySearch("");
  scrollToResultsTop();
}

function scrollToResultsTop() {
  refs.resultsPanel?.scrollIntoView({
    block: "start",
    behavior: "smooth",
  });
}

function scrollToFirstResult() {
  if (!state.bundle) {
    showToast("請先載入價格表。");
    return;
  }

  const firstCard = refs.resultsList.querySelector(".result-card");
  if (firstCard) {
    firstCard.scrollIntoView({
      block: "start",
      behavior: "smooth",
    });
    return;
  }

  scrollToResultsTop();
}

function updateDockState() {
  if (refs.dockClear) {
    const hasSearch = Boolean(state.searchTerm || refs.searchInput.value.trim());
    refs.dockClear.disabled = !hasSearch;
    refs.dockClear.classList.toggle("is-disabled", !hasSearch);
  }

  if (refs.dockFirst) {
    const hasResult = Boolean(refs.resultsList.querySelector(".result-card"));
    refs.dockFirst.disabled = !state.bundle || !hasResult;
    refs.dockFirst.classList.toggle("is-disabled", !state.bundle || !hasResult);
  }
}

function renderHistory() {
  if (!state.searchHistory.length) {
    refs.historyList.innerHTML = '<span class="card-footer-text">尚無查詢紀錄</span>';
    return;
  }

  refs.historyList.innerHTML = state.searchHistory
    .map(
      (item) =>
        `<button class="history-chip" type="button" data-history="${escapeHtml(item)}">${escapeHtml(item)}</button>`,
    )
    .join("");

  refs.historyList.querySelectorAll("[data-history]").forEach((button) => {
    button.addEventListener("click", () => {
      const term = button.dataset.history || "";
      refs.searchInput.value = term;
      state.searchTerm = term;
      applySearch(term);
      auditedSearch = '';
      auditSearch(term);
    });
  });
}

function renderResults() {
  if (!state.bundle) {
    refs.resultsTitle.textContent = "等待載入料檔";
    refs.resultsSubtitle.textContent = "裝置核准後自動下載，依目前搜尋模式比對資料。";
    refs.emptyState.classList.remove("hidden");
    refs.emptyState.querySelector(".empty-title").textContent = "請先完成裝置申請";
    refs.emptyState.querySelector(".empty-text").textContent =
      "核准後會自動載入加密料檔。查詢及提交型號會留下使用紀錄。";
    refs.resultsList.innerHTML = "";
    updateDockState();
    return;
  }

  const total = state.filteredEntries.length;
  const rendered = state.filteredEntries.slice(0, MAX_RESULTS_RENDER);
  const hasSearch = Boolean(state.searchTerm);

  refs.resultsTitle.textContent = hasSearch
    ? `找到 ${total} 筆符合資料`
    : `共 ${state.entries.length} 筆品項`;
  refs.resultsSubtitle.textContent =
    total > MAX_RESULTS_RENDER
      ? `為了讓手機操作更順，先顯示前 ${MAX_RESULTS_RENDER} 筆結果。`
      : state.searchMode === "identity"
        ? "目前只比對型號與中文品名，點卡片仍可查看完整產品資訊。"
        : "可用型號、中文品名、價格或備註搜尋，點卡片查看細節或直接點價格快速複製。";

  if (!rendered.length) {
    refs.emptyState.classList.remove("hidden");
    refs.emptyState.querySelector(".empty-title").textContent = "查無符合結果";
    refs.emptyState.querySelector(".empty-text").textContent =
      state.searchMode === "identity"
        ? "請改用型號或中文品名；若要搜尋價格、備註等欄位，請切換為「全部資訊」。"
        : "可以換關鍵字試試，或直接用型號、中文品名、底價、開盤價、補充資訊內文字搜尋。";
    refs.resultsList.innerHTML = "";
    updateDockState();
    return;
  }

  refs.emptyState.classList.add("hidden");
  refs.resultsList.innerHTML = rendered.map(renderCard).join("");
  updateDockState();
}

function renderCard(entry) {
  return `
    <article class="result-card" data-entry-id="${escapeHtml(entry.id)}">
      <div class="result-card-top">
        <div>
          <p class="section-label">型號</p>
          <p class="result-code">${escapeHtml(entry.sku || "未識別")}</p>
          ${entry.productName ? `<p class="result-name">${escapeHtml(entry.productName)}</p>` : ""}
        </div>
        <span class="page-pill">產品料檔</span>
      </div>
      <p class="card-note">${escapeHtml(entry.note || "無補充資訊")}</p>
      ${
        entry.bonus
          ? `<p class="card-extra"><strong>搭贈：</strong>${escapeHtml(entry.bonus)}</p>`
          : ""
      }
      <div class="price-strip">
        ${renderPriceChip(entry, "retailPrice")}
        ${renderPriceChip(entry, "basePrice", true)}
        ${renderPriceChip(entry, "tierPrice", true)}
        ${renderPriceChip(entry, "openingPrice", true)}
      </div>
      <div class="card-footer">
        <span class="card-footer-text">點價格即可複製「型號 + 價格」</span>
        <button class="ghost-button small-button" type="button" data-open-detail="${escapeHtml(entry.id)}">
          查看產品細節
        </button>
      </div>
    </article>
  `;
}

function renderPriceChip(entry, key, copyable = false) {
  const column = COLUMN_DEFS.find((item) => item.key === key);
  const value = entry[key] || "-";
  const dataset = copyable ? `data-copy-entry="${escapeHtml(entry.id)}" data-copy-key="${key}"` : "";

  return `
    <button
      class="price-chip ${copyable ? "copyable" : ""}"
      type="button"
      ${dataset}
      ${copyable && !entry[key] ? "disabled" : ""}
    >
      <span class="price-chip-label">${column?.label || key}</span>
      <span class="price-chip-value">${escapeHtml(value)}</span>
    </button>
  `;
}

function onResultsClick(event) {
  const copyButton = event.target.closest("[data-copy-entry]");
  if (copyButton) {
    const entry = findEntry(copyButton.dataset.copyEntry);
    const key = copyButton.dataset.copyKey;
    if (entry && key) {
      copyField(entry, key);
    }
    return;
  }

  const detailButton = event.target.closest("[data-open-detail]");
  if (detailButton) {
    const entry = findEntry(detailButton.dataset.openDetail);
    if (entry) {
      openDetail(entry);
    }
    return;
  }

  const card = event.target.closest("[data-entry-id]");
  if (!card) {
    return;
  }

  const entry = findEntry(card.dataset.entryId);
  if (entry) {
    openDetail(entry);
  }
}

function findEntry(id) {
  return state.entries.find((entry) => entry.id === id) || null;
}

async function copyField(entry, key) {
  const value = entry[key];
  if (!value) {
    return;
  }

  const label = getCopyLabel(key);
  const text = [
    entry.sku,
    entry.productName,
    label,
    value,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
  try {
    await copyToClipboard(text);
    showToast(`已複製：${text}`);
  } catch (error) {
    console.error(error);
    showToast("複製失敗，請確認目前頁面已允許剪貼簿權限。");
  }
}

// 成本只在這個分頁的記憶體中解鎖，不進搜尋索引或持久儲存。
let costAttempt = 0;
let costDialogFocus = null;
function bindCostGesture() {
  const tap = createCostGesture(openCostPasswordDialog);
  refs.logoEl.addEventListener('click', () => tap('logo'));
  refs.modePillEl.addEventListener('click', () => tap('pill'));
  refs.pinOverlay.addEventListener('keydown', event => {
    if(event.key==='Escape'){event.preventDefault();closePinDialog();return;}
    if(event.key==='Tab'){
      const nodes=[refs.pinInput,refs.pinCancel,refs.pinConfirm].filter(el=>!el.disabled);
      const first=nodes[0],last=nodes.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
}
function openCostPasswordDialog() {
  if(!managed?.allowed){showToast('請先完成裝置核准並載入料檔');return;}
  if(state.costs){showToast('成本已解鎖，可在更多選項鎖回');return;}
  costAttempt++;
  costDialogFocus=document.activeElement;
  refs.pinInput.value='';refs.pinConfirm.disabled=false;
  refs.pinError.classList.add('hidden');
  refs.pinOverlay.classList.remove('hidden');
  refs.pinOverlay.classList.add('is-visible');
  refs.pinOverlay.setAttribute('aria-hidden','false');
  document.querySelectorAll('.app-shell,.mobile-dock,#detail-overlay,#field-settings-overlay').forEach(el=>el.inert=true);
  refs.pinInput.focus();
}
function closePinDialog() {
  costAttempt++;
  refs.pinInput.value='';refs.pinError.textContent='';refs.pinConfirm.disabled=false;
  refs.pinOverlay.classList.add('hidden');refs.pinOverlay.classList.remove('is-visible');
  refs.pinOverlay.setAttribute('aria-hidden','true');
  document.querySelectorAll('.app-shell,.mobile-dock').forEach(el=>el.inert=!managed?.allowed);
  document.querySelectorAll('#detail-overlay,#field-settings-overlay').forEach(el=>el.inert=false);
  costDialogFocus?.focus();costDialogFocus=null;
}
function lockCosts() {
  state.costs=null;
  refs.toast.textContent='';refs.toast.classList.add('hidden');
  closePinDialog();
  document.querySelector('#cost-lock-button').classList.add('hidden');
  refs.detailGrid.querySelectorAll('[data-cost-field]').forEach(el=>el.remove());
  if(state.selectedEntry&&managed?.allowed)openDetail(state.selectedEntry,{audit:false});
}
function showCosts(rows) {
  state.costs=new Map(rows.map(row=>[row['型號'],row]));
  document.querySelector('#cost-lock-button').classList.remove('hidden');
  if(state.selectedEntry)openDetail(state.selectedEntry,{audit:false});
}
async function onCostPasswordSubmit(event) {
  event.preventDefault();if(refs.pinConfirm.disabled)return;
  const attempt=++costAttempt;
  let password=refs.pinInput.value;refs.pinInput.value='';refs.pinConfirm.disabled=true;
  refs.pinError.classList.add('hidden');
  try{
    const rows=await managed.unlockCosts(password);
    if(attempt!==costAttempt||!managed.allowed)return;
    closePinDialog();showCosts(rows);
    showToast('成本已解鎖，此瀏覽器將保留權限');
  }catch(error){
    if(attempt!==costAttempt)return;
    refs.pinError.textContent=error.message;refs.pinError.classList.remove('hidden');refs.pinInput.focus();
  }finally{password='';if(attempt===costAttempt)refs.pinConfirm.disabled=false;}
}
function renderCostFields(entry) {
  const row=state.costs?.get(entry.sku);
  const fields=row?Object.entries(row).filter(([label])=>isCostField(label)):[];
  if(!fields.length)return `<div class="detail-item" data-cost-field><span class="detail-item-label">成本</span><span class="detail-item-value cost-locked">${state.costs?'無成本資料':'未解鎖'}</span></div>`;
  return fields.map(([label,value])=>`<div class="detail-item detail-item-copyable" data-cost-field data-copy-value="${escapeHtml(String(value))}"><span class="detail-item-label">${escapeHtml(label==='銷售成本'?'成本':label)}</span><span class="detail-item-value">${escapeHtml(String(value))}</span></div>`).join('');
}

async function loadDetailFieldConfig() {
  const saved = await getValue(DETAIL_FIELD_CONFIG_KEY);
  if (saved && Array.isArray(saved) && saved.length > 0) {
    state.detailFieldConfig = saved.filter(f=>!isCostField(f.key)&&!isCostField(f.label));
  }
}

function buildDefaultFieldConfig(entries) {
  const config = [];
  // Standard fields from COLUMN_DEFS — all visible by default
  COLUMN_DEFS.forEach((col, i) => {
    config.push({ key: col.key, label: col.label, source: "standard", visible: true, order: i });
  });
  // Extra fields — collect unique labels across all entries
  const extraKeys = new Set();
  for (const entry of entries) {
    for (const { label } of entry.extras || []) {
      extraKeys.add(label);
    }
  }
  let extraOrder = COLUMN_DEFS.length;
  let extraCount = 0;
  for (const label of extraKeys) {
    config.push({ key: label, label, source: "extra", visible: extraCount < 5, order: extraOrder++ });
    extraCount++;
  }
  return config;
}

async function syncDetailFieldConfig(entries) {
  // First time: build default
  if (state.detailFieldConfig.length === 0) {
    state.detailFieldConfig = buildDefaultFieldConfig(entries);
    await saveDetailFieldConfig();
    return;
  }
  // Merge: add new extra keys from new data that aren't already tracked
  const existingKeys = new Set(state.detailFieldConfig.map((c) => c.key));
  const maxOrder = Math.max(...state.detailFieldConfig.map((c) => c.order), -1);
  let nextOrder = maxOrder + 1;
  let changed = false;
  for (const entry of entries) {
    for (const { label } of entry.extras || []) {
      if (!existingKeys.has(label)) {
        state.detailFieldConfig.push({ key: label, label, source: "extra", visible: false, order: nextOrder++ });
        existingKeys.add(label);
        changed = true;
      }
    }
  }
  if (changed) await saveDetailFieldConfig();
}

async function saveDetailFieldConfig() {
  await setValue(DETAIL_FIELD_CONFIG_KEY, state.detailFieldConfig);
}

function openFieldSettings() {
  if (!refs.fieldSettingsOverlay) return;
  if (state.detailFieldConfig.length === 0) {
    showToast("請先載入價格表，再設定欄位顯示。");
    return;
  }
  renderFieldSettingsList();
  refs.fieldSettingsOverlay.classList.remove("hidden");
  refs.fieldSettingsOverlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("detail-open");
  window.requestAnimationFrame(() => refs.fieldSettingsOverlay.classList.add("is-visible"));
}

function closeFieldSettings() {
  if (!refs.fieldSettingsOverlay) return;
  refs.fieldSettingsOverlay.classList.remove("is-visible");
  if (refs.fieldSettingsSheet) {
    refs.fieldSettingsSheet.style.transform = "translateY(calc(100% + 24px)) scale(0.985)";
    refs.fieldSettingsSheet.style.opacity = "0.94";
  }
  window.setTimeout(() => {
    refs.fieldSettingsOverlay.classList.add("hidden");
    refs.fieldSettingsOverlay.setAttribute("aria-hidden", "true");
    if (refs.fieldSettingsSheet) {
      refs.fieldSettingsSheet.style.transform = "";
      refs.fieldSettingsSheet.style.opacity = "";
    }
    // Only remove body class if detail sheet is also closed
    if (!refs.detailOverlay || refs.detailOverlay.classList.contains("hidden")) {
      document.body.classList.remove("detail-open");
    }
  }, DETAIL_ANIMATION_MS);
}

async function resetFieldConfig() {
  if (state.entries.length === 0) return;
  state.detailFieldConfig = buildDefaultFieldConfig(state.entries);
  await saveDetailFieldConfig();
  renderFieldSettingsList();
  showToast("已重置為預設欄位設定");
}

function renderFieldSettingsList() {
  if (!refs.fieldSettingsList) return;
  const sorted = [...state.detailFieldConfig].sort((a, b) => a.order - b.order);
  refs.fieldSettingsList.innerHTML = sorted.map((item) => `
    <li class="fs-row" data-key="${escapeHtml(item.key)}" draggable="true">
      <span class="fs-handle" title="拖動排序">☰</span>
      <label class="fs-label">
        <input type="checkbox" class="fs-check" ${item.visible ? "checked" : ""}>
        <span>${escapeHtml(item.label)}</span>
        ${item.source === "extra" ? '<span class="fs-tag">額外</span>' : ""}
      </label>
    </li>
  `).join("");

  // Checkbox toggle
  refs.fieldSettingsList.querySelectorAll(".fs-check").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const row = checkbox.closest(".fs-row");
      const key = row?.dataset.key;
      if (!key) return;
      const item = state.detailFieldConfig.find((c) => c.key === key);
      if (item) {
        item.visible = checkbox.checked;
        saveDetailFieldConfig();
      }
    });
  });

  // Desktop drag-to-reorder (HTML5 DnD)
  bindFieldListDragDesktop(refs.fieldSettingsList);
  // Mobile drag-to-reorder (touch events)
  bindFieldListDragTouch(refs.fieldSettingsList);
}

function bindFieldListDragDesktop(list) {
  let dragSrcEl = null;

  list.querySelectorAll(".fs-row").forEach((row) => {
    row.addEventListener("dragstart", (e) => {
      dragSrcEl = row;
      e.dataTransfer.effectAllowed = "move";
      window.requestAnimationFrame(() => row.classList.add("dragging"));
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      list.querySelectorAll(".drag-over").forEach((r) => r.classList.remove("drag-over"));
      dragSrcEl = null;
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      list.querySelectorAll(".drag-over").forEach((r) => r.classList.remove("drag-over"));
      if (row !== dragSrcEl) row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drag-over");
      if (!dragSrcEl || dragSrcEl === row) return;
      const allRows = [...list.querySelectorAll(".fs-row")];
      const srcIdx = allRows.indexOf(dragSrcEl);
      const dstIdx = allRows.indexOf(row);
      if (srcIdx < dstIdx) row.after(dragSrcEl);
      else row.before(dragSrcEl);
      commitFieldOrder(list);
    });
  });
}

function bindFieldListDragTouch(list) {
  let touchDragEl = null;
  let touchClone = null;
  let touchOffsetY = 0;
  let autoScrollTimer = null;

  const SCROLL_ZONE = 72;  // px 距離 sheet 頂 / 底部多近時開始自動捲動
  const SCROLL_SPEED = 5;  // px/frame

  function stopAutoScroll() {
    if (autoScrollTimer) {
      clearInterval(autoScrollTimer);
      autoScrollTimer = null;
    }
  }

  function startAutoScroll(direction) {
    stopAutoScroll();
    autoScrollTimer = setInterval(() => {
      if (refs.fieldSettingsSheet) refs.fieldSettingsSheet.scrollTop += direction * SCROLL_SPEED;
    }, 16);
  }

  list.querySelectorAll(".fs-handle").forEach((handle) => {
    handle.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) return;
      const row = handle.closest(".fs-row");
      if (!row) return;
      touchDragEl = row;
      const touch = e.touches[0];
      const rect = row.getBoundingClientRect();
      touchOffsetY = touch.clientY - rect.top;

      // 建立視覺克隆（固定定位，跟著手指移動）
      touchClone = row.cloneNode(true);
      Object.assign(touchClone.style, {
        position: "fixed",
        left: rect.left + "px",
        width: rect.width + "px",
        top: touch.clientY - touchOffsetY + "px",
        opacity: "0.88",
        zIndex: "9999",
        pointerEvents: "none",
        borderRadius: "12px",
        boxShadow: "0 8px 28px rgba(0,0,0,0.2)",
        background: "var(--surface-strong)",
        transition: "none",
      });
      document.body.appendChild(touchClone);
      row.classList.add("dragging");
      e.preventDefault();
    }, { passive: false });

    handle.addEventListener("touchmove", (e) => {
      if (!touchDragEl || !touchClone || e.touches.length !== 1) return;
      const touch = e.touches[0];
      touchClone.style.top = touch.clientY - touchOffsetY + "px";

      // 自動捲動：手指靠近 sheet 頂/底時觸發
      const sheet = refs.fieldSettingsSheet;
      if (sheet) {
        const sheetRect = sheet.getBoundingClientRect();
        if (touch.clientY < sheetRect.top + SCROLL_ZONE) {
          startAutoScroll(-1);
        } else if (touch.clientY > sheetRect.bottom - SCROLL_ZONE) {
          startAutoScroll(1);
        } else {
          stopAutoScroll();
        }
      }

      // 即時重排：找到手指下方的列，立刻在 DOM 中移動
      const otherRows = [...list.querySelectorAll(".fs-row:not(.dragging)")];
      const target = otherRows.find((r) => {
        const rect = r.getBoundingClientRect();
        return touch.clientY >= rect.top && touch.clientY <= rect.bottom;
      });
      if (target) {
        const allRows = [...list.querySelectorAll(".fs-row")];
        const srcIdx = allRows.indexOf(touchDragEl);
        const dstIdx = allRows.indexOf(target);
        if (srcIdx !== dstIdx) {
          if (srcIdx < dstIdx) target.after(touchDragEl);
          else target.before(touchDragEl);
        }
      }

      e.preventDefault();
    }, { passive: false });

    handle.addEventListener("touchend", () => {
      stopAutoScroll();
      if (!touchDragEl) return;
      if (touchClone) {
        document.body.removeChild(touchClone);
        touchClone = null;
      }
      touchDragEl.classList.remove("dragging");
      commitFieldOrder(list);
      touchDragEl = null;
    });

    handle.addEventListener("touchcancel", () => {
      stopAutoScroll();
      if (touchClone) {
        document.body.removeChild(touchClone);
        touchClone = null;
      }
      if (touchDragEl) {
        touchDragEl.classList.remove("dragging");
        touchDragEl = null;
      }
    });
  });
}

function commitFieldOrder(list) {
  const newOrder = [...list.querySelectorAll(".fs-row")].map((r) => r.dataset.key);
  newOrder.forEach((key, order) => {
    const item = state.detailFieldConfig.find((c) => c.key === key);
    if (item) item.order = order;
  });
  saveDetailFieldConfig();
}

function openDetail(entry, {audit=true} = {}) {
  if (!managed?.allowed) return;
  if(audit)managed.event('view', {sku:entry.sku});
  window.clearTimeout(detailCloseTimer);
  state.selectedEntry = entry;

  refs.detailTitle.textContent = entry.sku || "未識別型號";
  if (refs.detailSubtitle) {
    refs.detailSubtitle.textContent = entry.productName || "";
    refs.detailSubtitle.classList.toggle("hidden", !entry.productName);
  }
  // Render fields using detailFieldConfig if available, otherwise fall back to default
  if (state.detailFieldConfig.length > 0) {
    const visibleFields = [...state.detailFieldConfig]
      .sort((a, b) => a.order - b.order)
      .filter((f) => f.visible && !isCostField(f.key) && !isCostField(f.label));
    refs.detailGrid.innerHTML = visibleFields.map((item) => {
      if (item.source === "standard") {
        const col = COLUMN_DEFS.find((c) => c.key === item.key);
        return col ? renderDetailItem(col, entry) : "";
      } else {
        const extra = (entry.extras || []).find((e) => e.label === item.key);
        const val = extra?.value || "-";
        const copyable = extra?.value ? `data-copy-value="${escapeHtml(val)}"` : "";
        return `
          <div class="detail-item${extra?.value ? " detail-item-copyable" : ""}" ${copyable}>
            <span class="detail-item-label">${escapeHtml(item.label)}</span>
            <span class="detail-item-value">${escapeHtml(val)}</span>
          </div>`;
      }
    }).join("");
  } else {
    const extraRows = (entry.extras || []).map(({ label, value }) => `
      <div class="detail-item${value ? " detail-item-copyable" : ""}" ${value ? `data-copy-value="${escapeHtml(value)}"` : ""}>
        <span class="detail-item-label">${escapeHtml(label)}</span>
        <span class="detail-item-value">${escapeHtml(value || "-")}</span>
      </div>
    `).join("");
    refs.detailGrid.innerHTML = COLUMN_DEFS.map((column) => renderDetailItem(column, entry)).join("") + extraRows;
  }
  // 點擊任意欄位 → 複製「型號 品名 標籤 值」
  refs.detailGrid.insertAdjacentHTML('beforeend',renderCostFields(entry));
  refs.detailGrid.onclick = (e) => {
    const item = e.target.closest("[data-copy-value]");
    if (!item) return;
    const value = item.dataset.copyValue;
    if (!value) return;
    const costCopy=item.hasAttribute('data-cost-field'),epoch=costAttempt;
    if(costCopy&&!state.costs)return;
    const copyKey = item.dataset.copyKey;
    const label = copyKey
      ? getCopyLabel(copyKey)
      : (item.querySelector(".detail-item-label")?.textContent || "");
    const copyEntry = state.selectedEntry;
    const text = [copyEntry?.sku, copyEntry?.productName, label, value]
      .map((p) => String(p || "").trim())
      .filter(Boolean)
      .join(" ");
    copyToClipboard(text)
      .then(() => {if(!costCopy||(state.costs&&epoch===costAttempt))showToast(`已複製：${text}`);})
      .catch(() => showToast("複製失敗，請確認頁面已允許剪貼簿權限。"));
  };

  refs.copyActions.innerHTML = COPYABLE_PRICE_KEYS.map((key) => {
    const label = getCopyLabel(key);
    const value = entry[key] || "-";
    const disabled = entry[key] ? "" : "disabled";
    return `
      <button class="copy-button" type="button" data-detail-copy="${key}" ${disabled}>
        複製${label}：${escapeHtml(value)}
      </button>
    `;
  }).join("");

  refs.copyActions.querySelectorAll("[data-detail-copy]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.detailCopy;
      if (key) {
        copyField(entry, key);
      }
    });
  });

  refs.detailOverlay.classList.remove("hidden");
  refs.detailOverlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("detail-open");
  resetDetailSheetPosition();
  window.requestAnimationFrame(() => {
    refs.detailOverlay.classList.add("is-visible");
  });
}

function renderDetailItem(column, entry) {
  const value = entry[column.key] || "-";
  const copyable = entry[column.key]
    ? `data-copy-value="${escapeHtml(value)}" data-copy-key="${escapeHtml(column.key)}"`
    : "";
  return `
    <div class="detail-item${entry[column.key] ? " detail-item-copyable" : ""}" ${copyable}>
      <span class="detail-item-label">${column.label}</span>
      <span class="detail-item-value">${escapeHtml(value)}</span>
    </div>
  `;
}

function getCopyLabel(key) {
  return COPY_LABELS[key] || COLUMN_DEFS.find((column) => column.key === key)?.label || key;
}

function closeDetail(options = {}) {
  const { immediate = false } = options;
  detailSheetDrag.active = false;
  window.clearTimeout(detailCloseTimer);

  if (refs.detailOverlay.classList.contains("hidden")) {
    finalizeCloseDetail();
    return;
  }

  if (immediate) {
    finalizeCloseDetail();
    return;
  }

  refs.detailOverlay.classList.remove("is-visible");
  if (refs.detailSheet) {
    refs.detailSheet.style.transform = "translateY(calc(100% + 24px)) scale(0.985)";
    refs.detailSheet.style.opacity = "0.94";
  }
  if (refs.detailBackdrop) {
    refs.detailBackdrop.style.background = "rgba(16, 31, 28, 0)";
    refs.detailBackdrop.style.backdropFilter = "blur(0px)";
  }

  detailCloseTimer = window.setTimeout(() => {
    finalizeCloseDetail();
  }, DETAIL_ANIMATION_MS);
}

function finalizeCloseDetail() {
  window.clearTimeout(detailCloseTimer);
  resetDetailSheetPosition();
  if (refs.detailOverlay.contains(document.activeElement)) {
    document.activeElement.blur();
    if (managed?.allowed) refs.searchInput.focus({ preventScroll: true });
  }
  refs.detailOverlay.classList.add("hidden");
  refs.detailOverlay.classList.remove("is-visible");
  refs.detailOverlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("detail-open");
  state.selectedEntry = null;
}

function onDetailTouchStart(event) {
  if (event.touches.length !== 1 || !refs.detailSheet) {
    return;
  }

  const touch = event.touches[0];
  detailSheetDrag.active = true;
  detailSheetDrag.startY = touch.clientY;
  detailSheetDrag.startX = touch.clientX;
  detailSheetDrag.distance = 0;
  detailSheetDrag.startScrollTop = refs.detailSheet.scrollTop;
  detailSheetDrag.lastY = touch.clientY;
  detailSheetDrag.lastTime = performance.now();
  detailSheetDrag.velocity = 0;
}

function onDetailTouchMove(event) {
  if (!detailSheetDrag.active || !refs.detailSheet) {
    return;
  }

  const touch = event.touches[0];
  const deltaY = touch.clientY - detailSheetDrag.startY;
  const deltaX = Math.abs(touch.clientX - detailSheetDrag.startX);
  const now = performance.now();

  if (deltaY <= 0 || deltaX > Math.abs(deltaY) || detailSheetDrag.startScrollTop > 0) {
    detailSheetDrag.distance = 0;
    return;
  }

  const elapsed = Math.max(1, now - detailSheetDrag.lastTime);
  detailSheetDrag.velocity = (touch.clientY - detailSheetDrag.lastY) / elapsed;
  detailSheetDrag.lastY = touch.clientY;
  detailSheetDrag.lastTime = now;

  const dampedDistance = rubberBandDistance(deltaY, 220);
  detailSheetDrag.distance = dampedDistance;
  event.preventDefault();
  applyDetailSheetDrag(dampedDistance);
}

function onDetailTouchEnd() {
  if (!detailSheetDrag.active) {
    return;
  }

  const shouldClose = detailSheetDrag.distance > 110 || (detailSheetDrag.velocity > 0.55 && detailSheetDrag.distance > 28);
  detailSheetDrag.active = false;

  if (shouldClose) {
    closeDetail();
    return;
  }

  resetDetailSheetPosition();
}

function applyDetailSheetDrag(distance) {
  if (!refs.detailSheet || !refs.detailBackdrop) {
    return;
  }

  const progress = Math.min(1, distance / 180);
  const sheetScale = 1 - progress * 0.018;
  refs.detailSheet.style.transform = `translateY(${distance}px) scale(${sheetScale})`;
  refs.detailSheet.style.opacity = String(Math.max(0.94, 1 - distance / 1200));
  const opacity = Math.max(0.12, 0.42 - distance / 320);
  refs.detailBackdrop.style.background = `rgba(16, 31, 28, ${opacity})`;
  refs.detailBackdrop.style.backdropFilter = `blur(${Math.max(0, 6 - distance / 40)}px)`;
  if (refs.detailHandle) {
    refs.detailHandle.style.transform = `translateY(${progress * 2}px) scaleX(${1 + progress * 0.08})`;
    refs.detailHandle.style.opacity = String(Math.max(0.45, 1 - progress * 0.35));
  }
  if (refs.detailHead) {
    refs.detailHead.style.transform = `translateY(${progress * 4}px)`;
  }
  if (refs.detailTitle) {
    refs.detailTitle.style.transform = `scale(${1 - progress * 0.035})`;
    refs.detailTitle.style.transformOrigin = "left center";
  }
}

function resetDetailSheetPosition() {
  if (!refs.detailSheet || !refs.detailBackdrop) {
    return;
  }

  refs.detailSheet.style.transform = "";
  refs.detailSheet.style.opacity = "";
  refs.detailBackdrop.style.background = "";
  refs.detailBackdrop.style.backdropFilter = "";
  if (refs.detailHandle) {
    refs.detailHandle.style.transform = "";
    refs.detailHandle.style.opacity = "";
  }
  if (refs.detailHead) {
    refs.detailHead.style.transform = "";
  }
  if (refs.detailTitle) {
    refs.detailTitle.style.transform = "";
    refs.detailTitle.style.transformOrigin = "";
  }
  detailSheetDrag.distance = 0;
  detailSheetDrag.velocity = 0;
}

function rubberBandDistance(distance, maxDistance) {
  const constrained = Math.max(0, distance);
  return (constrained * maxDistance) / (constrained + maxDistance);
}

async function clearSearchHistory() {
  state.searchHistory = [];
  await deleteValue(SEARCH_HISTORY_KEY);
  renderHistory();
  showToast("最近查詢已清除。");
}

function detectInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.beforeInstallPrompt = event;
    refs.installButton.classList.remove("hidden");
  });

  const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  if (isIOS && !isStandalone) {
    setStatus("iPhone 可在 Safari 使用「分享 -> 加入主畫面」安裝成 App。");
  }
}

async function installApp() {
  if (!state.beforeInstallPrompt) {
    showToast("請使用瀏覽器的加入主畫面功能安裝。");
    return;
  }

  state.beforeInstallPrompt.prompt();
  await state.beforeInstallPrompt.userChoice;
  state.beforeInstallPrompt = null;
  refs.installButton.classList.add("hidden");
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register(`./sw.js?v=${APP_VERSION}`, {
      updateViaCache: "none",
    });
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}

function setStatus(text) {
  if (refs.statusBanner) {
    refs.statusBanner.textContent = text;
  }
}

let toastTimer = null;
function showToast(text) {
  if (!refs.toast) {
    return;
  }
  refs.toast.textContent = text;
  refs.toast.classList.remove("hidden");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => refs.toast.classList.add("hidden"), 2200);
}

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getValue(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function setValue(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('儲存未完成'));
    request.onerror = () => reject(request.error);
  });
}

async function deleteValue(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('清除未完成'));
    request.onerror = () => reject(request.error);
  });
}
