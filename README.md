<div align="center">

# 🦝 Bandit — AI Prompt Companion & Desktop Pet

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue?style=for-the-badge)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![Firefox Add-on](https://img.shields.io/badge/Firefox-Get_Add--on-FF7139?logo=firefoxbrowser&logoColor=white&style=for-the-badge)](https://addons.mozilla.org/en-US/firefox/addon/bandit/)
[![Chrome / Edge](https://img.shields.io/badge/Chrome%20%2F%20Edge-Coming%20Soon-4285F4?logo=googlechrome&logoColor=white&style=for-the-badge)](#-installation--availability)
[![AI Providers](https://img.shields.io/badge/AI-Nano%20·%20Claude%20·%20OpenAI%20·%20Gemini%20·%20Groq-f5a524?style=for-the-badge)](#-features)
[![No telemetry](https://img.shields.io/badge/telemetry-none-2ea44f?style=for-the-badge)](PRIVACY.md)
[![Version](https://img.shields.io/badge/version-2.3.1-lightgrey?style=for-the-badge)](#)
[![MIT License](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE)

**Feed him trash prompts. He gives back treasure.**

*A pixel-art raccoon that lives in your browser — enhances your AI prompts, summarizes complex chats, and levels up as you use it.*

</div>

---

## The Problem

You type `"create login page please with backedn"` into ChatGPT. You get a generic, incomplete response with missing error handling, no validation, and hardcoded credentials. You spend 20 minutes going back and forth fixing it.

**Bandit fixes this in one keystroke.**

---

## 🚀 See the Difference

<table>
<tr>
<td width="50%">

**❌ What you type (without Bandit):**

```
create login page please with backend
```

</td>
<td width="50%">

**✅ What the AI receives (with Bandit):**

> **Role:** Act as a senior full-stack engineer specializing in authentication systems.
>
> **Objective:** Build a production-ready login page with backend authentication.
>
> **Context:** Web app with clean, minimal styling. No design system specified.
>
> **Rules & Constraints:**
> - Login form with email + password fields, labeled, with client-side validation.
> - Backend auth endpoint that verifies credentials and returns a session/token; wrong credentials show an inline error, never a crash.
> - Loading state on submit (disabled button + spinner); empty-field submission blocked.
> - Responsive layout: usable at 360px and 1440px widths.
> - No hardcoded credentials; config via environment variables.
>
> **Process:** Think step-by-step about the security model before writing code.

</td>
</tr>
</table>

One keystroke. **Ctrl+Shift+E.** That's it.

---

## ✨ Features

| Feature | Description |
|:---|:---|
| 🪄 **Prompt Enhancement** | Rewrites rough ideas into structured, persona-driven prompts using chain-of-thought engineering. Three styles: Structured, Concise, or Detailed. |
| 🖱️ **Universal Context Menu** | Select any text on any webpage → right-click → "Enhance with Bandit ✨" → engineered prompt copied to clipboard. |
| 📋 **Chat Summarization** | Scrapes visible AI chats (ChatGPT, Claude, Gemini) into concise context briefs you can paste into a new conversation. |
| 🛡️ **Smart Input Guard** | Multi-layer validation rejects greetings, single words, profanity, and nonsense — only real prompts get sent to the AI. |
| ⚡ **Instant Speed** | When you have cloud API keys, Bandit skips on-device AI entirely and goes straight to your provider. Sub-second enhancement. |
| 🔒 **BYOK (Bring Your Own Key)** | Use Chrome's free on-device Gemini Nano, or plug in your own keys for Claude, OpenAI, Gemini, or Groq. |
| 🔄 **Automatic Failover** | If your primary provider hits a rate limit, Bandit silently falls back to your next configured provider. |
| 📜 **History & Undo** | Last 10 enhancements saved. One-click copy. Instant undo to restore your original text. |
| 🎮 **Interactive Pet** | Bandit wanders, sleeps, chases apples, does spin tricks, and levels up with visual accessories. |
| 🎓 **Guided Onboarding** | New users get a 3-step walkthrough teaching them exactly what Bandit does and how to use it. |

---

## 📦 Installation & Availability

<table>
<tr>
<td>🦊 <b>Firefox</b></td>
<td><a href="https://addons.mozilla.org/en-US/firefox/addon/bandit/">Download from Mozilla Add-ons Store</a></td>
</tr>
<tr>
<td>🌐 <b>Chrome / Edge</b></td>
<td>Under active development. Coming soon.</td>
</tr>
</table>

---

## 🎮 How to Use Bandit

| Action | What Happens |
|:---|:---|
| **Ctrl+Shift+E** (Cmd+Shift+E on Mac) | Instantly enhance the focused text box. |
| **Double-click Bandit** | Same as above — enhance whatever text box has focus. |
| **Right-click Bandit** | Open the full menu: Enhance, Undo, Summarize, History, Settings. |
| **Select text → Right-click page** | "Enhance with Bandit ✨" copies the enhanced version to clipboard. |
| **Type >7 chars in a text box** | Bandit perks up and offers to enhance. |
| **Drag & Drop** | Move Bandit anywhere. He remembers his spot across sessions. |
| **Double-click empty space** | Drop an apple for Bandit to fetch (+3 XP). |
| **Rub cursor over him** | Pet him (+1 XP, pixel hearts). |
| **Hold-click (600ms)** | He does a spin trick. 30% chance of +2 XP. |
| **Idle 20 seconds** | He falls asleep. Any click wakes him. |

---

## 📈 Leveling System

| Level | XP | Unlock |
|:---:|:---:|:---|
| 1 | 0 | Classic Bandit 🦝 |
| 2 | 20 | 😎 Cool Sunglasses |
| 3 | 50 | 🧣 Cozy Red Scarf |
| 4 | 100 | 👑 Crown — *ALL HAIL THE TRASH KING* |

**XP Sources:** Enhance (+10) · Summarize (+15) · Feed (+5) · Fetch apple (+3) · Petting (+1) · Daily streak (+5) · Spin trick (+2)

---

## 🏗️ Architecture

Zero dependencies. Pure vanilla JavaScript. Every architectural decision prioritizes **security** and **speed**.

```
Bandit/
├── manifest.json        # MV3 config, permissions, cross-browser (Chrome + Firefox)
├── content.js           # Shadow DOM injection — closed mode, host-page isolated
├── script.js            # Pet engine: physics, XP, drag, animations, input validation
├── storage.js           # State persistence + cross-tab sync via chrome.storage
├── background.js        # Service worker: secure API routing, failover chain, retries
├── styles.css           # Vanilla CSS, scoped to shadow root, prefers-reduced-motion
├── index.html           # Settings modal, pet DOM structure, demo page
└── ai/
    ├── pipeline.js      # Smart routing: BYOK-first when keys exist, Nano fallback
    ├── providers.js     # Adapters for Anthropic, OpenAI, Gemini, Groq APIs
    └── prompts.js       # Prompt engineering templates with output quality guards
```

### Key Technical Decisions

| Decision | Rationale |
|:---|:---|
| **Closed Shadow DOM** | Host-page scripts can't access Bandit's DOM — API key input fields are invisible to page JS. |
| **Background-only API calls** | API keys never enter the content script context. The host page has zero access to credentials. |
| **Native setter injection** | Uses `HTMLInputElement.prototype.value.set()` + synthetic events to safely inject text into React/ProseMirror editors without corrupting framework state. |
| **Smart pipeline routing** | If BYOK keys exist, on-device Nano is skipped entirely — saves 5–30 seconds per call. |
| **Multi-layer input validation** | 4-layer filter (single word → fluff/profanity → length → conversational) blocks garbage before it hits the AI. |
| **Per-provider key storage** | Each provider's key is stored independently, enabling automatic failover with a single retry + 800ms backoff. |
| **Debounced persistence** | State writes are batched (300ms debounce) to avoid thrashing `chrome.storage`. Drag positions flush on `pointerup` only. |

---

## 🛡️ Privacy & Security

Security isn't an afterthought — it's the architecture.

| Principle | Implementation |
|:---|:---|
| **Zero telemetry** | No analytics, no tracking, no external servers. We don't operate any infrastructure. |
| **Local-only storage** | API keys and all user data live exclusively in `browser.storage.local`. |
| **Isolated execution** | API requests fire from the background service worker only — never from the host page context. |
| **Closed Shadow DOM** | Host-page scripts cannot reach into Bandit's UI or read the API key input field. |
| **HTML escaping** | All AI outputs and error messages are sanitized via `escapeHTML()` before rendering. |
| **No passive scanning** | Page content is read only when YOU trigger Enhance or Summarize — never in the background. |

> **AI Output Disclaimer:** Enhanced prompts and summaries are generated by third-party AI models. Always review the output before using it.

📄 [Full Privacy Policy](PRIVACY.md)

---

## 🤝 Contributing

This repository is provided for transparency and as an open-source portfolio piece demonstrating production-grade browser extension architecture.

**Please note:** This is maintained as a solo project. Pull requests are not accepted without explicit prior permission. Feel free to fork, explore, and draw inspiration.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

<div align="center">
<br>
<i>Built with ❤️ for better prompting and happier browsing.</i>
<br><br>
<b>© 2026 Manishankar</b>
</div>
