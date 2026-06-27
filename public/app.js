// CARA AI — frontend
// Multi-conversation chat with live SSE streaming from the server-side Fugu proxy.
// Conversations persist in localStorage so the experience feels like a real consumer app.

(() => {
  const STORE_KEY = "cara.conversations.v1";
  const ACTIVE_KEY = "cara.active.v1";

  // marked config
  if (window.marked) {
    marked.setOptions({ breaks: true, gfm: true });
  }

  const $ = (sel) => document.querySelector(sel);
  const els = {
    list: $("#convo-list"),
    messages: $("#messages"),
    welcome: $("#welcome"),
    form: $("#chat-form"),
    input: $("#input"),
    send: $("#send"),
    newChat: $("#new-chat"),
    title: $("#convo-title"),
    sidebar: $("#sidebar"),
    menuToggle: $("#menu-toggle"),
    suggestions: $("#suggestions"),
  };

  let state = load();
  let streaming = false;

  // ---------- Persistence ----------
  function load() {
    let conversations = [];
    try { conversations = JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { conversations = []; }
    let activeId = localStorage.getItem(ACTIVE_KEY);
    if (!conversations.length) {
      const c = newConvo();
      conversations = [c];
      activeId = c.id;
    }
    if (!conversations.find((c) => c.id === activeId)) activeId = conversations[0].id;
    return { conversations, activeId };
  }

  function persist() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.conversations));
    localStorage.setItem(ACTIVE_KEY, state.activeId);
  }

  function newConvo() {
    return { id: crypto.randomUUID(), title: "New chat", messages: [], createdAt: Date.now() };
  }

  function activeConvo() {
    return state.conversations.find((c) => c.id === state.activeId);
  }

  // ---------- Rendering ----------
  function renderSidebar() {
    els.list.innerHTML = "";
    state.conversations
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .forEach((c) => {
        const item = document.createElement("div");
        item.className = "convo-item" + (c.id === state.activeId ? " active" : "");
        item.innerHTML = `
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span class="title">${escapeHtml(c.title)}</span>
          <button class="del" title="Delete" aria-label="Delete conversation">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
          </button>`;
        item.querySelector(".title").addEventListener("click", () => selectConvo(c.id));
        item.querySelector("svg").addEventListener("click", () => selectConvo(c.id));
        item.querySelector(".del").addEventListener("click", (e) => {
          e.stopPropagation();
          deleteConvo(c.id);
        });
        els.list.appendChild(item);
      });
  }

  function renderMessages() {
    const convo = activeConvo();
    els.title.textContent = convo.title;
    els.messages.querySelectorAll(".msg-row").forEach((n) => n.remove());

    if (!convo.messages.length) {
      els.welcome.style.display = "";
      return;
    }
    els.welcome.style.display = "none";
    convo.messages.forEach((m) => appendMessage(m.role, m.content, false));
    scrollToBottom();
  }

  function appendMessage(role, content, animate = true) {
    const row = document.createElement("div");
    row.className = `msg-row ${role}`;
    const isUser = role === "user";
    const avatar = isUser
      ? `<div class="avatar user">YOU</div>`
      : `<div class="avatar cara"><svg viewBox="0 0 64 64"><circle cx="22" cy="32" r="5" fill="#D560B2"></circle><path d="M34 20 A18 18 0 0 1 34 44" stroke="#F5F5F5" stroke-width="3.5" fill="none" stroke-linecap="round"></path><path d="M42 22 A14 14 0 0 1 42 42" stroke="#F5F5F5" stroke-width="3.5" fill="none" stroke-linecap="round" opacity="0.7"></path><path d="M50 25 A10 10 0 0 1 50 39" stroke="#F5F5F5" stroke-width="3.5" fill="none" stroke-linecap="round" opacity="0.44"></path></svg></div>`;
    row.innerHTML = `
      <div class="msg">
        ${avatar}
        <div class="msg-body">
          <div class="msg-role">${isUser ? "You" : "CARA"}</div>
          <div class="msg-content">${isUser ? escapeHtml(content) : renderMarkdown(content)}</div>
        </div>
      </div>`;
    els.messages.appendChild(row);
    return row.querySelector(".msg-content");
  }

  function renderMarkdown(text) {
    if (window.marked) {
      return marked.parse(text);
    }
    return escapeHtml(text);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>\"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;", "'": "&#39;" }[c]));
  }

  function scrollToBottom() {
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  // ---------- Actions ----------
  function selectConvo(id) {
    state.activeId = id;
    persist();
    renderSidebar();
    renderMessages();
    closeSidebarMobile();
  }

  function deleteConvo(id) {
    state.conversations = state.conversations.filter((c) => c.id !== id);
    if (!state.conversations.length) state.conversations = [newConvo()];
    if (state.activeId === id) state.activeId = state.conversations[0].id;
    persist();
    renderSidebar();
    renderMessages();
  }

  function startNewChat() {
    const empty = state.conversations.find((c) => c.messages.length === 0);
    const convo = empty || newConvo();
    if (!empty) state.conversations.push(convo);
    state.activeId = convo.id;
    persist();
    renderSidebar();
    renderMessages();
    closeSidebarMobile();
    els.input.focus();
  }

  async function sendMessage(text) {
    if (streaming) return;
    text = text.trim();
    if (!text) return;

    const convo = activeConvo();
    convo.messages.push({ role: "user", content: text });
    if (convo.title === "New chat") {
      convo.title = text.slice(0, 40) + (text.length > 40 ? "…" : "");
    }
    persist();
    renderSidebar();

    els.welcome.style.display = "none";
    appendMessage("user", text);
    scrollToBottom();

    const contentEl = appendMessage("assistant", "");
    contentEl.innerHTML = `<div class="typing"><span></span><span></span><span></span></div>`;
    scrollToBottom();

    streaming = true;
    updateSendState();

    let acc = "";
    let firstToken = true;

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: convo.id, messages: convo.messages }),
      });

      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({}));
        contentEl.innerHTML = renderMarkdown(`⚠️ ${err.error || "Something went wrong. Please try again."}`);
        streaming = false;
        updateSendState();
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const evt of events) {
          const lines = evt.split("\n");
          let event = "message";
          let data = "";
          for (const line of lines) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if (!data) continue;
          let parsed;
          try { parsed = JSON.parse(data); } catch { continue; }

          if (event === "token" && parsed.t) {
            if (firstToken) { contentEl.innerHTML = ""; firstToken = false; }
            acc += parsed.t;
            contentEl.innerHTML = renderMarkdown(acc) + `<span class="cursor"></span>`;
            scrollToBottom();
          } else if (event === "error") {
            contentEl.innerHTML = renderMarkdown(`⚠️ ${parsed.error || "Upstream error."}`);
          } else if (event === "done") {
            contentEl.innerHTML = renderMarkdown(acc || "(no response)");
          }
        }
      }

      contentEl.innerHTML = renderMarkdown(acc || "(no response)");
      if (acc) {
        convo.messages.push({ role: "assistant", content: acc });
        persist();
      }
    } catch (err) {
      contentEl.innerHTML = renderMarkdown("⚠️ Connection lost. Please try again.");
    } finally {
      streaming = false;
      updateSendState();
      scrollToBottom();
    }
  }

  // ---------- Composer ----------
  function updateSendState() {
    els.send.disabled = streaming || !els.input.value.trim();
  }

  function autoGrow() {
    els.input.style.height = "auto";
    els.input.style.height = Math.min(els.input.scrollHeight, 200) + "px";
  }

  function closeSidebarMobile() {
    els.sidebar.classList.remove("open");
  }

  // ---------- Events ----------
  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = els.input.value;
    els.input.value = "";
    autoGrow();
    updateSendState();
    sendMessage(text);
  });

  els.input.addEventListener("input", () => { autoGrow(); updateSendState(); });
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      els.form.requestSubmit();
    }
  });

  els.newChat.addEventListener("click", startNewChat);
  els.menuToggle.addEventListener("click", () => els.sidebar.classList.toggle("open"));

  els.suggestions?.addEventListener("click", (e) => {
    const btn = e.target.closest(".suggestion");
    if (!btn) return;
    sendMessage(btn.dataset.q);
  });

  // ---------- Init ----------
  renderSidebar();
  renderMessages();
  updateSendState();
  els.input.focus();
})();
