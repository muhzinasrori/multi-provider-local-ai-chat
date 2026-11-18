/* AI Chat — Vanilla JS (ES6+) */
'use strict';

// ═══════════ State ═══════════
const state = {
  conversationId: null,
  model: localStorage.getItem('model') || '',
  models: [],
  attachments: [], // lampiran menunggu dikirim: {id, filename, mime, size, url}
  streaming: false,
  abort: null,
  thinking: localStorage.getItem('thinking-mode') === 'true',
  hasTtsApi: false,
};

// ═══════════ Elemen ═══════════
const $ = (sel) => document.querySelector(sel);
const els = {
  sidebar: $('#sidebar'),
  chatList: $('#chat-list'),
  messages: $('#messages'),
  welcome: $('#welcome'),
  input: $('#input'),
  form: $('#composer'),
  composerZone: $('#composer-zone'),
  sendBtn: $('#send-btn'),
  attachBtn: $('#attach-btn'),
  fileInput: $('#file-input'),
  attPreview: $('#attachments-preview'),
  modelSelect: $('#model-select'),
  thinkingToggle: $('#thinking-toggle'),
  thinkingStatus: $('#thinking-status'),
  toast: $('#toast'),
  banner: $('#no-key-banner'),
  hljsTheme: $('#hljs-theme'),
};

// ═══════════ Thinking Mode ═══════════
function updateThinkingToggle() {
  const model = state.models.find(
    (m) => m.id === state.model
  );

  const supported = Boolean(model?.supportsThinking);

  els.thinkingToggle.classList.toggle(
    'hidden',
    !supported
  );

  if (!supported) return;

  els.thinkingStatus.textContent =
    state.thinking ? 'ON' : 'OFF';

  els.thinkingToggle.setAttribute(
    'aria-pressed',
    String(state.thinking)
  );

  els.thinkingToggle.classList.toggle(
    'active',
    state.thinking
  );
}

els.thinkingToggle.addEventListener('click', () => {
  state.thinking = !state.thinking;

  localStorage.setItem(
    'thinking-mode',
    String(state.thinking)
  );

  updateThinkingToggle();
});

// ═══════════ Markdown + highlight.js ═══════════
const md = window.markdownit({
  html: false,
  linkify: true,
  breaks: true,
  highlight: (code, lang) => {
    let body, label;
    try {
      if (lang && hljs.getLanguage(lang)) {
        body = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
        label = lang;
      } else {
        body = hljs.highlightAuto(code).value;
        label = hljs.getLanguage(hljs.highlightAuto(code).language)?.name || 'code';
      }
    } catch {
      body = md.utils.escapeHtml(code);
      label = 'code';
    }
    return `<div class="codeblock"><div class="codeblock-head"><span>${label}</span>` +
      `<button class="copy-code-btn" type="button">Salin</button></div>` +
      `<pre><code class="hljs language-${label}">${body}</code></pre></div>`;
  },
});

