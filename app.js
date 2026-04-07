import * as pdfjsLib from "./vendor/pdfjs/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.mjs";

const APP_VERSION = "11";

const DB_NAME = "local-price-pwa";
const DB_VERSION = 1;
const STORE_NAME = "kv";
const ACTIVE_DOCUMENT_KEY = "active-document";
const SEARCH_HISTORY_KEY = "search-history";
const SEARCH_HISTORY_LIMIT = 6;
const MAX_RESULTS_RENDER = 250;
const ROW_TOLERANCE = 3;
const HEADER_SEGMENT_GAP = 22;
const BUNDLE_VERSION = 2;

const COLUMN_DEFS = [
  { key: "sku", label: "型號", aliases: ["品編", "品号", "品號", "型號"] },
  { key: "retailPrice", label: "建議售價", aliases: ["建議售價", "建議價", "售價"] },
  { key: "bonus", label: "搭贈", aliases: ["搭贈", "贈品", "贈送"] },
  { key: "basePrice", label: "底價", aliases: ["底價"] },
  { key: "tierPrice", label: "量價", aliases: ["量價", "批價", "批發價"] },
  { key: "openingPrice", label: "開盤價", aliases: ["開盤價"] },
  { key: "note", label: "備註", aliases: ["備註", "說明", "備考"] },
];

const COPYABLE_PRICE_KEYS = ["bonus", "basePrice", "tierPrice", "openingPrice"];

const state = {
  bundle: null,
  entries: [],
  filteredEntries: [],
  searchTerm: "",
  searchHistory: [],
  pdfDoc: null,
  selectedEntry: null,
  previewPage: 1,
  previewRenderTask: null,
  beforeInstallPrompt: null,
};

const refs = {
  fileInput: document.querySelector("#file-input"),
  importButton: document.querySelector("#import-button"),
  clearButton: document.querySelector("#clear-button"),
  clearHistoryButton: document.querySelector("#clear-history-button"),
  installButton: document.querySelector("#install-button"),
  appDocLabel: document.querySelector("#app-doc-label"),
  documentTitle: document.querySelector("#document-title"),
  metaPages: document.querySelector("#meta-pages"),
  metaCount: document.querySelector("#meta-count"),
  metaUpdated: document.querySelector("#meta-updated"),
  searchForm: document.querySelector("#search-form"),
  searchInput: document.querySelector("#search-input"),
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
  detailClose: document.querySelector("#detail-close"),
  detailTitle: document.querySelector("#detail-title"),
  detailGrid: document.querySelector("#detail-grid"),
  copyActions: document.querySelector("#copy-actions"),
  previewLabel: document.querySelector("#preview-label"),
  previewCanvas: document.querySelector("#preview-canvas"),
  previewPrev: document.querySelector("#preview-prev"),
  previewNext: document.querySelector("#preview-next"),
};

init().catch((error) => {
  console.error(error);
  setStatus("初始化失敗，請重新整理頁面後再試一次。");
});

async function init() {
  bindEvents();
  state.searchHistory = (await getValue(SEARCH_HISTORY_KEY)) || [];
  renderHistory();
  renderShell();
  updateDockState();
  registerServiceWorker();
  detectInstallPrompt();
  await loadCachedBundle();
}

function bindEvents() {
  refs.importButton.addEventListener("click", () => refs.fileInput.click());
  refs.fileInput.addEventListener("change", onFileSelected);
  refs.clearButton.addEventListener("click", clearStoredDocument);
  refs.clearHistoryButton.addEventListener("click", clearSearchHistory);
  refs.searchForm.addEventListener("submit", onSearchSubmit);
  refs.searchInput.addEventListener("input", onSearchInput);
  refs.resultsList.addEventListener("click", onResultsClick);
  refs.detailBackdrop.addEventListener("click", closeDetail);
  refs.detailClose.addEventListener("click", closeDetail);
  refs.previewPrev.addEventListener("click", () => changePreviewPage(-1));
  refs.previewNext.addEventListener("click", () => changePreviewPage(1));
  refs.installButton.addEventListener("click", installApp);
  refs.dockSearch?.addEventListener("click", focusSearch);
  refs.dockClear?.addEventListener("click", clearActiveSearch);
  refs.dockFirst?.addEventListener("click", scrollToFirstResult);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !refs.detailOverlay.classList.contains("hidden")) {
      closeDetail();
    }
  });
}

