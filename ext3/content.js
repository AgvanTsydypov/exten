// Find the nearest "HTML block" for the clicked node and return its text.
const BLOCK_SELECTOR = [
  "p","li","blockquote","pre","code","article","section","main","aside",
  "header","footer","dd","dt","figcaption","td","th",
  "h1","h2","h3","h4","h5","h6","div"
].join(",");

function getNearestBlockText(node) {
  const el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  const block = el?.closest?.(BLOCK_SELECTOR) || el;
  if (!block) return "";
  // innerText keeps visual text (ignores hidden)
  return (block.innerText || block.textContent || "").replace(/\s+/g, " ").trim();
}

// Capture early (mousedown) so selection/caret changes don't wipe the text.
document.addEventListener("mousedown", (e) => {
  if (!e.altKey) return;

  const text = getNearestBlockText(e.target);
  if (!text) {
    console.log("[exten] No block text under cursor.");
    return;
  }

  // Keep it reasonable; servers often dislike megabyte payloads.
  const payload = text.length > 8000 ? text.slice(0, 8000) : text;

  // Send to background to talk to the server.
  chrome.runtime.sendMessage({ type: "SEND_TO_SERVER", text: payload });
}, { capture: true });

// Receive server response and log `suggestment` into page console.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "SERVER_RESPONSE") {
    const data = msg.data;
    if (data && typeof data === "object" && "suggestions" in data) {
      console.log("[exten] suggestment:", data);
    } else {
      console.log("[exten] No \"suggestment\" in response:", data);
    }
  } else if (msg?.type === "SERVER_RESPONSE_ERROR") {
    console.error("[exten] Server error:", msg.error);
  }
});
