/*
 * Fieldpiece Warranty Assistant — embeddable chat widget (no dependencies).
 *
 *   <script src="https://<chatbot-host>/widget.js" data-api="https://<chatbot-host>" defer></script>
 *
 * Optional attributes:
 *   data-token-provider="fnName"  global function returning the signed-in user's WMS access token (or a Promise of
 *                                 it). Enables warranty look-ups for that user; omit on public pages.
 *   data-open="true"              open the panel on load.
 *
 * The host page can start a fresh conversation (e.g. after sign-in / sign-out) with
 *   window.dispatchEvent(new Event("fieldpiece-assistant:reset"))
 */
(function () {
  "use strict";
  if (window.__fieldpieceAssistant) return; // loaded twice (e.g. a React re-mount): keep the first one
  window.__fieldpieceAssistant = true;
  var script = document.currentScript;
  var API = ((script && script.getAttribute("data-api")) || "").replace(/\/$/, "") ||
    (script ? new URL(script.src).origin : "");
  var TOKEN_FN = script && script.getAttribute("data-token-provider");
  var STORE_KEY = "fpw-session";

  var ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  var ICON_RESET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // Minimal, safe markdown: escape first, then bold, lists, paragraphs and [n] citations.
  function render(text) {
    var blocks = esc(text).split(/\n{2,}/);
    return blocks.map(function (block) {
      var lines = block.split("\n");
      var out = "", list = null;
      lines.forEach(function (line) {
        var m = line.match(/^\s*(?:[-*]|(\d+)\.)\s+(.*)$/);
        if (m) {
          var type = m[1] ? "ol" : "ul";
          if (list !== type) { if (list) out += "</" + list + ">"; out += "<" + type + ">"; list = type; }
          out += "<li>" + m[2] + "</li>";
        } else {
          if (list) { out += "</" + list + ">"; list = null; }
          if (line.trim()) out += "<p>" + line + "</p>";
        }
      });
      if (list) out += "</" + list + ">";
      return out;
    }).join("")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\[(\d+)\]/g, '<span class="fpw-cite">[$1]</span>');
  }
  function storage(fn) { try { return fn(window.sessionStorage); } catch (e) { return null; } }

  function getToken() {
    if (!TOKEN_FN || typeof window[TOKEN_FN] !== "function") return Promise.resolve(null);
    try { return Promise.resolve(window[TOKEN_FN]()).catch(function () { return null; }); }
    catch (e) { return Promise.resolve(null); }
  }

  function mount() {
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = API + "/widget.css";
    document.head.appendChild(link);

    var root = el("div", "fpw-root");
    var launcher = el("button", "fpw-launcher", ICON_CHAT);
    launcher.type = "button";
    launcher.title = "Warranty Assistant";
    launcher.setAttribute("aria-label", "Open the Warranty Assistant");
    launcher.setAttribute("aria-expanded", "false");
    launcher.setAttribute("aria-controls", "fpw-panel");

    var panel = el("section", "fpw-panel");
    panel.id = "fpw-panel";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Fieldpiece Warranty Assistant");

    var header = el("header", "fpw-header",
      '<img src="' + API + '/fieldpiece-logo.png" alt="Fieldpiece">' +
      '<div class="fpw-title"><strong>Warranty Assistant</strong><span>Registration, warranty and claims</span></div>');
    var resetBtn = el("button", "fpw-icon-btn", ICON_RESET);
    resetBtn.type = "button";
    resetBtn.title = "New conversation";
    resetBtn.setAttribute("aria-label", "Start a new conversation");
    var closeBtn = el("button", "fpw-icon-btn", ICON_X);
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close the assistant");
    header.appendChild(resetBtn);
    header.appendChild(closeBtn);

    var log = el("div", "fpw-log");
    log.setAttribute("role", "log");
    log.setAttribute("aria-live", "polite");
    var suggestions = el("div", "fpw-suggestions");
    var form = el("form", "fpw-form");
    var label = el("label", "fpw-sr", "Your question");
    label.htmlFor = "fpw-input";
    var input = el("textarea", "fpw-input");
    input.id = "fpw-input";
    input.rows = 1;
    input.maxLength = 1500;
    input.placeholder = "Ask about registration, warranty or claims";
    var send = el("button", "fpw-send", "Send");
    send.type = "submit";
    form.appendChild(label);
    form.appendChild(input);
    form.appendChild(send);
    var foot = el("p", "fpw-footnote",
      "Answers come from Fieldpiece warranty guides. Don't share payment details. The warranty desk decides every claim.");

    panel.appendChild(header);
    panel.appendChild(log);
    panel.appendChild(suggestions);
    panel.appendChild(form);
    panel.appendChild(foot);
    root.appendChild(panel);
    root.appendChild(launcher);
    document.body.appendChild(root);

    var sessionId = storage(function (s) { return s.getItem(STORE_KEY); });
    var busy = false;

    function scroll() { log.scrollTop = log.scrollHeight; }

    function setSuggestions(list) {
      suggestions.innerHTML = "";
      (list || []).forEach(function (q) {
        var chip = el("button", "fpw-chip");
        chip.type = "button";
        chip.textContent = q;
        chip.addEventListener("click", function () { ask(q); });
        suggestions.appendChild(chip);
      });
    }

    function addUser(text) {
      var m = el("div", "fpw-msg fpw-msg-user");
      m.textContent = text;
      log.appendChild(m);
      scroll();
    }

    function addBot(data) {
      var m = el("div", "fpw-msg fpw-msg-bot", render(data.answer));
      if (data.sources && data.sources.length) {
        var src = el("div", "fpw-sources", "Sources:");
        var ol = el("ol");
        data.sources.forEach(function (s) {
          var li = el("li");
          li.value = s.n;
          li.textContent = s.title + " — " + s.heading;
          ol.appendChild(li);
        });
        src.appendChild(ol);
        m.appendChild(src);
      }
      if (data.messageId) {
        var fb = el("div", "fpw-feedback");
        [["Helpful", true], ["Not helpful", false]].forEach(function (pair) {
          var b = el("button");
          b.type = "button";
          b.textContent = pair[1] ? "👍 Helpful" : "👎 Not helpful";
          b.setAttribute("aria-label", pair[0]);
          b.setAttribute("aria-pressed", "false");
          b.addEventListener("click", function () {
            fb.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
            b.setAttribute("aria-pressed", "true");
            fetch(API + "/api/chat/feedback", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId: sessionId, messageId: data.messageId, helpful: pair[1] }),
            }).catch(function () {});
          });
          fb.appendChild(b);
        });
        m.appendChild(fb);
      }
      log.appendChild(m);
      scroll();
    }

    function greet() {
      addBot({
        answer: "Hi! I'm the Fieldpiece Warranty Assistant. I can help you register a product, check a warranty, " +
          "understand what's covered, or file and follow a claim.",
      });
      setSuggestions(["How do I register my product?", "What does the warranty cover?", "How do I file a claim?"]);
    }

    function ask(text) {
      text = (text || "").trim();
      if (!text || busy) return;
      busy = true;
      send.disabled = true;
      input.value = "";
      setSuggestions([]);
      addUser(text);
      var typing = el("div", "fpw-typing", "<i></i><i></i><i></i>");
      typing.setAttribute("aria-label", "The assistant is typing");
      log.appendChild(typing);
      scroll();
      getToken().then(function (token) {
        var headers = { "Content-Type": "application/json" };
        if (token) headers.Authorization = "Bearer " + token;
        return fetch(API + "/api/chat", {
          method: "POST",
          headers: headers,
          body: JSON.stringify({ message: text, sessionId: sessionId }),
        });
      }).then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok) throw new Error(body.detail || "The assistant is unavailable.");
          return body;
        });
      }).then(function (data) {
        sessionId = data.sessionId;
        storage(function (s) { s.setItem(STORE_KEY, sessionId); });
        typing.remove();
        addBot(data);
        setSuggestions(data.suggestions);
      }).catch(function (err) {
        typing.remove();
        addBot({ answer: err && err.message ? err.message : "The assistant is unavailable right now. Please try again." });
      }).then(function () {
        busy = false;
        send.disabled = false;
        input.focus();
      });
    }

    function open(yes) {
      panel.hidden = !yes;
      launcher.setAttribute("aria-expanded", String(yes));
      if (yes) {
        if (!log.children.length) greet();
        input.focus();
      } else {
        launcher.focus();
      }
    }

    launcher.addEventListener("click", function () { open(panel.hidden); });
    closeBtn.addEventListener("click", function () { open(false); });
    function reset() {
      sessionId = null;
      storage(function (s) { s.removeItem(STORE_KEY); });
      log.innerHTML = "";
      setSuggestions([]);
    }
    resetBtn.addEventListener("click", function () { reset(); greet(); });
    // Another user signed in (or out) in the host page: never show them the previous conversation.
    window.addEventListener("fieldpiece-assistant:reset", function () {
      reset();
      if (!panel.hidden) greet();
    });
    panel.addEventListener("keydown", function (e) { if (e.key === "Escape") open(false); });
    form.addEventListener("submit", function (e) { e.preventDefault(); ask(input.value); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input.value); }
    });
    if (script && script.getAttribute("data-open") === "true") open(true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