async function onFileSelected(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  try {
    setStatus(`正在讀取 ${file.name}...`);
    const arrayBuffer = await file.arrayBuffer();
    const hash = await hashBuffer(arrayBuffer);

    if (state.bundle?.hash === hash && state.bundle?.version === BUNDLE_VERSION) {
      setStatus("這份 PDF 已存在本機，已直接載入。");
      showToast("這份價格表已經在本機。");
      refs.fileInput.value = "";
      return;
    }

    setStatus("正在解析 PDF 並建立本機索引，第一次會花一點時間。");
    const bundle = await buildBundle(file.name, arrayBuffer, hash);
    await setValue(ACTIVE_DOCUMENT_KEY, bundle);
    await activateBundle(bundle);
    setStatus(`已更新價格表：${bundle.fileName}`);
    showToast("新版價格表已覆蓋舊版。");
  } catch (error) {
    console.error("PDF import failed", error);
    const detail = error instanceof Error ? ` ${error.message}` : "";
    setStatus(`PDF 解析失敗，請確認檔案為可選取文字的價格表。${detail}`);
    showToast("解析失敗，請換一份 PDF 試試。");
  } finally {
    refs.fileInput.value = "";
  }
}

async function buildBundle(fileName, arrayBuffer, hash) {
  const sourceBytes = new Uint8Array(ensureArrayBuffer(arrayBuffer));
  const storedPdfBytes = sourceBytes.slice().buffer;
  const parserPdfBytes = sourceBytes.slice();
  const pdfDoc = await pdfjsLib.getDocument({ data: parserPdfBytes }).promise;
  const pageCount = pdfDoc.numPages;
  const entries = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    setStatus(`正在解析第 ${pageNumber} / ${pageCount} 頁...`);
    const page = await pdfDoc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const rows = extractRows(textContent.items);

    for (const row of rows) {
      const parsedRow = parseRowRecord(row.rawText, pageNumber);
      if (parsedRow.type === "ignore") {
        continue;
      }

      if (parsedRow.type === "continuation") {
        appendContinuation(entries, parsedRow.text);
        continue;
      }

      entries.push(parsedRow.entry);
    }
  }

  await pdfDoc.destroy();

  return {
    id: ACTIVE_DOCUMENT_KEY,
    version: BUNDLE_VERSION,
    fileName,
    hash,
    importedAt: new Date().toISOString(),
    pageCount,
    entries: entries.map((entry, index) => ({
      ...entry,
      id: `${entry.sku || "row"}-${entry.pageNumber}-${index}`,
      searchText: buildSearchText(entry),
    })),
    pdfBytes: storedPdfBytes,
  };
}

function parseRowRecord(rawText, pageNumber) {
  const text = normalizeRowText(rawText);
  if (!text || isIgnoredRowText(text)) {
    return { type: "ignore" };
  }

  const priceTokens = extractPriceTokens(text);

  if (priceTokens.length >= 2) {
    const entry = buildEntryFromPattern(text, priceTokens, pageNumber);
    return entry ? { type: "entry", entry } : { type: "ignore" };
  }

  if (isContinuationRowText(text)) {
    return { type: "continuation", text };
  }

  return { type: "ignore" };
}

function buildEntryFromPattern(text, priceTokens, pageNumber) {
  const firstPriceIndex = priceTokens[0]?.index ?? text.length;
  let prefix = text.slice(0, firstPriceIndex).trim();
  if (!prefix) {
    return null;
  }

  let bonus = "";
  const bonusMatch = prefix.match(/(?:^|\s)((?=[0-9/+]*[+/])[0-9/+]{2,}\/{0,2}|\/\/)$/);
  if (bonusMatch) {
    bonus = bonusMatch[1];
    prefix = prefix.slice(0, bonusMatch.index).trim();
  }

  let retailPrice = "";
  const retailMatch = prefix.match(/(?:^|\s)(\d[\d,]*)$/);
  if (retailMatch) {
    retailPrice = retailMatch[1];
    prefix = prefix.slice(0, retailMatch.index).trim();
  }

  const skuAndNote = extractSkuAndNote(prefix);
  if (!skuAndNote.sku) {
    return null;
  }

  const prices = priceTokens.map((token) => token.value);
  const basePrice = prices[0] || "";
  const tierPrice = prices[1] || "";
  const openingPrice = prices[2] || "";

  return {
    sku: skuAndNote.sku,
    retailPrice,
    bonus,
    basePrice,
    tierPrice,
    openingPrice,
    note: skuAndNote.note,
    pageNumber,
  };
}

