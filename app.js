import * as pdfjsLib from "./vendor/pdfjs/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.mjs";

const APP_VERSION = new URL(import.meta.url).searchParams.get("v") ?? "?";

const DB_NAME = "local-price-pwa";
const DB_VERSION = 1;
const STORE_NAME = "kv";
const ACTIVE_DOCUMENT_KEY = "active-document";
const SEARCH_HISTORY_KEY = "search-history";
const SEARCH_HISTORY_LIMIT = 10;
const MAX_RESULTS_RENDER = 250;
const ROW_TOLERANCE = 3;
const HEADER_SEGMENT_GAP = 22;
const BUNDLE_VERSION = 31;
const PRODUCT_NAME_FILE = "./name.xlsx";
const PRODUCT_NAME_LIBRARY_SRC = "./vendor/xlsx/xlsx.full.min.js";
const WATERMARK_CODE_PATTERN = /\bS(?:1[E-Z]|2[A-Z]{1,2}|3[A-Z]{1,2}|5[A-Z]{1,2})\b/gi;
const WATERMARK_PREFIX_PATTERN = /\bS(?:1[E-Z]|2[A-Z]{1,2}|3[A-Z]{1,2}|5[A-Z]{1,2})(?=\d)/gi;
const WATERMARK_EXACT_PATTERN = /^S(?:1[E-Z]|2[A-Z]{1,2}|3[A-Z]{1,2}|5[A-Z]{1,2})$/i;
const PRODUCT_NAME_HEADER_ALIASES = {
  sku: ["型號", "品編"],
  productName: ["品名", "中文品名", "中文名稱", "名稱"],
};
const V2_PROFILE_ID = "price-sheet-202604-v2";
const V2_PROFILE_VERSION = 1;
const V2_HEADER_ALIASES = {
  sku: ["品編", "型號"],
  retailPrice: ["建議售價"],
  bonus: ["搭贈"],
  basePrice: ["底價", "A"],
  tierPrice: ["量價", "B"],
  openingPrice: ["開盤價", "C"],
  note: ["備註", "補充資訊"],
};
const CANONICAL_HEADER_ALIASES = {
  sku: ["品編", "型號"],
  retailPrice: ["建議售價"],
  bonus: ["搭贈"],
  basePrice: ["底價", "A"],
  tierPrice: ["量價", "B"],
  openingPrice: ["開盤價", "C"],
  note: ["備註", "補充資訊"],
  atPrice: ["@"],
};

const EXPLICIT_HEADER_ALIASES = {
  sku: ["品編", "型號"],
  retailPrice: ["建議售價"],
  bonus: ["搭贈"],
  basePrice: ["底價", "A"],
  tierPrice: ["量價", "B"],
  openingPrice: ["開盤價", "C"],
  note: ["備註", "補充資訊"],
  atPrice: ["@"],
};
const DETAIL_ANIMATION_MS = 280;
const DETAIL_FIELD_CONFIG_KEY = "detail-field-config";
const UNLOCK_PASSPHRASE_KEY = "unlock-passphrase";
const WATERMARK_MIN_WIDTH = 160;
const WATERMARK_MIN_HEIGHT = 90;
const WATERMARK_MAX_TEXT_LENGTH = 12;
const IS_TEST_MODE = typeof window !== "undefined" && window.__LOCAL_PRICE_PWA_TEST__ === true;

const COLUMN_DEFS = [
  { key: "sku", label: "型號", aliases: ["品編", "品号", "品號", "型號"] },
  { key: "retailPrice", label: "建議售價", aliases: ["建議售價", "建議價", "售價"] },
  { key: "bonus", label: "搭贈", aliases: ["搭贈", "贈品", "贈送"] },
  { key: "basePrice", label: "底價", aliases: ["底價"] },
  { key: "tierPrice", label: "量價", aliases: ["量價", "批價", "批發價"] },
  { key: "openingPrice", label: "開盤價", aliases: ["開盤價"] },
  { key: "note", label: "補充資訊", aliases: ["備註", "補充資訊", "說明", "備考"] },
];

const OPTIONAL_PARSE_COLUMNS = [
  { key: "atPrice", label: "@", aliases: ["@", "＠"] },
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
  searchHistory: [],
  pdfDoc: null,
  selectedEntry: null,
  previewPage: 1,
  previewRenderTask: null,
  beforeInstallPrompt: null,
  detailFieldConfig: [],
};

const refs = {
  fileInput: document.querySelector("#file-input"),
  panelMoreOptions: document.querySelector(".panel-more-options"),
  importButton: document.querySelector("#import-button"),
  clearButton: document.querySelector("#clear-button"),
  clearHistoryButton: document.querySelector("#clear-history-button"),
  installButton: document.querySelector("#install-button"),
  appDocLabel: document.querySelector("#app-doc-label"),
  documentTitle: document.querySelector("#document-title"),
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
  detailSheet: document.querySelector("#detail-sheet"),
  detailHead: document.querySelector("#detail-head"),
  detailHandle: document.querySelector("#detail-handle"),
  detailClose: document.querySelector("#detail-close"),
  detailTitle: document.querySelector("#detail-title"),
  detailSubtitle: document.querySelector("#detail-subtitle"),
  detailGrid: document.querySelector("#detail-grid"),
  copyActions: document.querySelector("#copy-actions"),
  previewLabel: document.querySelector("#preview-label"),
  previewCanvas: document.querySelector("#preview-canvas"),
  previewPrev: document.querySelector("#preview-prev"),
  previewNext: document.querySelector("#preview-next"),
  previewZone: document.querySelector("#preview-zone"),
  jsonFileInput: document.querySelector("#json-file-input"),
  jsonImportButton: document.querySelector("#json-import-button"),
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
  pinRemember: document.querySelector("#pin-remember"),
  pinManageBtn: document.querySelector("#pin-manage-btn"),
  pinClearSaved: document.querySelector("#pin-clear-saved"),
  pinSaveNew: document.querySelector("#pin-save-new"),
  pinNewInput: document.querySelector("#pin-new-input"),
  pinUnlockSection: document.querySelector("#pin-unlock-section"),
  pinManageSection: document.querySelector("#pin-manage-section"),
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
let xlsxLibraryPromise = null;
let productNameResourcePromise = null;

if (!IS_TEST_MODE) {
  init().catch((error) => {
    console.error(error);
    setStatus("初始化失敗，請重新整理頁面後再試一次。");
  });
}

async function init() {
  const versionEl = document.querySelector(".app-version");
  if (versionEl) versionEl.textContent = `v${APP_VERSION}`;
  bindEvents();
  state.searchHistory = (await getValue(SEARCH_HISTORY_KEY)) || [];
  await loadDetailFieldConfig();
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
  refs.jsonImportButton.addEventListener("click", () => refs.jsonFileInput.click());
  refs.jsonFileInput.addEventListener("change", onJsonFileSelected);
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
  bindUnlockGesture();
  refs.pinConfirm?.addEventListener("click", onPassphraseConfirm);
  refs.pinCancel?.addEventListener("click", closePinDialog);
  refs.pinOverlay?.addEventListener("click", (e) => { if (e.target === refs.pinOverlay) closePinDialog(); });
  refs.pinInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") onPassphraseConfirm(); });
  refs.pinManageBtn?.addEventListener("click", toggleManageMode);
  refs.pinClearSaved?.addEventListener("click", clearSavedPassphrase);
  refs.pinSaveNew?.addEventListener("click", saveNewPassphrase);
  refs.clearButton.addEventListener("click", clearStoredDocument);
  refs.clearHistoryButton.addEventListener("click", clearSearchHistory);
  refs.searchForm.addEventListener("submit", onSearchSubmit);
  refs.searchInput.addEventListener("input", onSearchInput);
  refs.resultsList.addEventListener("click", onResultsClick);
  refs.detailBackdrop.addEventListener("click", closeDetail);
  refs.detailClose.addEventListener("click", closeDetail);
  refs.detailSheet?.addEventListener("touchstart", onDetailTouchStart, { passive: true });
  refs.detailSheet?.addEventListener("touchmove", onDetailTouchMove, { passive: false });
  refs.detailSheet?.addEventListener("touchend", onDetailTouchEnd);
  refs.detailSheet?.addEventListener("touchcancel", onDetailTouchEnd);
  refs.previewPrev.addEventListener("click", () => changePreviewPage(-1));
  refs.previewNext.addEventListener("click", () => changePreviewPage(1));
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
        openPassphraseDialog();
      } else {
        _ctrlBackslashLast = now;
      }
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
    const productNameResource = await getProductNameResource();
    const hasLatestNameMap = (state.bundle?.nameMapHash || "") === (productNameResource.hash || "");

    if (state.bundle?.hash === hash && state.bundle?.version === BUNDLE_VERSION && hasLatestNameMap) {
      setStatus("這份 PDF 已存在本機，已直接載入。");
      showToast("這份價格表已經在本機。");
      refs.fileInput.value = "";
      return;
    }

    setStatus("正在解析 PDF 並建立本機索引，第一次會花一點時間。");
    const bundle = await buildBundle(file.name, arrayBuffer, hash);
    await setValue(ACTIVE_DOCUMENT_KEY, bundle);
    await activateBundle(bundle);
    setStatus(getImportedBundleStatus(bundle));
    showToast(getImportedBundleToast(bundle));
  } catch (error) {
    console.error("PDF import failed", error);
    const detail = error instanceof Error ? ` ${error.message}` : "";
    setStatus(`PDF 解析失敗，請確認檔案為可選取文字的價格表。${detail}`);
    showToast("解析失敗，請換一份 PDF 試試。");
  } finally {
    refs.fileInput.value = "";
  }
}

