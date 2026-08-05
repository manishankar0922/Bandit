# Privacy Policy for Bandit

**Last Updated:** August 2026

Bandit ("the Extension") is designed with a strict privacy-first philosophy. This Privacy Policy outlines what data is collected, how it is used, and how it is protected.

## 1. Core Principle: 100% Local Storage
**Bandit does not collect, transmit, share, or sell any of your personal data.** 
- All data—including your API keys, chat history, custom prompts, and pet progress (XP/level)—is stored **locally** on your device using the browser's native `storage.local` API.
- We do not run any servers, databases, or analytics tracking. Your data never touches our servers because we don't have any.

## 2. API Communication
When you use Bandit to enhance a prompt or summarize a chat, the Extension communicates **directly** from your browser to the AI provider you have selected (e.g., Anthropic, OpenAI, Google, Groq, or NVIDIA). 
- Your prompts and selected text are sent securely via HTTPS directly to these third-party APIs. 
- Bandit does not intercept, log, or store these requests externally. 
- Please refer to the respective privacy policies of the AI provider you choose to use to understand how they handle data submitted via their API.

## 3. Chrome Built-in AI (Nano)
If you configure Bandit to use the "Built-in Chrome AI" option, all text processing happens entirely **on-device** using your browser's local AI models. In this mode, your prompts never leave your computer.

## 4. Required Permissions
Bandit requests the following browser permissions solely to function:
- **`storage`**: Used exclusively to save your pet's state, API keys, and settings locally on your machine.
- **`contextMenus`**: Allows Bandit to add right-click options like "Summarize Chat".
- **`activeTab` / `scripting`**: Required to read the text you have highlighted or typed so that Bandit can enhance or summarize it, and to inject the pet's UI into the page.

## 5. Changes to This Policy
Because Bandit operates entirely offline/locally, this policy is unlikely to change significantly. If major features are added that require external data access, this policy will be updated and users will be notified via the Extension's changelog.

## 6. Contact
If you have any questions about this Privacy Policy or how Bandit handles your data, please open an issue in the [GitHub Repository](https://github.com/manishankar0922/Bandit).