function extractPriceTokens(text) {
  const results = [];
  const pattern = /\$\s*(-|\d[\d,]*)|(-|\d[\d,]*)(?:\s*\$)/g;

  for (const match of text.matchAll(pattern)) {
    const value = match[1] || match[2];
    if (!value) {
      continue;
    }
    results.push({
      value,
      index: match.index ?? 0,
    });
  }

  return results;
}

function extractSkuAndNote(prefix) {
  const normalized = prefix
    .replace(/／/g, "/")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = normalized.split(" ").filter(Boolean);
  const skuTokens = [];
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index];
    if (!skuTokens.length && !isCodeToken(token)) {
      break;
    }
    if (isCodeToken(token) || isSkuSuffixToken(token)) {
      skuTokens.push(token);
      index += 1;
      continue;
    }
    break;
  }

  const sku = skuTokens.reduce((result, token) => {
    if (!result) {
      return token;
    }
    if (isSkuSuffixToken(token)) {
      return `${result} ${token}`;
    }
    return `${result}${token}`;
  }, "");

  const note = tokens.slice(index).join(" ").trim();
  return {
    sku,
    note,
  };
}

function isCodeToken(token) {
  return /^[A-Z0-9][A-Z0-9.-]*$/i.test(token);
}

function isSkuSuffixToken(token) {
  return /^\/[A-Z0-9.-]+$/i.test(token);
}

function appendContinuation(entries, text) {
  const previous = entries.at(-1);
  if (!previous || !text) {
    return;
  }

  if (!previous.note) {
    previous.note = text;
    return;
  }

  if (!previous.note.includes(text)) {
    previous.note = `${previous.note} ${text}`.trim();
  }
}

function normalizeRowText(text) {
  return String(text || "")
    .replace(/／/g, "/")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/\s*\$\s*/g, "$ ")
    .replace(/\s+/g, " ")
    .trim();
}

function isIgnoredRowText(text) {
  return (
    /^A\s*B\s*C$/i.test(text) ||
    /^[-\s\d]+$/.test(text) ||
    /品\s*編.*建議售價.*搭贈.*底價.*量價.*開盤價/.test(text) ||
    /機密文件/.test(text) ||
    /^202\d年/.test(text) ||
    /^客\s*戶/.test(text) ||
    /^屬\s*性/.test(text) ||
    /^備\s*註.*等\s*級/.test(text) ||
    /^※/.test(text) ||
    isCategoryRowText(text)
  );
}

function isCategoryRowText(text) {
  if (/另計/.test(text)) {
    return true;
  }

  return (
    /(全電壓|單電壓|系列|價目表|定價表|客戶|工廠|批盤|燈飾|電料|燈管|燈具|燈泡|投射燈|空台|蠟燭燈|小夜燈|軌道投射燈)/.test(text) &&
    !/\$/.test(text)
  );
}

function isContinuationRowText(text) {
  if (/\$/.test(text)) {
    return false;
  }

  if (isIgnoredRowText(text)) {
    return false;
  }

  return text.length <= 36 || /(LM\/W|整組價|待機|全亮滅)/.test(text);
}

function extractRows(items) {
  const cleanItems = items
    .map((item) => ({
      text: cleanCellText(item.str),
      x: Number(item.transform?.[4] || 0),
      y: Number(item.transform?.[5] || 0),
      width: Number(item.width || 0),
    }))
    .filter((item) => item.text);

  cleanItems.sort((a, b) => {
    if (Math.abs(a.y - b.y) > ROW_TOLERANCE) {
      return b.y - a.y;
    }
    return a.x - b.x;
  });

  const rows = [];

  for (const item of cleanItems) {
    const lastRow = rows.at(-1);
    if (!lastRow || Math.abs(lastRow.y - item.y) > ROW_TOLERANCE) {
      rows.push({ y: item.y, items: [item] });
      continue;
    }
    lastRow.items.push(item);
  }

  return rows.map((row) => {
    const ordered = row.items.sort((a, b) => a.x - b.x);
    return {
      y: row.y,
      items: ordered,
      segments: mergeSegments(ordered, HEADER_SEGMENT_GAP),
      rawText: ordered.map((item) => item.text).join(" "),
    };
  });
}