function renderMarkdown(text) {
  let thinkingHtml = '';
  text = text.replace(/<think>([\s\S]*?)(?:<\/think>|$)/g, (_, thought) => {
    const cleanThought = thought.trim();
    if (cleanThought) {
      thinkingHtml += `<details class="thought-box" open><summary>💭 Thinking</summary><div class="thought-content">${md.render(cleanThought)}</div></details>`;
    }
    return '';
  });
  const codeBlocks = [];
  const mathBlocks = [];

  const saveMath = (tex, display) => {
    const id = `@@MATH_${mathBlocks.length}@@`;
    mathBlocks.push({ tex: tex.trim(), display });
    return id;
  };

  // 1. Amankan blok kode (```...``` dan `...`) terlebih dahulu
  let processed = text.replace(/```[\s\(\S\)]*?```|`[^`\n]+`/g, (match) => {
    const id = `@@CODE_${codeBlocks.length}@@`;
    codeBlocks.push(match);
    return id;
  });

  // 2. Ekstrak blok matematika display ($$ ... $$ dan \[ ... \]) SEBELUM menyentuh kurung biasa
  processed = processed
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => saveMath(tex, true))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => saveMath(tex, true))
    .replace(/^\[\s*\n?([\s\S]*?\\[\s\S]*?)\n?\s*\]$/gm, (_, tex) => saveMath(tex, true));

  // 3. Ekstrak matematika inline ($ ... $ dan \( ... \))
  processed = processed
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, tex) => saveMath(tex, false))
    .replace(/\$([^\n$]+?)\$/g, (_, tex) => saveMath(tex, false))
    .replace(/\(\s*(\\[a-zA-Z]+[^()\n]*)\s*\)/g, (_, tex) => saveMath(tex, false));

  // 4. Kembalikan blok kode agar di-highlight oleh markdown-it + highlight.js
  processed = processed.replace(/@@CODE_(\d+)@@/g, (_, i) => codeBlocks[Number(i)]);

  // 5. Render Markdown menjadi HTML
  let html = md.render(processed);

  // 6. Render semua rumus matematika menggunakan KaTeX
  html = html.replace(/@@MATH_(\d+)@@/g, (_, i) => {
    const item = mathBlocks[Number(i)];
    if (!item || !window.katex) return '';
    try {
      return window.katex.renderToString(item.tex, {
        displayMode: item.display,
        throwOnError: false,
      });
    } catch {
      return item.tex;
    }
  });

  return thinkingHtml + html;
}

// ═══════════ Util ═══════════
function toast(msg, isError = false) {
  els.toast.textContent = msg;
  els.toast.classList.toggle('error', isError);
  els.toast.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => els.toast.classList.add('hidden'), 3200);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB'
  : n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ═══════════ Model dropdown ═══════════
async function loadModels() {
  const { models, providers, hasTtsApi } = await api('/api/models');
  state.hasTtsApi = Boolean(hasTtsApi);
  state.models = models;
  els.banner.classList.toggle('hidden', providers.length > 0);

  els.modelSelect.innerHTML = '';
  const byProvider = {};
  for (const m of models) (byProvider[m.providerLabel] ||= []).push(m);
  for (const [group, list] of Object.entries(byProvider)) {
    const og = document.createElement('optgroup');
    og.label = group;
    for (const m of list) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.id;
      og.appendChild(opt);
    }
    els.modelSelect.appendChild(og);
  }
  if (!models.some((m) => m.id === state.model)) state.model = models[0]?.id || '';
  els.modelSelect.value = state.model;
  $('#welcome-model').textContent = state.model || 'AI';
  updateThinkingToggle();
}

els.modelSelect.addEventListener('change', () => {
  state.model = els.modelSelect.value;
  localStorage.setItem('model', state.model);
  $('#welcome-model').textContent = state.model;
  updateThinkingToggle();
});

// ═══════════ Sidebar: riwayat ═══════════
function groupLabel(dateStr) {
  const d = new Date(dateStr.replace(' ', 'T') + 'Z');
  const today = new Date();
  const days = Math.floor((today.setHours(0, 0, 0, 0) - d.getTime()) / 864e5);
  if (days <= 0) return 'Hari ini';
  if (days === 1) return 'Kemarin';
  if (days <= 7) return '7 hari terakhir';
  if (days <= 30) return '30 hari terakhir';
  return 'Lebih lama';
}

async function loadConversations() {
  const { conversations } = await api('/api/conversations');
  els.chatList.innerHTML = '';
  let lastGroup = '';
  for (const c of conversations) {
    const g = groupLabel(c.updated_at);
    if (g !== lastGroup) {
      lastGroup = g;
      const label = document.createElement('div');
      label.className = 'chat-group-label';
      label.textContent = g;
      els.chatList.appendChild(label);
    }
    els.chatList.appendChild(chatItem(c));
  }
  if (!conversations.length) {
    els.chatList.innerHTML = '<div class="chat-group-label">Belum ada riwayat</div>';
  }
}

function chatItem(c) {
  const item = document.createElement('div');
  item.className = 'chat-item' + (c.id === state.conversationId ? ' active' : '');
  item.dataset.id = c.id;

  const title = document.createElement('button');
  title.className = 'title';
  title.textContent = c.title;
  title.title = c.title;
  title.addEventListener('click', () => openConversation(c.id));

  const actions = document.createElement('div');
  actions.className = 'chat-actions';

  const renameBtn = document.createElement('button');
  renameBtn.title = 'Ganti judul';
  renameBtn.innerHTML = '✏️';
  renameBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    startRename(item, c);
  });

  const delBtn = document.createElement('button');
  delBtn.className = 'del';
  delBtn.title = 'Hapus chat';
  delBtn.innerHTML = '🗑️';
  delBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Hapus "${c.title}"?`)) return;
    await api(`/api/conversations/${c.id}`, { method: 'DELETE' });
    if (state.conversationId === c.id) newChat();
    loadConversations();
  });

  actions.append(renameBtn, delBtn);
  item.append(title, actions);
  return item;
}

