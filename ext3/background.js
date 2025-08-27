// Receives text from the content script and sends it to the local server.
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message?.type !== "SEND_TEXT") return;

  try {
    const res = await fetch("http://127.0.0.1:5055/main", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: message.text,
        url: sender?.tab?.url || null,
        title: message.title || null
      })
    });

    const data = await res.text(); // read response body (whatever it is)
    sendResponse({ ok: res.ok, status: res.status, data });
  } catch (err) {
    sendResponse({ ok: false, error: String(err) });
  }

  // keep the message channel open for the async response
  return true;
});
