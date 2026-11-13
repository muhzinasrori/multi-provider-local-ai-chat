const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const { config, modelList, findModel, enabledProviders } = require('./config');
const { LOCAL_USER_ID, q } = require('./db');
const { buildParts } = require('./prompt');

const adapters = {
  openai: require('./adapters/openai'),
  gemini: require('./adapters/gemini'),
  mock: require('./adapters/mock'),
};

const app = express();
app.use(express.json({ limit: '2mb' }));

// ── Static: frontend + pustaka vendor + file unggahan ─────────────────────
app.use(express.static(path.join(config.root, 'public')));
app.use(
  '/vendor/markdown-it',
  express.static(path.join(config.root, 'node_modules/markdown-it/dist'))
);
app.use(
  '/vendor/highlightjs',
  express.static(path.join(config.root, 'node_modules/@highlightjs/cdn-assets'))
);
app.use(
  '/vendor/katex',
  express.static(path.join(config.root, 'node_modules/katex/dist'))
);
app.use('/uploads', express.static(config.uploadsDir));

// ── Model & provider (dibaca ulang dari .env tiap request) ────────────────
app.get('/api/models', (_req, res) => {
  res.json({ models: modelList(), providers: enabledProviders().map((p) => p.id) });
});

// ── CRUD percakapan ───────────────────────────────────────────────────────
app.get('/api/conversations', (_req, res) => {
  res.json({ conversations: q.listConversations(LOCAL_USER_ID) });
});

app.post('/api/conversations', (req, res) => {
  const id = q.createConversation(LOCAL_USER_ID, req.body.model || null);
  res.json({ id, title: 'New chat', model: req.body.model || null });
});

app.patch('/api/conversations/:id', (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 120);
  if (!title) return res.status(400).json({ error: 'title required' });
  const changed = q.renameConversation(Number(req.params.id), LOCAL_USER_ID, title);
  res.json({ ok: !!changed });
});

app.delete('/api/conversations/:id', (req, res) => {
  const convId = Number(req.params.id);
  // ambil path lampiran SEBELUM baris terhapus oleh cascade
  const paths = q.attachmentPathsForConversation(convId);
  const changed = q.deleteConversation(convId, LOCAL_USER_ID);
  for (const p of paths) fs.rmSync(path.join(config.root, p), { force: true });
  res.json({ ok: !!changed });
});

app.get('/api/conversations/:id/messages', (req, res) => {
  const conv = q.getConversation(Number(req.params.id), LOCAL_USER_ID);
  if (!conv) return res.status(404).json({ error: 'not found' });
  const messages = q.messages(conv.id);
  const atts = q.attachmentsForMessages(messages.map((m) => m.id));
  const byMsg = {};
  for (const a of atts) (byMsg[a.message_id] ||= []).push(a);
  res.json({
    conversation: conv,
    messages: messages.map((m) => ({
      ...m,
      attachments: (byMsg[m.id] || []).map((a) => ({
        id: a.id,
        filename: a.filename,
        mime: a.mime,
        size: a.size,
        url: `/uploads/${path.basename(a.stored_path)}`,
      })),
    })),
  });
});

// ── Unggah file (disk; SQLite hanya menyimpan path) ──────────────────────
const ALLOWED_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif',
  '.txt', '.pdf', '.json', '.js', '.py', '.csv', '.md',
]);

const storage = multer.diskStorage({
  destination: config.uploadsDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      return cb(new Error(`Jenis file tidak didukung: ${ext || file.originalname}`));
    }
    cb(null, true);
  },
});

app.post('/api/upload', upload.array('files', 10), (req, res) => {
  const out = (req.files || []).map((f) => {
    const id = require('./db').db
      .prepare(`INSERT INTO attachments (filename, stored_path, mime, size) VALUES (?, ?, ?, ?)`)
      .run(f.originalname, path.relative(config.root, f.path).replace(/\\/g, '/'), f.mimetype, f.size)
      .lastInsertRowid;
    return {
      id,
      filename: f.originalname,
      mime: f.mimetype,
      size: f.size,
      url: `/uploads/${path.basename(f.path)}`,
    };
  });
  res.json({ attachments: out });
});