function startRename(item, c) {
  const titleBtn = item.querySelector('.title');
  const input = document.createElement('input');
  input.className = 'rename';
  input.value = c.title;
  item.replaceChild(input, titleBtn);
  input.focus();
  input.select();

  const finish = async (save) => {
    const val = input.value.trim();
    if (save && val && val !== c.title) {
      await api(`/api/conversations/${c.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: val }),
      });
    }
    loadConversations();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
    e.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
}

// ═══════════ Render pesan ═══════════
function msgEl(role, content = '', attachments = []) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? 'S' : 'AI';

  const body = document.createElement('div');
  body.className = 'msg-body';

  const roleLbl = document.createElement('div');
  roleLbl.className = 'msg-role';
  roleLbl.textContent = role === 'user' ? 'Anda' : 'AI';

  const attBox = document.createElement('div');
  attBox.className = 'msg-attachments' + (attachments.length ? '' : ' hidden');
  for (const a of attachments) {
    if (a.mime.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = a.url;
      img.alt = a.filename;
      img.addEventListener('click', () => lightbox(a.url));
      attBox.appendChild(img);
    } else {
      const chip = document.createElement('span');
      chip.className = 'file-chip';
      chip.innerHTML = `📄 <span class="fname" title="${escapeHtml(a.filename)}">${escapeHtml(a.filename)}</span> <span>${fmtSize(a.size)}</span>`;
      attBox.appendChild(chip);
    }
  }

  const contentEl = document.createElement('div');
  contentEl.className = 'msg-content';
  contentEl.innerHTML = renderMarkdown(content);

  body.append(roleLbl, attBox, contentEl);

  if (role === 'assistant') {
    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    const regen = document.createElement('button');
    regen.textContent = '⟳ Regenerasi jawaban';
    regen.addEventListener('click', () => sendMessage({ regenerate: true }));
    const copy = document.createElement('button');
    copy.textContent = '📋 Salin teks';
    copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(contentEl.textContent);
      toast('Teks disalin');
    });
    actions.append(regen, copy);
    body.appendChild(actions);
  }

  wrap.append(avatar, body);
  return wrap;
}

function lightbox(url) {
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.innerHTML = `<img src="${url}" alt="">`;
  box.addEventListener('click', () => box.remove());
  document.body.appendChild(box);
}

function typingEl() {
  const el = document.createElement('div');
  el.className = 'typing';
  el.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span> AI sedang mengetik…';
  return el;
}

// ═══════════ Buka / baru percakapan ═══════════
async function openConversation(id) {
  const { conversation, messages } = await api(`/api/conversations/${id}/messages`);
  state.conversationId = id;
  els.messages.innerHTML = '';
  for (const m of messages) {
    els.messages.appendChild(msgEl(m.role, m.content, m.attachments));
  }
  if (conversation.model && state.models.some((x) => x.id === conversation.model)) {
    state.model = conversation.model;
    els.modelSelect.value = state.model;
    updateThinkingToggle();
  }
  loadConversations();
  scrollToBottom();
  if (window.innerWidth <= 768) toggleSidebar(false);
}

function newChat() {
  state.conversationId = null;
  els.messages.innerHTML = '';
  els.messages.appendChild(els.welcome);
  els.welcome.classList.remove('hidden');
  els.input.value = '';
  autosize();
  state.attachments = [];
  renderAttachmentPreview();
  loadConversations();
  els.input.focus();
  if (window.innerWidth <= 768) toggleSidebar(false);
}

function scrollToBottom() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

// ═══════════ Sidebar toggle (responsif) ═══════════
function toggleSidebar(open) {
  const collapsed = open === false;
  els.sidebar.classList.toggle('collapsed', collapsed);
  const overlay = $('#sidebar-overlay');
  if (window.innerWidth <= 768) overlay.classList.toggle('show', !collapsed);
}

// ═══════════ Lampiran: upload, preview, drag&drop, paste ═══════════
async function uploadFiles(fileList) {
  const files = [...fileList].slice(0, 10);
  if (!files.length) return;
  const fd = new FormData();
  for (const f of files) fd.append('files', f, f.name || `screenshot-${Date.now()}.png`);

  const placeholders = files.map((f) => {
    const item = attachmentItem({ id: null, filename: f.name, mime: f.type || 'application/octet-stream', size: f.size, url: null }, true);
    els.attPreview.appendChild(item);
    return item;
  });

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Gagal mengunggah');
    const { attachments } = await res.json();
    for (let i = 0; i < attachments.length; i++) {
      state.attachments.push(attachments[i]);
      placeholders[i].replaceWith(attachmentItem(attachments[i], false));
    }
    for (let i = attachments.length; i < placeholders.length; i++) placeholders[i].remove();
  } catch (err) {
    placeholders.forEach((p) => p.remove());
    toast(err.message, true);
  }
  updateAttachmentVisibility();
  updateSendState();
}

function attachmentItem(att, uploading) {
  const item = document.createElement('div');
  item.className = 'att-item' + (uploading ? ' uploading' : '');
  item.dataset.attId = att.id ?? '';

  if (att.mime?.startsWith('image/') && att.url) {
    const img = document.createElement('img');
    img.className = 'thumb';
    img.src = att.url;
    item.appendChild(img);
  } else {
    const icon = document.createElement('span');
    icon.textContent = att.mime?.startsWith('image/') ? '🖼️' : '📄';
    icon.style.fontSize = '22px';
    item.appendChild(icon);
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.innerHTML = `<div class="name">${escapeHtml(att.filename)}</div><div class="sub">${uploading ? 'mengunggah…' : fmtSize(att.size)}</div>`;
  item.appendChild(meta);

  if (!uploading) {
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'remove';
    rm.title = 'Hapus lampiran';
    rm.textContent = '×';
    rm.addEventListener('click', () => {
      state.attachments = state.attachments.filter((a) => a.id !== att.id);
      item.remove();
      updateAttachmentVisibility();
      updateSendState();
    });
    item.appendChild(rm);
  }
  return item;
}

function renderAttachmentPreview() {
  els.attPreview.innerHTML = '';
  for (const a of state.attachments) els.attPreview.appendChild(attachmentItem(a, false));
  updateAttachmentVisibility();
}

function updateAttachmentVisibility() {
  els.attPreview.classList.toggle('hidden', !state.attachments.length);
}

els.attachBtn.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', () => {
  uploadFiles(els.fileInput.files);
  els.fileInput.value = '';
});

// Drag & drop
let dragDepth = 0;
for (const evt of ['dragenter', 'dragover']) {
  document.addEventListener(evt, (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    if (evt === 'dragenter') dragDepth++;
    els.composerZone.classList.add('dragover');
  });
}
document.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) { dragDepth = 0; els.composerZone.classList.remove('dragover'); }
});
document.addEventListener('drop', (e) => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  dragDepth = 0;
  els.composerZone.classList.remove('dragover');
  uploadFiles(e.dataTransfer.files);
});

// Paste gambar dari clipboard (Ctrl+V)
els.input.addEventListener('paste', (e) => {
  const items = [...(e.clipboardData?.items || [])];
  const imageFiles = items
    .filter((it) => it.type.startsWith('image/'))
    .map((it) => it.getAsFile())
    .filter(Boolean);
  if (imageFiles.length) {
    e.preventDefault();
    uploadFiles(imageFiles);
    toast(`${imageFiles.length} gambar dari clipboard dilampirkan`);
  }
});

// ═══════════ Kirim pesan + baca stream SSE ═══════════
async function sendMessage({ regenerate = false } = {}) {
  if (state.streaming) {
    state.abort?.abort();
    return;
  }
  if (!state.model) return toast('Belum ada model tersedia. Periksa .env.', true);

  const content = els.input.value.trim();
  if (regenerate && !state.conversationId) return;
  if (!regenerate && !content && !state.attachments.length) return;

  els.welcome.classList.add('hidden');
  const attachmentIds = state.attachments.map((a) => a.id);

  if (!regenerate) {
    els.messages.appendChild(
      msgEl('user', content, state.attachments)
    );
    els.input.value = '';
    autosize();
    state.attachments = [];
    renderAttachmentPreview();
  }

  // placeholder asisten
  const assistantWrap = msgEl('assistant', '', []);
  const contentEl = assistantWrap.querySelector('.msg-content');
  contentEl.innerHTML = '';
  const typing = typingEl();
  contentEl.appendChild(typing);
  els.messages.appendChild(assistantWrap);
  scrollToBottom();

  state.streaming = true;
  state.abort = new AbortController();
  updateSendState();

  let streamText = '';
  let streamThinking = '';
  let renderTimer = null;

  const combinedStream = () =>
    (streamThinking ? `<think>\n${streamThinking}\n</think>\n\n` : '') + streamText;

  const flushRender = () => {
    renderTimer = null;
    contentEl.innerHTML = renderMarkdown(combinedStream());
    scrollToBottom();
  };

  const appendThinking = (t) => {
    if (!streamText && !streamThinking) typing.remove();
    streamThinking += t;
    if (!renderTimer) {
      renderTimer = setTimeout(flushRender, 80);
    }
  };

  const appendDelta = (t) => {
    if (!streamText && !streamThinking) typing.remove();
    streamText += t;
    if (!renderTimer) {
      renderTimer = setTimeout(flushRender, 80);
    }
  };

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: state.abort.signal,
      body: JSON.stringify({
        conversationId: state.conversationId,
        content: regenerate ? '' : content,
        model: state.model,
        attachmentIds: regenerate ? [] : attachmentIds,
        regenerate,
        thinking: state.thinking,
        voiceMode: voiceCall.active,
      }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      throw new Error(error || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of block.split('\n')) {
          if (!line.startsWith('data:')) continue;
          let evt;
          try { evt = JSON.parse(line.slice(5)); } catch { continue; }
          if (evt.thinkingDelta) appendThinking(evt.thinkingDelta);
          if (evt.delta) {
            appendDelta(evt.delta);
            if (voiceCall.active) feedVoiceStream(evt.delta);
          }
          if (evt.error) toast(evt.error, true);
          if (evt.done) {
            if (voiceCall.active) flushVoiceStream();
            state.conversationId = evt.conversationId;
            loadConversations();
          }
        }
      }
    }
    if (renderTimer) {
      clearTimeout(renderTimer);
      flushRender();
    }
    if (!combinedStream()) {
      contentEl.innerHTML = '<em style="color:var(--text-dim)">Jawaban kosong.</em>';
    }
  } catch (err) {
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    if (err.name === 'AbortError') {
      if (combinedStream()) contentEl.innerHTML = renderMarkdown(combinedStream());
      else contentEl.innerHTML = '<em style="color:var(--text-dim)">Dibatalkan.</em>';
    } else {
      contentEl.innerHTML = renderMarkdown(combinedStream());
      toast(err.message, true);
    }
  } finally {
    state.streaming = false;
    state.abort = null;
    updateSendState();
    scrollToBottom();
  }
}

// ═══════════ Composer UI ═══════════
function autosize() {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 220) + 'px';
}

function updateSendState() {
  const canSend = els.input.value.trim() || state.attachments.length;
  els.sendBtn.disabled = state.streaming ? false : !canSend;
  els.sendBtn.classList.toggle('stop', state.streaming);
  els.sendBtn.title = state.streaming ? 'Hentikan' : 'Kirim';
  els.sendBtn.innerHTML = state.streaming
    ? '<svg viewBox="0 0 24 24" width="16" height="16"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>'
    : '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 19V5M5 12l7-7 7 7"/></svg>';
}

els.input.addEventListener('input', () => { autosize(); updateSendState(); });
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!state.streaming) sendMessage();
  }
});
els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  sendMessage();
});

// Tombol "Salin" pada blok kode (delegasi, karena dibuat oleh markdown renderer)
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.copy-code-btn');
  if (!btn) return;
  const code = btn.closest('.codeblock')?.querySelector('pre code');
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code.textContent);
    btn.textContent = 'Tersalin ✓';
  } catch {
    btn.textContent = 'Gagal';
  }
  setTimeout(() => (btn.textContent = 'Salin'), 1600);
});

for (const btn of document.querySelectorAll('.suggestion')) {
  btn.addEventListener('click', () => {
    els.input.value = btn.dataset.prompt;
    autosize();
    updateSendState();
    sendMessage();
  });
}

$('#new-chat-btn').addEventListener('click', newChat);
$('#open-sidebar-btn').addEventListener('click', () => toggleSidebar(true));
$('#close-sidebar-btn').addEventListener('click', () => toggleSidebar(false));
$('#sidebar-overlay').addEventListener('click', () => toggleSidebar(false));

// ═══════════ Tema ═══════════
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  els.hljsTheme.href = theme === 'dark'
    ? '/vendor/highlightjs/styles/github-dark.min.css'
    : '/vendor/highlightjs/styles/github.min.css';
  $('#theme-icon').textContent = theme === 'dark' ? '🌙' : '☀️';
  $('#theme-label').textContent = theme === 'dark' ? 'Mode Gelap' : 'Mode Terang';
  localStorage.setItem('theme', theme);
}
$('#theme-toggle').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

// ═══════════ Init ═══════════
(async function init() {
  applyTheme(localStorage.getItem('theme') || 'dark');
  if (window.innerWidth <= 768) els.sidebar.classList.add('collapsed');
  await loadModels();
  await loadConversations();
  autosize();
  updateSendState();
  els.input.focus();
})();

// ═══════════ Voice Call (VAD + Groq Whisper + Browser TTS) ═══════════
const voiceCall = {
  active: false,
  stream: null,
  recorder: null,
  audioCtx: null,
  chunks: [],
  silenceTimer: null,
  isSpeaking: false,
  sentenceBuffer: '',
  utteranceQueue: [],
  currentAudio: null,
};

const callEls = {
  btn: $('#voice-call-btn'),
  overlay: $('#call-overlay'),
  orb: $('#call-orb'),
  modelName: $('#call-model-name'),
  status: $('#call-status'),
  transcript: $('#call-transcript'),
  interruptBtn: $('#call-interrupt-btn'),
  endBtn: $('#call-end-btn'),
};

function setCallState(mode, text = '') {
  callEls.orb.className = 'call-orb ' + mode;
  callEls.status.textContent = text;
}

function cleanTextForSpeech(raw) {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/```[\s\(\S\)]*?```/g, ' kode program ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[#*_~>|[\]()]/g, '')
    .replace(/https?:\/\/\S+/g, 'tautan')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectLang(text) {
  const enWords = /\b(the|is|are|was|were|you|your|have|has|with|for|that|this|what|how|can|will|would|could|should|and|but|not)\b/i;
  return enWords.test(text) ? 'en-US' : 'id-ID';
}

function speakWithDeviceTTS(sentence, targetLang) {
  const utter = new SpeechSynthesisUtterance(sentence);
  utter.lang = targetLang;
  utter.rate = 1.05;

  const voices = speechSynthesis.getVoices();
  const matchedVoice =
    voices.find((v) => v.lang.toLowerCase().startsWith(targetLang.slice(0, 2)) && v.name.includes('Natural')) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(targetLang.slice(0, 2))) ||
    voices[0];

  if (matchedVoice) utter.voice = matchedVoice;

  utter.onend = () => speakNextInQueue();
  utter.onerror = () => speakNextInQueue();
  speechSynthesis.speak(utter);
}

async function speakNextInQueue() {
  if (!voiceCall.active) return;
  if (voiceCall.utteranceQueue.length === 0) {
    voiceCall.isSpeaking = false;
    if (!state.streaming) startListening();
    return;
  }

  voiceCall.isSpeaking = true;
  setCallState('speaking', 'AI sedang berbicara...');

  const combinedText = voiceCall.utteranceQueue.splice(0).join(' ');
  const targetLang = detectLang(combinedText);

  if (!state.hasTtsApi) {
    return speakWithDeviceTTS(combinedText, targetLang); 
  }

  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: combinedText, lang: targetLang }),
    });

    if (res.status === 204 || !res.ok) {
      return speakWithDeviceTTS(combinedText, targetLang); 
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    voiceCall.currentAudio = audio;

    audio.onended = () => {
      URL.revokeObjectURL(url);
      voiceCall.currentAudio = null;
      speakNextInQueue();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      voiceCall.currentAudio = null;
      speakWithDeviceTTS(combinedText, targetLang);
    };

    await audio.play();
  } catch {
    speakWithDeviceTTS(combinedText, targetLang); 
  }
}

function enqueueSpeech(text) {
  const clean = cleanTextForSpeech(text);
  if (!clean) return;
  voiceCall.utteranceQueue.push(clean);
  if (!voiceCall.isSpeaking) speakNextInQueue();
}

function feedVoiceStream(delta) {
  voiceCall.sentenceBuffer += delta;
  const parts = voiceCall.sentenceBuffer.split(/([.?!]+|\n+)/);
  while (parts.length > 2) {
    const sentence = parts.shift() + (parts.shift() || '');
    enqueueSpeech(sentence);
  }
  voiceCall.sentenceBuffer = parts.join('');
}

function flushVoiceStream() {
  if (voiceCall.sentenceBuffer.trim()) {
    enqueueSpeech(voiceCall.sentenceBuffer);
    voiceCall.sentenceBuffer = '';
  } else if (!voiceCall.isSpeaking && voiceCall.active) {
    startListening();
  }
}

function stopSpeaking() {
  if (voiceCall.currentAudio) {
    voiceCall.currentAudio.pause();
    voiceCall.currentAudio = null;
  }
  speechSynthesis.cancel();

  voiceCall.utteranceQueue = [];
  voiceCall.sentenceBuffer = '';
  voiceCall.isSpeaking = false;
}

async function startListening() {
  if (!voiceCall.active || voiceCall.isSpeaking || state.streaming) return;
  setCallState('listening', 'Mendengarkan Anda...');
  callEls.transcript.textContent = '';

  voiceCall.chunks = [];
  const recorder = new MediaRecorder(voiceCall.stream, { mimeType: 'audio/webm' });
  voiceCall.recorder = recorder;

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) voiceCall.chunks.push(e.data);
  };

  recorder.onstop = async () => {
    if (!voiceCall.active || voiceCall.chunks.length === 0) return;
    const blob = new Blob(voiceCall.chunks, { type: 'audio/webm' });
    if (blob.size < 2500) return startListening(); // abaikan suara kosong/terlalu pendek

    setCallState('', 'Mengenali suara...');
    const fd = new FormData();
    fd.append('audio', blob, 'voice.webm');

    try {
      const res = await fetch('/api/transcribe', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal transkripsi');

      const text = (data.text || '').trim();
      if (!text) return startListening();

      callEls.transcript.textContent = `"${text}"`;
      setCallState('', 'AI sedang berpikir...');
      els.input.value = text;
      sendMessage();
    } catch (err) {
      toast(err.message, true);
      startListening();
    }
  };

  recorder.start();
  monitorSilence();
}

function monitorSilence() {
  const source = voiceCall.audioCtx.createMediaStreamSource(voiceCall.stream);
  const analyser = voiceCall.audioCtx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);
  let hasSpoken = false;
  let silenceStart = Date.now();

  const check = () => {
    if (!voiceCall.active || voiceCall.recorder?.state !== 'recording') return;
    analyser.getByteFrequencyData(data);
    const volume = data.reduce((a, b) => a + b, 0) / data.length;

    if (volume > 18) { // ambang batas suara bicara
      hasSpoken = true;
      silenceStart = Date.now();
    } else if (hasSpoken && Date.now() - silenceStart > 1500) {
      // Berhenti bicara selama 1.5 detik -> kirim rekaman
      voiceCall.recorder.stop();
      return;
    }
    requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}

async function startVoiceCall() {
  if (!state.model) return toast('Pilih model AI terlebih dahulu.', true);
  try {
    voiceCall.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceCall.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    speechSynthesis.getVoices();

    voiceCall.active = true;
    callEls.modelName.textContent = state.model;
    callEls.overlay.classList.remove('hidden');
    startListening();
  } catch {
    toast('Gagal mengakses mikrofon di Brave. Periksa izin mikrofon.', true);
  }
}

function endVoiceCall() {
  voiceCall.active = false;
  stopSpeaking();
  if (state.streaming) state.abort?.abort();
  if (voiceCall.recorder?.state === 'recording') voiceCall.recorder.stop();
  voiceCall.stream?.getTracks().forEach((t) => t.stop());
  voiceCall.audioCtx?.close();
  callEls.overlay.classList.add('hidden');
}

callEls.btn.addEventListener('click', startVoiceCall);
callEls.endBtn.addEventListener('click', endVoiceCall);
callEls.interruptBtn.addEventListener('click', () => {
  stopSpeaking();
  if (state.streaming) state.abort?.abort();
  startListening();
});
