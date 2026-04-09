import * as pdfjsLib from "./vendor/pdfjs/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.mjs";

const APP_VERSION = "46";

const DB_NAME = "local-price-pwa";
const DB_VERSION = 1;
const STORE_NAME = "kv";
const ACTIVE_DOCUMENT_KEY = "active-document";
const SEARCH_HISTORY_KEY = "search-history";
const SEARCH_HISTORY_LIMIT = 10;
const MAX_RESULTS_RENDER = 250;
const ROW_TOLERANCE = 3;
const HEADER_SEGMENT_GAP = 22;
const BUNDLE_VERSION = 28;
const PRODUCT_NAME_FILE = "./name.xlsx";
const PRODUCT_NAME_LIBRARY_SRC = "./vendor/xlsx/xlsx.full.min.js";
const PRODUCT_NAME_HEADER_ALIASES = {
  sku: ["型號", "品編"],
  productName: ["品名", "中文品名", "中文名稱", "名稱"],
};
const V2_PROFILE_ID = "price-sheet-202604-v2";
const V2_PROFILE_VERSION = 1;
const V2_FILE_NAME_PATTERN = /202604\)?v2/i;
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
};

const refs = {
  fileInput: document.querySelector("#file-input"),
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
  const normalizedName = String(fileName || "").toLowerCase();
  const header = detectV2Header(firstRows);
  if (!V2_FILE_NAME_PATTERN.test(normalizedName) || !header) {
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
  const note = joinV2Note(
    joinV2Note(leftData.note, cells.note),
    joinV2Note(joinV2Note(baseSplit.note, tierSplit.note), openingSplit.note),
  );

  return {
    kind: "entry",
    entry: {
      sku: leftData.sku || cleanCellText(cells.sku),
      retailPrice: normalizePriceCell(cells.retailPrice),
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
      price: normalized,
      note: "",
    };
  }

  return {
    price: normalizePriceCell(match[1]),
    note: cleanCellText(match[2]),
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
    setStatus(getLoadedBundleStatus(bundle));
    await activateBundle(bundle);
  } catch (error) {
    console.error("Failed to load cached bundle", error);
    await deleteValue(ACTIVE_DOCUMENT_KEY);
    setStatus("先前的本機快取已失效，請重新載入 PDF。");
  }
}

async function upgradeBundleIfNeeded(bundle) {
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
  state.filteredEntries = !normalized
    ? state.entries
    : state.entries.filter((entry) => entryMatchesSearch(entry, normalized));

  renderResults();
  updateDockState();
}

function entryMatchesSearch(entry, normalized) {
  if (!normalized) {
    return true;
  }

  if (normalized.length <= 3) {
    const aliases = [
      entry.sku,
      ...(entry.searchAliases || []),
    ]
      .map((value) => normalizeForCompare(value))
      .filter(Boolean);

    if (aliases.some((alias) => alias === normalized || alias.startsWith(normalized))) {
      return true;
    }
  }

  return (entry.searchText || "").includes(normalized);
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

function openDetail(entry) {
  window.clearTimeout(detailCloseTimer);
  state.selectedEntry = entry;
  state.previewPage = entry.pageNumber;

  refs.detailTitle.textContent = entry.sku || "未識別型號";
  if (refs.detailSubtitle) {
    refs.detailSubtitle.textContent = entry.productName || "";
    refs.detailSubtitle.classList.toggle("hidden", !entry.productName);
  }
  refs.detailGrid.innerHTML = COLUMN_DEFS.map((column) => renderDetailItem(column, entry)).join("");
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
  return `
    <div class="detail-item">
      <span class="detail-item-label">${column.label}</span>
      <span class="detail-item-value">${escapeHtml(entry[column.key] || "-")}</span>
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