async function onJsonFileSelected(event) {
  const [file] = event.target.files || [];
  if (!file) return;
  try {
    setStatus(`正在讀取 ${file.name}...`);
    const text = await file.text();
    const jsonData = JSON.parse(text);
    let rawEntries, protConfig = null;
    if (Array.isArray(jsonData)) {
      // 舊格式：明文陣列
      if (jsonData.length === 0) throw new Error("JSON 格式錯誤，請確認為非空陣列格式。");
      rawEntries = jsonData;
    } else if (jsonData._v === 2 && jsonData.data) {
      // v2 格式（舊版相容）
      protConfig = { _v: 2, salt: jsonData._salt, iv: jsonData._iv, data: jsonData.data };
      rawEntries = [];
    } else if (jsonData.r && jsonData.q && jsonData.p && typeof jsonData.r === "string") {
      // v3 格式：多層混淆加密
      protConfig = { _v: 3, r: jsonData.r, q: jsonData.q, p: jsonData.p };
      rawEntries = [];
    } else {
      throw new Error("JSON 格式錯誤，請確認為正確格式。");
    }
    const hash = await hashBuffer(await file.arrayBuffer());
    setStatus("正在建立本機索引...");
    const bundle = buildBundleFromJson(file.name, rawEntries, hash, protConfig);
    await setValue(ACTIVE_DOCUMENT_KEY, bundle);
    await activateBundleFromJson(bundle);
    if (protConfig) {
      setStatus(`已載入加密價格表：${file.name}。完成解鎖手勢後輸入密碼即可查看。`);
      showToast("加密價格表已載入，請解鎖後查看");
    } else {
      setStatus(`已從 JSON 載入 ${bundle.entries.length} 筆資料：${file.name}`);
      showToast(`已載入 ${bundle.entries.length} 筆資料`);
    }
  } catch (error) {
    console.error("JSON import failed", error);
    const detail = error instanceof Error ? ` ${error.message}` : "";
    setStatus(`JSON 解析失敗。${detail}`);
    showToast("JSON 解析失敗，請確認格式正確。");
  } finally {
    refs.jsonFileInput.value = "";
  }
}

