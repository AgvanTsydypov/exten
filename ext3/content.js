(() => {
  function getBlockText(target) {
    // If user selected text, prefer that.
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.toString().trim()) {
      return sel.toString().trim();
    }

    // Otherwise, find the nearest block-like ancestor and use its text.
    let el = target;
    while (el && el !== document.body) {
      const display = getComputedStyle(el).display;
      if (["block", "flex", "grid", "table", "list-item"].includes(display)) break;
      el = el.parentElement;
    }
    if (!el) el = target;

    return (el.innerText || el.textContent || "").trim();
  }

  function toast(ok) {
    try {
      const t = document.createElement("div");
      t.textContent = ok ? "✓ Sent" : "✗ Failed";
      Object.assign(t.style, {
        position: "fixed",
        right: "12px",
        bottom: "12px",
        zIndex: 2147483647,
        padding: "8px 10px",
        background: ok ? "#0b8" : "#c33",
        color: "white",
        fontSize: "12px",
        borderRadius: "6px",
        boxShadow: "0 2px 8px rgba(0,0,0,.15)",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
      });
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 1200);
    } catch (_) {}
  }

  // ALT-click to send the clicked block's text.
  document.addEventListener(
    "click",
    (e) => {
      if (!e.altKey) return; // require Alt/Option
      const text = getBlockText(e.target);
      if (!text) return;

      chrome.runtime.sendMessage(
        { type: "SEND_TEXT", text, title: document.title },
        (resp) => {
          if (!resp) return;
          toast(Boolean(resp.ok));
        }
      );
    },
    true // capture to catch early before site handlers possibly stop it
  );
})();
