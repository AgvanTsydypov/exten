(function () {
    const { IDS, Z } = Exten.const;
    const { state } = Exten;
    const U = Exten.utils;
  
    let driversInstalled = false;
    let activeTransitions = 0;
    let rafId = 0;
    let dirty = false;
    let loopUntil = 0;
  
    function markDirty(lingerMs = 200) {
      dirty = true;
      loopUntil = Math.max(loopUntil, performance.now() + lingerMs);
      ensureLoop();
    }
    function ensureLoop() {
      if (rafId) return;
      rafId = requestAnimationFrame(function step(ts) {
        if (dirty) {
          dirty = false;
          // НЕ скрываем тултип, если пользователь с ним взаимодействует
          const now = Date.now();
          const interacting =
            state.pointerInTooltip ||
            state.pointerInSelectPopup ||
            state.pointerInGlobalModal ||
            now < state.tooltipPinnedUntil;
  
          if (!interacting) Exten.tooltip.hideTooltip();
  
          _renderNow(state.lastSuggestions || []);
        }
        if (activeTransitions > 0 || ts < loopUntil) {
          rafId = requestAnimationFrame(step);
        } else {
          rafId = 0;
        }
      });
    }
    function onTransStart() { activeTransitions++; markDirty(500); }
    function onTransEnd()   { activeTransitions = Math.max(0, activeTransitions - 1); markDirty(200); }
  
    function ensureDrivers() {
      if (driversInstalled) return;
      driversInstalled = true;
      document.addEventListener("scroll", () => markDirty(100), { passive: true, capture: true });
      document.addEventListener("wheel", () => markDirty(100), { passive: true });
      document.addEventListener("touchmove", () => markDirty(100), { passive: true });
      window.addEventListener("resize", () => markDirty(200), { passive: true });
      document.addEventListener("keydown", () => markDirty(100), true);
      document.addEventListener("transitionstart", onTransStart, true);
      document.addEventListener("transitionend", onTransEnd, true);
      document.addEventListener("animationstart", onTransStart, true);
      document.addEventListener("animationend", onTransEnd, true);
    }
  
    function ensureOverlay() {
      let overlay = document.getElementById(IDS.OVERLAY);
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = IDS.OVERLAY;
        Object.assign(overlay.style, {
          position: "fixed",
          inset: "0",
          pointerEvents: "none",
          zIndex: String(Z.OVERLAY)
        });
        document.documentElement.appendChild(overlay);
      }
      return overlay;
    }
    function clearOverlay() {
      const overlay = document.getElementById(IDS.OVERLAY);
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
  
    function findRangesInNode(textNode, original) {
      const text = textNode.nodeValue;
      if (!text || !original) return [];
      const ranges = [];
      let from = 0;
      while (true) {
        const idx = text.indexOf(original, from);
        if (idx === -1) break;
        const prev = idx > 0 ? text[idx - 1] : "";
        const next = (idx + original.length < text.length) ? text[idx + original.length] : "";
        if (U.isBoundaryLeft(prev) && U.isBoundaryRight(next)) {
          const r = document.createRange();
          r.setStart(textNode, idx);
          r.setEnd(textNode, idx + original.length);
          ranges.push(r);
        }
        from = idx + original.length;
      }
      return ranges;
    }
  
    // замена по конкретному Range — устойчиво к перерисовкам
    function replaceByRange(range, suggestion) {
      try {
        const replacement = document.createTextNode(suggestion || "");
        range.deleteContents();
        range.insertNode(replacement);
      } catch (e) {
        console.warn("[exten] Replace failed:", e);
      } finally {
        Exten.tooltip.hideTooltip();
        markDirty(150);
      }
    }
    function ignorePair(original, suggestion) {
      Exten.storage.addToIgnored(original, suggestion).then(() => {
        Exten.tooltip.hideTooltip();
        markDirty(150);
      });
    }
  
    function renderSuggestionsUI(suggestions) {
      ensureDrivers();
      state.lastSuggestions = Array.isArray(suggestions) ? suggestions : [];
      markDirty(200);
    }
  
    function _renderNow(suggestions) {
      clearOverlay();
      const overlay = ensureOverlay();
      state.matches = [];
  
      const ignored = state.ignoredSet || new Set();
      const items = (Array.isArray(suggestions) ? suggestions : [])
        .filter(s => s && typeof s.original === "string")
        .filter(s => !ignored.has(Exten.storage.makeIgnoreKey(s.original, s.suggestion || "")));
  
      if (!items.length) { Exten.tooltip.hideTooltip(); return; }
  
      for (const node of U.textNodesUnder(document.body)) {
        for (let i = 0; i < items.length; i++) {
          const s = items[i];
          const original = (s && typeof s.original === "string") ? s.original.trim() : "";
          const suggestion = (s && typeof s.suggestion === "string") ? s.suggestion : "";
          if (!original) continue;
  
          const ranges = findRangesInNode(node, original);
          for (const range of ranges) {
            const rects = U.getVisibleClientRectsForRange(range);
            if (!rects.length) continue;
  
            // сохранить для справки (не используем индекс для replace)
            state.matches.push({ range, original, suggestion, rects });
  
            for (const r of rects) overlay.appendChild(drawUnderlineForRect(r));
  
            for (const r of rects) {
              const spot = document.createElement("div");
              Object.assign(spot.style, {
                position: "absolute",
                left: r.left + "px",
                top:  r.top  + "px",
                width:  r.width  + "px",
                height: r.height + "px",
                background: "transparent",
                cursor: "pointer",
                pointerEvents: "auto"
              });
              spot.addEventListener("mouseenter", () => {
                if (state.pointerInSelectPopup || state.pointerInGlobalModal) return;
                // пин на полсекунды, чтобы успеть навести
                state.tooltipPinnedUntil = Date.now() + 600;
                Exten.tooltip.showTooltipNearRect(
                  r,
                  suggestion,
                  () => replaceByRange(range, suggestion),
                  () => ignorePair(original, suggestion)
                );
              });
              spot.addEventListener("click", (e) => {
                if (state.pointerInSelectPopup || state.pointerInGlobalModal) return;
                e.preventDefault(); e.stopPropagation();
                state.tooltipPinnedUntil = Date.now() + 600;
                Exten.tooltip.showTooltipNearRect(
                  r,
                  suggestion,
                  () => replaceByRange(range, suggestion),
                  () => ignorePair(original, suggestion)
                );
              });
              overlay.appendChild(spot);
            }
          }
        }
      }
  
      if (state.mutationObserver) state.mutationObserver.disconnect();
      state.mutationObserver = new MutationObserver(() => { markDirty(120); });
      state.mutationObserver.observe(document.body, {
        childList: true,
        characterData: true,
        attributes: true,
        subtree: true
      });
    }
  
    function underlineOriginals(originals) {
      const suggestions = (originals || []).map(o => ({ original: o, suggestion: "" }));
      renderSuggestionsUI(suggestions);
    }
  
    Exten.overlay = { ensureOverlay, clearOverlay, renderSuggestionsUI, underlineOriginals };
  })();
  