function mergeSegments(items, gapThreshold) {
  const segments = [];

  for (const item of items) {
    const last = segments.at(-1);
    if (!last) {
      segments.push({
        text: item.text,
        x: item.x,
        endX: item.x + item.width,
      });
      continue;
    }

    const gap = item.x - last.endX;
    if (gap <= gapThreshold) {
      last.text = joinText(last.text, item.text);
      last.endX = Math.max(last.endX, item.x + item.width);
    } else {
      segments.push({
        text: item.text,
        x: item.x,
        endX: item.x + item.width,
      });
    }
  }

  return segments;
}

function detectHeader(row) {
  const headerSegments = [];

  for (const segment of row.segments) {
    const normalized = normalizeForCompare(segment.text);
    const match = COLUMN_DEFS.find((column) =>
      column.aliases.some((alias) => normalized.includes(normalizeForCompare(alias))),
    );

    if (match) {
      headerSegments.push({
        key: match.key,
        x: segment.x,
        label: match.label,
      });
    }
  }

  const unique = headerSegments.filter(
    (segment, index, all) => all.findIndex((entry) => entry.key === segment.key) === index,
  );

  const hasSku = unique.some((segment) => segment.key === "sku");
  if (!hasSku || unique.length < 4) {
    return null;
  }

  const ordered = unique.sort((a, b) => a.x - b.x);
  return {
    columns: ordered.map((segment, index) => {
      const previous = ordered[index - 1];
      const next = ordered[index + 1];
      return {
        key: segment.key,
        label: segment.label,
        minX: previous ? (previous.x + segment.x) / 2 : Number.NEGATIVE_INFINITY,
        maxX: next ? (segment.x + next.x) / 2 : Number.POSITIVE_INFINITY,
      };
    }),
  };
}

function mapRowToEntry(row, header, pageNumber) {
  const cells = Object.fromEntries(COLUMN_DEFS.map((column) => [column.key, ""]));

  for (const item of row.items) {
    const centerX = item.x + item.width / 2;
    const column = header.columns.find(
      (entry) => centerX >= entry.minX && centerX < entry.maxX,
    );

    if (!column) {
      continue;
    }

    cells[column.key] = joinText(cells[column.key], item.text);
  }

  for (const column of COLUMN_DEFS) {
    cells[column.key] = cleanCellText(cells[column.key]);
  }

  if (isNoiseRow(row, cells)) {
    return null;
  }

  return {
    ...cells,
    pageNumber,
  };
}

function isNoiseRow(row, cells) {
  const rowText = normalizeForCompare(row.rawText);
  const hasAnyField = Object.values(cells).some(Boolean);
  const priceCount = ["retailPrice", "basePrice", "tierPrice", "openingPrice"].filter(
    (key) => cells[key],
  ).length;

  if (!hasAnyField) {
    return true;
  }

  if (/^(頁碼|page|\d+|第\d+頁)$/.test(rowText)) {
    return true;
  }

  if (
    COLUMN_DEFS.every((column) =>
      !cells[column.key] ||
      normalizeForCompare(cells[column.key]).includes(normalizeForCompare(column.label)),
    )
  ) {
    return true;
  }

  return !cells.sku && !cells.note && !cells.bonus && priceCount === 0;
}

function mergeEntry(entries, incoming) {
  const previous = entries.at(-1);

  if (!previous) {
    entries.push(incoming);
    return;
  }

  const incomingHasSku = Boolean(incoming.sku);
  const incomingPriceCount = ["retailPrice", ...COPYABLE_PRICE_KEYS]
    .filter((key) => incoming[key])
    .length;

  if (incomingHasSku || incomingPriceCount > 0) {
    entries.push(incoming);
    return;
  }

  for (const column of COLUMN_DEFS) {
    if (!incoming[column.key]) {
      continue;
    }
    previous[column.key] = joinText(previous[column.key], incoming[column.key]);
  }
}

async function activateBundle(bundle) {
  const pdfBytes = ensureArrayBuffer(bundle.pdfBytes);
  const parserPdfBytes = pdfBytes.slice(0);
  if (state.pdfDoc) {
    try {
      await state.pdfDoc.destroy();
    } catch (error) {
      console.warn("Failed to destroy previous PDF document", error);
    }
  }

  state.bundle = {
    ...bundle,
    pdfBytes,
  };
  state.entries = bundle.entries || [];
  state.pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(parserPdfBytes) }).promise;
  applySearch(state.searchTerm);
  renderShell();
}

