/**
 * Adapter untuk semua penyedia yang memakai API kompatibel OpenAI
 * (Z.AI / Zhipu, OpenAI, dan penyedia lain dengan format sama).
 *
 * provider: { apiKey, baseUrl }
 * messages: [{ role, parts: [{type:'text',text} | {type:'image',mime,base64}] }]
 * onDelta(text) dipanggil untuk tiap potongan token.
 */
async function streamChat({ provider, model, messages, onDelta, signal }) {
  const body = {
    model,
    stream: true,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.parts.map((p) =>
        p.type === 'image'
          ? { type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.base64}` } }
          : { type: 'text', text: p.text }
      ),
    })),
  };

  const res = await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`${provider.label} HTTP ${res.status}: ${errText.slice(0, 500)}`);
  }

  for await (const json of parseSSE(res.body)) {
    if (json === '[DONE]') break;
    try {
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) onDelta(delta);
    } catch {
      /* abaikan chunk tak terparse */
    }
  }
}

/** Yields objek JSON (atau string mentah) untuk tiap baris `data:` pada SSE stream. */
async function* parseSSE(byteStream) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of byteStream) {
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      if (payload === '[DONE]') {
        yield payload;
        return;
      }
      try {
        yield JSON.parse(payload);
      } catch {
        /* baris SSE tidak valid, lewati */
      }
    }
  }
}

module.exports = { streamChat };
