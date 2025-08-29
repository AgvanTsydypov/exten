(function () {
    const { IDS, Z } = Exten.const;
    const { state } = Exten;
    const U = Exten.utils;
  
    let currentSuggestions = [];
  
    function ensureSelectPopup() {
      Exten.api.ensureSpinnerStyle();
      Exten.popups.ensureCommonPopupStyles();
  
      let p = document.getElementById(IDS.SELECT_POPUP);
      if (!p) {
        p = document.createElement("div");
        p.id = IDS.SELECT_POPUP;
        Object.assign(p.style, {
          position: "fixed",
          maxWidth: "480px",
          minWidth: "300px",
          padding: "10px",
          background: "rgba(255,255,255,0.98)",
          border: "1px solid rgba(0,0,0,0.15)",
          borderRadius: "10px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
          display: "none",
          zIndex: String(Z.UI),
          pointerEvents: "auto"
        });
        p.innerHTML = `
          <div class="exten-grid">
            <div class="exten-header">
              <div class="exten-title">Send selected</div>
              <button id="exten-select-close" class="exten-close" title="close">✕</button>
            </div>
  
            <div id="exten-select-preview" class="exten-area" style="max-height:100px; overflow:auto; white-space:pre-wrap;"></div>
  
            <textarea id="exten-select-input" class="exten-area" rows="3" placeholder="optional text to add..."></textarea>
  
            <div class="exten-actions">
              <div id="exten-select-spinner" class="exten-spinner"></div>
              <button id="exten-select-send" class="exten-btn">send text</button>
            </div>
  
            <div id="exten-select-suggestions" class="exten-area" style="max-height:240px; overflow:auto; padding:0; border:none; background:transparent;"></div>
          </div>
        `;
        p.addEventListener("click", (e) => e.stopPropagation());
        p.addEventListener("mouseenter", () => { state.pointerInSelectPopup = true; });
        p.addEventListener("mouseleave", () => { state.pointerInSelectPopup = false; });
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
    function getSelectedText() { const sel = window.getSelection(); if (!sel) return ""; return String(sel.toString() || "").trim(); }
    function focusInsideSelectPopup() { const p = document.getElementById(IDS.SELECT_POPUP); return !!(p && document.activeElement && p.contains(document.activeElement)); }
  
    function renderSelectPopupSuggestions(suggestionsRaw) {
      const p = ensureSelectPopup();
      const box = p.querySelector("#exten-select-suggestions");
      const ignored = state.ignoredSet || new Set();
  
      const suggestions = (Array.isArray(suggestionsRaw) ? suggestionsRaw : [])
        .filter(s => s && typeof s.original === "string")
        .filter(s => !ignored.has(Exten.storage.makeIgnoreKey(s.original, s.suggestion || "")));
  
      currentSuggestions = suggestions;
  
      if (!suggestions.length) {
        box.innerHTML = `<div style="color:#666; font-size:12px; padding:8px;">No suggestions.</div>`;
        return;
      }
  
      box.innerHTML = "";
      suggestions.forEach((s, idx) => {
        const item = document.createElement("div");
        item.className = "exten-list-item";
        item.innerHTML = `
          <div class="exten-suggestion-original">${U.escapeHtml(s.original)}</div>
          <div class="exten-suggestion-text">${U.escapeHtml(s.suggestion || "")}</div>
          <div class="exten-actions">
            <button class="exten-item-change exten-btn"  data-i="${idx}">change</button>
            <button class="exten-item-cancel exten-btn"  data-i="${idx}" style="background:#fafafa;">cancel</button>
          </div>
        `;
        box.appendChild(item);
      });
  
      box.querySelectorAll(".exten-item-change").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const i = Number(e.currentTarget.getAttribute("data-i"));
          const s = currentSuggestions[i];
          if (!s) return;
          U.replaceAllExactInDocument(s.original, s.suggestion || "");
          Exten.overlay.renderSuggestionsUI(state.lastSuggestions || []);
          const next = currentSuggestions.filter((_, j) => j !== i);
          renderSelectPopupSuggestions(next);
        });
      });
      box.querySelectorAll(".exten-item-cancel").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const i = Number(e.currentTarget.getAttribute("data-i"));
          const s = currentSuggestions[i];
          if (!s) return;
          Exten.storage.addToIgnored(s.original, s.suggestion || "");
          const next = currentSuggestions.filter((_, j) => j !== i);
          renderSelectPopupSuggestions(next);
          Exten.overlay.renderSuggestionsUI(state.lastSuggestions || []);
        });
      });
    }
  
    function showSelectPopup() {
      const selected = getSelectedText(); if (!selected) return hideSelectPopup();
      const rect = getSelectionRect();   if (!rect)     return hideSelectPopup();
  
      Exten.popups.hideAllExcept(IDS.SELECT_POPUP);
  
      const p = ensureSelectPopup();
      p.style.display = "block"; p.style.left = "0px"; p.style.top = "-10000px";
  
      const preview = p.querySelector("#exten-select-preview");
      const input   = p.querySelector("#exten-select-input");
      const btnSend = p.querySelector("#exten-select-send");
      const btnClose= p.querySelector("#exten-select-close");
      const localSpinner = p.querySelector("#exten-select-spinner");
  
      preview.textContent = selected;
  
      if (!state.selectPopupActive) {
        input.value = "";
        p.querySelector("#exten-select-suggestions").innerHTML = "";
        currentSuggestions = [];
      }
  
      const pad = 8, width = p.offsetWidth, height = p.offsetHeight;
      let left = Math.min(Math.max(rect.left, 8), window.innerWidth - width - 8);
      let top  = rect.top - height - pad; if (top < 0) top = rect.bottom + pad;
      p.style.left = `${left}px`; p.style.top = `${top}px`;
  
      btnSend.onclick = (e) => {
        e.stopPropagation();
        const extra = (input.value || "").trim();
        const combined = extra ? (selected + "\n" + extra) : selected;
  
        localSpinner.style.display = "inline-block";
        btnSend.disabled = true;
        input.disabled = true;
  
        Exten.api.processText(combined, {
          useGlobalSpinner: false,
          onSuggestions: (suggs) => {
            localSpinner.style.display = "none";
            btnSend.disabled = false;
            input.disabled = false;
            renderSelectPopupSuggestions(suggs);
          }
        });
      };
      btnClose.onclick = (e) => { e.stopPropagation(); hideSelectPopup(); };
  
      state.selectPopupActive = true;
    }
  
    function hideSelectPopup() {
      const p = document.getElementById(IDS.SELECT_POPUP);
      if (p) p.style.display = "none";
      state.selectPopupActive = false;
      state.pointerInSelectPopup = false;
      currentSuggestions = [];
    }
  
    function handleSelectionUI() {
      if (window.__extenSelTimer) cancelAnimationFrame(window.__extenSelTimer);
      window.__extenSelTimer = requestAnimationFrame(() => {
        const sel = window.getSelection();
        const text = sel ? String(sel.toString() || "").trim() : "";
        if ((focusInsideSelectPopup() || state.pointerInSelectPopup || state.pointerInGlobalModal) && state.selectPopupActive)
          return;
        if (text && text.length > 0) showSelectPopup(); else hideSelectPopup();
      });
    }
  
    function repositionIfNeeded() {
      if (!state.selectPopupActive) return;
      if (state.pointerInSelectPopup || state.pointerInGlobalModal) return;
      const sel = window.getSelection();
      const text = sel ? String(sel.toString() || "").trim() : "";
      if (text) showSelectPopup();
    }
  
    Exten.selectPopup = {
      ensureSelectPopup,
      showSelectPopup,
      hideSelectPopup,
      handleSelectionUI,
      renderSelectPopupSuggestions,
      repositionIfNeeded
    };
  })();
  