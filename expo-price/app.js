(() => {
  'use strict';

  const items = Array.isArray(window.EXPO_PRICE_DATA) ? window.EXPO_PRICE_DATA : [];
  const el = {
    search: document.querySelector('#searchInput'),
    clear: document.querySelector('#clearBtn'),
    category: document.querySelector('#categorySelect'),
    sort: document.querySelector('#sortSelect'),
    results: document.querySelector('#results'),
    count: document.querySelector('#resultCount'),
    empty: document.querySelector('#emptyState'),
    more: document.querySelector('#moreBtn'),
    toast: document.querySelector('#toast'),
    recentRow: document.querySelector('#recentRow'),
    recentChips: document.querySelector('#recentChips'),
    install: document.querySelector('#installBtn'),
    installDialog: document.querySelector('#installDialog'),
    offline: document.querySelector('#offlineBadge')
  };

  const RECENT_KEY = 'expo-price-recent-v1';
  const STEP = 60;
  let visible = STEP;
  let filtered = [];
  let deferredInstallPrompt = null;
  let toastTimer = null;

  function normalize(value) {
    return String(value ?? '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/嵌/g, '崁')
      .replace(/[×＊*]/g, 'x')
      .replace(/吋/g, 'inch')
      .replace(/[\s\-_/\\()（）\[\]【】.,，。:：;+＋]/g, '');
  }

  function bigrams(s) {
    if (s.length < 2) return [s];
    const out = [];
    for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
    return out;
  }

  function dice(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length === 1 || b.length === 1) return a === b ? 1 : 0;
    const aa = bigrams(a);
    const bb = bigrams(b);
    const counts = new Map();
    for (const x of aa) counts.set(x, (counts.get(x) || 0) + 1);
    let hits = 0;
    for (const x of bb) {
      const c = counts.get(x) || 0;
      if (c > 0) {
        hits++;
        counts.set(x, c - 1);
      }
    }
    return (2 * hits) / (aa.length + bb.length);
  }

  function isSubsequence(needle, haystack) {
    if (!needle) return true;
    let i = 0;
    for (const ch of haystack) {
      if (ch === needle[i]) i++;
      if (i === needle.length) return true;
    }
    return false;
  }

  function scoreItem(item, rawQuery) {
    const q = normalize(rawQuery);
    if (!q) return 1;

    const name = normalize(item.name);
    const product = normalize(item.product);
    const aliases = normalize(item.aliases || '');
    const all = name + product + aliases;
    const tokens = rawQuery.trim().split(/\s+/).map(normalize).filter(Boolean);

    let score = 0;
    let strongMatch = false;

    if (product === q) { score += 1300; strongMatch = true; }
    else if (product.startsWith(q)) { score += 1050; strongMatch = true; }
    else if (product.includes(q)) { score += 900; strongMatch = true; }

    if (name === q) { score += 820; strongMatch = true; }
    else if (name.startsWith(q)) { score += 720; strongMatch = true; }
    else if (name.includes(q)) { score += 650; strongMatch = true; }

    if (!strongMatch && all.includes(q)) { score += 600; strongMatch = true; }

    if (tokens.length > 1) {
      let tokenHits = 0;
      for (const token of tokens) {
        if (product.includes(token)) { score += 230; tokenHits++; }
        else if (name.includes(token)) { score += 205; tokenHits++; }
        else if (all.includes(token)) { score += 170; tokenHits++; }
        else {
          const fuzzyToken = Math.max(dice(token, product), dice(token, name));
          if (fuzzyToken >= 0.48) { score += Math.round(fuzzyToken * 120); tokenHits++; }
        }
      }
      if (tokenHits === tokens.length) score += 220;
      else if (tokenHits === 0) return 0;
    }

    if (q.length >= 3) {
      const similarity = Math.max(dice(q, product), dice(q, name), dice(q, all.slice(0, Math.max(q.length * 4, 32))));
      if (similarity >= 0.42) score += Math.round(similarity * 340);
      if (isSubsequence(q, all)) score += 110;
      if (!strongMatch && similarity < 0.42 && score < 150) return 0;
    } else if (!strongMatch && score === 0) {
      return 0;
    }

    return score;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  }

  function highlight(text, query) {
    const q = query.trim();
    if (!q) return escapeHtml(text);
    const tokens = q.split(/\s+/).filter(t => t.length >= 2).sort((a,b) => b.length - a.length);
    if (!tokens.length) return escapeHtml(text);
    let safe = escapeHtml(text);
    for (const token of tokens) {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        safe = safe.replace(new RegExp(`(${escaped})`, 'ig'), '<mark>$1</mark>');
      } catch (_) {}
    }
    return safe;
  }

  function money(value) {
    return new Intl.NumberFormat('zh-TW').format(value);
  }

  function populateCategories() {
    const categories = [...new Set(items.map(x => x.name))].sort((a,b) => a.localeCompare(b, 'zh-Hant'));
    const frag = document.createDocumentFragment();
    for (const name of categories) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      frag.append(option);
    }
    el.category.append(frag);
  }

  function getRecent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter(Boolean).slice(0, 5); }
    catch (_) { return []; }
  }

  function saveRecent(q) {
    const value = q.trim();
    if (value.length < 2) return;
    const next = [value, ...getRecent().filter(x => x !== value)].slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    renderRecent();
  }

  function renderRecent() {
    const recent = getRecent();
    el.recentRow.hidden = recent.length === 0;
    el.recentChips.innerHTML = recent.map(q => `<button class="recent-chip" type="button" data-query="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('');
  }

  function runSearch({ remember = false } = {}) {
    const q = el.search.value.trim();
    const category = el.category.value;
    const sort = el.sort.value;
    visible = STEP;

    filtered = items
      .filter(item => !category || item.name === category)
      .map(item => ({ ...item, _score: scoreItem(item, q) }))
      .filter(item => item._score > 0);

    if (sort === 'priceAsc') filtered.sort((a,b) => a.price - b.price || b._score - a._score);
    else if (sort === 'priceDesc') filtered.sort((a,b) => b.price - a.price || b._score - a._score);
    else if (sort === 'name') filtered.sort((a,b) => (a.name + a.product).localeCompare(b.name + b.product, 'zh-Hant'));
    else if (q) filtered.sort((a,b) => b._score - a._score || a.price - b.price);
    else filtered.sort((a,b) => a.name.localeCompare(b.name, 'zh-Hant') || a.product.localeCompare(b.product, 'zh-Hant'));

    if (remember && q) saveRecent(q);
    renderResults();
  }

  function renderResults() {
    const q = el.search.value.trim();
    const showing = filtered.slice(0, visible);
    el.count.textContent = filtered.length;
    el.empty.hidden = filtered.length !== 0;
    el.results.hidden = filtered.length === 0;
    el.more.hidden = filtered.length <= visible;
    el.clear.classList.toggle('visible', q.length > 0);

    el.results.innerHTML = showing.map((item, index) => {
      const exactish = q && index === 0 && item._score >= 650;
      return `<article class="product-card${exactish ? ' best' : ''}" data-id="${item.id}">
        <div class="card-main">
          <div class="category" title="${escapeHtml(item.name)}">${highlight(item.name, q)}</div>
          <h2 class="product-name">${highlight(item.product, q)}</h2>
          <div class="match-meta">展場含稅價${item.source ? `・來源表 ${escapeHtml(item.source)}` : ''}</div>
        </div>
        <div class="price-box">
          <div class="price-label">含稅</div>
          <div class="price"><span class="currency">NT$</span>${money(item.price)}</div>
        </div>
        <div class="card-actions">
          <button class="copy-btn" type="button" data-copy="${escapeHtml(`${item.name}｜${item.product}｜展場含稅 NT$${money(item.price)}`)}">複製</button>
        </div>
      </article>`;
    }).join('');
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.classList.add('show');
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 1600);
  }

  function updateOnlineState() {
    el.offline.hidden = navigator.onLine;
  }

  el.search.addEventListener('input', () => runSearch());
  el.search.addEventListener('search', () => runSearch({ remember: true }));
  el.search.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      saveRecent(el.search.value);
      el.search.blur();
    }
  });
  el.clear.addEventListener('click', () => {
    el.search.value = '';
    el.search.focus();
    runSearch();
  });
  el.category.addEventListener('change', () => runSearch());
  el.sort.addEventListener('change', () => runSearch());
  el.more.addEventListener('click', () => { visible += STEP; renderResults(); });

  document.addEventListener('click', async e => {
    const quick = e.target.closest('[data-query]');
    if (quick) {
      el.search.value = quick.dataset.query || '';
      runSearch({ remember: true });
      el.search.focus();
      return;
    }
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      try {
        await navigator.clipboard.writeText(copy.dataset.copy || '');
        showToast('已複製價格資訊');
      } catch (_) {
        showToast('無法複製，請長按文字選取');
      }
    }
  });

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstallPrompt = e;
  });

  el.install.addEventListener('click', async () => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (isStandalone) { showToast('目前已是 App 模式'); return; }
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      return;
    }
    if (typeof el.installDialog.showModal === 'function') el.installDialog.showModal();
    else alert('iPhone / iPad：Safari 點「分享」→「加入主畫面」。');
  });

  window.addEventListener('online', updateOnlineState);
  window.addEventListener('offline', updateOnlineState);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }

  populateCategories();
  renderRecent();
  updateOnlineState();
  runSearch();
})();
