// ========================= exten content.js ==============================
// Требуется в manifest.json:
// - "permissions": ["storage"]
// - "host_permissions": ["http://127.0.0.1:5055/*"]
// - content script на всех страницах
// ========================================================================

const SERVER_URL = "http://127.0.0.1:5055/main";
const OVERLAY_ID = "exten-underline-overlay";
const TOOLTIP_ID = "exten-suggest-tooltip";
const SELECT_POPUP_ID = "exten-select-popup";
const STORAGE_LOG_KEY = "suggestionsLog";
const STORAGE_IGNORED_KEY = "extenIgnored"; // [{ original, suggestion }]

const SPINNER_ID = "exten-loading-spinner";
const SPINNER_STYLE_ID = "exten-loading-style";

// Глобальные кэши и флаги
window.__extenLastSuggestions = Array.isArray(window.__extenLastSuggestions) ? window.__extenLastSuggestions : [];
window.__extenIgnoredSet = window.__extenIgnoredSet instanceof Set ? window.__extenIgnoredSet : new Set();
let __selectPopupActive = false;
let __pointerInSelectPopup = false; // курсор внутри окна выбора?
let __pendingRequests = 0; // для спиннера

////////////////////////////////////////////////////////////////////////////////
// 0) Индикатор загрузки (спиннер, верхний левый угол)
////////////////////////////////////////////////////////////////////////////////
function ensureSpinnerStyle() {
  if (document.getElementById(SPINNER_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = SPINNER_STYLE_ID;
  style.textContent = `
    @keyframes exten-spin { to { transform: rotate(360deg); } }
  `;
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
      zIndex: "2147483647",
      pointerEvents: "none",
      display: "none",
      backdropFilter: "blur(0px)"
    });
    // темная тема поддержка — если фон тёмный, границы видны всё равно
    document.documentElement.appendChild(s);
  }
  return s;
}
function showSpinner() {
  const s = ensureSpinner();
  s.style.display = "block";
}
function hideSpinner() {
  const s = document.getElementById(SPINNER_ID);
  if (s) s.style.display = "none";
}
function incPending() {
  __pendingRequests++;
  if (__pendingRequests > 0) showSpinner();
}
function decPending() {
  __pendingRequests = Math.max(0, __pendingRequests - 1);
  if (__pendingRequests === 0) hideSpinner();
}

////////////////////////////////////////////////////////////////////////////////
// 5) Сохранение предложений в chrome.storage.local
////////////////////////////////////////////////////////////////////////////////
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

////////////////////////////////////////////////////////////////////////////////
// Игнорирование (кнопка "cancel"): хранение и фильтрация
////////////////////////////////////////////////////////////////////////////////
function makeIgnoreKey(original, suggestion) {
  return String(original ?? "") + "\u0001" + String(suggestion ?? "");
}
async function loadIgnoredSet() {
  try {
    const got = await chrome.storage.local.get(STORAGE_IGNORED_KEY);
    const arr = Array.isArray(got[STORAGE_IGNORED_KEY]) ? got[STORAGE_IGNORED_KEY] : [];
    window.__extenIgnoredSet = new Set(arr.map(x => makeIgnoreKey(x.original, x.suggestion)));
  } catch {
    window.__extenIgnoredSet = new Set();
  }
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
  } catch (e) {
    console.warn("[exten] Failed to add to ignored:", e);
  }
}

////////////////////////////////////////////////////////////////////////////////
/// Overlay слой для подчёркивания и интерактива
////////////////////////////////////////////////////////////////////////////////
function ensureOverlay() {
  let overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "2147483647"
    });
    document.documentElement.appendChild(overlay);
  }
  return overlay;
}
function clearOverlay() {
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) overlay.innerHTML = "";
}
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
  return rects.filter(r =>
    r.width > 0.5 && r.height > 0.5 && r.left < vw && r.top < vh && r.bottom > 0 && r.right > 0
  );
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
  let node;
  while ((node = walker.nextNode())) yield node;
}