function buildBundleFromJson(fileName, jsonData, hash, protConfig = null) {
  const entries = jsonData.map((row, index) => {
    const entry = { pageNumber: 0, searchAliases: [], extras: [] };
    for (const [col, val] of Object.entries(row)) {
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
    pageCount: 0,
    nameMapHash: "",
    entries,
    pdfBytes: null,
    protConfig,
  };
}

async function activateBundleFromJson(bundle) {
  if (state.pdfDoc) {
    try {
      await state.pdfDoc.destroy();
    } catch (error) {
      console.warn("Failed to destroy previous PDF document", error);
    }
    state.pdfDoc = null;
  }
  state.bundle = bundle;
  state.entries = bundle.entries || [];
  await syncDetailFieldConfig(state.entries);
  applySearch(state.searchTerm);
  renderShell();
  // 加密 bundle：有儲存密碼就自動解鎖，不需要手勢
  if (bundle.protConfig) {
    const saved = await getValue(UNLOCK_PASSPHRASE_KEY);
    if (saved) {
      try {
        await unlockBundle(saved);
      } catch {
        // 儲存的密碼失效（例如 JSON 已換），靜默忽略，等待手勢手動解鎖
      }
    }
  }
}

async function buildBundle(fileName, arrayBuffer, hash) {
  const sourceBytes = new Uint8Array(ensureArrayBuffer(arrayBuffer));
  const storedPdfBytes = sourceBytes.slice().buffer;
  const parserPdfBytes = sourceBytes.slice();
  const currentProductNameResourcePromise = getProductNameResource();
  const pdfDoc = await pdfjsLib.getDocument({ data: parserPdfBytes }).promise;
  const pageCount = pdfDoc.numPages;
  const firstPage = await pdfDoc.getPage(1);
  const firstRows = extractRows((await firstPage.getTextContent()).items);
  const profile = detectDocumentProfile(fileName, hash, firstRows);

  if (profile?.id === V2_PROFILE_ID) {
    const bundle = await buildV2BundleFromDocument({
      fileName,
      hash,
      pdfDoc,
      pageCount,
      storedPdfBytes,
      profile,
    });
    await pdfDoc.destroy();
    return bundle;
  }

  const entries = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    setStatus(`正在解析第 ${pageNumber} / ${pageCount} 頁...`);
    const page = await pdfDoc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const rows = extractRows(textContent.items);
    const pageHasAtPrice = rows.some((row) => /[@＠]/.test(row.rawText));
    let activeHeader = null;
    let pendingHeaderSegments = [];
    let sectionStartIndex = entries.length;
    let sharedFields = {};

    for (const row of rows) {
      const normalizedRowText = normalizeRowText(row.rawText);
      const rowHeaderSegments = collectHeaderSegments(row);
      const detectedHeader = detectHeader(row, pendingHeaderSegments);
      if (detectedHeader) {
        activeHeader = detectedHeader;
        pendingHeaderSegments = [];
        sectionStartIndex = entries.length;
        sharedFields = {};
        continue;
      }

      if (rowHeaderSegments.length) {
        pendingHeaderSegments = mergeHeaderSegments(pendingHeaderSegments, rowHeaderSegments);
        continue;
      }

      pendingHeaderSegments = [];

      if (activeHeader) {
        if (isCategoryRowText(normalizedRowText)) {
          sectionStartIndex = entries.length;
          sharedFields = {};
          continue;
        }

        const mappedEntry = mapRowToEntry(row, activeHeader, pageNumber);
        if (mappedEntry) {
          mappedEntry._pageHasAtPrice = pageHasAtPrice;
          const normalizedEntry = normalizeMappedEntry(mappedEntry);
          if (isSharedFieldEntry(normalizedEntry)) {
            sharedFields = promoteSectionBonusToShared(entries, sharedFields, pageNumber, sectionStartIndex);
            sharedFields = updateSharedFields(sharedFields, normalizedEntry);
            backfillSharedFields(entries, sharedFields, pageNumber, sectionStartIndex);
          } else {
            if (sharedFields.sharedBonusActive && normalizedEntry.bonus) {
              sharedFields = updateSharedFields(sharedFields, normalizedEntry);
              normalizedEntry.bonus = "";
              backfillSharedFields(entries, sharedFields, pageNumber, sectionStartIndex);
            }
            mergeEntry(entries, applySharedFields(normalizedEntry, sharedFields));
          }
        }
        continue;
      }

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
  const productNameResource = await currentProductNameResourcePromise;
  return createBundle({
    fileName,
    hash,
    pageCount,
    entries,
    storedPdfBytes,
    productNameResource,
  });
}

function detectDocumentProfile(fileName, hash, firstRows) {
  const header = detectV2Header(firstRows);
  if (!header) {
    return null;
  }

  return {
    id: V2_PROFILE_ID,
    version: V2_PROFILE_VERSION,
    sourceFingerprint: `${V2_PROFILE_ID}:${hash}`,
  };
}

async function buildV2BundleFromDocument({ fileName, hash, pdfDoc, pageCount, storedPdfBytes, profile }) {
  const currentProductNameResourcePromise = getProductNameResource();
  const entries = [];
  let lastKnownHeader = null;

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    setStatus(`正在套用 202604V2 專用解析：第 ${pageNumber} / ${pageCount} 頁...`);
    const page = await pdfDoc.getPage(pageNumber);
    const rows = extractRows((await page.getTextContent()).items);
    const detectedHeader = detectV2Header(rows);
    const headerSource = detectedHeader ? "新偵測" : (lastKnownHeader ? "沿用上頁" : "無");
    if (detectedHeader) {
      lastKnownHeader = detectedHeader;
    }
    const header = detectedHeader || lastKnownHeader;

    const entriesBefore = entries.length;
    if (!header) {
      console.log(`[V2解析] 第 ${pageNumber}/${pageCount} 頁：header=${headerSource}，跳過整頁`);
      continue;
    }

    const sectionState = {
      title: "",
      tokens: [],
      startIndex: entries.length,
      sharedBonus: "",
      sharedBonusActive: false,
      sharedNote: "",
      sharedNoteStartIndex: null,
      sharedNoteSignature: "",
    };

    for (const row of rows) {
      if (row.y >= header.contentStartY) {
        continue;
      }

      const parsed = parseV2Row(row, header, pageNumber);
      if (!parsed) {
        continue;
      }

      if (parsed.kind === "category") {
        sectionState.title = parsed.title;
        sectionState.tokens = parsed.tokens;
        sectionState.startIndex = entries.length;
        sectionState.sharedBonus = "";
        sectionState.sharedBonusActive = false;
        sectionState.sharedNote = "";
        sectionState.sharedNoteStartIndex = null;
        sectionState.sharedNoteSignature = "";
        continue;
      }

      if (parsed.kind === "sharedBonus") {
        sectionState.sharedBonusActive = true;
        sectionState.sharedBonus = promoteV2SectionBonusToShared(
          entries,
          sectionState.sharedBonus,
          pageNumber,
          sectionState.startIndex,
        );
        sectionState.sharedBonus = mergeSharedBonus(sectionState.sharedBonus, parsed.value);
        for (let index = sectionState.startIndex; index < entries.length; index += 1) {
          if (entries[index].pageNumber === pageNumber) {
            entries[index].bonus = sectionState.sharedBonus;
          }
        }
        continue;
      }

      if (parsed.kind === "sharedNote") {
        sectionState.sharedNote = joinV2Note(sectionState.sharedNote, parsed.value);
        sectionState.sharedNoteStartIndex = sectionState.sharedNoteStartIndex ?? Math.max(sectionState.startIndex, entries.length - 1);
        sectionState.sharedNoteSignature =
          sectionState.sharedNoteSignature ||
          getV2EntrySignature(entries[sectionState.sharedNoteStartIndex]);
        for (let index = sectionState.sharedNoteStartIndex; index < entries.length; index += 1) {
          if (
            entries[index].pageNumber === pageNumber &&
            getV2EntrySignature(entries[index]) === sectionState.sharedNoteSignature
          ) {
            entries[index].note = joinV2Note(entries[index].note, sectionState.sharedNote);
          }
        }
        continue;
      }

      const entrySignature = getV2EntrySignature(parsed.entry);
      const shouldApplySharedNote =
        sectionState.sharedNote &&
        entrySignature &&
        entrySignature === sectionState.sharedNoteSignature;
      const entryHasStructuredBonus = isStructuredBonusValue(parsed.entry.bonus);

      if (sectionState.sharedBonusActive && entryHasStructuredBonus) {
        sectionState.sharedBonus = mergeSharedBonus(sectionState.sharedBonus, parsed.entry.bonus);
        parsed.entry.bonus = "";
        for (let index = sectionState.startIndex; index < entries.length; index += 1) {
          if (entries[index].pageNumber === pageNumber) {
            entries[index].bonus = sectionState.sharedBonus;
          }
        }
      }

      const entry = {
        ...parsed.entry,
        bonus: parsed.entry.bonus || (sectionState.sharedBonusActive ? sectionState.sharedBonus : ""),
        note: shouldApplySharedNote ? joinV2Note(parsed.entry.note, sectionState.sharedNote) : parsed.entry.note,
        categoryTokens: [],
        searchAliases: buildV2SearchAliases(parsed.entry),
        pageNumber,
      };
      const hasAnyPrice = entry.retailPrice || entry.basePrice || entry.tierPrice || entry.openingPrice;
      if (!hasAnyPrice) {
        continue;
      }
      entries.push(entry);

      if (sectionState.sharedNote && !shouldApplySharedNote) {
        sectionState.sharedNote = "";
        sectionState.sharedNoteStartIndex = null;
        sectionState.sharedNoteSignature = "";
      }
    }
    console.log(`[V2解析] 第 ${pageNumber}/${pageCount} 頁：header=${headerSource}，本頁加入 ${entries.length - entriesBefore} 筆，累計 ${entries.length} 筆`);
  }
  console.log(`[V2解析] 解析完成，共 ${entries.length} 筆`);
  const productNameResource = await currentProductNameResourcePromise;
  return createBundle({
    fileName,
    hash,
    pageCount,
    entries,
    storedPdfBytes,
    profile,
    productNameResource,
  });
}

function createBundle({ fileName, hash, pageCount, entries, storedPdfBytes, profile = null, productNameResource }) {
  const bundle = {
    id: ACTIVE_DOCUMENT_KEY,
    version: BUNDLE_VERSION,
    fileName,
    hash,
    importedAt: new Date().toISOString(),
    pageCount,
    nameMapHash: productNameResource?.hash || "",
    entries: finalizeBundleEntries(entries, productNameResource),
    pdfBytes: storedPdfBytes,
  };

  if (profile) {
    bundle.profileId = profile.id;
    bundle.profileVersion = profile.version;
    bundle.sourceFingerprint = profile.sourceFingerprint;
  }

  return bundle;
}

function finalizeBundleEntries(entries, productNameResource) {
  return entries.map((entry, index) => finalizeBundleEntry(entry, index, productNameResource));
}

function finalizeBundleEntry(entry, index, productNameResource) {
  const productName = lookupProductName(entry.sku, productNameResource) || entry.productName || "";
  const searchAliases = mergeSearchAliases(entry.searchAliases, productName);
  const finalizedEntry = {
    ...entry,
    productName,
    searchAliases,
  };

  return {
    ...finalizedEntry,
    id: `${finalizedEntry.sku || "row"}-${finalizedEntry.pageNumber}-${index}`,
    searchText: buildSearchText(finalizedEntry),
  };
}

function detectV2Header(rows) {
  const matches = {};

  for (const row of rows) {
    const ordered = [...row.items].sort((a, b) => a.x - b.x);
    for (let index = 0; index < ordered.length; index += 1) {
      const item = ordered[index];
      const next = ordered[index + 1];
      const candidates = [
        { text: item.text, x: item.x, y: row.y },
      ];

      if (next) {
        candidates.push({
          text: `${item.text}${next.text}`,
          x: Math.min(item.x, next.x),
          y: row.y,
        });
      }

      for (const candidate of candidates) {
        const key = matchV2HeaderKey(candidate.text);
        if (!key) {
          continue;
        }

        const existing = matches[key];
        if (!existing || candidate.y > existing.y || (candidate.y === existing.y && candidate.x > existing.x)) {
          matches[key] = candidate;
        }
      }
    }
  }

  if (!matches.sku || !matches.retailPrice || !matches.basePrice || !matches.tierPrice || !matches.openingPrice) {
    return null;
  }

  const ordered = [
    matches.sku,
    matches.retailPrice,
    matches.bonus,
    matches.basePrice,
    matches.tierPrice,
    matches.openingPrice,
    matches.note,
  ].filter(Boolean).map((entry) => ({
    key: matchV2HeaderKey(entry.text),
    x: entry.x,
    y: entry.y,
  })).sort((a, b) => a.x - b.x);

  return {
    contentStartY: Math.min(...Object.values(matches).map((entry) => entry.y)) - 8,
    columns: ordered.map((entry, index) => {
      const previous = ordered[index - 1];
      const next = ordered[index + 1];
      return {
        key: entry.key,
        x: entry.x,
        minX: previous ? (previous.x + entry.x) / 2 : Number.NEGATIVE_INFINITY,
        maxX: next ? (entry.x + next.x) / 2 : Number.POSITIVE_INFINITY,
      };
    }),
  };
}

function matchV2HeaderKey(text) {
  const normalized = normalizeForCompare(text);
  for (const [key, aliases] of Object.entries(V2_HEADER_ALIASES)) {
    for (const alias of aliases) {
      const normalizedAlias = normalizeForCompare(alias);
      if (normalizedAlias && normalized.includes(normalizedAlias)) {
        return key;
      }
    }
  }
  return "";
}

function parseV2Row(row, header, pageNumber) {
  const cells = {
    sku: "",
    retailPrice: "",
    bonus: "",
    basePrice: "",
    tierPrice: "",
    openingPrice: "",
    note: "",
  };

  const ordered = [...row.items].sort((a, b) => a.x - b.x);
  const retailColumn = header.columns.find((column) => column.key === "retailPrice");
  const noteColumn = header.columns.find((column) => column.key === "note");
  const rightMostPriceColumn = [...header.columns]
    .filter((column) => ["basePrice", "tierPrice", "openingPrice"].includes(column.key))
    .sort((a, b) => b.x - a.x)[0];

  if (isV2CategoryRow(row, retailColumn?.x || 0, rightMostPriceColumn?.x || 0)) {
    return {
      kind: "category",
      title: cleanCellText(row.rawText),
      tokens: deriveV2CategoryTokens(cleanCellText(row.rawText)),
    };
  }

  for (const item of ordered) {
    const centerX = item.x + item.width / 2;
    if (noteColumn && centerX >= noteColumn.minX) {
      cells.note = joinText(cells.note, item.text);
      continue;
    }

    const targetColumn = header.columns.find(
      (column) => centerX >= column.minX && centerX < column.maxX,
    );

    if (!targetColumn) {
      continue;
    }

    if (targetColumn.key === "note" || (rightMostPriceColumn && centerX > rightMostPriceColumn.x + 36)) {
      cells.note = joinText(cells.note, item.text);
      continue;
    }

    cells[targetColumn.key] = joinText(cells[targetColumn.key], item.text);
  }

  const hasPrice = Boolean(cells.retailPrice || cells.basePrice || cells.tierPrice || cells.openingPrice);
  const hasSkuOrNote = Boolean(cells.sku || cells.note || cells.bonus);
  if (!hasPrice && !hasSkuOrNote) {
    return null;
  }

  if (!cells.sku && !cells.retailPrice && !cells.basePrice && !cells.tierPrice && !cells.openingPrice && cells.bonus) {
    return {
      kind: "sharedBonus",
      value: normalizeV2Bonus(cells.bonus),
    };
  }

  if (!cells.sku && !cells.retailPrice && !cells.basePrice && !cells.tierPrice && !cells.openingPrice && cells.note) {
    return {
      kind: "sharedNote",
      value: normalizeV2Note(cells.note),
    };
  }

  const leftData = extractV2SkuAndNote(cells.sku);
  const openingSplit = splitMixedPriceAndNote(cells.openingPrice);
  const baseSplit = splitMixedPriceAndNote(cells.basePrice);
  const tierSplit = splitMixedPriceAndNote(cells.tierPrice);
  const retailSplit = splitRetailPriceAndLeadingNote(
    cells.retailPrice,
    Boolean(baseSplit.price || tierSplit.price || openingSplit.price),
  );
  const note = joinV2Note(
    joinV2Note(joinV2Note(leftData.note, retailSplit.note), cells.note),
    joinV2Note(joinV2Note(baseSplit.note, tierSplit.note), openingSplit.note),
  );

  return {
    kind: "entry",
    entry: {
      sku: leftData.sku || cleanCellText(cells.sku),
      retailPrice: retailSplit.price,
      bonus: normalizeV2Bonus(cells.bonus),
      basePrice: baseSplit.price,
      tierPrice: tierSplit.price,
      openingPrice: openingSplit.price,
      note,
      pageNumber,
    },
  };
}

function isV2CategoryRow(row, retailX, rightMostPriceX) {
  const ordered = [...row.items].sort((a, b) => a.x - b.x);
  if (!ordered.length) {
    return false;
  }

  const text = cleanCellText(row.rawText);
  const allLeft = ordered.every((item) => item.x < retailX - 40);
  const touchesPriceZone = ordered.some((item) => item.x >= retailX - 20);
  if (!allLeft || touchesPriceZone) {
    return false;
  }

  if (looksLikeV2ContinuationText(text)) {
    return false;
  }

  return looksLikeV2CategoryText(text);
}

function looksLikeV2CategoryText(text) {
  const normalized = cleanCellText(text);
  if (!normalized) {
    return false;
  }

  return /(全電壓|單電壓|球泡燈|投射燈泡|蠟燭燈|小夜燈|軌道投射燈|神盾筒燈|燈絲燈|羅浮宮|AR-111|E27|E14|E12|LED軌道投射燈|筒燈|燈泡)/.test(
    normalized,
  );
}

function looksLikeV2ContinuationText(text) {
  const normalized = cleanCellText(text);
  if (!normalized) {
    return false;
  }

  return /(RA\d+|R9>|耐壓|發光角|色溫|色\b|銀\/黑|銀色|黑色|內附|調光|lm|V\b|W\/N|D\/W\/N|\/\/\/|\/\/)/i.test(
    normalized,
  );
}

function extractV2SkuAndNote(leftText) {
  const normalized = String(leftText || "")
    .replace(/／/g, "/")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = normalized.split(" ").filter(Boolean);
  const skuTokens = [];
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index];
    if (!skuTokens.length && !isV2SkuToken(token)) {
      break;
    }
    if (isV2SkuToken(token)) {
      skuTokens.push(token);
      index += 1;
      continue;
    }
    break;
  }

  return {
    sku: skuTokens.join("").replace(/\s+/g, ""),
    note: normalizeV2Note(tokens.slice(index).join(" ")),
  };
}

