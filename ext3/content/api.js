(function () {
    const { IDS, URLS, Z } = Exten.const;
    const { state } = Exten;
  
    // Глобальный спиннер
    function ensureSpinnerStyle() {
      if (document.getElementById(IDS.SPINNER_STYLE)) return;
      const style = document.createElement("style");
      style.id = IDS.SPINNER_STYLE;
      style.textContent = `@keyframes exten-spin { to { transform: rotate(360deg); } }`;
      document.head.appendChild(style);
    }
    function ensureSpinner() {
      let s = document.getElementById(IDS.SPINNER);
      if (!s) {
        ensureSpinnerStyle();
        s = document.createElement("div");
        s.id = IDS.SPINNER;
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
          zIndex: String(Z.SPINNER),
          pointerEvents: "none",
          display: "none"
        });
        document.documentElement.appendChild(s);
      }
      return s;
    }
    function showSpinner() { ensureSpinner().style.display = "block"; }
    function hideSpinner() { const s = document.getElementById(IDS.SPINNER); if (s) s.style.display = "none"; }
    function incPending() { state.pendingRequests++; if (state.pendingRequests > 0) showSpinner(); }
    function decPending() { state.pendingRequests = Math.max(0, state.pendingRequests - 1); if (state.pendingRequests === 0) hideSpinner(); }
  
    async function processText(text, opts = {}) {
      const { useGlobalSpinner = true, onSuggestions } = opts;
      if (!text) return;
      if (useGlobalSpinner) incPending();
      try {
        const resp = await fetch(URLS.MAIN, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text })
        });
        const data = await resp.json();
        console.log("suggestment:", data?.suggestment);
        const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
        await Exten.storage.saveSuggestions({ url: location.href, sourceText: text, suggestions });
        Exten.overlay.renderSuggestionsUI(suggestions);
        if (typeof onSuggestions === "function") onSuggestions(suggestions, data);
      } catch (err) {
        console.error("[exten] Failed to contact server or process response:", err);
        if (typeof onSuggestions === "function") onSuggestions([], { error: String(err) });
      } finally {
        if (useGlobalSpinner) decPending();
      }
    }
  
    async function sendGlobalContext(context) {
      incPending();
      try {
        const resp = await fetch(URLS.GLOBAL_CONTEXT, {
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
  
    Exten.api = { processText, sendGlobalContext, ensureSpinnerStyle };
  })();
  