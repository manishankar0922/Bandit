// Detect AI provider from the API key prefix.
export function detectProviderFromKey(apiKey) {
  const key = (apiKey || '').trim();
  if (!key) return null;
  if (key.startsWith('sk-ant-')) return 'anthropic';
  if (key.startsWith('gsk_')) return 'groq';
  if (key.startsWith('nvapi-')) return 'nvidia';
  if (key.startsWith('sk-proj-') || key.startsWith('sk-')) return 'openai';
  return 'gemini';
}