// ── Chat dengan streaming SSE ─────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { content = '', model, attachmentIds = [], regenerate = false } = req.body || {};

  const found = findModel(String(model || ''));
  if (!found) return res.status(400).json({ error: `Model tidak tersedia: ${model}. Periksa API Key di .env.` });
  const { provider, modelId } = found;

  // prepare conversation & pesan user
  let convId = Number(req.body.conversationId) || 0;
  if (convId) {
    if (!q.getConversation(convId, LOCAL_USER_ID)) convId = 0;
  }
  if (!convId) convId = q.createConversation(LOCAL_USER_ID, modelId);

  let userMsgId;
  if (regenerate) {
    const lastUser = q.lastUserMessage(convId);
    if (!lastUser) return res.status(400).json({ error: 'Tidak ada pesan untuk diregenerasi' });
    userMsgId = lastUser.id;
    const old = q.lastAssistantMessage(convId);
    if (old) q.deleteMessage(old.id);
  } else {
    if (!String(content).trim() && !attachmentIds.length) {
      return res.status(400).json({ error: 'Pesan kosong' });
    }
    userMsgId = q.addMessage(convId, 'user', String(content), modelId);
    q.linkAttachments((attachmentIds || []).map(Number).filter(Boolean), convId, userMsgId);
    q.autoTitle(convId, String(content).trim() || 'Pesan dengan lampiran');
  }

  // susun riwayat untuk adapter
  const messages = q.messages(convId);
  const attRows = q.attachmentsForMessages(messages.map((m) => m.id));
  const attByMsg = {};
  for (const a of attRows) (attByMsg[a.message_id] ||= []).push(a);

  const adapterMessages = [];
  if (config.systemPrompt) {
    adapterMessages.push({
      role: 'system',
      parts: [{ type: 'text', text: config.systemPrompt }],
    });
  }
  for (const m of messages) {
    if (regenerate && m.id === userMsgId) continue; // user msg terakhir akan dibangun ulang di bawah
    const parts = await buildParts(m, attByMsg[m.id] || [], provider);
    if (parts.length) adapterMessages.push({ role: m.role, parts });
  }
  if (regenerate) {
    const lastUser = messages.find((m) => m.id === userMsgId);
    const parts = await buildParts(lastUser, attByMsg[userMsgId] || [], provider);
    adapterMessages.push({ role: 'user', parts });
  }
  // pesan user terbaru harus di akhir (saat regenerate, hapus assistant trailing)
  while (adapterMessages.at(-1)?.role === 'assistant') adapterMessages.pop();

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const abort = new AbortController();
  req.on('close', () => abort.abort());

  let full = '';
  const sendEvent = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    await adapters[provider.adapter].streamChat({
      provider,
      model: modelId,
      messages: adapterMessages,
      signal: abort.signal,
      onDelta: (text) => {
        full += text;
        sendEvent({ delta: text });
      },
    });
    const assistantMsgId = q.addMessage(convId, 'assistant', full, modelId);
    q.touchConversation(convId, modelId);
    sendEvent({ done: true, conversationId: convId, messageId: assistantMsgId, userMessageId: userMsgId });
  } catch (err) {
    console.error('[chat]', err);
    sendEvent({ error: err.message || 'Terjadi kesalahan pada provider API' });
    if (full) {
      // simpan sebagian agar riwayat tidak hilang
      const id = q.addMessage(convId, 'assistant', full, modelId);
      sendEvent({ done: true, conversationId: convId, messageId: id });
    }
  }
  res.end();
});

app.listen(config.port, () => {
  const providers = enabledProviders();
  console.log(`✔ AI Chat berjalan di http://localhost:${config.port}`);
  console.log(
    providers.length
      ? `  Provider aktif: ${providers.map((p) => `${p.label} (${p.models.length} model)`).join(', ')}`
      : '  ⚠ Tidak ada API Key aktif. Isi .env (lihat .env.example) atau set MOCK_API=true untuk mode uji.'
  );
});