function isV2SkuToken(token) {
  return /^[A-Z0-9][A-Z0-9./-]*$/i.test(String(token || ""));
}

function normalizeV2Bonus(text) {
  return cleanCellText(text).replace(/\s+/g, "");
}

function promoteV2SectionBonusToShared(entries, existingSharedBonus, pageNumber, sectionStartIndex) {
  let nextSharedBonus = existingSharedBonus;

  for (let index = sectionStartIndex; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.pageNumber !== pageNumber || !isStructuredBonusValue(entry.bonus)) {
      continue;
    }

    nextSharedBonus = mergeSharedBonus(nextSharedBonus, entry.bonus);
    entry.bonus = "";
  }

  return nextSharedBonus;
}

function normalizeV2Note(text) {
  return cleanCellText(text)
    .replace(/\s*\/\s*/g, " / ")
    .replace(/°\s+角/g, "°角")
    .replace(/\s+/g, " ")
    .trim();
}

function joinV2Note(left, right) {
  const parts = [normalizeV2Note(left), normalizeV2Note(right)].filter(Boolean);
  return [...new Set(parts)].join(" ").trim();
}

function deriveV2CategoryTokens(sectionTitle) {
  const upper = String(sectionTitle || "").toUpperCase();
  const tokens = new Set();

  for (const match of upper.matchAll(/[A-Z]{2,}[0-9-]*/g)) {
    tokens.add(match[0]);
    tokens.add(match[0].replace(/[^A-Z0-9]/g, ""));
  }

  return [...tokens].filter(Boolean);
}

function buildV2SearchAliases(entry) {
  const aliases = new Set();
  const sku = String(entry.sku || "");
  const compactSku = sku.replace(/[^A-Z0-9]/gi, "");
  const note = normalizeV2Note(entry.note);

  if (sku) {
    aliases.add(sku);
    aliases.add(compactSku);
    const withoutLead = compactSku.replace(/^(LED|D)/i, "");
    if (withoutLead) {
      aliases.add(withoutLead);
      const alphaPrefix = (withoutLead.match(/^[A-Z]+/) || [""])[0];
      for (let length = 2; length <= Math.min(6, alphaPrefix.length); length += 1) {
        aliases.add(alphaPrefix.slice(0, length));
      }
    }
  }

  if (note) {
    aliases.add(note);
    aliases.add(note.replace(/\s+/g, ""));
  }

  return [...aliases].filter(Boolean);
}

function getV2EntrySignature(entry) {
  if (!entry) {
    return "";
  }

  return [
    entry.retailPrice,
    entry.basePrice,
    entry.tierPrice,
    entry.openingPrice,
  ]
    .filter(Boolean)
    .join("|");
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
  const abcPrices = prices.slice(-3);
  const basePrice = abcPrices[0] || "";
  const tierPrice = abcPrices[1] || "";
  const openingPrice = abcPrices[2] || "";
  const prefixPrices = prices.slice(0, Math.max(0, prices.length - 3));
  if (!retailPrice && prefixPrices.length) {
    retailPrice = prefixPrices.at(-1) || "";
  }

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

function normalizeMappedEntry(entry) {
  const skuAndNote = extractSkuAndNote(entry.sku || "");
  const trailingNote = skuAndNote.note || "";
  let explicitNote = cleanCellText(entry.note);
  const normalizedAtPrice = normalizePriceCell(entry.atPrice);
  const normalizedRetailPrice = normalizePriceCell(entry.retailPrice);
  let normalizedBonus = cleanCellText(entry.bonus);
  const hasAtPriceColumn = Boolean(entry._headerHasAtPrice || entry._pageHasAtPrice);

  // Some layouts shift 建議售價 one column into 搭贈 when the header lands slightly off.
  // Real 搭贈 values are usually patterns like 10+1, 30+5, //, 23+2// instead of a plain price.
  let repairedRetailPrice = stripAtPricePrefix(normalizedRetailPrice, normalizedAtPrice);
  if (hasAtPriceColumn && !normalizedAtPrice) {
    repairedRetailPrice = splitConcatenatedRetailPrice(repairedRetailPrice);
  }
  const splitBonus = splitRetailBonusValue(normalizedBonus);
  if (!repairedRetailPrice && splitBonus.retailPrice) {
    repairedRetailPrice = splitBonus.retailPrice;
  }
  normalizedBonus = splitBonus.bonus;
  if (!repairedRetailPrice && normalizedBonus && looksLikePlainPrice(normalizedBonus)) {
    repairedRetailPrice = normalizedBonus;
    normalizedBonus = "";
  }

  const splitBase = splitMixedPriceAndNote(entry.basePrice);
  const splitTier = splitMixedPriceAndNote(entry.tierPrice);
  const splitOpening = splitMixedPriceAndNote(entry.openingPrice);
  explicitNote = [explicitNote, splitBase.note, splitTier.note, splitOpening.note]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    ...entry,
    sku: skuAndNote.sku || cleanCellText(entry.sku),
    retailPrice: repairedRetailPrice,
    basePrice: splitBase.price,
    tierPrice: splitTier.price,
    openingPrice: splitOpening.price,
    bonus: normalizedBonus,
    note: [trailingNote, explicitNote].filter(Boolean).join(" ").trim(),
  };
}

