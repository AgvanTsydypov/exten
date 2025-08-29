(function () {
    const { IDS } = Exten.const;
    const U = {};
  
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  
    function isEffectivelyInvisible(el) {
      let n = el, depth = 0;
      while (n && n.nodeType === 1 && depth < 12) {
        const cs = getComputedStyle(n);
        if (cs.display === "none" || cs.visibility === "hidden") return true;
        if (parseFloat(cs.opacity || "1") <= 0.05) return true;
        n = n.parentElement;
        depth++;
      }
      return false;
    }
  
    function isExtenUI(el) {
      return !!(el && el.closest?.(
        `#${IDS.TOOLTIP}, #${IDS.SELECT_POPUP}, #${IDS.GLOBAL_MODAL}, #${IDS.OVERLAY}`
      ));
    }
  
    function pointIsTopmostForAncestor(x, y, ancestor) {
      const el = document.elementFromPoint(x, y);
      if (!el) return false;
      if (isEffectivelyInvisible(el)) return false;
  
      // Разрешаем наши UI/overlay поверх текста — считаем точку валидной
      if (isExtenUI(el)) return true;
  
      return ancestor && ancestor.isConnected && (ancestor.contains(el) || el.contains(ancestor));
    }
  
    U.escapeHtml = function (s) {
      return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    };
  
    U.isBlockish = function (el) {
      if (!(el instanceof Element)) return false;
      const tag = el.tagName.toLowerCase();
      if (["p","div","section","article","main","aside","header","footer","li","ul","ol","td","th","tr","table","figcaption","figure","pre","blockquote"].includes(tag)) return true;
      const cs = getComputedStyle(el);
      return ["block","flex","grid","table","flow-root","list-item"].includes(cs.display);
    };
  
    U.findBlockRoot = function (start) {
      if (!(start instanceof Element)) return document.body;
      const marked = start.closest("[data-exten-block]");
      if (marked) return marked;
      let el = start;
      while (el && el !== document.body) {
        if (U.isBlockish(el)) return el;
        el = el.parentElement;
      }
      return document.body;
    };
  
    U.textFromBlock = function (el) {
      const txt = (el && el.innerText ? el.innerText : "").trim();
      const MAX = 50000;
      return txt.length > MAX ? txt.slice(0, MAX) : txt;
    };
  
    U.isBoundaryLeft  = (ch) => !ch || /\s|[([{"'“‘«—–-]|[.!?]/.test(ch);
    U.isBoundaryRight = (ch) => !ch || /\s|[)\]},"'”’»—–-]|[.!?]/.test(ch);
  
    U.textNodesUnder = function* (root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          const p = n.parentNode;
          if (!p) return NodeFilter.FILTER_REJECT;
          const tag = (p.nodeName || "").toLowerCase();
          if (["script","style","noscript"].includes(tag)) return NodeFilter.FILTER_REJECT;
          const cs = p instanceof Element ? getComputedStyle(p) : null;
          if (cs && (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity||"1") <= 0.05)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      let node; while ((node = walker.nextNode())) yield node;
    };
  
    U.getVisibleClientRectsForRange = function (range) {
      const rects = Array.from(range.getClientRects());
      const vw = window.innerWidth, vh = window.innerHeight;
  
      const anc = range.commonAncestorContainer.nodeType === 1
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
  
      const filtered = [];
      for (const r of rects) {
        if (!(r.width > 0.5 && r.height > 0.5)) continue;
        if (r.left >= vw || r.top >= vh || r.right <= 0 || r.bottom <= 0) continue;
  
        const cy = clamp(r.top + r.height / 2, 0, vh - 1);
        const cx1 = clamp(r.left + 4, 0, vw - 1);
        const cx2 = clamp(r.left + r.width / 2, 0, vw - 1);
        const cx3 = clamp(r.right - 4, 0, vw - 1);
  
        let visibleSamples = 0;
        if (pointIsTopmostForAncestor(cx1, cy, anc)) visibleSamples++;
        if (pointIsTopmostForAncestor(cx2, cy, anc)) visibleSamples++;
        if (pointIsTopmostForAncestor(cx3, cy, anc)) visibleSamples++;
  
        if (visibleSamples >= 2) filtered.push(r);
      }
      return filtered;
    };
  
    // Замена всех «словно-предложений» по документу
    U.replaceAllExactInDocument = function (original, suggestion) {
      if (!original) return 0;
      let total = 0;
      for (const node of U.textNodesUnder(document.body)) {
        const text = node.nodeValue || "";
        let out = "", i = 0;
        while (i < text.length) {
          const idx = text.indexOf(original, i);
          if (idx === -1) { out += text.slice(i); break; }
          const prev = idx > 0 ? text[idx - 1] : "";
          const next = (idx + original.length < text.length) ? text[idx + original.length] : "";
          if (U.isBoundaryLeft(prev) && U.isBoundaryRight(next)) {
            out += text.slice(i, idx) + (suggestion || "");
            i = idx + original.length; total++;
          } else {
            out += text.slice(i, idx + 1); i = idx + 1;
          }
        }
        if (out && out !== text) node.nodeValue = out;
      }
      return total;
    };
  
    Exten.utils = U;
  })();
  