async function loadCachedBundle() {
  try {
    const cached = await getValue(ACTIVE_DOCUMENT_KEY);
    if (!cached) {
      setStatus("尚未載入價格表，請先選擇本地 PDF。");
      return;
    }

    const bundle = await upgradeBundleIfNeeded(cached);
    setStatus(`已自動載入本機價格表：${bundle.fileName}`);
    await activateBundle(bundle);
  } catch (error) {
    console.error("Failed to load cached bundle", error);
    await deleteValue(ACTIVE_DOCUMENT_KEY);
    setStatus("先前的本機快取已失效，請重新載入 PDF。");
  }
}

async function upgradeBundleIfNeeded(bundle) {
  if (bundle?.version === BUNDLE_VERSION) {
    return bundle;
  }

  setStatus("正在更新本機索引版本，請稍候...");
  const rebuilt = await buildBundle(
    bundle.fileName || "已保存價格表.pdf",
    ensureArrayBuffer(bundle.pdfBytes),
    bundle.hash || (await hashBuffer(bundle.pdfBytes)),
  );
  await setValue(ACTIVE_DOCUMENT_KEY, rebuilt);
  return rebuilt;
}

function onSearchInput(event) {
  state.searchTerm = event.target.value.trim();
  applySearch(state.searchTerm);
}

async function onSearchSubmit(event) {
  event.preventDefault();
  const term = refs.searchInput.value.trim();
  state.searchTerm = term;
  applySearch(term);
  scrollToResultsTop();

  if (!term) {
    return;
  }

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
  state.filteredEntries = !normalized
    ? state.entries
    : state.entries.filter((entry) => entry.searchText.includes(normalized));

  renderResults();
  updateDockState();
}

function renderShell() {
  const bundle = state.bundle;
  refs.documentTitle.textContent = bundle ? bundle.fileName : "尚未載入價格表";
  if (refs.appDocLabel) {
    refs.appDocLabel.textContent = bundle ? bundle.fileName : "尚未載入價格表";
  }
  refs.metaPages.textContent = bundle ? String(bundle.pageCount) : "-";
  refs.metaCount.textContent = bundle ? String(bundle.entries.length) : "-";
  refs.metaUpdated.textContent = bundle ? formatDateTime(bundle.importedAt) : "-";
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
    });
  });
}