function normalizePriceCell(value) {
  return String(value || "")
    .replace(/\$/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function splitMixedPriceAndNote(value) {
  const raw = cleanCellText(value);
  if (!raw) {
    return {
      price: "",
      note: "",
    };
  }

  const normalized = normalizePriceCell(raw);
  if (looksLikePlainPrice(normalized) || normalized === "-") {
    return {
      price: normalized,
      note: "",
    };
  }

  const match = raw.match(/^\$?\s*(-|\d[\d,]*)(.*)$/);
  if (!match) {
    return {
      price: "",
      note: normalized,
    };
  }

  return {
    price: normalizePriceCell(match[1]),
    note: cleanCellText(match[2]),
  };
}

function splitRetailPriceAndLeadingNote(value, allowLeadingNote = false) {
  const raw = cleanCellText(value);
  if (!raw) {
    return {
      price: "",
      note: "",
    };
  }

  const normalized = normalizePriceCell(raw);
  if (looksLikePlainPrice(normalized) || normalized === "-") {
    return {
      price: normalized,
      note: "",
    };
  }

  if (allowLeadingNote) {
    const trailingPriceMatch = raw.match(/^(.*?)(-|\d[\d,]*)$/);
    if (trailingPriceMatch) {
      const note = cleanCellText(trailingPriceMatch[1]);
      const price = normalizePriceCell(trailingPriceMatch[2]);
      if (note && looksLikePlainPrice(price) && /[A-Za-z\u4e00-\u9fff()\/\[\]°><]/.test(note)) {
        return {
          price,
          note,
        };
      }
    }
  }

  return {
    price: normalized,
    note: "",
  };
}

function looksLikePlainPrice(value) {
  return /^\d[\d,]*$/.test(String(value || "").trim());
}

function stripAtPricePrefix(retailPrice, atPrice) {
  if (!retailPrice || !atPrice) {
    return retailPrice;
  }

  if (retailPrice === atPrice) {
    return "";
  }

  if (!retailPrice.startsWith(atPrice)) {
    return retailPrice;
  }

  const stripped = retailPrice.slice(atPrice.length);
  return looksLikePlainPrice(stripped) ? stripped : retailPrice;
}

function splitConcatenatedRetailPrice(retailPrice) {
  if (!looksLikePlainPrice(retailPrice) || retailPrice.length < 4) {
    return retailPrice;
  }

  for (const prefixLength of [2, 1]) {
    if (retailPrice.length <= prefixLength + 1) {
      continue;
    }

    const prefix = retailPrice.slice(0, prefixLength);
    const suffix = retailPrice.slice(prefixLength);
    if (!looksLikePlainPrice(prefix) || !looksLikePlainPrice(suffix)) {
      continue;
    }

    if (suffix.length >= 2) {
      return suffix;
    }
  }

  return retailPrice;
}

function splitRetailBonusValue(bonusValue) {
  const normalized = normalizeSharedBonus(bonusValue);
  if (!normalized) {
    return {
      retailPrice: "",
      bonus: "",
    };
  }

  for (let index = normalized.length - 1; index >= 2; index -= 1) {
    const retailPrice = normalized.slice(0, index);
    const bonus = normalized.slice(index);
    if (!looksLikePlainPrice(retailPrice)) {
      continue;
    }
    if (!isStructuredBonusValue(bonus)) {
      continue;
    }
    return {
      retailPrice,
      bonus,
    };
  }

  return {
    retailPrice: "",
    bonus: normalized,
  };
}

function isStructuredBonusValue(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return false;
  }

  if (normalized === "//") {
    return true;
  }

  const trimmed = normalized.replace(/\/+$/g, "");
  if (!trimmed.includes("+")) {
    return false;
  }

  return trimmed
    .split("/")
    .filter(Boolean)
    .every((part) => /^[1-9]\d*\+\d+$/.test(part));
}

function isSharedFieldEntry(entry) {
  const hasSku = Boolean(entry.sku);
  const hasPrice = Boolean(
    entry.retailPrice || entry.basePrice || entry.tierPrice || entry.openingPrice,
  );
  return !hasSku && !hasPrice && Boolean(entry.bonus);
}

function updateSharedFields(sharedFields, entry) {
  return {
    ...sharedFields,
    bonus: entry.bonus ? mergeSharedBonus(sharedFields.bonus, entry.bonus) : sharedFields.bonus || "",
    sharedBonusActive: sharedFields.sharedBonusActive || isSharedFieldEntry(entry),
  };
}

function applySharedFields(entry, sharedFields) {
  return {
    ...entry,
    bonus: sharedFields.sharedBonusActive
      ? sharedFields.bonus || entry.bonus || ""
      : entry.bonus || sharedFields.bonus || "",
  };
}

function backfillSharedFields(entries, sharedFields, pageNumber, sectionStartIndex) {
  for (let index = entries.length - 1; index >= sectionStartIndex; index -= 1) {
    const entry = entries[index];
    if (entry.pageNumber !== pageNumber) {
      break;
    }

    if (sharedFields.bonus) {
      entry.bonus = sharedFields.bonus;
    }
  }
}

function normalizeSharedBonus(value) {
  return cleanCellText(value).replace(/\s+/g, "");
}

function mergeSharedBonus(existingValue, incomingValue) {
  const existing = normalizeSharedBonus(existingValue);
  const incoming = normalizeSharedBonus(incomingValue);

  if (!incoming) {
    return existing;
  }

  if (!existing) {
    return incoming;
  }

  if (existing.includes(incoming)) {
    return existing;
  }

  const separator = existing.endsWith("/") || incoming.startsWith("/") ? "" : "/";
  return `${existing}${separator}${incoming}`;
}

function promoteSectionBonusToShared(entries, sharedFields, pageNumber, sectionStartIndex) {
  let nextSharedFields = { ...sharedFields, sharedBonusActive: true };

  for (let index = sectionStartIndex; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.pageNumber !== pageNumber || !entry.bonus) {
      continue;
    }

    nextSharedFields = updateSharedFields(nextSharedFields, entry);
    entry.bonus = "";
  }

  return nextSharedFields;
}

function extractSkuAndNote(prefix) {
  const normalizedSafe = String(prefix || "")
    .replace(/／/g, "/")
    .replace(/\s+/g, " ")
    .trim();
  const safeTokens = normalizedSafe.split(" ").filter(Boolean);
  const safeSkuTokens = [];
  let safeIndex = 0;

  while (safeIndex < safeTokens.length) {
    const token = safeTokens[safeIndex];
    if (!safeSkuTokens.length && !isCodeToken(token)) {
      break;
    }
    if (isCodeToken(token) || isSkuSuffixToken(token)) {
      safeSkuTokens.push(token);
      safeIndex += 1;
      continue;
    }
    break;
  }

  if (safeSkuTokens.length) {
    return {
      sku: safeSkuTokens.reduce((result, token) => {
        if (!result) {
          return token;
        }
        if (isSkuSuffixToken(token)) {
          return `${result} ${token}`;
        }
        return `${result}${token}`;
      }, ""),
      note: safeTokens.slice(safeIndex).join(" ").trim(),
    };
  }
  const normalized = prefix
    .replace(/／/g, "/")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/\s+/g, " ")
    .trim();

  const leadingSkuMatch = normalized.match(/^([A-Z0-9][A-Z0-9.-]*(?:\s*\/[A-Z0-9.-]+)?)(.*)$/i);
  if (leadingSkuMatch) {
    return {
      sku: leadingSkuMatch[1].replace(/\s+/g, ""),
      note: leadingSkuMatch[2].trim(),
    };
  }

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
      height: getItemVisualHeight(item),
    }))
    .filter((item) => item.text)
    .filter((item) => !isLikelyWatermarkItem(item));

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

