// ========================= exten content.js ==============================
// Требуется в manifest.json:
// - "permissions": ["storage", "tabs", "activeTab"]
// - "host_permissions": ["http://127.0.0.1:5055/*"]
// - background.js: service_worker, action
// ========================================================================

const SERVER_BASE = "http://127.0.0.1:5055";
const SERVER_URL = SERVER_BASE + "/main";
const GLOBAL_CONTEXT_URL = SERVER_BASE + "/global_context";

const OVERLAY_ID = "exten-underline-overlay";
const TOOLTIP_ID = "exten-suggest-tooltip";
const SELECT_POPUP_ID = "exten-select-popup";
const GLOBAL_MODAL_ID = "exten-global-context-modal";

const STORAGE_LOG_KEY = "suggestionsLog";
const STORAGE_IGNORED_KEY = "extenIgnored"; // [{ original, suggestion }]

const SPINNER_ID = "exten-loading-spinner";
const SPINNER_STYLE_ID = "exten-loading-style";

// === Z-INDEX PRIORITY =====================================================
// overlay (подчёркивание + хотспоты) — сзади
// UI-попапы (tooltip/select/global) — поверх
// спиннер — самый верх
const Z_OVERLAY = 2147483000;
const Z_UI      = 2147483600;
const Z_SPINNER = 2147483647;

// Глобальные кэши и флаги
window.__extenLastSuggestions = Array.isArray(window.__extenLastSuggestions) ? window.__extenLastSuggestions : [];
window.__extenIgnoredSet = window.__extenIgnoredSet instanceof Set ? window.__extenIgnoredSet : new Set();
let __selectPopupActive = false;
let __pointerInSelectPopup = false; // курсор внутри окна выделения?
let __pointerInGlobalModal = false; // курсор внутри модалки глоб. контекста?
let __pendingRequests = 0; // для глобального спиннера

// локальное состояние для списка предложений в попапе выбора
let __selectPopupCurrentSuggestions = [];

