require('dotenv').config();
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

const config = {
  root: ROOT,
  port: Number(process.env.PORT) || 3000,
  maxUploadBytes: (Number(process.env.MAX_UPLOAD_MB) || 20) * 1024 * 1024,
  systemPrompt: (process.env.SYSTEM_PROMPT || '').trim(),
  uploadsDir: path.join(ROOT, 'uploads'),
  dataDir: path.join(ROOT, 'data'),
};

for (const dir of [config.uploadsDir, config.dataDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * ── Provider registry ────────────────────────────────────────────────────
 * Setiap provider dideklarasikan di sini. Server membaca .env saat berjalan:
 * provider hanya muncul di frontend bila API Key-nya terisi.
 *
 * Untuk menambah penyedia baru:
 *   1. Tambahkan nama variabel key di .env (mis. DEEPSEEK_API_KEY).
 *   2. Tambahkan entri di array PROVIDERS — pilih adapter 'openai' untuk
 *      endpoint kompatibel OpenAI, atau 'gemini' untuk Google Generative
 *      Language API, atau buat adapter baru di server/adapters/.
 *   3. Daftarkan model-modelnya.
 */
const PROVIDERS = [
  {
    id: 'zai',
    label: 'Z.AI (Zhipu)',
    adapter: 'openai',
    apiKeyEnv: 'ZAI_API_KEY',
    baseUrlEnv: 'ZAI_BASE_URL',
    defaultBaseUrl: 'https://api.z.ai/api/paas/v4',
    models: ['glm-4.7-flash', 'glm-4.6-flash', 'glm-4.5-flash'],
    thinkingModels: ['glm-4.7-flash', 'glm-4.6-flash', 'glm-4.5-flash'],
    vision: true,
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    adapter: 'gemini',
    apiKeyEnv: 'GEMINI_API_KEY',
    baseUrlEnv: 'GEMINI_BASE_URL',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    models: ['gemini-3.8-flash'],
    thinkingModels: ['gemini-3.8-flash'],
    vision: true,
    pdfInline: true, // kirim PDF langsung sebagai inlineData
  },
  {
    id: 'openai',
    label: 'OpenAI',
    adapter: 'openai',
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrlEnv: 'OPENAI_BASE_URL',
    defaultBaseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o'],
    vision: true,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    adapter: 'openai',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    baseUrlEnv: 'DEEPSEEK_BASE_URL',
    defaultBaseUrl: 'https://api.deepseek.com',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    thinkingModels: ['deepseek-chat', 'reasoner'],
    vision: false,
  },
  {
    id: 'ollama',
    label: 'Ollama (Local AI)',
    adapter: 'openai',
    apiKeyEnv: 'OLLAMA_API_KEY',
    baseUrlEnv: 'OLLAMA_BASE_URL',
    defaultBaseUrl: 'http://localhost:11434/v1',
    models: ['qwen3:1.7b', 'qwen2.5:0.5b', 'qwen2.5:1.5b'],
    thinkingModels: ['qwen3:1.7b'],
    vision: false,
  },
  {
    id: 'groq',
    label: 'Groq Cloud',
    adapter: 'openai',
    apiKeyEnv: 'GROQ_API_KEY',
    baseUrlEnv: 'GROQ_BASE_URL',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    models: [
      'openai/gpt-oss-20b',
      'openai/gpt-oss-120b',
      'qwen/qwen3.8-27b',
      'openai/gpt-oss-safeguard-20b'
    ],
    thinkingModels: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b'],
    vision: true,
  },

];

function enabledProviders() {
  const list = PROVIDERS
    .filter((p) => (process.env[p.apiKeyEnv] || '').trim())
    .map((p) => ({
      ...p,
      apiKey: process.env[p.apiKeyEnv].trim(),
      baseUrl: (process.env[p.baseUrlEnv] || '').trim() || p.defaultBaseUrl,
    }));
  if ((process.env.MOCK_API || '').toLowerCase() === 'true') {
    list.unshift({
      id: 'mock',
      label: 'Mock (lokal, tanpa API key)',
      adapter: 'mock',
      apiKey: '',
      baseUrl: '',
      models: ['mock-flash'],
      vision: true,
      pdfInline: false,
    });
  }
  return list;
}

function findModel(modelId) {
  for (const provider of enabledProviders()) {
    if (provider.models.includes(modelId)) return { provider, modelId };
  }
  return null;
}

/** daftar model untuk GET /api/models */
function modelList() {
  return enabledProviders().flatMap((p) =>
    p.models.map((m) => ({
      id: m,
      provider: p.id,
      providerLabel: p.label,
      label: `${m} · ${p.label}`,
      supportsThinking: (p.thinkingModels || []).includes(m),
    }))
  );
}

module.exports = { config, PROVIDERS, enabledProviders, findModel, modelList };
