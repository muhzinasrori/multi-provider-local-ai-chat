/**
 * Adapter Mock — streaming jawaban contoh tanpa API key luar.
 * Aktif bila MOCK_API=true di .env. Berguna menguji UI (markdown, kode,
 * lampiran, riwayat, SSE) secara lokal.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function streamChat({ messages, onDelta, signal }) {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  const text = last?.parts.find((p) => p.type === 'text')?.text || '';
  const images = (last?.parts || []).filter((p) => p.type === 'image').length;
  const docs = (last?.parts || []).filter((p) => p.type === 'document').length;

  const reply =
`Halo! Ini jawaban **Mock** (mode uji lokal, tanpa API key).

Pesan terakhirmu: \`${text.slice(0, 120) || '(kosong)'}\`
${images ? `🖼️ ${images} gambar diterima (base64 di sisi server). ` : ''}${docs ? `📄 ${docs} dokumen diterima.` : ''}

Contoh fitur render:

1. Tabel

| Model | Provider |
|---|---|
| glm-4.7-flash | Z.AI |
| gemini-2.5-flash | Google |

2. Blok kode dengan tombol salin:

\`\`\`javascript
function greet(name) {
  return \`Hello, \${name}!\`;
}
console.log(greet('dunia'));
\`\`\`

3. Daftar:
   - streaming SSE kata demi kata
   - markdown + syntax highlighting
   - riwayat tersimpan di SQLite

> Isi API Key di file \`.env\` lalu restart server untuk memakai model asli.`;

  for (const token of reply.match(/\S+\s*/g) || []) {
    if (signal?.aborted) return;
    onDelta(token);
    await sleep(25);
  }
}

module.exports = { streamChat };
