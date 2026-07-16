# Privacy Policy — Bandit (Browser Extension)

**Last updated:** July 16, 2026

Bandit is a browser extension that enhances your prompts and summarizes AI chats. This policy explains what data Bandit accesses, how it's handled, and what gets sent where.

---

## Data Bandit DOES NOT Collect

- ❌ No analytics or telemetry of any kind
- ❌ No tracking cookies, pixels, or fingerprinting
- ❌ No user accounts or registration
- ❌ No data sent to our servers (we don't operate any)
- ❌ No browsing history collection
- ❌ No personal information collection

## Data Stored Locally

Bandit stores the following **only on your device** using `browser.storage.local` (never transmitted anywhere):

| Data | Purpose |
|------|---------|
| Pet name, XP, level | Game state for the desktop pet |
| Position on screen | Remembers where you dragged Bandit |
| AI provider selection | Which AI service you chose (e.g., "anthropic", "gemini") |
| API key(s) | Your own API keys, saved per-provider for failover |
| Model override | Optional model name if you set one |
| Enhance style preference | Your chosen style (Structured/Concise/Detailed) |
| Last 10 results | History of your enhanced prompts and summaries |
| Daily streak counter | Tracks consecutive visit days for XP bonus |

**All of this stays on your machine.** Uninstalling the extension deletes it.

## Data Sent to Third-Party AI Providers

When you trigger **Enhance** or **Summarize**, Bandit sends data to the AI provider **you configured**:

| What is sent | When | To whom |
|-------------|------|---------|
| Your prompt text (the text in the focused text box) | When you trigger Enhance | Your chosen AI provider's API endpoint |
| Visible chat transcript (the page content you can see) | When you trigger Summarize | Your chosen AI provider's API endpoint |
| Your API key | With every AI request | Your chosen AI provider's API endpoint |
| A system instruction (the enhance/summarize prompt template) | With every AI request | Your chosen AI provider's API endpoint |

### Important notes about AI provider requests:

1. **You control which provider receives your data.** Bandit supports Anthropic (Claude), OpenAI, Google Gemini, and Groq. You choose which one(s) to use by providing your own API key.
2. **Requests go directly to the provider's official API endpoint** — never through any intermediary server.
3. **API calls happen only from the extension's background worker** — never from the host page's JavaScript context. This means the host website cannot intercept or observe the request.
4. **No data is cached or logged.** The AI response is displayed/inserted and that's it. Debug mode (opt-in, per-site) logs only the provider name and response time — never prompt text or API keys.
5. **Failover behavior:** If you save keys for multiple providers, Bandit may try a second provider if the first fails. This means your prompt could be sent to more than one provider in a single request cycle. You control this by only saving keys for providers you trust.

### AI Output Disclaimer

**The AI-generated output (enhanced prompts, summaries, and placeholder suggestions) is produced by third-party AI models and may contain:**
- Inaccurate or irrelevant suggestions
- Placeholder questions that don't match your original context
- Errors, hallucinations, or inappropriate content

**Bandit does not guarantee the accuracy, relevance, or quality of any AI-generated output.** The enhanced prompt is a suggestion — always review it before submitting to your AI coding tool. You can undo any enhancement via the right-click menu → ↩️ Undo.

## Page Content Access

Bandit's content script runs on all pages (`<all_urls>`) to:

1. **Render the pet** — injects a shadow DOM container for the raccoon sprite and UI
2. **Read the focused text box** — only when you trigger Enhance, to grab the text to rewrite
3. **Read visible chat content** — only when you trigger Summarize, to scrape the conversation

Bandit **never** reads page content in the background or without your explicit action. There is no passive monitoring, scanning, or data collection.

## Shadow DOM Isolation

Bandit's entire UI lives inside a **closed shadow DOM**. This means:
- Host-page scripts cannot access Bandit's internal elements (including the API key input field in Settings)
- Bandit's styles don't leak into or affect the host page
- The host page cannot read or modify Bandit's state

## Permissions Explained

| Permission | Why |
|-----------|-----|
| `storage` | Save pet state, API keys, and preferences locally |
| `host_permissions: https://api.anthropic.com/*` | Send AI requests to Anthropic Claude |
| `host_permissions: https://api.openai.com/*` | Send AI requests to OpenAI |
| `host_permissions: https://generativelanguage.googleapis.com/*` | Send AI requests to Google Gemini |
| `host_permissions: https://api.groq.com/*` | Send AI requests to Groq |
| `content_scripts: <all_urls>` | Inject the pet onto every page |

## Children's Privacy

Bandit does not knowingly collect any information from children under 13. The extension has no accounts, no data collection, and no server-side storage.

## Changes to This Policy

If this policy changes, the updated version will be published in this repository with a new "Last updated" date.

## Contact

For privacy questions or concerns, open an issue on the [GitHub repository](https://github.com/manishankar0922/Bandit).
