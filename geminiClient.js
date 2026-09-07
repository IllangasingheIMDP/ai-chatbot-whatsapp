const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
  }
}

async function apiFetch(path, apiKey, options = {}) {
  const separator = path.includes('?') ? '&' : '?';
  const url = `${BASE_URL}${path}${separator}key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GeminiError(`Gemini API error ${res.status}: ${body.slice(0, 300)}`, res.status);
  }
  return res.json();
}

/**
 * Fetches the live list of models this key can use with generateContent.
 * We deliberately don't hardcode model names, since Google ships new ones
 * and retires old ones over time.
 */
export async function listGenerativeModels(apiKey) {
  const data = await apiFetch('/models', apiKey);
  return (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => ({
      name: m.name.replace(/^models\//, ''),
      displayName: m.displayName || m.name,
    }));
}

export async function validateApiKey(apiKey) {
  try {
    const models = await listGenerativeModels(apiKey);
    return { valid: models.length > 0, models };
  } catch (err) {
    return { valid: false, models: [], error: err.message };
  }
}

/**
 * history: array of { role: 'user'|'model', parts: [...] } from prior turns.
 * newParts: parts for the current turn (text and/or inlineData).
 */
export async function generateReply({ apiKey, model, history, newParts }) {
  const contents = [...history, { role: 'user', parts: newParts }];
  const data = await apiFetch(`/models/${encodeURIComponent(model)}:generateContent`, apiKey, {
    method: 'POST',
    body: JSON.stringify({ contents }),
  });
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts || [])
    .map((p) => p.text || '')
    .join('')
    .trim();
  if (!text) {
    const reason = candidate?.finishReason || 'unknown';
    throw new GeminiError(`Gemini returned no text (finishReason: ${reason})`);
  }
  return text;
}