////////////////////////////////////////////////////////////////////////////////
// 6+7) Поиск совпадений, подсветка, тултип, замена и "cancel"
////////////////////////////////////////////////////////////////////////////////
let __extenMatches = []; // [{ range, original, suggestion, rects }]
function isBoundaryLeft(ch) { return !ch || /\s|[([{"'“‘«—–-]|[.!?]/.test(ch); }
function isBoundaryRight(ch){ return !ch || /\s|[)\]},"'”’»—–-]|[.!?]/.test(ch); }
function findSentenceMatchesInNode(textNode, original) {
  const text = textNode.nodeValue;
  if (!text || !original) return [];
  const matches = [];
  let from = 0;
  while (true) {
    const idx = text.indexOf(original, from);
    if (idx === -1) break;
    const prev = idx > 0 ? text[idx - 1] : "";
    const next = (idx + original.length < text.length) ? text[idx + original.length] : "";
    if (isBoundaryLeft(prev) && isBoundaryRight(next)) {
      const r = document.createRange();
      r.setStart(textNode, idx);
      r.setEnd(textNode, idx + original.length);
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
      zIndex: "2147483647"
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
  // при открытии тултипа — закрыть другие попапы (включая select)
  closeAllPopupsExcept(TOOLTIP_ID);

  const tip = ensureTooltip();
  tip.querySelector("#exten-tip-text").textContent = suggestion || "(no suggestion)";
  tip.style.display = "block";
  tip.style.left = "0px";
  tip.style.top = "-10000px";
  const pad = 8;
  const width = tip.offsetWidth, height = tip.offsetHeight;
  let left = Math.min(Math.max(rect.left, 8), window.innerWidth - width - 8);
  let top = rect.top - height - pad;
  if (top < 0) top = rect.bottom + pad;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;

  const btnReplace = tip.querySelector("#exten-tip-replace");
  const btnClose = tip.querySelector("#exten-tip-close");
  const btnIgnore = tip.querySelector("#exten-tip-ignore");
  btnReplace.onclick = (e) => { e.stopPropagation(); onReplace(); hideTooltip(); };
  btnClose.onclick = (e) => { e.stopPropagation(); hideTooltip(); };
  btnIgnore.onclick = (e) => { e.stopPropagation(); onIgnore(); hideTooltip(); };
}
function hideTooltip() {
  const tip = document.getElementById(TOOLTIP_ID);
  if (tip) tip.style.display = "none";
}

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
        const rects = getVisibleClientRectsForRange(range);
        if (!rects.length) continue;

        const matchIndex = __extenMatches.push({ range, original, suggestion, rects }) - 1;

        for (const r of rects) overlay.appendChild(drawUnderlineForRect(r));

        for (const r of rects) {
          const spot = document.createElement("div");
          Object.assign(spot.style, {
            position: "absolute",
            left: r.left + "px",
            top: r.top + "px",
            width: r.width + "px",
            height: r.height + "px",
            background: "transparent",
            cursor: "pointer",
            pointerEvents: "auto"
          });
          // если курсор внутри окна выбора — не открываем тултип
          spot.addEventListener("mouseenter", () => {
            if (__pointerInSelectPopup) return;
            showTooltipNearRect(
              r,
              suggestion,
              () => replaceMatch(matchIndex),
              () => ignoreMatch(matchIndex)
            );
          });
          spot.addEventListener("click", (e) => {
            if (__pointerInSelectPopup) return;
            e.preventDefault(); e.stopPropagation();
            showTooltipNearRect(
              r,
              suggestion,
              () => replaceMatch(matchIndex),
              () => ignoreMatch(matchIndex)
            );
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
    rafId = requestAnimationFrame(() => {
      hideTooltip();
      renderSuggestionsUI(window.__extenLastSuggestions || []);
    });
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
  const m = __extenMatches[index];
  if (!m) return;
  try {
    const { range, suggestion } = m;
    const replacement = document.createTextNode(suggestion || "");
    range.deleteContents();
    range.insertNode(replacement);
  } catch (e) {
    console.warn("[exten] Replace failed:", e);
  } finally {
    hideTooltip();
    renderSuggestionsUI(window.__extenLastSuggestions || []);
  }
}
function ignoreMatch(index) {
  const m = __extenMatches[index];
  if (!m) return;
  const { original, suggestion } = m;
  addToIgnored(original, suggestion).then(() => {
    hideTooltip();
    renderSuggestionsUI(window.__extenLastSuggestions || []);
  });
}
function underlineOriginals(originals) {
  const suggestions = (originals || []).map(o => ({ original: o, suggestion: "" }));
  renderSuggestionsUI(suggestions);
}

////////////////////////////////////////////////////////////////////////////////
// Общая отправка текста
////////////////////////////////////////////////////////////////////////////////
async function processText(text) {
  if (!text) return;
  incPending();
  try {
    const resp = await fetch(SERVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    const data = await resp.json();
    console.log("suggestment:", data?.suggestment);
    const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
    await saveSuggestions({ url: location.href, sourceText: text, suggestions });
    renderSuggestionsUI(suggestions);
  } catch (err) {
    console.error("[exten] Failed to contact server or process response:", err);
  } finally {
    decPending();
  }
}

////////////////////////////////////////////////////////////////////////////////
// 1–4) Alt+Click: отправляем ВЕСЬ текст блока
////////////////////////////////////////////////////////////////////////////////
function isBlockish(el) {
  if (!(el instanceof Element)) return false;
  const tag = el.tagName.toLowerCase();
  if (["div","section","article","main","aside","header","footer",
       "li","ul","ol","td","th","tr","table","figcaption","figure",
       "pre","blockquote"].includes(tag)) return true;
  const cs = getComputedStyle(el);
  return ["block","flex","grid","table","flow-root","list-item"].includes(cs.display);
}
function findBlockRoot(start) {
  if (!(start instanceof Element)) return document.body;
  const marked = start.closest("[data-exten-block]");
  if (marked) return marked;
  let el = start;
  while (el && el !== document.body) {
    if (isBlockish(el)) return el;
    el = el.parentElement;
  }
  return document.body;
}
function textFromBlock(el) {
  const txt = (el && el.innerText ? el.innerText : "").trim();
  const MAX = 50000;
  return txt.length > MAX ? txt.slice(0, MAX) : txt;
}
function handleAltClickSendBlock(e) {
  if (!e.altKey) return;
  const block = findBlockRoot(e.target);
  const text = textFromBlock(block);
  if (!text) return;
  e.preventDefault();
  e.stopPropagation();
  processText(text);
}

////////////////////////////////////////////////////////////////////////////////
// Отправка при вводе '.', '?' или '!' в редактируемых полях
////////////////////////////////////////////////////////////////////////////////
function isEditableTarget(el) {
  if (!(el instanceof Element)) return false;
  if (el.closest('[contenteditable="true"]')) return true;
  const tag = el.tagName?.toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    return ["text","search","url","tel","email","password","number"].includes(type);
  }
  return false;
}
function getEditableText(el) {
  if (!(el instanceof Element)) return "";
  const tag = el.tagName?.toLowerCase();
  if (tag === "textarea" || tag === "input") return el.value || "";
  const ce = el.closest('[contenteditable="true"]');
  if (ce) return textFromBlock(ce);
  return "";
}
const __extenLastSendMap = new WeakMap();
function maybeSendOnPunctuation(e) {
  if (!isEditableTarget(e.target)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key;
  if (key !== "." && key !== "?" && key !== "!") return;
  const target = e.target;
  const now = Date.now();
  const last = __extenLastSendMap.get(target) || 0;
  if (now - last < 800) return;
  setTimeout(() => {
    const text = getEditableText(target).trim();
    if (text) {
      __extenLastSendMap.set(target, Date.now());
      processText(text);
    }
  }, 0);
}

////////////////////////////////////////////////////////////////////////////////
// Всплывающее окно при ВЫДЕЛЕНИИ текста (с полем ввода и кнопкой "send text")
////////////////////////////////////////////////////////////////////////////////
function ensureSelectPopup() {
  let p = document.getElementById(SELECT_POPUP_ID);
  if (!p) {
    p = document.createElement("div");
    p.id = SELECT_POPUP_ID;
    Object.assign(p.style, {
      position: "fixed",
      maxWidth: "420px",
      minWidth: "260px",
      padding: "10px",
      background: "rgba(255,255,255,0.98)",
      border: "1px solid rgba(0,0,0,0.15)",
      borderRadius: "10px",
      boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
      font: "12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Inter,Arial,sans-serif",
      color: "#111",
      display: "none",
      zIndex: "2147483647",
      pointerEvents: "auto"
    });
    p.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:6px;">
        <div style="font-weight:600;">Send selected</div>
        <button id="exten-select-close" title="close" style="padding:2px 6px; border-radius:6px; border:1px solid #ddd; background:#fff; cursor:pointer;">✕</button>
      </div>
      <div id="exten-select-preview" style="max-height:100px; overflow:auto; background:#fafafa; border:1px solid #eee; border-radius:6px; padding:6px; margin-bottom:6px; white-space:pre-wrap;"></div>
      <textarea id="exten-select-input" rows="3" placeholder="optional text to add..." style="width:100%; resize:vertical; border:1px solid #ddd; border-radius:6px; padding:6px; outline:none; margin-bottom:8px;"></textarea>
      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button id="exten-select-send" style="padding:6px 10px; border-radius:8px; border:1px solid #ccc; background:#f5f5f5; cursor:pointer;">send text</button>
      </div>
    `;
    // Клики внутри попапа не считаем внешними
    p.addEventListener("click", (e) => e.stopPropagation());
    // Трек курсора внутри/снаружи попапа (для блокировки тултипа)
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
  const rects = range.getClientRects();
  if (rects.length) return rects[0];
  const rect = range.getBoundingClientRect?.();
  if (rect && rect.width && rect.height) return rect;
  return null;
}
function getSelectedText() {
  const sel = window.getSelection();
  if (!sel) return "";
  return String(sel.toString() || "").trim();
}
function focusInsideSelectPopup() {
  const p = document.getElementById(SELECT_POPUP_ID);
  return !!(p && document.activeElement && p.contains(document.activeElement));
}
function showSelectPopup() {
  const selected = getSelectedText();
  if (!selected) return hideSelectPopup();
  const rect = getSelectionRect();
  if (!rect) return hideSelectPopup();

  // при открытии окна выбора — закрыть другие попапы (тултип)
  closeAllPopupsExcept(SELECT_POPUP_ID);

  const p = ensureSelectPopup();
  p.style.display = "block";
  p.style.left = "0px";
  p.style.top = "-10000px";

  const preview = p.querySelector("#exten-select-preview");
  const input = p.querySelector("#exten-select-input");
  const btnSend = p.querySelector("#exten-select-send");
  const btnClose = p.querySelector("#exten-select-close");

  preview.textContent = selected;
  if (!__selectPopupActive) input.value = "";

  const pad = 8;
  const width = p.offsetWidth, height = p.offsetHeight;
  let left = Math.min(Math.max(rect.left, 8), window.innerWidth - width - 8);
  let top = rect.top - height - pad;
  if (top < 0) top = rect.bottom + pad;
  p.style.left = `${left}px`;
  p.style.top = `${top}px`;

  btnSend.onclick = (e) => {
    e.stopPropagation();
    const extra = (input.value || "").trim();
    const combined = extra ? (selected + "\n" + extra) : selected;
    hideSelectPopup();
    processText(combined);
  };
  btnClose.onclick = (e) => { e.stopPropagation(); hideSelectPopup(); };

  __selectPopupActive = true;
}
function hideSelectPopup() {
  const p = document.getElementById(SELECT_POPUP_ID);
  if (p) p.style.display = "none";
  __selectPopupActive = false;
  __pointerInSelectPopup = false; // сброс флага
}
function handleSelectionUI() {
  if (window.__extenSelTimer) cancelAnimationFrame(window.__extenSelTimer);
  window.__extenSelTimer = requestAnimationFrame(() => {
    const text = getSelectedText();
    // если фокус или курсор внутри попапа — не закрываем и не открываем другие
    if ((focusInsideSelectPopup() || __pointerInSelectPopup) && __selectPopupActive) {
      return;
    }
    if (text && text.length > 0) {
      showSelectPopup();
    } else {
      hideSelectPopup();
    }
  });
}

////////////////////////////////////////////////////////////////////////////////
// Подключаем обработчики один раз
////////////////////////////////////////////////////////////////////////////////
(function attachOnce() {
  if (window.__extenAltClickAttached) return;
  window.__extenAltClickAttached = true;

  loadIgnoredSet();

  document.addEventListener("click", handleAltClickSendBlock, true);

  document.addEventListener("click", (e) => {
    const tip = document.getElementById(TOOLTIP_ID);
    if (tip && !tip.contains(e.target)) hideTooltip();

    const selPopup = document.getElementById(SELECT_POPUP_ID);
    if (selPopup && !selPopup.contains(e.target)) {
      if (!window.getSelection || window.getSelection().isCollapsed) hideSelectPopup();
    }
  });

  document.addEventListener("keydown", maybeSendOnPunctuation, true);

  // Не закрывать попап при вводе в его textarea / когда курсор над ним
  document.addEventListener("selectionchange", handleSelectionUI, true);
  document.addEventListener("mouseup", handleSelectionUI, true);
  document.addEventListener("keyup", handleSelectionUI, true);

  // Репозиционирование попапа при скролле/resize, если выделение ещё есть и курсор не в попапе
  function repositionSelectionPopup() {
    if (!__selectPopupActive) return;
    if (focusInsideSelectPopup() || __pointerInSelectPopup) return;
    const txt = getSelectedText();
    if (txt) showSelectPopup();
  }
  window.addEventListener("scroll", repositionSelectionPopup, { passive: true });
  window.addEventListener("resize", repositionSelectionPopup);
})();