// ========================================================================
// 0) Индикатор загрузки (глобальный спиннер, верхний левый угол)
// ========================================================================
function ensureSpinnerStyle() {
  if (document.getElementById(SPINNER_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = SPINNER_STYLE_ID;
  style.textContent = `@keyframes exten-spin { to { transform: rotate(360deg); } }`;
  document.head.appendChild(style);
}
function ensureSpinner() {
  let s = document.getElementById(SPINNER_ID);
  if (!s) {
    ensureSpinnerStyle();
    s = document.createElement("div");
    s.id = SPINNER_ID;
    Object.assign(s.style, {
      position: "fixed",
      top: "8px",
      left: "8px",
      width: "18px",
      height: "18px",
      border: "2px solid rgba(0,0,0,0.25)",
      borderTopColor: "rgba(0,0,0,0.85)",
      borderRadius: "50%",
      animation: "exten-spin 0.9s linear infinite",
      zIndex: String(Z_SPINNER),
      pointerEvents: "none",
      display: "none"
    });
    document.documentElement.appendChild(s);
  }
  return s;
}
function showSpinner() { ensureSpinner().style.display = "block"; }
function hideSpinner() { const s = document.getElementById(SPINNER_ID); if (s) s.style.display = "none"; }
function incPending() { __pendingRequests++; if (__pendingRequests > 0) showSpinner(); }
function decPending() { __pendingRequests = Math.max(0, __pendingRequests - 1); if (__pendingRequests === 0) hideSpinner(); }

// ========================================================================
// 5) Сохранение предложений в chrome.storage.local
// ========================================================================
async function saveSuggestions({ url, sourceText, suggestions }) {
  try {
    const got = await chrome.storage.local.get(STORAGE_LOG_KEY);
    const suggestionsLog = Array.isArray(got[STORAGE_LOG_KEY]) ? got[STORAGE_LOG_KEY] : [];
    suggestionsLog.push({ url, sourceText, suggestions, ts: Date.now() });
    await chrome.storage.local.set({ [STORAGE_LOG_KEY]: suggestionsLog });
    window.__extenLastSuggestions = suggestions;
  } catch (e) {
    console.warn("[exten] Failed to save suggestions:", e);
  }
}

// ========================================================================
// Игнорирование (кнопка "cancel"): хранение и фильтрация
// ========================================================================
function makeIgnoreKey(original, suggestion) { return String(original ?? "") + "\u0001" + String(suggestion ?? ""); }
async function loadIgnoredSet() {
  try {
    const got = await chrome.storage.local.get(STORAGE_IGNORED_KEY);
    const arr = Array.isArray(got[STORAGE_IGNORED_KEY]) ? got[STORAGE_IGNORED_KEY] : [];
    window.__extenIgnoredSet = new Set(arr.map(x => makeIgnoreKey(x.original, x.suggestion)));
  } catch { window.__extenIgnoredSet = new Set(); }
}
async function addToIgnored(original, suggestion) {
  try {
    const key = makeIgnoreKey(original, suggestion);
    if (!window.__extenIgnoredSet.has(key)) {
      window.__extenIgnoredSet.add(key);
      const got = await chrome.storage.local.get(STORAGE_IGNORED_KEY);
      const arr = Array.isArray(got[STORAGE_IGNORED_KEY]) ? got[STORAGE_IGNORED_KEY] : [];
      arr.push({ original, suggestion });
      await chrome.storage.local.set({ [STORAGE_IGNORED_KEY]: arr });
    }
  } catch (e) { console.warn("[exten] Failed to add to ignored:", e); }
}

// ========================================================================
/// Overlay слой для подчёркивания и интерактива
// ========================================================================
function ensureOverlay() {
  let overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: String(Z_OVERLAY)
    });
    document.documentElement.appendChild(overlay);
  }
  return overlay;
}
function clearOverlay() { const overlay = document.getElementById(OVERLAY_ID); if (overlay) overlay.innerHTML = ""; }
function drawUnderlineForRect(rect) {
  const line = document.createElement("div");
  const thickness = 2;
  Object.assign(line.style, {
    position: "absolute",
    left: rect.left + "px",
    top: rect.top + rect.height - thickness + "px",
    width: rect.width + "px",
    height: thickness + "px",
    background: "rgba(255, 215, 0, 0.9)",
    borderRadius: "1px",
    boxShadow: "0 0 0.5px rgba(0,0,0,0.4)",
    pointerEvents: "none"
  });
  return line;
}
function getVisibleClientRectsForRange(range) {
  const rects = Array.from(range.getClientRects());
  const vw = window.innerWidth, vh = window.innerHeight;
  return rects.filter(r => r.width > 0.5 && r.height > 0.5 && r.left < vw && r.top < vh && r.bottom > 0 && r.right > 0);
}
function* textNodesUnder(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentNode;
      if (!p) return NodeFilter.FILTER_REJECT;
      const tag = (p.nodeName || "").toLowerCase();
      if (["script", "style", "noscript"].includes(tag)) return NodeFilter.FILTER_REJECT;
      const cs = p instanceof Element ? getComputedStyle(p) : null;
      if (cs && (cs.visibility === "hidden" || cs.display === "none")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let node; while ((node = walker.nextNode())) yield node;
}

// ========================================================================
// 6+7) Подсветка, тултип, замена, cancel
// ========================================================================
let __extenMatches = []; // [{ range, original, suggestion, rects }]
function isBoundaryLeft(ch) { return !ch || /\s|[([{"'“‘«—–-]|[.!?]/.test(ch); }
function isBoundaryRight(ch){ return !ch || /\s|[)\]},"'”’»—–-]|[.!?]/.test(ch); }
function findSentenceMatchesInNode(textNode, original) {
  const text = textNode.nodeValue;
  if (!text || !original) return [];
  const matches = [];
  let from = 0;
  while (true) {
    const idx = text.indexOf(original, from); if (idx === -1) break;
    const prev = idx > 0 ? text[idx - 1] : "";
    const next = (idx + original.length < text.length) ? text[idx + original.length] : "";
    if (isBoundaryLeft(prev) && isBoundaryRight(next)) {
      const r = document.createRange(); r.setStart(textNode, idx); r.setEnd(textNode, idx + original.length);
      matches.push(r);
    }
    from = idx + original.length;
  }
  return matches;
}

// Закрыть все попапы, кроме указанного id
function closeAllPopupsExcept(exceptId) {
  if (exceptId !== TOOLTIP_ID) hideTooltip();
  if (exceptId !== SELECT_POPUP_ID) hideSelectPopup();
  if (exceptId !== GLOBAL_MODAL_ID) hideGlobalContextModal();
}

function ensureTooltip() {
  let t = document.getElementById(TOOLTIP_ID);
  if (!t) {
    t = document.createElement("div");
    t.id = TOOLTIP_ID;
    Object.assign(t.style, {
      position: "fixed",
      maxWidth: "360px",
      padding: "8px 10px",
      background: "rgba(255,255,255,0.98)",
      border: "1px solid rgba(0,0,0,0.15)",
      borderRadius: "8px",
      boxShadow: "0 6px 20px rgba(0,0,0,0.15)",
      font: "12px/1.35 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Inter,Arial,sans-serif",
      color: "#111",
      display: "none",
      pointerEvents: "auto",
      zIndex: String(Z_UI)
    });
    t.innerHTML = `
      <div id="exten-tip-text" style="white-space:pre-wrap; word-break:break-word; margin-bottom:6px;"></div>
      <div style="display:flex; gap:6px; justify-content:flex-end; align-items:center;">
        <button id="exten-tip-replace" style="padding:4px 8px; border-radius:6px; border:1px solid #ccc; background:#f5f5f5; cursor:pointer;">change</button>
        <button id="exten-tip-ignore" style="padding:4px 8px; border-radius:6px; border:1px solid #ccc; background:#fafafa; cursor:pointer;">cancel</button>
        <button id="exten-tip-close" style="padding:4px 8px; border-radius:6px; border:1px solid #ddd; background:#fff; cursor:pointer;">✕</button>
      </div>
    `;
    document.documentElement.appendChild(t);
  }
  return t;
}
function showTooltipNearRect(rect, suggestion, onReplace, onIgnore) {
  closeAllPopupsExcept(TOOLTIP_ID);
  const tip = ensureTooltip();
  tip.querySelector("#exten-tip-text").textContent = suggestion || "(no suggestion)";
  tip.style.display = "block";
  tip.style.left = "0px"; tip.style.top = "-10000px";
  const pad = 8, width = tip.offsetWidth, height = tip.offsetHeight;
  let left = Math.min(Math.max(rect.left, 8), window.innerWidth - width - 8);
  let top = rect.top - height - pad; if (top < 0) top = rect.bottom + pad;
  tip.style.left = `${left}px`; tip.style.top = `${top}px`;
  const btnReplace = tip.querySelector("#exten-tip-replace");
  const btnClose = tip.querySelector("#exten-tip-close");
  const btnIgnore = tip.querySelector("#exten-tip-ignore");
  btnReplace.onclick = (e) => { e.stopPropagation(); onReplace(); hideTooltip(); };
  btnClose.onclick = (e) => { e.stopPropagation(); hideTooltip(); };
  btnIgnore.onclick = (e) => { e.stopPropagation(); onIgnore(); hideTooltip(); };
}
function hideTooltip() { const tip = document.getElementById(TOOLTIP_ID); if (tip) tip.style.display = "none"; }

function renderSuggestionsUI(suggestions) {
  clearOverlay();
  const overlay = ensureOverlay();
  __extenMatches = [];
  const ignored = window.__extenIgnoredSet || new Set();
  const items = (Array.isArray(suggestions) ? suggestions : [])
    .filter(s => s && typeof s.original === "string")
    .filter(s => !ignored.has(makeIgnoreKey(s.original, s.suggestion || "")));
  if (!items.length) { hideTooltip(); return; }

  for (const node of textNodesUnder(document.body)) {
    for (let i = 0; i < items.length; i++) {
      const s = items[i];
      const original = (s && typeof s.original === "string") ? s.original.trim() : "";
      const suggestion = (s && typeof s.suggestion === "string") ? s.suggestion : "";
      if (!original) continue;
      const ranges = findSentenceMatchesInNode(node, original);
      for (const range of ranges) {
        const rects = getVisibleClientRectsForRange(range); if (!rects.length) continue;
        const matchIndex = __extenMatches.push({ range, original, suggestion, rects }) - 1;
        for (const r of rects) overlay.appendChild(drawUnderlineForRect(r));
        for (const r of rects) {
          const spot = document.createElement("div");
          Object.assign(spot.style, {
            position: "absolute", left: r.left + "px", top: r.top + "px",
            width: r.width + "px", height: r.height + "px",
            background: "transparent", cursor: "pointer", pointerEvents: "auto"
          });
          spot.addEventListener("mouseenter", () => {
            if (__pointerInSelectPopup || __pointerInGlobalModal) return;
            showTooltipNearRect(r, suggestion, () => replaceMatch(matchIndex), () => ignoreMatch(matchIndex));
          });
          spot.addEventListener("click", (e) => {
            if (__pointerInSelectPopup || __pointerInGlobalModal) return;
            e.preventDefault(); e.stopPropagation();
            showTooltipNearRect(r, suggestion, () => replaceMatch(matchIndex), () => ignoreMatch(matchIndex));
          });
          overlay.appendChild(spot);
        }
      }
    }
  }

  // Перерисовка при скролле/ресайзе
  let rafId = null;
  function scheduleRerender() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => { hideTooltip(); renderSuggestionsUI(window.__extenLastSuggestions || []); });
  }
  if (window.__extenRerenderHandler) {
    window.removeEventListener("scroll", window.__extenRerenderHandler);
    window.removeEventListener("resize", window.__extenRerenderHandler);
  }
  window.__extenRerenderHandler = scheduleRerender;
  window.addEventListener("scroll", scheduleRerender, { passive: true });
  window.addEventListener("resize", scheduleRerender);

  if (window.__extenMo) window.__extenMo.disconnect();
  window.__extenMo = new MutationObserver(() => { scheduleRerender(); });
  window.__extenMo.observe(document.body, { childList: true, characterData: true, subtree: true });
}
function replaceMatch(index) {
  const m = __extenMatches[index]; if (!m) return;
  try {
    const { range, suggestion } = m;
    const replacement = document.createTextNode(suggestion || "");
    range.deleteContents(); range.insertNode(replacement);
  } catch (e) { console.warn("[exten] Replace failed:", e); }
  finally { hideTooltip(); renderSuggestionsUI(window.__extenLastSuggestions || []); }
}
function ignoreMatch(index) {
  const m = __extenMatches[index]; if (!m) return;
  const { original, suggestion } = m;
  addToIgnored(original, suggestion).then(() => { hideTooltip(); renderSuggestionsUI(window.__extenLastSuggestions || []); });
}
function underlineOriginals(originals) {
  const suggestions = (originals || []).map(o => ({ original: o, suggestion: "" }));
  renderSuggestionsUI(suggestions);
}

// === Замена "во всём документе" (для списка в попапе) ====================
function replaceAllExactInDocument(original, suggestion) {
  if (!original) return 0;
  let total = 0;
  for (const node of textNodesUnder(document.body)) {
    const text = node.nodeValue || "";
    let out = "";
    let i = 0;
    while (i < text.length) {
      const idx = text.indexOf(original, i);
      if (idx === -1) { out += text.slice(i); break; }
      const prev = idx > 0 ? text[idx - 1] : "";
      const next = (idx + original.length < text.length) ? text[idx + original.length] : "";
      if (isBoundaryLeft(prev) && isBoundaryRight(next)) {
        out += text.slice(i, idx) + (suggestion || "");
        i = idx + original.length;
        total++;
      } else {
        out += text.slice(i, idx + 1);
        i = idx + 1;
      }
    }
    if (out && out !== text) node.nodeValue = out;
  }
  // после замены — пересчитать подсветку
  renderSuggestionsUI(window.__extenLastSuggestions || []);
  return total;
}

// ========================================================================
// Общая отправка текста на /main (c опциями для локального спиннера)
// ========================================================================
async function processText(text, opts = {}) {
  const { useGlobalSpinner = true, onSuggestions } = opts;
  if (!text) return;
  if (useGlobalSpinner) incPending();
  try {
    const resp = await fetch(SERVER_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    const data = await resp.json();
    console.log("suggestment:", data?.suggestment);
    const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
    await saveSuggestions({ url: location.href, sourceText: text, suggestions });
    renderSuggestionsUI(suggestions);
    if (typeof onSuggestions === "function") onSuggestions(suggestions, data);
  } catch (err) {
    console.error("[exten] Failed to contact server or process response:", err);
    if (typeof onSuggestions === "function") onSuggestions([], { error: String(err) });
  } finally {
    if (useGlobalSpinner) decPending();
  }
}

// ========================================================================
// 1–4) Alt+Click: отправляем ВЕСЬ текст блока
// ========================================================================
function isBlockish(el) {
  if (!(el instanceof Element)) return false;
  const tag = el.tagName.toLowerCase();
  if (["p","div","section","article","main","aside","header","footer","li","ul","ol","td","th","tr","table","figcaption","figure","pre","blockquote"].includes(tag)) return true;
  const cs = getComputedStyle(el); return ["block","flex","grid","table","flow-root","list-item"].includes(cs.display);
}
function findBlockRoot(start) {
  if (!(start instanceof Element)) return document.body;
  const marked = start.closest("[data-exten-block]"); if (marked) return marked;
  let el = start; while (el && el !== document.body) { if (isBlockish(el)) return el; el = el.parentElement; }
  return document.body;
}
function textFromBlock(el) { const txt = (el && el.innerText ? el.innerText : "").trim(); const MAX = 50000; return txt.length > MAX ? txt.slice(0, MAX) : txt; }
function handleAltClickSendBlock(e) {
  if (!e.altKey) return;
  const block = findBlockRoot(e.target);
  const text = textFromBlock(block); if (!text) return;
  e.preventDefault(); e.stopPropagation();
  processText(text);
}

// ========================================================================
// Отправка при вводе '.', '?' или '!' в редактируемых полях
// ========================================================================
function isEditableTarget(el) {
  if (!(el instanceof Element)) return false;
  if (el.closest('[contenteditable="true"]')) return true;
  const tag = el.tagName?.toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input") { const type = (el.getAttribute("type") || "text").toLowerCase(); return ["text","search","url","tel","email","password","number"].includes(type); }
  return false;
}
function getEditableText(el) {
  if (!(el instanceof Element)) return "";
  const tag = el.tagName?.toLowerCase();
  if (tag === "textarea" || tag === "input") return el.value || "";
  const ce = el.closest('[contenteditable="true"]'); if (ce) return textFromBlock(ce);
  return "";
}
const __extenLastSendMap = new WeakMap();
function maybeSendOnPunctuation(e) {
  if (!isEditableTarget(e.target)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key; if (key !== "." && key !== "?" && key !== "!") return;
  const target = e.target; const now = Date.now(); const last = __extenLastSendMap.get(target) || 0;
  if (now - last < 800) return;
  setTimeout(() => { const text = getEditableText(target).trim(); if (text) { __extenLastSendMap.set(target, Date.now()); processText(text); } }, 0);
}

// ========================================================================
// Всплывающее окно при ВЫДЕЛЕНИИ текста (с полем ввода, спиннером и списком)
// ========================================================================
function ensureSelectPopup() {
  let p = document.getElementById(SELECT_POPUP_ID);
  if (!p) {
    ensureSpinnerStyle(); // чтобы анимация была доступна и для локального спиннера
    p = document.createElement("div");
    p.id = SELECT_POPUP_ID;
    Object.assign(p.style, {
      position: "fixed",
      maxWidth: "460px",
      minWidth: "280px",
      padding: "10px",
      background: "rgba(255,255,255,0.98)",
      border: "1px solid rgba(0,0,0,0.15)",
      borderRadius: "10px",
      boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
      font: "12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Inter,Arial,sans-serif",
      color: "#111",
      display: "none",
      zIndex: String(Z_UI),
      pointerEvents: "auto"
    });
    p.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:6px;">
        <div style="font-weight:600;">Send selected</div>
        <button id="exten-select-close" title="close" style="padding:2px 6px; border-radius:6px; border:1px solid #ddd; background:#fff; cursor:pointer;">✕</button>
      </div>
      <div id="exten-select-preview" style="max-height:100px; overflow:auto; background:#fafafa; border:1px solid #eee; border-radius:6px; padding:6px; margin-bottom:6px; white-space:pre-wrap;"></div>
      <textarea id="exten-select-input" rows="3" placeholder="optional text to add..." style="width:100%; resize:vertical; border:1px solid #ddd; border-radius:6px; padding:6px; outline:none; margin-bottom:8px;"></textarea>
      <div style="display:flex; gap:8px; justify-content:flex-end; align-items:center;">
        <div id="exten-select-spinner" style="display:none; width:16px; height:16px; border:2px solid rgba(0,0,0,0.25); border-top-color: rgba(0,0,0,0.85); border-radius:50%; animation: exten-spin 0.9s linear infinite;"></div>
        <button id="exten-select-send" style="padding:6px 10px; border-radius:8px; border:1px solid #ccc; background:#f5f5f5; cursor:pointer;">send text</button>
      </div>
      <div id="exten-select-suggestions" style="margin-top:8px; max-height:240px; overflow:auto;"></div>
    `;
    // Клики внутри попапа не считаем внешними
    p.addEventListener("click", (e) => e.stopPropagation());
    p.addEventListener("mouseenter", () => { __pointerInSelectPopup = true; });
    p.addEventListener("mouseleave", () => { __pointerInSelectPopup = false; });
    document.documentElement.appendChild(p);
  }
  return p;
}
function getSelectionRect() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return null;
  const rects = range.getClientRects(); if (rects.length) return rects[0];
  const rect = range.getBoundingClientRect?.(); if (rect && rect.width && rect.height) return rect;
  return null;
}
function getSelectedText() { const sel = window.getSelection(); if (!sel) return ""; return String(sel.toString() || "").trim(); }
function focusInsideSelectPopup() { const p = document.getElementById(SELECT_POPUP_ID); return !!(p && document.activeElement && p.contains(document.activeElement)); }

function renderSelectPopupSuggestions(suggestionsRaw) {
  const p = ensureSelectPopup();
  const box = p.querySelector("#exten-select-suggestions");
  const ignored = window.__extenIgnoredSet || new Set();

  const suggestions = (Array.isArray(suggestionsRaw) ? suggestionsRaw : [])
    .filter(s => s && typeof s.original === "string")
    .filter(s => !ignored.has(makeIgnoreKey(s.original, s.suggestion || "")));

  __selectPopupCurrentSuggestions = suggestions;

  if (!suggestions.length) {
    box.innerHTML = `<div style="color:#666; font-size:12px;">No suggestions.</div>`;
    return;
  }

  box.innerHTML = "";
  suggestions.forEach((s, idx) => {
    const item = document.createElement("div");
    Object.assign(item.style, {
      border: "1px solid #eee",
      borderRadius: "8px",
      padding: "8px",
      marginBottom: "6px",
      background: "#fff"
    });
    item.innerHTML = `
      <div style="font-weight:600; margin-bottom:4px; word-break:break-word;">${escapeHtml(s.original)}</div>
      <div style="margin-bottom:6px; color:#0a6; word-break:break-word;">${escapeHtml(s.suggestion || "")}</div>
      <div style="display:flex; gap:6px; justify-content:flex-end;">
        <button class="exten-item-change" data-i="${idx}" style="padding:4px 8px; border-radius:6px; border:1px solid #ccc; background:#f5f5f5; cursor:pointer;">change</button>
        <button class="exten-item-cancel" data-i="${idx}" style="padding:4px 8px; border-radius:6px; border:1px solid #ccc; background:#fafafa; cursor:pointer;">cancel</button>
      </div>
    `;
    box.appendChild(item);
  });

  // Вешаем обработчики
  box.querySelectorAll(".exten-item-change").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const i = Number(e.currentTarget.getAttribute("data-i"));
      const s = __selectPopupCurrentSuggestions[i];
      if (!s) return;
      replaceAllExactInDocument(s.original, s.suggestion || "");
      // Убираем пункт из локального списка и перерисовываем
      const next = __selectPopupCurrentSuggestions.filter((_, j) => j !== i);
      renderSelectPopupSuggestions(next);
    });
  });
  box.querySelectorAll(".exten-item-cancel").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const i = Number(e.currentTarget.getAttribute("data-i"));
      const s = __selectPopupCurrentSuggestions[i];
      if (!s) return;
      addToIgnored(s.original, s.suggestion || "");
      const next = __selectPopupCurrentSuggestions.filter((_, j) => j !== i);
      renderSelectPopupSuggestions(next);
      // Перерисовать оверлей без игнорируемой пары
      renderSuggestionsUI(window.__extenLastSuggestions || []);
    });
  });
}

function showSelectPopup() {
  const selected = getSelectedText(); if (!selected) return hideSelectPopup();
  const rect = getSelectionRect(); if (!rect) return hideSelectPopup();
  closeAllPopupsExcept(SELECT_POPUP_ID);
  const p = ensureSelectPopup();
  p.style.display = "block"; p.style.left = "0px"; p.style.top = "-10000px";

  const preview = p.querySelector("#exten-select-preview");
  const input = p.querySelector("#exten-select-input");
  const btnSend = p.querySelector("#exten-select-send");
  const btnClose = p.querySelector("#exten-select-close");
  const localSpinner = p.querySelector("#exten-select-spinner");

  preview.textContent = selected;
  if (!__selectPopupActive) {
    input.value = "";
    // очищаем старый список при новом открытии
    const box = p.querySelector("#exten-select-suggestions");
    box.innerHTML = "";
    __selectPopupCurrentSuggestions = [];
  }

  const pad = 8, width = p.offsetWidth, height = p.offsetHeight;
  let left = Math.min(Math.max(rect.left, 8), window.innerWidth - width - 8);
  let top = rect.top - height - pad; if (top < 0) top = rect.bottom + pad;
  p.style.left = `${left}px`; p.style.top = `${top}px`;

  btnSend.onclick = (e) => {
    e.stopPropagation();
    const extra = (input.value || "").trim();
    const combined = extra ? (selected + "\n" + extra) : selected;

    // НЕ закрываем попап. Показываем локальный спиннер.
    localSpinner.style.display = "inline-block";
    btnSend.disabled = true;
    input.disabled = true;

    processText(combined, {
      useGlobalSpinner: false,
      onSuggestions: (suggs) => {
        // скрыть локальный спиннер и вернуть управление
        localSpinner.style.display = "none";
        btnSend.disabled = false;
        input.disabled = false;
        // отрисовать список предложений прямо в попапе
        renderSelectPopupSuggestions(suggs);
      }
    });
  };
  btnClose.onclick = (e) => { e.stopPropagation(); hideSelectPopup(); };

  __selectPopupActive = true;
}
function hideSelectPopup() { const p = document.getElementById(SELECT_POPUP_ID); if (p) p.style.display = "none"; __selectPopupActive = false; __pointerInSelectPopup = false; __selectPopupCurrentSuggestions = []; }
function handleSelectionUI() {
  if (window.__extenSelTimer) cancelAnimationFrame(window.__extenSelTimer);
  window.__extenSelTimer = requestAnimationFrame(() => {
    const text = getSelectedText();
    if ((focusInsideSelectPopup() || __pointerInSelectPopup || __pointerInGlobalModal) && __selectPopupActive) return;
    if (text && text.length > 0) showSelectPopup(); else hideSelectPopup();
  });
}

// helper для безопасной вставки текста в HTML
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ========================================================================
// НОВОЕ: Модалка "Global Context" (клик по иконке расширения) → /global_context
// ========================================================================
function ensureGlobalContextModal() {
  let m = document.getElementById(GLOBAL_MODAL_ID);
  if (!m) {
    m = document.createElement("div");
    m.id = GLOBAL_MODAL_ID;
    Object.assign(m.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0,0,0,0.35)",
      display: "none",
      zIndex: String(Z_UI),
      pointerEvents: "auto"
    });
    const card = document.createElement("div");
    Object.assign(card.style, {
      position: "absolute",
      left: "50%",
      top: "20%",
      transform: "translateX(-50%)",
      width: "min(680px, 92vw)",
      background: "#fff",
      border: "1px solid rgba(0,0,0,0.15)",
      borderRadius: "12px",
      boxShadow: "0 12px 30px rgba(0,0,0,0.2)",
      padding: "14px",
      font: "13px -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Inter,Arial,sans-serif",
      color: "#111"
    });
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px;">
        <div style="font-weight:700;">Global context</div>
        <button id="exten-global-close" style="padding:4px 8px; border-radius:8px; border:1px solid #ddd; background:#fff; cursor:pointer;">✕</button>
      </div>
      <div style="margin-bottom:8px; color:#444;">Введите текст, который будет использован как общий контекст.</div>
      <textarea id="exten-global-input" rows="8" placeholder="context..." style="width:100%; resize:vertical; border:1px solid #ddd; border-radius:8px; padding:8px; outline:none;"></textarea>
      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:10px;">
        <button id="exten-global-send" style="padding:6px 10px; border-radius:8px; border:1px solid #ccc; background:#f5f5f5; cursor:pointer;">send context</button>
      </div>
    `;
    m.appendChild(card);
    m.addEventListener("mouseenter", () => { __pointerInGlobalModal = true; });
    m.addEventListener("mouseleave", () => { __pointerInGlobalModal = false; });
    m.addEventListener("click", (e) => { if (e.target === m) hideGlobalContextModal(); });
    document.documentElement.appendChild(m);
  }
  return m;
}
function showGlobalContextModal() {
  closeAllPopupsExcept(GLOBAL_MODAL_ID);
  const m = ensureGlobalContextModal();
  m.style.display = "block";
  const input = m.querySelector("#exten-global-input");
  const btnSend = m.querySelector("#exten-global-send");
  const btnClose = m.querySelector("#exten-global-close");
  btnClose.onclick = (e) => { e.stopPropagation(); hideGlobalContextModal(); };
  btnSend.onclick = (e) => {
    e.stopPropagation();
    const context = (input.value || "").trim();
    if (!context) return;
    hideGlobalContextModal();
    sendGlobalContext(context);
  };
  input.focus({ preventScroll: true });
}
function hideGlobalContextModal() { const m = document.getElementById(GLOBAL_MODAL_ID); if (m) m.style.display = "none"; __pointerInGlobalModal = false; }
async function sendGlobalContext(context) {
  incPending();
  try {
    const resp = await fetch(GLOBAL_CONTEXT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context })
    });
    const data = await resp.json();
    if (!data?.ok) console.warn("[exten] Global context error:", data?.error || "unknown");
    else console.log("[exten] Global context accepted. Model:", data?.model, "len:", (data?.global_context || "").length);
  } catch (e) {
    console.error("[exten] Failed to send global context:", e);
  } finally {
    decPending();
  }
}

// ========================================================================
// Системные обработчики
// ========================================================================
function handleSelectionUI() {
  if (window.__extenSelTimer) cancelAnimationFrame(window.__extenSelTimer);
  window.__extenSelTimer = requestAnimationFrame(() => {
    const text = getSelectedText();
    if ((focusInsideSelectPopup() || __pointerInSelectPopup || __pointerInGlobalModal) && __selectPopupActive) return;
    if (text && text.length > 0) showSelectPopup(); else hideSelectPopup();
  });
}

// Сообщение от background.js при клике на иконку
chrome.runtime?.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "OPEN_GLOBAL_CONTEXT") {
    showGlobalContextModal();
    sendResponse && sendResponse({ ok: true });
  }
});

