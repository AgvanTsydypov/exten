(function () {
    const { IDS } = Exten.const;
  
    // Вставляем единые стили для всех попапов один раз
    function ensureCommonPopupStyles() {
      const STYLE_ID = "exten-common-popup-style";
      if (document.getElementById(STYLE_ID)) return;
  
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        /* Единая коробочная модель, чтобы ширины совпадали */
        #${IDS.SELECT_POPUP}, #${IDS.SELECT_POPUP} *,
        #${IDS.GLOBAL_MODAL}, #${IDS.GLOBAL_MODAL} * { box-sizing: border-box; }
  
        /* Базовая типографика */
        #${IDS.SELECT_POPUP},
        #${IDS.GLOBAL_MODAL} .exten-card {
          font: 12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Inter,Arial,sans-serif;
          color:#111;
        }
  
        /* Сетка и поля */
        #${IDS.SELECT_POPUP} .exten-grid,
        #${IDS.GLOBAL_MODAL} .exten-grid { display:grid; grid-template-columns: 1fr; gap:8px; }
  
        #${IDS.SELECT_POPUP} .exten-area,
        #${IDS.GLOBAL_MODAL} .exten-area {
          width:100%;
          border:1px solid #ddd;
          border-radius:8px;
          padding:8px;
          background:#fff;
        }
  
        #${IDS.SELECT_POPUP} .exten-header,
        #${IDS.GLOBAL_MODAL} .exten-header {
          display:flex; align-items:center; justify-content:space-between; gap:8px;
          margin-bottom:0;
        }
        #${IDS.SELECT_POPUP} .exten-title,
        #${IDS.GLOBAL_MODAL} .exten-title { font-weight:600; }
  
        #${IDS.SELECT_POPUP} .exten-actions,
        #${IDS.GLOBAL_MODAL} .exten-actions { display:flex; gap:8px; justify-content:flex-end; align-items:center; }
  
        #${IDS.SELECT_POPUP} .exten-btn,
        #${IDS.GLOBAL_MODAL} .exten-btn {
          padding:6px 10px; border-radius:8px; border:1px solid #ccc; background:#f5f5f5; cursor:pointer;
        }
        #${IDS.SELECT_POPUP} .exten-close,
        #${IDS.GLOBAL_MODAL} .exten-close {
          padding:2px 6px; border-radius:6px; border:1px solid #ddd; background:#fff; cursor:pointer;
        }
        #${IDS.SELECT_POPUP} .exten-spinner,
        #${IDS.GLOBAL_MODAL} .exten-spinner {
          display:none; width:16px; height:16px;
          border:2px solid rgba(0,0,0,0.25); border-top-color: rgba(0,0,0,0.85);
          border-radius:50%; animation: exten-spin 0.9s linear infinite;
        }
  
        /* Список предложений в select-popup */
        #${IDS.SELECT_POPUP} .exten-list-item {
          border:1px solid #eee; border-radius:8px; padding:8px; background:#fff; margin-bottom:6px;
        }
        #${IDS.SELECT_POPUP} .exten-suggestion-original { font-weight:600; margin-bottom:4px; word-break:break-word; }
        #${IDS.SELECT_POPUP} .exten-suggestion-text    { color:#0a6;       margin-bottom:6px; word-break:break-word; }
      `;
      document.head.appendChild(style);
    }
  
    function hideAllExcept(exceptId) {
      if (exceptId !== IDS.TOOLTIP)      Exten.tooltip.hideTooltip();
      if (exceptId !== IDS.SELECT_POPUP) Exten.selectPopup.hideSelectPopup();
      if (exceptId !== IDS.GLOBAL_MODAL) Exten.globalModal.hideGlobalContextModal();
    }
  
    // Экспорт
    Exten.popups = { hideAllExcept, ensureCommonPopupStyles };
  })();
  