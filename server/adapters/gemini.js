/**
 * Adapter Google Gemini (Generative Language API resmi).
 * Streaming: :streamGenerateContent?alt=sse
 * Gambar/PDF dikirim sebagai inlineData base64.
 */
async function streamChat({ provider, model, messages, onDelta, onThinking, signal, thinking = false }) {
  const systemText = messages.find((m) => m.role === 'system')?.parts.map((p) => p.text).join('\n');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: m.parts.map((p) =>
        p.type === 'image' || p.type === 'document'
          ? { inlineData: { mimeType: p.mime, data: p.base64 } }
          : { text: p.text }
      ),
    }));

  const url =
    `${provider.baseUrl.replace(/\/+$/, '')}/v1beta/models/${encodeURIComponent(model)}` +
    `:streamGenerateContent?alt=sse&key=${encodeURIComponent(provider.apiKey)}`;

  const isSupported = (provider.thinkingModels || []).includes(model);
  const isGemini3OrNewer = /^gemini-[34]/.test(model);

  // Konfigurasi thinking sesuai versi model Gemini
  let thinkingConfig;
  if (isSupported) {
    if (isGemini3OrNewer) {
      thinkingConfig = {
        thinkingLevel: thinking ? 'HIGH' : 'LOW',
        includeThoughts: thinking,
      };
    } else {
      thinkingConfig = {
        thinkingBudget: thinking ? 8192 : 0,
        includeThoughts: thinking,
      };
    }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
      ...(thinkingConfig ? { generationConfig: { thinkingConfig } } : {}),
    }),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`${provider.label} HTTP ${res.status}: ${errText.slice(0, 500)}`);
  }

  for await (const json of parseSSE(res.body)) {
    const parts = json.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (!part.text) continue;
      if (part.thought) {
        if (onThinking) onThinking(part.text);
      } else {
        onDelta(part.text);
      }
    }
  }
}

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
      try {
        yield JSON.parse(line.slice(5).trim());
      } catch {
        /* lewati */
      }
    }
  }
}

module.exports = { streamChat };
