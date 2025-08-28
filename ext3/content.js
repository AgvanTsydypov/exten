// === Utility: persistent storage of suggestions ==========================
async function saveSuggestions({ url, selection, suggestions }) {
  try {
    const { suggestionsLog = [] } = await chrome.storage.local.get("suggestionsLog");
    suggestionsLog.push({
      url,
      selection,
      suggestions,           // array of { original, suggestion }
      ts: Date.now()
    });
    await chrome.storage.local.set({ suggestionsLog });
    // convenient handle for quick inspection in DevTools
    // (doesn't replace persistent storage)
    window.__extenLastSuggestions = suggestions;
    return true;
  } catch (e) {
    console.warn("Failed to save suggestions:", e);
    return false;
  }
}

// === Overlay underlines ===================================================
const OVERLAY_ID = "exten-underline-overlay";

function ensureOverlay() {
  let overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "2147483647" // on top of everything
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
  // thin line at the bottom of each rect segment
  const line = document.createElement("div");
  const thickness = 2; // px
  Object.assign(line.style, {
    position: "absolute",
    left: `${rect.left}px`,
    top: `${rect.top + rect.height - thickness}px`,
    width: `${rect.width}px`,
    height: `${thickness}px`,
    background: "rgba(255, 215, 0, 0.9)", // gold-ish
    borderRadius: "1px",
    boxShadow: "0 0 0.5px rgba(0,0,0,0.4)"
  });
  return line;
}

function getVisibleClientRectsForRange(range) {
  const rects = Array.from(range.getClientRects());
  // Filter absurd rects (zero width/height) and those outside viewport
  const vw = window.innerWidth, vh = window.innerHeight;
  return rects.filter(r => r.width > 0.5 && r.height > 0.5 && r.left < vw && r.top < vh && r.bottom > 0 && r.right > 0);
}

function highlightMatchesInTextNode(node, needle, overlay) {
  const text = node.nodeValue;
  if (!text || !needle) return;

  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  let startIndex = 0;

  while (true) {
    const idx = lowerText.indexOf(lowerNeedle, startIndex);
    if (idx === -1) break;

    const range = document.createRange();
    range.setStart(node, idx);
    range.setEnd(node, idx + needle.length);

    for (const rect of getVisibleClientRectsForRange(range)) {
      overlay.appendChild(drawUnderlineForRect(rect));
    }
    startIndex = idx + needle.length;
  }
}

function* textNodesUnder(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      // skip inside script/style/noscript/svg <style>, and hidden nodes
      const p = n.parentNode;
      if (!p) return NodeFilter.FILTER_REJECT;
      const tag = (p.nodeName || "").toLowerCase();
      if (["script", "style", "noscript"].includes(tag)) return NodeFilter.FILTER_REJECT;
      // skip if parent is not shown
      const cs = p instanceof Element ? getComputedStyle(p) : null;
      if (cs && (cs.visibility === "hidden" || cs.display === "none")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let node;
  while ((node = walker.nextNode())) yield node;
}

function highlightAll(originalStrings) {
  clearOverlay();
  const overlay = ensureOverlay();
  if (!Array.isArray(originalStrings) || originalStrings.length === 0) return;

  // Re-render underlines on scroll/resize to keep alignment correct
  // Debounced for performance
  let rerenderTimer = null;
  function rerender() {
    if (rerenderTimer) cancelAnimationFrame(rerenderTimer);
    rerenderTimer = requestAnimationFrame(() => {
      clearOverlay();
      const ol = ensureOverlay();
      for (const node of textNodesUnder(document.body)) {
        for (const original of originalStrings) {
          if (typeof original === "string" && original.trim()) {
            highlightMatchesInTextNode(node, original.trim(), ol);
          }
        }
      }
    });
  }

  // initial render
  rerender();

  // listeners (remove previous ones if you add a more elaborate lifecycle)
  window.addEventListener("scroll", rerender, { passive: true });
  window.addEventListener("resize", rerender);
}

// Convenience wrapper for exactly what's needed here
function underlineOriginals(originals) {
  if (!Array.isArray(originals) || !originals.length) return;
  highlightAll(originals);
}

// === NEW: Alt+Click отправляет текст всего блока =========================

// Считаем «блоковыми» элементы с display: block|flex|grid|table и некоторые теги
function isBlockish(el) {
  if (!(el instanceof Element)) return false;
  const tag = el.tagName.toLowerCase();
  if (["p","div","section","article","main","aside","header","footer","li","ul","ol","td","th","tr","table","figcaption","figure","pre","blockquote"].includes(tag)) {
    return true;
  }
  const cs = getComputedStyle(el);
  return ["block","flex","grid","table","flow-root","list-item"].includes(cs.display);
}

// Ищем ближайший «корневой» блок от места клика
function findBlockRoot(start) {
  if (!(start instanceof Element)) return document.body;
  // приоритетно уважаем пометку разработчика
  const marked = start.closest("[data-exten-block]");
  if (marked) return marked;

  let el = start;
  while (el && el !== document.body) {
    if (isBlockish(el)) return el;
    el = el.parentElement;
  }
  return document.body;
}

// Достаём текст блока (без скриптов/стилей)
function textFromBlock(el) {
  // innerText уважает CSS и переносы — обычно то, что нужно
  const txt = (el && el.innerText ? el.innerText : "").trim();
  // необязательно: мягкое ограничение, чтобы не улетать в мегабайты
  const MAX = 50000;
  return txt.length > MAX ? txt.slice(0, MAX) : txt;
}

async function handleAltClickSendBlock(e) {
  if (!e.altKey) return;

  const block = findBlockRoot(e.target);
  const text = textFromBlock(block);
  if (!text) return;

  // Не даём клику «провалиться» (навигация по ссылке и т.п.)
  e.preventDefault();
  e.stopPropagation();

  try {
    const resp = await fetch("http://127.0.0.1:5055/main", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }) // тот же контракт с сервером
    });

    const data = await resp.json();

    // === старое поведение сохраняем ===
    const suggestment = data?.suggestment;
    console.log("suggestment:", suggestment);

    // === 5) сохраняем data.suggestions в chrome.storage.local ===
    const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
    await saveSuggestions({
      url: location.href,
      selection: text,                // можно переименовать в sourceText, если хотите
      suggestions                     // [{ original, suggestion }]
    });

    // === 6) подчёркиваем все совпадения 'original' по странице ===
    const originals = suggestions.map(s => s?.original).filter(Boolean);
    underlineOriginals(originals);
  } catch (err) {
    console.error("Failed to contact server or process response:", err);
  }
}

// Привязываем новый обработчик
(function attachOnce() {
  if (window.__extenAltClickAttached) return;
  window.__extenAltClickAttached = true;
  document.addEventListener("click", handleAltClickSendBlock, true);
})();
