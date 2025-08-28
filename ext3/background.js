chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "SEND_TO_SERVER") return;

  const selectionOrBlockText = msg.text || "";

  fetch("http://127.0.0.1:5055/main", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: selectionOrBlockText })
  })
    .then(async (res) => {
      const ct = res.headers.get("content-type") || "";
      const data = ct.includes("application/json") ? await res.json() : await res.text();

      // Send response back to the content script (the tab that initiated it).
      if (sender.tab?.id != null) {
        chrome.tabs.sendMessage(sender.tab.id, { type: "SERVER_RESPONSE", data });
      }
    })
    .catch((err) => {
      if (sender.tab?.id != null) {
        chrome.tabs.sendMessage(sender.tab.id, { type: "SERVER_RESPONSE_ERROR", error: String(err) });
      }
    });
});
