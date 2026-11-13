const path = require('path');
const Database = require('better-sqlite3');
const { config } = require('./config');

const db = new Database(path.join(config.dataDir, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  title      TEXT NOT NULL DEFAULT 'New chat',
  model      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT NOT NULL DEFAULT '',
  model           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attachments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
  message_id      INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  filename        TEXT NOT NULL,
  stored_path     TEXT NOT NULL,               -- path file di disk, BUKAN base64
  mime            TEXT NOT NULL,
  size            INTEGER NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_conv  ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_attachments_md ON attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_convs_user     ON conversations(user_id, updated_at DESC);
`);

// Akun lokal default — identitas penyimpanan riwayat.
db.prepare("INSERT OR IGNORE INTO users (username) VALUES ('local')").run();
const LOCAL_USER_ID = db.prepare("SELECT id FROM users WHERE username = 'local'").get().id;

const q = {
  listConversations: (userId) =>
    db.prepare(`SELECT id, title, model, created_at, updated_at FROM conversations
                WHERE user_id = ? ORDER BY updated_at DESC`).all(userId),

  getConversation: (id, userId) =>
    db.prepare('SELECT id, title, model FROM conversations WHERE id = ? AND user_id = ?').get(id, userId),

  createConversation: (userId, model) =>
    db.prepare(`INSERT INTO conversations (user_id, title, model) VALUES (?, 'New chat', ?)`).run(userId, model).lastInsertRowid,

  renameConversation: (id, userId, title) =>
    db.prepare(`UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
      .run(title, id, userId).changes,

  touchConversation: (id, model) =>
    db.prepare(`UPDATE conversations SET updated_at = datetime('now'), model = COALESCE(?, model) WHERE id = ?`)
      .run(model, id),

  autoTitle: (id, title) =>
    db.prepare(`UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ? AND title = 'New chat'`)
      .run(title.slice(0, 60), id),

  deleteConversation: (id, userId) =>
    db.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').run(id, userId).changes,

  addMessage: (convId, role, content, model) =>
    db.prepare(`INSERT INTO messages (conversation_id, role, content, model) VALUES (?, ?, ?, ?)`)
      .run(convId, role, content, model).lastInsertRowid,

  messages: (convId) =>
    db.prepare(`SELECT id, role, content, model, created_at FROM messages
                WHERE conversation_id = ? ORDER BY id ASC`).all(convId),

  lastAssistantMessage: (convId) =>
    db.prepare(`SELECT id FROM messages WHERE conversation_id = ? AND role = 'assistant'
                ORDER BY id DESC LIMIT 1`).get(convId),

  lastUserMessage: (convId) =>
    db.prepare(`SELECT id, content FROM messages WHERE conversation_id = ? AND role = 'user'
                ORDER BY id DESC LIMIT 1`).get(convId),

  deleteMessage: (id) => db.prepare('DELETE FROM messages WHERE id = ?').run(id),

  linkAttachments: (ids, convId, msgId) => {
    if (!ids.length) return;
    const ph = ids.map(() => '?').join(',');
    db.prepare(`UPDATE attachments SET conversation_id = ?, message_id = ? WHERE id IN (${ph})`)
      .run(convId, msgId, ...ids);
  },

  attachmentsForMessages: (ids) => {
    if (!ids.length) return [];
    const ph = ids.map(() => '?').join(',');
    return db.prepare(`SELECT id, message_id, filename, stored_path, mime, size
                       FROM attachments WHERE message_id IN (${ph}) ORDER BY id ASC`).all(...ids);
  },

  attachmentById: (id) =>
    db.prepare('SELECT id, filename, stored_path, mime, size FROM attachments WHERE id = ?').get(id),

  attachmentPathsForConversation: (convId) =>
    db.prepare('SELECT stored_path FROM attachments WHERE conversation_id = ?').all(convId)
      .map((r) => r.stored_path),
};

module.exports = { db, LOCAL_USER_ID, q };