function getItemVisualHeight(item) {
  return Math.max(
    Math.abs(Number(item.height || 0)),
    Math.abs(Number(item.transform?.[0] || 0)),
    Math.abs(Number(item.transform?.[1] || 0)),
    Math.abs(Number(item.transform?.[2] || 0)),
    Math.abs(Number(item.transform?.[3] || 0)),
  );
}

function isLikelyWatermarkItem(item) {
  const compactText = String(item.text || "").replace(/\s+/g, "");
  if (!compactText || compactText.length > WATERMARK_MAX_TEXT_LENGTH) {
    return false;
  }

  const width = Math.abs(Number(item.width || 0));
  const height = Math.abs(Number(item.height || 0));
  const looksLargeEnough = width >= WATERMARK_MIN_WIDTH && height >= WATERMARK_MIN_HEIGHT;
  if (!looksLargeEnough) {
    return false;
  }

  return (
    WATERMARK_EXACT_PATTERN.test(compactText) ||
    /^[\u4e00-\u9fffA-Za-z0-9]+$/.test(compactText)
  );
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

function collectHeaderSegments(row) {
  const headerSegments = [];

  for (let index = 0; index < row.items.length; index += 1) {
    const item = row.items[index];
    const nextItem = row.items[index + 1];
    const candidates = [
      {
        text: item.text,
        x: item.x,
      },
    ];

    if (nextItem) {
      candidates.push({
        text: `${item.text}${nextItem.text}`,
        x: Math.min(item.x, nextItem.x),
      });
    }

    for (const candidate of candidates) {
      const normalized = normalizeForCompare(candidate.text);
      const match = findBestHeaderMatch(normalized);

      if (match) {
        headerSegments.push({
          key: match.column.key,
          x: candidate.x,
          label: match.column.label,
          score: match.score,
        });
      }
    }
  }

  return headerSegments;
}

function mergeHeaderSegments(existingSegments, incomingSegments) {
  const unique = [];
  for (const segment of [...existingSegments, ...incomingSegments]) {
    const existing = unique.find((entry) => entry.key === segment.key);
    if (!existing) {
      unique.push(segment);
      continue;
    }
    if (segment.score > existing.score || (segment.score === existing.score && segment.x > existing.x)) {
      Object.assign(existing, segment);
    }
  }

  return unique;
}

function detectHeader(row, previousSegments = []) {
  const unique = mergeHeaderSegments(previousSegments, collectHeaderSegments(row));

  const hasSku = unique.some((segment) => segment.key === "sku");
  const hasBase = unique.some((segment) => segment.key === "basePrice");
  const hasTier = unique.some((segment) => segment.key === "tierPrice");
  const hasOpening = unique.some((segment) => segment.key === "openingPrice");
  if (!hasSku || !hasBase || !hasTier || !hasOpening) {
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
        x: segment.x,
        minX: previous ? (previous.x + segment.x) / 2 : Number.NEGATIVE_INFINITY,
        maxX: next ? (segment.x + next.x) / 2 : Number.POSITIVE_INFINITY,
      };
    }),
  };
}

function findBestHeaderMatch(normalizedText) {
  let bestMatch = null;
  for (const column of [...COLUMN_DEFS, ...OPTIONAL_PARSE_COLUMNS]) {
    const explicitAliases = [
      ...(CANONICAL_HEADER_ALIASES[column.key] || []),
      ...(EXPLICIT_HEADER_ALIASES[column.key] || []),
    ];
    for (const alias of explicitAliases) {
      const normalizedAlias = normalizeForCompare(alias);
      if (!normalizedAlias || !normalizedText.includes(normalizedAlias)) {
        continue;
      }

      let score = 4;
      if (normalizedText === normalizedAlias) {
        score = 6;
      } else if (
        normalizedText.startsWith(normalizedAlias) ||
        normalizedText.endsWith(normalizedAlias)
      ) {
        score = 5;
      }

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          column,
          score,
        };
      }
    }

    for (const alias of column.aliases) {
      const normalizedAlias = normalizeForCompare(alias);
      if (!normalizedAlias || !normalizedText.includes(normalizedAlias)) {
        continue;
      }

      let score = 1;
      if (normalizedText === normalizedAlias) {
        score = 3;
      } else if (
        normalizedText.startsWith(normalizedAlias) ||
        normalizedText.endsWith(normalizedAlias)
      ) {
        score = 2;
      }

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          column,
          score,
        };
      }
    }
  }
  return bestMatch;
}

function mapRowToEntry(row, header, pageNumber) {
  const cells = Object.fromEntries(COLUMN_DEFS.map((column) => [column.key, ""]));
  const noteColumn = header.columns.find((column) => column.key === "note");
  const rightMostPriceColumn = [...header.columns]
    .filter((column) => ["basePrice", "tierPrice", "openingPrice"].includes(column.key))
    .sort((a, b) => b.x - a.x)[0];

  for (const item of row.items) {
    const centerX = item.x + item.width / 2;
    if (
      rightMostPriceColumn &&
      centerX > rightMostPriceColumn.x + 40
    ) {
      const noteKey = noteColumn ? "note" : "note";
      cells[noteKey] = joinText(cells[noteKey], item.text);
      continue;
    }

    const column = header.columns.reduce((closest, entry) => {
      if (!closest) {
        return entry;
      }
      return Math.abs(centerX - entry.x) < Math.abs(centerX - closest.x) ? entry : closest;
    }, null);

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
    _headerHasAtPrice: header.columns.some((column) => column.key === "atPrice"),
    pageNumber,
  };
}

function containsNoteLikeText(text) {
  const value = String(text || "").trim();
  return /[\u4e00-\u9fff°]/.test(value);
}

function isNoiseRow(row, cells) {
  const rowText = normalizeForCompare(row.rawText);
  const hasAnyField = Object.values(cells).some(Boolean);
  const priceCount = ["retailPrice", "basePrice", "tierPrice", "openingPrice"].filter(
    (key) => cells[key],
  ).length;
  const hasStructuredData = Boolean(cells.sku || cells.retailPrice || cells.bonus || priceCount > 0);

  if (!hasAnyField) {
    return true;
  }

  if (isCategoryRowText(row.rawText)) {
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

  if (!hasStructuredData && cells.note) {
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
  if (bundle.source === "json") {
    return activateBundleFromJson(bundle);
  }
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
  await syncDetailFieldConfig(state.entries);
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
    setStatus(getLoadedBundleStatus(bundle));
    await activateBundle(bundle);
  } catch (error) {
    console.error("Failed to load cached bundle", error);
    await deleteValue(ACTIVE_DOCUMENT_KEY);
    setStatus("先前的本機快取已失效，請重新載入 PDF。");
  }
}

async function upgradeBundleIfNeeded(bundle) {
  if (bundle.source === "json") {
    return bundle;
  }
  const productNameResource = await getProductNameResource();
  const currentNameMapHash = productNameResource.hash || "";
  if (bundle?.version === BUNDLE_VERSION && (bundle?.nameMapHash || "") === currentNameMapHash) {
    return bundle;
  }

  const shouldRebuildForNameMap = (bundle?.nameMapHash || "") !== currentNameMapHash;
  setStatus(
    shouldRebuildForNameMap
      ? "偵測到型號中文對照表已更新，正在重建本機索引..."
      : "正在更新本機索引版本，請稍候...",
  );
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
  const tokens = buildSearchTokens(term);
  state.filteredEntries = !normalized
    ? state.entries
    : state.entries.filter((entry) => entryMatchesSearch(entry, normalized, tokens));

  renderResults();
  updateDockState();
}

function entryMatchesSearch(entry, normalized, tokens = []) {
  if (!normalized) {
    return true;
  }

  const aliases = getEntrySearchAliases(entry);
  if (normalized.length <= 3 && aliases.some((alias) => alias === normalized || alias.startsWith(normalized))) {
    return true;
  }

  if ((entry.searchText || "").includes(normalized)) {
    return true;
  }

  if (tokens.length <= 1) {
    return false;
  }

  return tokens.every((token) => entryMatchesSearchToken(entry, token, aliases));
}

function entryMatchesSearchToken(entry, token, aliases = getEntrySearchAliases(entry)) {
  if (!token) {
    return true;
  }

  if (token.length <= 3 && aliases.some((alias) => alias === token || alias.startsWith(token))) {
    return true;
  }

  return (entry.searchText || "").includes(token);
}

function getEntrySearchAliases(entry) {
  return [
    entry.sku,
    entry.productName,
    ...(entry.searchAliases || []),
  ]
    .map((value) => normalizeForCompare(value))
    .filter(Boolean);
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
    });
  });
}

