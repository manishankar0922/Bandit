# Bandit Security Guidelines

## Security Policy

Bandit is designed as a local-first, privacy-respecting AI extension. By default, it uses on-device AI (where available) or connects directly from your browser to your chosen AI provider (OpenAI, Anthropic, Gemini, Groq, etc.).

**Zero Middlemen:** Bandit has no backend server, no analytics, and no telemetry. Your prompts and your API keys never leave your browser except to travel directly to the AI provider you configure.

## API Key Safety
- **Local Storage Only:** Bandit explicitly uses `chrome.storage.local` rather than `chrome.storage.sync`. This ensures your API keys stay strictly on your current device and are never synced across the cloud via Google servers in plain text.
- **Never commit your API keys.** If you fork or clone this repository, do not hardcode your keys into the JavaScript files.
- **Backups:** If you use the Bandit settings UI to export a backup of your pet's state (which includes your API keys), the generated `.json` files are automatically ignored by Git (via `.gitignore`). Do not forcefully commit these backups!

## Extension Hardening
Bandit adheres to modern Chrome Manifest V3 security standards:
- **Strict Content Security Policy (CSP):** The extension enforces `script-src 'self'; object-src 'none';` to completely block the execution of inline scripts, `eval()`, or remote code injection.
- **Shadow DOM Isolation:** Bandit's user interface is injected using `attachShadow({ mode: 'closed' })`. This prevents the websites you visit from reading Bandit's internal DOM, state, or intercepting the interactions.
- **Safe HTML Sanitization:** All text rendered inside Bandit's speech bubbles is strictly sanitized through standard text node creation before being displayed, mitigating XSS risks from API provider responses or page scraping.

## Reporting a Vulnerability

If you discover a security vulnerability in Bandit, please **do not** open a public issue. Instead, please email the maintainer directly or reach out via private message. We will ensure the issue is addressed promptly before public disclosure.
