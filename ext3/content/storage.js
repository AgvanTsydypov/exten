(function () {
    const { STORAGE } = Exten.const;
    const { state } = Exten;
  
    async function saveSuggestions({ url, sourceText, suggestions }) {
      try {
        const got = await chrome.storage.local.get(STORAGE.LOG);
        const log = Array.isArray(got[STORAGE.LOG]) ? got[STORAGE.LOG] : [];
        log.push({ url, sourceText, suggestions, ts: Date.now() });
        await chrome.storage.local.set({ [STORAGE.LOG]: log });
        state.lastSuggestions = suggestions;
      } catch (e) {
        console.warn("[exten] Failed to save suggestions:", e);
      }
    }
  
    function makeIgnoreKey(original, suggestion) {
      return String(original ?? "") + "\u0001" + String(suggestion ?? "");
    }
  
    async function loadIgnoredSet() {
      try {
        const got = await chrome.storage.local.get(STORAGE.IGNORED);
        const arr = Array.isArray(got[STORAGE.IGNORED]) ? got[STORAGE.IGNORED] : [];
        state.ignoredSet = new Set(arr.map(x => makeIgnoreKey(x.original, x.suggestion)));
      } catch {
        state.ignoredSet = new Set();
      }
    }
  
    async function addToIgnored(original, suggestion) {
      try {
        const key = makeIgnoreKey(original, suggestion);
        if (!state.ignoredSet.has(key)) {
          state.ignoredSet.add(key);
          const got = await chrome.storage.local.get(STORAGE.IGNORED);
          const arr = Array.isArray(got[STORAGE.IGNORED]) ? got[STORAGE.IGNORED] : [];
          arr.push({ original, suggestion });
          await chrome.storage.local.set({ [STORAGE.IGNORED]: arr });
        }
      } catch (e) {
        console.warn("[exten] Failed to add to ignored:", e);
      }
    }
  
    Exten.storage = { saveSuggestions, loadIgnoredSet, addToIgnored, makeIgnoreKey };
  })();
  