function renderResults() {
  if (!state.bundle) {
    refs.resultsTitle.textContent = "等待匯入價格表";
    refs.resultsSubtitle.textContent = "匯入後會在本機建立索引，支援型號、中文品名與備註搜尋。";
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
      : "可用型號、中文品名、價格或備註搜尋，點卡片查看細節或直接點價格快速複製。";

  if (!rendered.length) {
    refs.emptyState.classList.remove("hidden");
    refs.emptyState.querySelector(".empty-title").textContent = "查無符合結果";
    refs.emptyState.querySelector(".empty-text").textContent =
      "可以換關鍵字試試，或直接用型號、中文品名、底價、開盤價、補充資訊內文字搜尋。";
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
        <span class="page-pill">第 ${entry.pageNumber} 頁</span>
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

// ── Web Crypto 工具 ──────────────────────────────────────────

// V3 加密常數（與 excel-to-json.html 必須相同）
const V3_APP_SECRET = "v3-rL9mK7pXnB2qT4aE1hW8sC0dF6jUzY5";
const V3_ALPHA = "zQLpcmK3nR9xB2vT6aE1hG7wUj4oYsC5dNfXiF0IuOMlHePJrVqDbWZASgyk8t_-";

function fromAlpha(str) {
  const lookup = {};
  for (let i = 0; i < V3_ALPHA.length; i++) lookup[V3_ALPHA[i]] = i;
  let buf = 0, bits = 0;
  const out = [];
  for (const ch of str) {
    if (!(ch in lookup)) continue;
    buf = (buf << 6) | lookup[ch];
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); }
  }
  return new Uint8Array(out);
}

async function unlockV3(passphrase, cfg) {
  const enc = new TextEncoder();
  const xored = fromAlpha(cfg.r);
  const salt  = fromAlpha(cfg.q);
  const iv    = fromAlpha(cfg.p);
  const km = await crypto.subtle.importKey(
    "raw", enc.encode(passphrase + "|" + V3_APP_SECRET), "PBKDF2", false, ["deriveBits"]
  );
  const masterBuf = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 147293, hash: "SHA-256" }, km, 512
  );
  const master = new Uint8Array(masterBuf);
  const K_aes = await crypto.subtle.importKey("raw", master.slice(0, 32), "AES-GCM", false, ["decrypt"]);
  const K_xor = master.slice(32, 64);
  const cipher = new Uint8Array(xored.length);
  for (let i = 0; i < xored.length; i++) cipher[i] = xored[i] ^ K_xor[i % 32];
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, K_aes, cipher);
  return JSON.parse(new TextDecoder().decode(plainBuf));
}

