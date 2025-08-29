(function () {
    const { IDS } = Exten.const;
    const { state } = Exten;
    const U = Exten.utils;
  
    function handleAltClickSendBlock(e) {
      if (!e.altKey) return;
      const block = U.findBlockRoot(e.target);
      const text = U.textFromBlock(block);
      if (!text) return;
      e.preventDefault();
      e.stopPropagation();
      Exten.api.processText(text);
    }
  
    // Отправка при вводе . ? !
    const lastSendMap = new WeakMap();
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
      const ce = el.closest('[contenteditable="true"]'); if (ce) return U.textFromBlock(ce);
      return "";
    }
    function maybeSendOnPunctuation(e) {
      if (!isEditableTarget(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key; if (key !== "." && key !== "?" && key !== "!") return;
      const target = e.target;
      const now = Date.now();
      const last = lastSendMap.get(target) || 0;
      if (now - last < 800) return;
      setTimeout(() => {
        const text = getEditableText(target).trim();
        if (text) {
          lastSendMap.set(target, Date.now());
          Exten.api.processText(text);
        }
      }, 0);
    }
  
    // Инициализация единожды
    (function attachOnce() {
      if (window.__extenAttached) return;
      window.__extenAttached = true;
  
      Exten.storage.loadIgnoredSet();
  
      document.addEventListener("click", handleAltClickSendBlock, true);
  
      // щелчки вне окон — закрывать
      document.addEventListener("click", (e) => {
        const tip = document.getElementById(IDS.TOOLTIP);
        if (tip && !tip.contains(e.target)) Exten.tooltip.hideTooltip();
  
        const selPopup = document.getElementById(IDS.SELECT_POPUP);
        if (selPopup && !selPopup.contains(e.target)) {
          if (!window.getSelection || window.getSelection().isCollapsed) Exten.selectPopup.hideSelectPopup();
        }
        // глобальная модалка закрывается по overlay внутри себя
      });
  
      document.addEventListener("keydown", maybeSendOnPunctuation, true);
  
      // Показывать/репозиционировать попап при выделении
      document.addEventListener("selectionchange", Exten.selectPopup.handleSelectionUI, true);
      document.addEventListener("mouseup",          Exten.selectPopup.handleSelectionUI, true);
      document.addEventListener("keyup",            Exten.selectPopup.handleSelectionUI, true);
  
      // Репозиционирование при скролле/resize
      window.addEventListener("scroll", Exten.selectPopup.repositionIfNeeded, { passive: true });
      window.addEventListener("resize", Exten.selectPopup.repositionIfNeeded);
  
      // При клике на иконку расширения
      chrome.runtime?.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg && msg.type === "OPEN_GLOBAL_CONTEXT") {
          Exten.globalModal.showGlobalContextModal();
          sendResponse && sendResponse({ ok: true });
        }
      });
    })();
  })();
  