// Provider registry for Bandit's AI pipeline.
// Runs inside the background service worker only — API keys never
// touch the host page's JS context.

export const PROVIDERS = {
  anthropic: { endpoint: 'https://api.anthropic.com/v1/messages', auth: 'x-api-key', model: 'claude-3-5-haiku-20241022', format: 'anthropic' },
  openai:    { endpoint: 'https://api.openai.com/v1/chat/completions', auth: 'bearer', model: 'gpt-4o-mini', format: 'openai' },
  gemini:    { endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent', auth: 'query', model: 'gemini-2.0-flash', format: 'gemini' },
  groq:      { endpoint: 'https://api.groq.com/openai/v1/chat/completions', auth: 'bearer', model: 'llama-3.3-70b-versatile', format: 'openai' },
  nvidia:    { endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', auth: 'bearer', model: 'meta/llama3-70b-instruct', format: 'openai' },
};

export function buildRequest(providerId, { apiKey, model, systemPrompt, userText, maxTokens }) {
  const cfg = PROVIDERS[providerId];
  if (!cfg) throw new Error('Unknown AI provider: ' + providerId);

  const useModel = (model && model.trim()) || cfg.model;
  const tokens = maxTokens || 500;

  let url = cfg.endpoint;
  if (cfg.format === 'gemini') {
    url = url.replace('{MODEL}', encodeURIComponent(useModel));
  }

  const headers = { 'content-type': 'application/json' };

  if (cfg.auth === 'x-api-key') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (cfg.auth === 'bearer') {
    headers['authorization'] = 'Bearer ' + apiKey;
  } else if (cfg.auth === 'query') {
    url += (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(apiKey);
  }

  let body;
  if (cfg.format === 'anthropic') {
    body = {
      model: useModel,
      max_tokens: tokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userText }],
      stream: true,
    };
  } else if (cfg.format === 'openai') {
    body = {
      model: useModel,
      max_tokens: tokens,
      max_completion_tokens: tokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
      stream: true,
    };
  } else if (cfg.format === 'gemini') {
    body = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { maxOutputTokens: tokens },
    };
    // Gemini handles streaming via a different endpoint usually (streamGenerateContent)
    if (!url.includes('streamGenerateContent')) {
      url = url.replace('generateContent', 'streamGenerateContent?alt=sse');
    }
  } else {
    throw new Error('Unknown provider format: ' + cfg.format);
  }

  return { url, headers, body };
}

export function parseResponse(providerId, data) {
  const cfg = PROVIDERS[providerId];
  if (!cfg) throw new Error('Unknown AI provider: ' + providerId);
  if (!data || typeof data !== 'object') throw new Error(providerId + ' returned invalid response data');

  if (cfg.format === 'anthropic') {
    const text = (Array.isArray(data.content) ? data.content : [])
      .map(block => (block && block.text) || '').join('').trim();
    if (!text) throw new Error((data.error && data.error.message) || 'Empty response from Anthropic');
    return text;
  }

  if (cfg.format === 'openai') {
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const text = choices[0] && choices[0].message
      ? (choices[0].message.content || '').trim() : '';
    if (!text) throw new Error((data.error && data.error.message) || 'Empty response from provider');
    return text;
  }

  if (cfg.format === 'gemini') {
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    const parts = candidates[0] && candidates[0].content
      ? (Array.isArray(candidates[0].content.parts) ? candidates[0].content.parts : []) : [];
    const text = parts.map(p => (p && p.text) || '').join('').trim();
    if (!text) throw new Error((data.error && data.error.message) || 'Empty response from Gemini');
    return text;
  }

  throw new Error('Unknown provider format: ' + cfg.format);
}

export function parseStreamChunk(providerId, line) {
  if (!line || !line.startsWith('data: ')) return '';
  const dataStr = line.slice(6).trim();
  if (dataStr === '[DONE]') return '';
  
  try {
    const data = JSON.parse(dataStr);
    const cfg = PROVIDERS[providerId];
    
    if (cfg.format === 'openai') {
      const choices = Array.isArray(data.choices) ? data.choices : [];
      if (!choices[0] || !choices[0].delta) return '';
      return choices[0].delta.content || '';
    }
    
    if (cfg.format === 'anthropic') {
      if (data.type === 'content_block_delta' && data.delta && data.delta.text) {
        return data.delta.text;
      }
      return '';
    }
    
    if (cfg.format === 'gemini') {
      const candidates = Array.isArray(data.candidates) ? data.candidates : [];
      const parts = candidates[0] && candidates[0].content && candidates[0].content.parts ? candidates[0].content.parts : [];
      return parts.map(p => (p && p.text) || '').join('');
    }
    
  } catch (err) {
    // Ignore JSON parse errors for incomplete chunks
  }
  return '';
}
