// MV3 service worker: по клику на иконку — попросить content-script открыть модалку
chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "OPEN_GLOBAL_CONTEXT" }).catch(() => {
    // Если контент-скрипт ещё не инжектирован (редкие случаи) – ничего не делаем
  });
});
