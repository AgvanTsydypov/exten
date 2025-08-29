(function () {
    const { IDS, Z } = Exten.const;
    const { state } = Exten;
  
    function ensureTooltip() {
      let t = document.getElementById(IDS.TOOLTIP);
      if (!t) {
        t = document.createElement("div");
        t.id = IDS.TOOLTIP;
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
          zIndex: String(Z.UI)
        });
        t.innerHTML = `
          <div id="exten-tip-text" style="white-space:pre-wrap; word-break:break-word; margin-bottom:6px;"></div>
          <div style="display:flex; gap:6px; justify-content:flex-end; align-items:center;">
            <button id="exten-tip-replace" style="padding:4px 8px; border-radius:6px; border:1px solid #ccc; background:#f5f5f5; cursor:pointer;">change</button>
            <button id="exten-tip-ignore"  style="padding:4px 8px; border-radius:6px; border:1px solid #ccc; background:#fafafa; cursor:pointer;">cancel</button>
            <button id="exten-tip-close"   style="padding:4px 8px; border-radius:6px; border:1px solid #ddd; background:#fff; cursor:pointer;">✕</button>
          </div>
        `;
        // трекаем нахождение курсора внутри тултипа
        t.addEventListener("mouseenter", () => { state.pointerInTooltip = true; });
        t.addEventListener("mouseleave", () => { state.pointerInTooltip = false; });
        document.documentElement.appendChild(t);
      }
      return t;
    }
  
    function showTooltipNearRect(rect, suggestion, onReplace, onIgnore) {
      Exten.popups.hideAllExcept(IDS.TOOLTIP);
  
      const tip = ensureTooltip();
      tip.querySelector("#exten-tip-text").textContent = suggestion || "(no suggestion)";
      tip.style.display = "block";
      tip.style.left = "0px"; tip.style.top = "-10000px";
  
      const pad = 8, width = tip.offsetWidth, height = tip.offsetHeight;
      let left = Math.min(Math.max(rect.left, 8), window.innerWidth - width - 8);
      let top  = rect.top - height - pad; if (top < 0) top = rect.bottom + pad;
      tip.style.left = `${left}px`; tip.style.top = `${top}px`;
  
      // «прикрепляем» тултип на полсекунды, чтобы можно было спокойно навести
      state.tooltipPinnedUntil = Date.now() + 600;
  
      const btnReplace = tip.querySelector("#exten-tip-replace");
      const btnClose   = tip.querySelector("#exten-tip-close");
      const btnIgnore  = tip.querySelector("#exten-tip-ignore");
  
      btnReplace.onclick = (e) => { e.stopPropagation(); onReplace(); hideTooltip(); };
      btnClose.onclick   = (e) => { e.stopPropagation(); hideTooltip(); };
      btnIgnore.onclick  = (e) => { e.stopPropagation(); onIgnore();  hideTooltip(); };
    }
  
    function hideTooltip() {
      const tip = document.getElementById(IDS.TOOLTIP);
      if (tip) tip.style.display = "none";
      state.pointerInTooltip = false;
    }
  
    Exten.tooltip = { ensureTooltip, showTooltipNearRect, hideTooltip };
  })();
  