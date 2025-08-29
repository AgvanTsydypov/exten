(function () {
    const { IDS, Z } = Exten.const;
    const { state } = Exten;
  
    function ensureGlobalContextModal() {
      Exten.popups.ensureCommonPopupStyles();
  
      let m = document.getElementById(IDS.GLOBAL_MODAL);
      if (!m) {
        m = document.createElement("div");
        m.id = IDS.GLOBAL_MODAL;
        Object.assign(m.style, {
          position: "fixed",
          inset: "0",
          background: "rgba(0,0,0,0.35)",
          display: "none",
          zIndex: String(Z.UI),
          pointerEvents: "auto"
        });
        const card = document.createElement("div");
        card.className = "exten-card";
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
          padding: "14px"
        });
        card.innerHTML = `
          <div class="exten-grid">
            <div class="exten-header">
              <div class="exten-title" style="font-weight:700;">Global context</div>
              <button id="exten-global-close" class="exten-close">✕</button>
            </div>
  
            <div style="color:#444;">Global context.</div>
  
            <textarea id="exten-global-input" class="exten-area" rows="8" placeholder="context..."></textarea>
  
            <div class="exten-actions">
              <button id="exten-global-send" class="exten-btn">send context</button>
            </div>
          </div>
        `;
        m.appendChild(card);
        m.addEventListener("mouseenter", () => { state.pointerInGlobalModal = true; });
        m.addEventListener("mouseleave", () => { state.pointerInGlobalModal = false; });
        m.addEventListener("click", (e) => { if (e.target === m) hideGlobalContextModal(); });
        document.documentElement.appendChild(m);
      }
      return m;
    }
  
    function showGlobalContextModal() {
      Exten.popups.hideAllExcept(IDS.GLOBAL_MODAL);
      const m = ensureGlobalContextModal();
      m.style.display = "block";
      const input = m.querySelector("#exten-global-input");
      const btnSend = m.querySelector("#exten-global-send");
      const btnClose= m.querySelector("#exten-global-close");
      btnClose.onclick = (e) => { e.stopPropagation(); hideGlobalContextModal(); };
      btnSend.onclick  = (e) => {
        e.stopPropagation();
        const context = (input.value || "").trim();
        if (!context) return;
        hideGlobalContextModal();
        Exten.api.sendGlobalContext(context);
      };
      input.focus({ preventScroll: true });
    }
  
    function hideGlobalContextModal() {
      const m = document.getElementById(IDS.GLOBAL_MODAL);
      if (m) m.style.display = "none";
      state.pointerInGlobalModal = false;
    }
  
    Exten.globalModal = { ensureGlobalContextModal, showGlobalContextModal, hideGlobalContextModal };
  })();
  