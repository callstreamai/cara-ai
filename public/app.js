// CARA AI — frontend
// Real user accounts via Supabase Auth. Conversations + messages are stored
// per-user in Supabase (protected by row-level security). Live SSE streaming
// from the server-side Fugu proxy.

(() => {
  if (window.marked) marked.setOptions({ breaks: true, gfm: true });

  const $ = (s) => document.querySelector(s);
  const els = {
    boot: $("#boot"),
    authScreen: $("#auth-screen"),
    app: $("#app"),
    // auth
    authError: $("#auth-error"),
    authTitle: $("#auth-title"),
    authSub: $("#auth-sub"),
    authGoogleBtn: $("#auth-google-btn"),
    // chat
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
    userMenu: $("#user-menu"),
    userEmail: $("#user-email"),
    userAvatar: $("#user-avatar"),
    attachBtn: $("#attach-btn"),
    fileInput: $("#file-input"),
    attachments: $("#attachments"),
  };

  // Attached documents staged for the next message: {id, filename, text, chars, truncated, status}
  let pendingAttachments = [];

  let supabase = null;
  let user = null;
  let conversations = [];   // [{id, title, created_at}]
  let activeId = null;
  let messages = [];        // messages of the active conversation
  let streaming = false;

  // ---------------- Boot ----------------
  async function boot() {
    // Guard: if the Supabase library failed to load from the CDN, don't hang.
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      return fatal("Couldn't load a required library. Please refresh.");
    }

    let cfg;
    try {
      cfg = await fetch("/api/config").then((r) => r.json());
    } catch {
      return fatal("Could not reach the server. Please refresh.");
    }
    if (!cfg.authEnabled || !cfg.supabaseUrl || !cfg.supabaseAnonKey) {
      return fatal("Sign-in is not configured yet. Please try again shortly.");
    }

    try {
      supabase = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    } catch (e) {
      return fatal("Couldn't start the auth client. Please refresh.");
    }

    // Never let a stalled getSession() trap the user on the loading screen.
    let session = null;
    try {
      const res = await Promise.race([
        supabase.auth.getSession(),
        new Promise((resolve) => setTimeout(() => resolve({ __timeout: true }), 6000)),
      ]);
      if (!res.__timeout) session = res?.data?.session || null;
    } catch {
      session = null;
    }

    if (session) {
      user = session.user;
      try {
        await enterApp();
      } catch {
        showAuth();
      }
    } else {
      showAuth();
    }

    supabase.auth.onAuthStateChange((_event, s) => {
      if (s) {
        user = s.user;
      } else {
        user = null;
        showAuth();
      }
    });
  }

  function fatal(msg) {
    els.boot.innerHTML = `<div class="boot-msg">${msg}</div>`;
  }

  // ---------------- Auth UI ----------------
  function showAuth() {
    els.boot.hidden = true;
    els.app.hidden = true;
    els.authScreen.hidden = false;
  }

  function showAuthError(msg) {
    els.authError.textContent = msg;
    els.authError.hidden = false;
  }
  function hideAuthError() {
    els.authError.hidden = true;
  }

  // Google SSO — restricted to @callstreamai.com via Supabase OAuth
  els.authGoogleBtn.addEventListener("click", async () => {
    hideAuthError();
    els.authGoogleBtn.disabled = true;
    els.authGoogleBtn.textContent = "Redirecting…";
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
          queryParams: { hd: "callstreamai.com" },
        },
      });
      if (error) throw error;
    } catch (err) {
      showAuthError(err.message || "Sign-in failed. Please try again.");
      els.authGoogleBtn.disabled = false;
      els.authGoogleBtn.textContent = "Sign in with Google";
    }
  });

  // ---------------- Enter app ----------------
  async function enterApp() {
    els.boot.hidden = true;
    els.authScreen.hidden = true;
    els.app.hidden = false;

    const email = user.email || "Account";
    els.userEmail.textContent = email;
    els.userAvatar.textContent = (email[0] || "U").toUpperCase();

    await loadConversations();
    els.input.focus();
  }

  async function accessToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || "";
  }

  // ---------------- Data: conversations ----------------
  async function loadConversations() {
    const { data, error } = await supabase
      .from("conversations")
      .select("id,title,created_at")
      .order("updated_at", { ascending: false });
    if (error) {
      console.error(error);
      conversations = [];
    } else {
      conversations = data || [];
    }
    if (!conversations.length) {
      activeId = null;
      messages = [];
      renderSidebar();
      renderMessages();
    } else {
      activeId = conversations[0].id;
      await openConversation(activeId);
    }
    renderSidebar();
  }

  async function openConversation(id) {
    activeId = id;
    const { data, error } = await supabase
      .from("messages")
      .select("role,content,created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    messages = error ? [] : (data || []);
    renderSidebar();
    renderMessages();
    closeSidebarMobile();
  }

  async function createConversation(title) {
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: user.id, title: title || "New chat" })
      .select("id,title,created_at")
      .single();
    if (error) {
      console.error(error);
      return null;
    }
    conversations.unshift(data);
    return data;
  }

  async function renameConversation(id, title) {
    await supabase.from("conversations").update({ title, updated_at: new Date().toISOString() }).eq("id", id);
    const c = conversations.find((x) => x.id === id);
    if (c) c.title = title;
  }

  async function touchConversation(id) {
    await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", id);
  }

  async function deleteConversation(id) {
    await supabase.from("conversations").delete().eq("id", id);
    conversations = conversations.filter((c) => c.id !== id);
    if (activeId === id) {
      if (conversations.length) await openConversation(conversations[0].id);
      else { activeId = null; messages = []; renderMessages(); }
    }
    renderSidebar();
  }

  async function addMessage(conversationId, role, content) {
    const { data, error } = await supabase
      .from("messages")
      .insert({ conversation_id: conversationId, user_id: user.id, role, content })
      .select("role,content,created_at")
      .single();
    if (error) { console.error(error); return null; }
    return data;
  }

  // ---------------- Rendering ----------------
  function renderSidebar() {
    els.list.innerHTML = "";
    conversations.forEach((c) => {
      const item = document.createElement("div");
      item.className = "convo-item" + (c.id === activeId ? " active" : "");
      item.innerHTML = `
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span class="title">${escapeHtml(c.title)}</span>
        <button class="del" title="Delete" aria-label="Delete conversation">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
        </button>`;
      item.querySelector(".title").addEventListener("click", () => openConversation(c.id));
      item.querySelector("svg").addEventListener("click", () => openConversation(c.id));
      item.querySelector(".del").addEventListener("click", (e) => {
        e.stopPropagation();
        deleteConversation(c.id);
      });
      els.list.appendChild(item);
    });
  }

  function renderMessages() {
    const c = conversations.find((x) => x.id === activeId);
    els.title.textContent = c ? c.title : "New chat";
    els.messages.querySelectorAll(".msg-row").forEach((n) => n.remove());
    if (!messages.length) {
      els.welcome.style.display = "";
      return;
    }
    els.welcome.style.display = "none";
    messages.forEach((m) => appendMessage(m.role, m.content));
    scrollToBottom();
  }

  function appendMessage(role, content) {
    const row = document.createElement("div");
    row.className = `msg-row ${role}`;
    const isUser = role === "user";
    const avatar = isUser
      ? `<div class="avatar user">${(user?.email?.[0] || "Y").toUpperCase()}</div>`
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
    return window.marked ? marked.parse(text) : escapeHtml(text);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function scrollToBottom() {
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  // ---------------- Send ----------------
  async function sendMessage(text) {
    if (streaming || attachmentsBusy()) return;
    text = text.trim();
    const docs = readyAttachments();
    if (!text && docs.length === 0) return;

    // If sending only documents, give the turn a sensible default prompt.
    const promptText = text || (docs.length === 1
      ? `Please summarize ${docs[0].filename}.`
      : "Please summarize the attached documents.");

    // A short marker appended to the stored/displayed message so the
    // attachment is visible in history (the full text is sent separately).
    const docNames = docs.map((d) => d.filename);
    const marker = docNames.length ? `\n\n📎 ${docNames.join(", ")}` : "";
    const displayText = promptText + marker;
    const titleSeed = (text || docNames[0] || "New chat");

    // Ensure there's an active conversation.
    let convo = conversations.find((c) => c.id === activeId);
    if (!convo) {
      convo = await createConversation(titleSeed.slice(0, 40) + (titleSeed.length > 40 ? "…" : ""));
      if (!convo) return;
      activeId = convo.id;
      messages = [];
      renderSidebar();
    } else if (messages.length === 0 && convo.title === "New chat") {
      await renameConversation(convo.id, titleSeed.slice(0, 40) + (titleSeed.length > 40 ? "…" : ""));
      renderSidebar();
    }

    // Snapshot + clear the staged attachments now (they're consumed by this turn).
    const sendDocs = docs.map((d) => ({ filename: d.filename, text: d.text }));
    clearAttachments();

    // Persist + render user message (with the 📎 marker, not the doc text).
    messages.push({ role: "user", content: displayText });
    await addMessage(convo.id, "user", displayText);
    els.welcome.style.display = "none";
    appendMessage("user", displayText);
    scrollToBottom();

    // Assistant placeholder.
    const contentEl = appendMessage("assistant", "");
    contentEl.innerHTML = `<div class="typing"><span></span><span></span><span></span></div>`;
    scrollToBottom();

    streaming = true;
    updateSendState();

    let acc = "";
    let firstToken = true;

    try {
      const token = await accessToken();
      // Send messages with the last user message as the clean prompt (no 📎 marker);
      // attachments travel separately and are injected as context server-side.
      const sendMessages = messages.map((m, i) =>
        i === messages.length - 1 ? { role: m.role, content: promptText } : m
      );
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: sendMessages, attachments: sendDocs }),
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
          let event = "message", data = "";
          for (const line of evt.split("\n")) {
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
          }
        }
      }

      contentEl.innerHTML = renderMarkdown(acc || "(no response)");
      if (acc) {
        messages.push({ role: "assistant", content: acc });
        await addMessage(convo.id, "assistant", acc);
        await touchConversation(convo.id);
        // bump to top of sidebar
        conversations = [convo, ...conversations.filter((c) => c.id !== convo.id)];
        renderSidebar();
      }
    } catch (err) {
      contentEl.innerHTML = renderMarkdown("⚠️ Connection lost. Please try again.");
    } finally {
      streaming = false;
      updateSendState();
      scrollToBottom();
    }
  }

  // ---------------- Attachments ----------------
  const MAX_FILE_MB = 15;
  let attachSeq = 0;

  function renderAttachments() {
    els.attachments.innerHTML = "";
    pendingAttachments.forEach((a) => {
      const chip = document.createElement("div");
      chip.className = "attach-chip" + (a.status === "error" ? " error" : "");
      let icon, meta;
      if (a.status === "loading") {
        icon = `<span class="chip-spinner"></span>`;
        meta = "Reading…";
      } else if (a.status === "error") {
        icon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>`;
        meta = a.error || "Failed";
      } else {
        icon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`;
        meta = a.truncated ? `${(a.chars / 1000).toFixed(0)}k chars · trimmed` : `${a.chars.toLocaleString()} chars`;
      }
      chip.innerHTML = `
        <span class="chip-icon">${icon}</span>
        <span class="chip-body">
          <span class="chip-name" title="${escapeHtml(a.filename)}">${escapeHtml(a.filename)}</span>
          <span class="chip-meta">${escapeHtml(meta)}</span>
        </span>
        <button class="chip-remove" aria-label="Remove" data-id="${a.id}">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>`;
      chip.querySelector(".chip-remove").addEventListener("click", () => {
        pendingAttachments = pendingAttachments.filter((x) => x.id !== a.id);
        renderAttachments();
        updateSendState();
      });
      els.attachments.appendChild(chip);
    });
    els.attachments.classList.toggle("has-items", pendingAttachments.length > 0);
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    for (const file of files) {
      if (pendingAttachments.length >= 5) {
        alert("You can attach up to 5 documents at a time.");
        break;
      }
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        const id = ++attachSeq;
        pendingAttachments.push({ id, filename: file.name, status: "error", error: `Too large (max ${MAX_FILE_MB}MB)` });
        renderAttachments();
        continue;
      }
      const id = ++attachSeq;
      const entry = { id, filename: file.name, status: "loading" };
      pendingAttachments.push(entry);
      renderAttachments();
      updateSendState();

      try {
        const token = await accessToken();
        const fd = new FormData();
        fd.append("file", file);
        const resp = await fetch("/api/extract", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        const data = await resp.json().catch(() => ({}));
        const cur = pendingAttachments.find((x) => x.id === id);
        if (!cur) continue; // removed while loading
        if (!resp.ok) {
          cur.status = "error";
          cur.error = data.error || "Couldn't read file";
        } else {
          cur.status = "ready";
          cur.text = data.text;
          cur.chars = data.chars;
          cur.truncated = data.truncated;
        }
      } catch {
        const cur = pendingAttachments.find((x) => x.id === id);
        if (cur) { cur.status = "error"; cur.error = "Upload failed"; }
      }
      renderAttachments();
      updateSendState();
    }
  }

  function readyAttachments() {
    return pendingAttachments.filter((a) => a.status === "ready" && a.text);
  }
  function attachmentsBusy() {
    return pendingAttachments.some((a) => a.status === "loading");
  }
  function clearAttachments() {
    pendingAttachments = [];
    renderAttachments();
  }

  // ---------------- Composer ----------------
  function updateSendState() {
    els.send.disabled = streaming || attachmentsBusy() || (!els.input.value.trim() && readyAttachments().length === 0);
  }
  function autoGrow() {
    els.input.style.height = "auto";
    els.input.style.height = Math.min(els.input.scrollHeight, 200) + "px";
  }
  function closeSidebarMobile() {
    els.sidebar.classList.remove("open");
  }

  async function startNewChat() {
    // If current active convo is already empty, just stay.
    const current = conversations.find((c) => c.id === activeId);
    if (current && messages.length === 0) {
      els.input.focus();
      return;
    }
    activeId = null;
    messages = [];
    renderSidebar();
    renderMessages();
    closeSidebarMobile();
    els.input.focus();
  }

  // ---------------- Events ----------------
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
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); els.form.requestSubmit(); }
  });
  els.newChat.addEventListener("click", startNewChat);
  els.menuToggle.addEventListener("click", () => els.sidebar.classList.toggle("open"));

  // Attach document
  els.attachBtn.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", (e) => {
    handleFiles(e.target.files);
    els.fileInput.value = ""; // allow re-selecting the same file
  });
  els.suggestions?.addEventListener("click", (e) => {
    const btn = e.target.closest(".suggestion");
    if (btn) sendMessage(btn.dataset.q);
  });
  els.userMenu.addEventListener("click", async () => {
    if (confirm("Sign out of CARA?")) {
      await supabase.auth.signOut();
      conversations = []; messages = []; activeId = null;
      clearAttachments();
      showAuth();
    }
  });

  // ---------------- Go ----------------
  boot();
})();