function renderResults() {
  if (!state.bundle) {
    refs.resultsTitle.textContent = "等待匯入價格表";
    refs.resultsSubtitle.textContent = "匯入後會在本機建立索引，下次開啟會自動讀取。";
    refs.emptyState.classList.remove("hidden");
    refs.emptyState.querySelector(".empty-title").textContent = "先載入你的 PDF 價格表";
    refs.emptyState.querySelector(".empty-text").textContent =
      "這個 PWA 不會上傳檔案，只會把解析後的資料與原始 PDF 保存在你的裝置。";
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
      : "點卡片查看細節，或直接點價格快速複製。";

  if (!rendered.length) {
    refs.emptyState.classList.remove("hidden");
    refs.emptyState.querySelector(".empty-title").textContent = "查無符合結果";
    refs.emptyState.querySelector(".empty-text").textContent =
      "可以換關鍵字試試，或直接用型號、底價、開盤價、備註內文字搜尋。";
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
        </div>
        <span class="page-pill">第 ${entry.pageNumber} 頁</span>
      </div>
      <p class="card-note">${escapeHtml(entry.note || "無備註")}</p>
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
          查看細節與 PDF
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

  const label = COLUMN_DEFS.find((column) => column.key === key)?.label || key;
  const text = `型號 ${entry.sku} ${label} ${value}`;
  try {
    await copyToClipboard(text);
    showToast(`已複製：${text}`);
  } catch (error) {
    console.error(error);
    showToast("複製失敗，請確認目前頁面已允許剪貼簿權限。");
  }
}

function openDetail(entry) {
  state.selectedEntry = entry;
  state.previewPage = entry.pageNumber;

  refs.detailTitle.textContent = entry.sku || "未識別型號";
  refs.detailGrid.innerHTML = COLUMN_DEFS.map((column) => renderDetailItem(column, entry)).join("");
  refs.copyActions.innerHTML = COPYABLE_PRICE_KEYS.map((key) => {
    const label = COLUMN_DEFS.find((column) => column.key === key)?.label || key;
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
  renderPreviewPage().catch((error) => {
    if (error?.name !== "RenderingCancelledException") {
      console.error(error);
    }
  });
}

function renderDetailItem(column, entry) {
  return `
    <div class="detail-item">
      <span class="detail-item-label">${column.label}</span>
      <span class="detail-item-value">${escapeHtml(entry[column.key] || "-")}</span>
    </div>
  `;
}

function closeDetail() {
  refs.detailOverlay.classList.add("hidden");
  refs.detailOverlay.setAttribute("aria-hidden", "true");
  state.selectedEntry = null;
}

async function renderPreviewPage() {
  if (!state.pdfDoc || !state.selectedEntry) {
    return;
  }

  const pageNumber = Math.max(1, Math.min(state.previewPage, state.pdfDoc.numPages));
  state.previewPage = pageNumber;
  refs.previewLabel.textContent = `第 ${pageNumber} 頁`;
  refs.previewPrev.disabled = pageNumber <= 1;
  refs.previewNext.disabled = pageNumber >= state.pdfDoc.numPages;

  if (state.previewRenderTask) {
    try {
      state.previewRenderTask.cancel();
    } catch (error) {
      console.warn("Preview render cancel failed", error);
    }
  }

  const page = await state.pdfDoc.getPage(pageNumber);
  const unscaled = page.getViewport({ scale: 1 });
  const frameWidth = refs.previewCanvas.parentElement?.clientWidth || 320;
  const scale = Math.max(1, (frameWidth - 24) / unscaled.width);
  const viewport = page.getViewport({ scale });
  const canvas = refs.previewCanvas;
  const context = canvas.getContext("2d");

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  state.previewRenderTask = page.render({
    canvasContext: context,
    viewport,
  });

  await state.previewRenderTask.promise;
}

function changePreviewPage(offset) {
  if (!state.selectedEntry) {
    return;
  }
  state.previewPage += offset;
  renderPreviewPage().catch((error) => {
    if (error?.name !== "RenderingCancelledException") {
      console.error(error);
    }
  });
}

async function clearStoredDocument() {
  if (!window.confirm("要清除本機已保存的 PDF 與索引嗎？")) {
    return;
  }

  await deleteValue(ACTIVE_DOCUMENT_KEY);
  state.bundle = null;
  state.entries = [];
  state.filteredEntries = [];
  state.searchTerm = "";
  refs.searchInput.value = "";
  if (state.pdfDoc) {
    await state.pdfDoc.destroy();
    state.pdfDoc = null;
  }
  closeDetail();
  renderShell();
  renderResults();
  setStatus("已清除本機價格表。");
  showToast("本機資料已清除。");
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
  refs.statusBanner.textContent = text;
}

let toastTimer = null;
function showToast(text) {
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

function buildSearchText(entry) {
  return normalizeForCompare(
    [
      entry.sku,
      entry.retailPrice,
      entry.bonus,
      entry.basePrice,
      entry.tierPrice,
      entry.openingPrice,
      entry.note,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function cleanCellText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^[|｜]+|[|｜]+$/g, "")
    .trim();
}

function joinText(left, right) {
  if (!left) {
    return right || "";
  }
  if (!right) {
    return left;
  }
  if (left.endsWith(right) || right.startsWith(left)) {
    return left;
  }
  const lastChar = left.slice(-1);
  const firstChar = right.slice(0, 1);
  const needsSpace = /[A-Za-z0-9]$/.test(lastChar) && /^[A-Za-z0-9]/.test(firstChar);
  return `${left}${needsSpace ? " " : ""}${right}`;
}

function normalizeForCompare(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[：:;,.，。/\\|｜()\[\]{}_-]/g, "");
}

function formatDateTime(isoString) {
  if (!isoString) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-Hant-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoString));
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ensureArrayBuffer(buffer) {
  if (buffer instanceof ArrayBuffer) {
    return buffer;
  }

  if (ArrayBuffer.isView(buffer)) {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }

  return new Uint8Array(buffer).buffer;
}

async function hashBuffer(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", ensureArrayBuffer(buffer));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function deleteValue(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
