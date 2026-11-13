const fs = require('fs');
const path = require('path');

const TEXT_EXT = new Set(['.txt', '.json', '.js', '.py', '.csv', '.md', '.ts', '.jsx', '.tsx', '.html', '.css', '.yaml', '.yml', '.xml', '.sql']);
const MAX_TEXT_INLINE = 120 * 1024; // 120 KB per file teks

function isImage(att) {
  return att.mime.startsWith('image/');
}
function isTextish(att) {
  return TEXT_EXT.has(path.extname(att.filename).toLowerCase()) || att.mime.startsWith('text/');
}

function readBase64(att) {
  return fs.readFileSync(path.join(require('./config').config.root, att.stored_path)).toString('base64');
}

async function extractPdfText(att) {
  const pdfParse = require('pdf-parse');
  const buf = fs.readFileSync(path.join(require('./config').config.root, att.stored_path));
  const data = await pdfParse(buf);
  return data.text;
}

/**
 * Ubah satu baris pesan (row messages + rows attachments) menjadi parts
 * untuk adapter: teks, gambar base64, dokumen (PDF untuk Gemini), dan
 * isi file teks yang di-inline sebagai fenced block.
 */
async function buildParts(message, attachments, provider) {
  const parts = [];
  if (message.content) parts.push({ type: 'text', text: message.content });

  for (const att of attachments) {
    if (isImage(att)) {
      parts.push({ type: 'image', mime: att.mime, base64: readBase64(att) });
    } else if (att.mime === 'application/pdf') {
      if (provider.pdfInline) {
        parts.push({ type: 'document', mime: att.mime, base64: readBase64(att) });
      } else {
        let text = '';
        try {
          text = await extractPdfText(att);
        } catch {
          text = '(gagal mengekstrak teks PDF)';
        }
        parts.push({ type: 'text', text: `Isi file "${att.filename}" (PDF):\n\n${clip(text)}` });
      }
    } else if (isTextish(att)) {
      let text = '';
      try {
        text = fs.readFileSync(path.join(require('./config').config.root, att.stored_path), 'utf8');
      } catch {
        text = '(gagal membaca file)';
      }
      const lang = path.extname(att.filename).slice(1).toLowerCase();
      parts.push({ type: 'text', text: `File terlampir "${att.filename}":\n\n\`\`\`${lang}\n${clip(text)}\n\`\`\`` });
    } else {
      parts.push({ type: 'text', text: `(Pengguna mengunggah file "${att.filename}" bertipe ${att.mime} yang tidak dapat dibaca sebagai teks.)` });
    }
  }
  return parts;
}

function clip(text) {
  return text.length > MAX_TEXT_INLINE
    ? text.slice(0, MAX_TEXT_INLINE) + '\n… (dipotong)'
    : text;
}

module.exports = { buildParts };