function uint8ArrayToBase64(arr) {
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < arr.length; i += chunk) {
    binary += String.fromCharCode(...arr.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToUint8Array(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

async function deriveDecryptKey(passphrase, saltBytes) {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey(
    "raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations: 100000, hash: "SHA-256" },
    km, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
  );
}

async function decryptData(cipherBytes, key, ivBytes) {
  const buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBytes }, key, cipherBytes);
  return new TextDecoder().decode(buf);
}

// ── 隱形解鎖手勢（本機×5 → 價×5 → 本機×3）────────────────────

function bindUnlockGesture() {
  const SEQ = [
    { key: "pill", needed: 5 },
    { key: "logo", needed: 5 },
    { key: "pill", needed: 3 },
  ];
  let step = 0, count = 0, timer = null;
  function reset() { step = 0; count = 0; clearTimeout(timer); }
  function advance(key) {
    if (SEQ[step].key !== key) { reset(); return; }
    count++;
    clearTimeout(timer);
    timer = setTimeout(reset, 3000);
    if (count >= SEQ[step].needed) {
      clearTimeout(timer);
      count = 0;
      step++;
      if (step >= SEQ.length) {
        reset();
        openPassphraseDialog();
      } else {
        timer = setTimeout(reset, 3000);
      }
    }
  }
  refs.logoEl?.addEventListener("click",     () => advance("logo"));
  refs.modePillEl?.addEventListener("click", () => advance("pill"));
}

// ── 解鎖對話框 ────────────────────────────────────────────────

async function openPassphraseDialog() {
  if (!state.bundle?.protConfig) {
    showToast("請先載入加密格式的 JSON 價格表");
    return;
  }
  // 已解鎖就不重複動作
  if (state.bundle.entries?.length > 0) {
    showToast("價格表已解鎖");
    return;
  }
  const saved = await getValue(UNLOCK_PASSPHRASE_KEY);
  // 有儲存密碼 → 直接靜默解鎖，不彈對話框
  if (saved) {
    try {
      await unlockBundle(saved);
      showToast("已自動解鎖");
      return;
    } catch {
      // 密碼失效（JSON 已換），繼續開啟對話框讓使用者重新輸入
    }
  }
  // 無儲存密碼 → 顯示對話框
  refs.pinDialogTitle.textContent = "解鎖價格表";
  refs.pinDialogHint.textContent  = "輸入轉換時設定的密碼。";
  refs.pinInput.value = "";
  refs.pinError.classList.add("hidden");
  if (refs.pinRemember) refs.pinRemember.checked = true;
  setManageMode(false);
  refs.pinOverlay.classList.remove("hidden");
  refs.pinOverlay.setAttribute("aria-hidden", "false");
  window.requestAnimationFrame(() => refs.pinOverlay.classList.add("is-visible"));
  refs.pinInput.focus();
}

function closePinDialog() {
  refs.pinOverlay.classList.remove("is-visible");
  window.setTimeout(() => {
    refs.pinOverlay.classList.add("hidden");
    refs.pinOverlay.setAttribute("aria-hidden", "true");
    if (refs.pinInput) refs.pinInput.value = "";
    if (refs.pinNewInput) refs.pinNewInput.value = "";
  }, 200);
}

async function onPassphraseConfirm() {
  const passphrase = refs.pinInput?.value;
  if (!passphrase) return;
  refs.pinError.classList.add("hidden");
  try {
    await unlockBundle(passphrase);
    if (refs.pinRemember?.checked) {
      await setValue(UNLOCK_PASSPHRASE_KEY, passphrase);
    }
    closePinDialog();
    showToast("已解鎖，重新整理後自動鎖回");
  } catch {
    refs.pinError.classList.remove("hidden");
    refs.pinInput.select();
  }
}

async function unlockBundle(passphrase) {
  const cfg = state.bundle.protConfig;
  let rawEntries;
  if (cfg._v === 3) {
    rawEntries = await unlockV3(passphrase, cfg);
  } else {
    // v2 相容
    const saltBytes = base64ToUint8Array(cfg.salt);
    const ivBytes   = base64ToUint8Array(cfg.iv);
    const key = await deriveDecryptKey(passphrase, saltBytes);
    const plain = await decryptData(base64ToUint8Array(cfg.data), key, ivBytes);
    rawEntries = JSON.parse(plain);
  }
  const rebuilt = buildBundleFromJson(state.bundle.fileName, rawEntries, state.bundle.hash, null);
  state.bundle.entries = rebuilt.entries;
  state.entries = rebuilt.entries;
  // 解鎖後強制重建欄位設定（加密載入時 entries 為空，舊 config 沒有 extras 欄位）
  state.detailFieldConfig = [];
  await syncDetailFieldConfig(state.entries);
  applySearch(state.searchTerm);
  renderShell();
}

// ── 密碼管理（對話框內 ⚙ 切換）──────────────────────────────

let _pinManageMode = false;

function toggleManageMode() { setManageMode(!_pinManageMode); }

function setManageMode(on) {
  _pinManageMode = on;
  refs.pinManageSection?.classList.toggle("hidden", !on);
  refs.pinUnlockSection?.classList.toggle("hidden", on);
  if (refs.pinDialogTitle) {
    refs.pinDialogTitle.textContent = on ? "管理密碼" : "解鎖價格表";
  }
  if (refs.pinDialogHint) {
    refs.pinDialogHint.textContent = on ? "" : refs.pinDialogHint.textContent;
  }
}

async function clearSavedPassphrase() {
  await deleteValue(UNLOCK_PASSPHRASE_KEY);
  showToast("已清除本機記憶的密碼");
  closePinDialog();
}

async function saveNewPassphrase() {
  const newPw = refs.pinNewInput?.value.trim();
  if (!newPw) return;
  await setValue(UNLOCK_PASSPHRASE_KEY, newPw);
  showToast("新密碼已儲存至本機");
  closePinDialog();
}

// ── Detail Field Config ──────────────────────────────────────

async function loadDetailFieldConfig() {
  const saved = await getValue(DETAIL_FIELD_CONFIG_KEY);
  if (saved && Array.isArray(saved) && saved.length > 0) {
    state.detailFieldConfig = saved;
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

function openDetail(entry) {
  window.clearTimeout(detailCloseTimer);
  state.selectedEntry = entry;
  state.previewPage = entry.pageNumber;

  refs.detailTitle.textContent = entry.sku || "未識別型號";
  if (refs.detailSubtitle) {
    refs.detailSubtitle.textContent = entry.productName || "";
    refs.detailSubtitle.classList.toggle("hidden", !entry.productName);
  }
  const isJsonSource = state.bundle?.source === "json";
  if (refs.previewZone) {
    refs.previewZone.classList.toggle("hidden", isJsonSource);
  }

  // Render fields using detailFieldConfig if available, otherwise fall back to default
  if (state.detailFieldConfig.length > 0) {
    const visibleFields = [...state.detailFieldConfig]
      .sort((a, b) => a.order - b.order)
      .filter((f) => f.visible);
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
  refs.detailGrid.addEventListener("click", (e) => {
    const item = e.target.closest("[data-copy-value]");
    if (!item) return;
    const value = item.dataset.copyValue;
    if (!value) return;
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
      .then(() => showToast(`已複製：${text}`))
      .catch(() => showToast("複製失敗，請確認頁面已允許剪貼簿權限。"));
  });

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
  renderPreviewPage().catch((error) => {
    if (error?.name !== "RenderingCancelledException") {
      console.error(error);
    }
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

async function loadXlsxLibrary() {
  if (window.XLSX) {
    return window.XLSX;
  }

  if (xlsxLibraryPromise) {
    return xlsxLibraryPromise;
  }

  xlsxLibraryPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[data-xlsx-src="${PRODUCT_NAME_LIBRARY_SRC}"]`);
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(window.XLSX), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("XLSX library failed to load.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = `${PRODUCT_NAME_LIBRARY_SRC}?v=${APP_VERSION}`;
    script.async = true;
    script.dataset.xlsxSrc = PRODUCT_NAME_LIBRARY_SRC;
    script.onload = () => {
      if (window.XLSX) {
        resolve(window.XLSX);
        return;
      }
      reject(new Error("XLSX library loaded without exposing window.XLSX."));
    };
    script.onerror = () => reject(new Error("Failed to load xlsx.full.min.js."));
    document.head.append(script);
  }).catch((error) => {
    xlsxLibraryPromise = null;
    throw error;
  });

  return xlsxLibraryPromise;
}

async function getProductNameResource() {
  if (productNameResourcePromise) {
    return productNameResourcePromise;
  }

  productNameResourcePromise = loadProductNameResource().catch((error) => {
    console.warn("Failed to load name.xlsx; product name aliases will be skipped.", error);
    productNameResourcePromise = null;
    return createEmptyProductNameResource();
  });

  return productNameResourcePromise;
}

function createEmptyProductNameResource() {
  return {
    hash: "",
    exactMap: new Map(),
    normalizedMap: new Map(),
  };
}

async function loadProductNameResource() {
  const [XLSX, response] = await Promise.all([
    loadXlsxLibrary(),
    fetch(PRODUCT_NAME_FILE, { cache: "no-store" }),
  ]);

  if (!response.ok) {
    throw new Error(`name.xlsx request failed with HTTP ${response.status}.`);
  }

  const workbookBytes = await response.arrayBuffer();
  const hash = await hashBuffer(workbookBytes);
  const workbook = XLSX.read(workbookBytes, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("name.xlsx does not contain any worksheet.");
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });
  const { exactMap, normalizedMap } = buildProductNameLookup(rows);

  return {
    hash,
    exactMap,
    normalizedMap,
  };
}

function buildProductNameLookup(rows) {
  const workbookRows = Array.isArray(rows) ? rows : [];
  const headerRowIndex = workbookRows.findIndex(
    (row) => Array.isArray(row) && row.some((cell) => String(cell || "").trim()),
  );
  if (headerRowIndex < 0) {
    throw new Error("name.xlsx does not contain a header row.");
  }

  const headerRow = workbookRows[headerRowIndex].map((cell) => String(cell || "").trim());
  const skuIndex = findWorksheetColumnIndex(headerRow, PRODUCT_NAME_HEADER_ALIASES.sku);
  const productNameIndex = findWorksheetColumnIndex(headerRow, PRODUCT_NAME_HEADER_ALIASES.productName);
  if (skuIndex < 0 || productNameIndex < 0) {
    throw new Error("name.xlsx must contain 型號 and 品名 columns.");
  }

  const exactMap = new Map();
  const normalizedMap = new Map();

  for (const row of workbookRows.slice(headerRowIndex + 1)) {
    if (!Array.isArray(row)) {
      continue;
    }

    const sku = String(row[skuIndex] || "").trim();
    const productName = String(row[productNameIndex] || "").trim();
    if (!sku || !productName) {
      continue;
    }

    storeProductNameMapping(exactMap, sku, productName, sku);
    const normalizedSku = normalizeSkuLookupKey(sku);
    if (normalizedSku) {
      storeProductNameMapping(normalizedMap, normalizedSku, productName, sku);
    }
  }

  return {
    exactMap,
    normalizedMap,
  };
}

function findWorksheetColumnIndex(headerRow, aliases) {
  const normalizedAliases = aliases.map((alias) => normalizeForCompare(alias));
  return headerRow.findIndex((cell) => normalizedAliases.includes(normalizeForCompare(cell)));
}

function storeProductNameMapping(map, key, productName, sourceSku) {
  const existing = map.get(key);
  if (!existing) {
    map.set(key, productName);
    return;
  }

  if (!productName || existing === productName) {
    return;
  }

  console.warn(
    `[name.xlsx] Duplicate mapping detected for ${sourceSku}: keeping "${existing}" instead of "${productName}".`,
  );
}

function lookupProductName(sku, productNameResource) {
  const exactSku = String(sku || "").trim();
  if (!exactSku || !productNameResource) {
    return "";
  }

  if (productNameResource.exactMap?.has(exactSku)) {
    return productNameResource.exactMap.get(exactSku) || "";
  }

  const normalizedSku = normalizeSkuLookupKey(exactSku);
  if (!normalizedSku) {
    return "";
  }

  return productNameResource.normalizedMap?.get(normalizedSku) || "";
}

function normalizeSkuLookupKey(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function getImportedBundleStatus(bundle) {
  return bundle.nameMapHash
    ? `已匯入價格表：${bundle.fileName}`
    : `已匯入價格表：${bundle.fileName}（未載入中文品名對照）`;
}

function getLoadedBundleStatus(bundle) {
  return bundle.nameMapHash
    ? `已自動載入本機價格表：${bundle.fileName}`
    : `已自動載入本機價格表：${bundle.fileName}（未載入中文品名對照）`;
}

function getImportedBundleToast(bundle) {
  return bundle.nameMapHash
    ? "價格表與中文品名索引已匯入完成。"
    : "價格表已匯入，但無法讀取 name.xlsx，已略過中文品名對應。";
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

function buildSearchText(entry) {
  return normalizeForCompare(
    [
      entry.sku,
      entry.productName,
      ...(entry.searchAliases || []),
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

function mergeSearchAliases(...groups) {
  const aliases = [];
  const seen = new Set();

  for (const group of groups) {
    const values = Array.isArray(group) ? group : [group];
    for (const value of values) {
      const text = String(value || "").trim();
      if (!text) {
        continue;
      }

      const normalized = normalizeForCompare(text);
      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      aliases.push(text);
    }
  }

  return aliases;
}

function buildSearchTokens(text) {
  return [...new Set(
    String(text || "")
      .split(/[\s：:;,.，。/\\|｜()[\]{}_\-"'`]+/g)
      .map((value) => normalizeForCompare(value))
      .filter(Boolean),
  )];
}

function cleanCellText(text) {
  let cleaned = String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^[|｜]+|[|｜]+$/g, "")
    .trim();

  let previous = "";
  while (cleaned !== previous) {
    previous = cleaned;
    cleaned = cleaned
      .replace(WATERMARK_PREFIX_PATTERN, "")
      .replace(WATERMARK_CODE_PATTERN, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  return cleaned;
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
  const needsSpace =
    (/[A-Za-z0-9\])"]$/.test(lastChar) && (/^[A-Za-z0-9\[(（"]/.test(firstChar) || /[\u4e00-\u9fff]/.test(firstChar))) ||
    (/[\u4e00-\u9fff]$/.test(lastChar) && /^[A-Za-z0-9]/.test(firstChar));
  return `${left}${needsSpace ? " " : ""}${right}`;
}

function normalizeForCompare(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[：:;,.，。/\\|｜()[\]{}_-]/g, "");
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

if (typeof window !== "undefined") {
  window.__localPricePwaTestHooks = {
    async parsePdfBuffer(fileName, arrayBuffer) {
      const hash = await hashBuffer(arrayBuffer);
      const bundle = await buildBundle(fileName, arrayBuffer, hash);
      return {
        entryCount: bundle.entries.length,
        pageCount: bundle.pageCount,
        profileId: bundle.profileId || "",
      };
    },
  };
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