// ========================================================================
// Подключаем обработчики один раз
// ========================================================================
(function attachOnce() {
  if (window.__extenAltClickAttached) return;
  window.__extenAltClickAttached = true;

  loadIgnoredSet();

  document.addEventListener("click", handleAltClickSendBlock, true);

  // клики вне попапов — закрыть их
  document.addEventListener("click", (e) => {
    const tip = document.getElementById(TOOLTIP_ID);
    if (tip && !tip.contains(e.target)) hideTooltip();

    const selPopup = document.getElementById(SELECT_POPUP_ID);
    if (selPopup && !selPopup.contains(e.target)) {
      if (!window.getSelection || window.getSelection().isCollapsed) hideSelectPopup();
    }
    // глобальная модалка сама закрывается по клику на оверлей
  });

  document.addEventListener("keydown", maybeSendOnPunctuation, true);

  document.addEventListener("selectionchange", handleSelectionUI, true);
  document.addEventListener("mouseup", handleSelectionUI, true);
  document.addEventListener("keyup", handleSelectionUI, true);

  // Репозиционирование select-попапа
  function repositionSelectionPopup() {
    if (!__selectPopupActive) return;
    if (focusInsideSelectPopup() || __pointerInSelectPopup || __pointerInGlobalModal) return;
    const txt = getSelectedText(); if (txt) showSelectPopup();
  }
  window.addEventListener("scroll", repositionSelectionPopup, { passive: true });
  window.addEventListener("resize", repositionSelectionPopup);
})();
