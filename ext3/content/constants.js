(function () {
    window.Exten = window.Exten || {};
  
    const SERVER_BASE = "http://127.0.0.1:5055";
  
    const IDS = {
      OVERLAY: "exten-underline-overlay",
      TOOLTIP: "exten-suggest-tooltip",
      SELECT_POPUP: "exten-select-popup",
      GLOBAL_MODAL: "exten-global-context-modal",
      SPINNER: "exten-loading-spinner",
      SPINNER_STYLE: "exten-loading-style"
    };
  
    const Z = {
      OVERLAY: 2147483000,
      UI:      2147483600,
      SPINNER: 2147483647
    };
  
    const STORAGE = {
      LOG: "suggestionsLog",
      IGNORED: "extenIgnored"
    };
  
    const state = {
      lastSuggestions: [],
      ignoredSet: new Set(),
      matches: [],
      selectPopupActive: false,
      pointerInSelectPopup: false,
      pointerInGlobalModal: false,
      pointerInTooltip: false,         // NEW
      tooltipPinnedUntil: 0,           // NEW (ms since epoch)
      pendingRequests: 0,
      rerenderHandler: null,
      mutationObserver: null
    };
  
    Exten.const = {
      SERVER_BASE,
      URLS: {
        MAIN: SERVER_BASE + "/main",
        GLOBAL_CONTEXT: SERVER_BASE + "/global_context",
        HIGHLIGHT: SERVER_BASE + "/highlight"
      },
      IDS,
      Z,
      STORAGE
    };
    Exten.state = state;
  })();
  