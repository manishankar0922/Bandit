<div align="center">

# 🦝 Bandit — AI Prompt Companion & Desktop Pet

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue?style=for-the-badge)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json)
[![Firefox First](https://img.shields.io/badge/Firefox-Target_1st-FF7139?logo=firefoxbrowser&logoColor=white&style=for-the-badge)](#-firefox-first-quick-start)
[![Chrome / Chromium](https://img.shields.io/badge/Chromium-Supported-4285F4?logo=googlechrome&logoColor=white&style=for-the-badge)](#-chromium-installation)
[![Prompt Templates](https://img.shields.io/badge/Templates-30_Curated-f5a524?style=for-the-badge)](#-prompt-templates-library)
[![No Telemetry](https://img.shields.io/badge/telemetry-none-2ea44f?style=for-the-badge)](PRIVACY.md)
[![Version](https://img.shields.io/badge/version-6.0.0-lightgrey?style=for-the-badge)](#)
[![MIT License](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE)

**Feed him rough prompts. He gives back engineered treasure.**

*A pixel-art raccoon pet that lives in your browser — writes prompt templates, enhances your rough ideas with chain-of-thought engineering, summarizes long conversations, and levels up as you use it.*

</div>

---

## 💡 The Problem

You type `"create login page please with backedn"` into ChatGPT or Claude. You get a generic, incomplete snippet with missing error handling, no input validation, and hardcoded credentials. You spend 20 minutes going back and forth fixing it.

**Bandit fixes this in one click or hotkey.**

---

## 🚀 See the Difference

<table>
<tr>
<td width="50%">

### ❌ What you type (without Bandit):

```
create login page please with backend
```

</td>
<td width="50%">

### ✅ What the AI receives (with Bandit):

> **Role:** Act as a senior full-stack engineer specializing in authentication systems.
>
> **Objective:** Build a production-ready login page with backend authentication.
>
> **Context:** Web app with clean, accessible styling and modern security practices.
>
> **Requirements & Constraints:**
> - Responsive form with email + password inputs, accessible labels, and client-side validation.
> - Secure backend auth endpoint that verifies credentials and returns a session token.
> - Inline error alerts on invalid credentials; never leak stack traces or crash.
> - Loading state on submit (disabled button + spinner); empty-field submission blocked.
> - Zero hardcoded secrets; configuration handled via environment variables.
>
> **Process:** Think step-by-step through the threat model before providing code.

</td>
</tr>
</table>

One keystroke: **`Ctrl+Shift+E`** (or **`Cmd+Shift+E`** on macOS).

---

## 🦊 Firefox-First Quick Start (60 Seconds)

Bandit is engineered **Firefox-first** to ensure standard Manifest V3 compliance, native dark scrollbars, and zero browser permission bloat.

### Run in Firefox:
1. Open **Firefox**.
2. In your address bar, type `about:debugging#/runtime/this-firefox` and press **Enter**.
3. Click the button labeled **"Load Temporary Add-on…"**.
4. In the file picker, select:
   ```
   Bandit/dist/firefox/manifest.json
   ```
5. **Done!** Open any website (like [ChatGPT](https://chatgpt.com), [Claude](https://claude.ai), or [Gemini](https://gemini.google.com)). Bandit will appear in the bottom-right corner, ready to assist!

---

## 🌐 Chromium Installation (Chrome, Brave, Edge)

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Toggle on **Developer mode** in the top-right corner.
3. Click **"Load unpacked"**.
4. Select the directory:
   ```
   Bandit/dist/chrome/
   ```

---

## 🧩 Prompt Templates Library

Never stare at a blank prompt box again. Bandit features a built-in library of **30 curated prompt templates** organized across 5 categories, complete with an interactive fill-in-the-blanks runner.

```
+-------------------------------------------------------------+
| 🧩 Prompt Templates                                      ✕  |
| Pick a starting prompt, fill in the blanks, and enhance!    |
+-------------------------------------------------------------+
| [🔍 Search templates (e.g. blog, code, email, essay)...   ] |
+-------------------------------------------------------------+
| (🌟 All: 30) (✍️ Writing: 8) (💻 Coding: 7) (💼 Business: 6)...|
+-------------------------------------------------------------+
| ┌─────────────────────────────────────────────────────────┐ |
| │ ✍️ WRITING                                               │ |
| │ Professional Business Email                             │ |
| │ Draft a polite, concise, and persuasive email.          │ |
| │ ⚡ 4 fill-in blanks                                      │ |
| └─────────────────────────────────────────────────────────┘ |
+-------------------------------------------------------------+
```

### Template Categories:
- **✍️ Writing (8 templates):** Catchy Blog Intro, Professional Business Email, Product Copy & Benefits, Viral Social Post, Newsletter Opening Hook, Persuasive Op-Ed Essay, Book/Article Summary, Tailored Cover Letter.
- **💻 Coding (7 templates):** Systematic Bug Debugger, Code Refactoring & Architecture, Unit Test Generator, SQL Query Builder, API Design Specification, Regex Explainer & Builder, Comprehensive Documentation.
- **💼 Business (6 templates):** Pitch Deck Elevator Pitch, Executive Meeting Summary, Competitor SWOT Analysis, Customer Support De-escalation, High-Clarity Job Description, Team OKRs & Key Results.
- **🎨 Creative (5 templates):** Midjourney & DALL-E Image Prompt, Fantasy World-Building, YouTube Script Hook, Brand Taglines & Slogans, Dialogue Punch-Up.
- **🎓 Learning (4 templates):** Feynman Technique Simplifier, Study Flashcard Q&As, Counter-Argument Critique, Comprehensive Learning Syllabus.

### Interactive Fill-in-the-Blanks Runner:
- **Live Monospace Preview:** Automatically updates in real-time as you fill in each blank.
- **Dummy-Proof Fallbacks:** Left a field blank? Bandit automatically inserts sensible default placeholders so you never send broken formatting.
- **🚀 1-Click "Insert & Enhance ✨":** Injects your prompt into your current chat box and immediately triggers Bandit's AI enhancement.
- **📝 "Just Insert":** Injects the prompt directly into the chat input without enhancing (+2 XP for Bandit).
- **📋 "Copy":** Copies the prompt directly to your clipboard.
- **⭐ Custom Templates:** Create and save your own templates using `{{variableName}}` tags. Saved locally and included in your JSON settings backups.

---

## 🎮 Controls & Shortcuts

| Action | Shortcut / Trigger | Description |
|:---|:---|:---|
| **✨ Enhance Prompt** | `Ctrl+Shift+E` (or `Cmd+Shift+E`) | Rewrites the prompt in your focused text box into a structured powerhouse. |
| **🧩 Open Templates** | `Alt+Shift+T` | Opens the 30-template library and fill-in-the-blanks runner. |
| **🐾 Open Pet Menu** | **Click Bandit** | Opens the 9-item radial fan: Enhance, Templates, Summarize, Undo, Feed, History, Settings, Home, Disable. |
| **↩️ Undo Enhancement** | Radial Menu → `↩️ Undo` | Restores whatever text was in your input box before the last enhancement. |
| **📋 Summarize Chat** | Radial Menu → `📋 Summarize` | Scrapes visible conversation transcripts into a compact brief. |
| **🖱️ Context Menu** | **Right-click page** | Select text or right-click any page to Enhance, open Templates, or Summarize via browser context menu. |
| **🍪 Feed Bandit** | Radial Menu → `🍪 Feed` | Feed Bandit a cookie (+5 XP, happy animation). |
| **🍎 Fetch Apple** | **Double-click page background** | Toss an apple for Bandit to fetch (+3 XP). |
| **❤️ Pet Bandit** | **Hover cursor over Bandit** | Pet him to generate hearts (+1 XP). |
| **🌀 Spin Trick** | **Hold-click Bandit (600ms)** | Bandit executes a spin trick (chance of +2 XP). |
| **📍 Drag & Reposition** | **Click & Drag** | Move Bandit anywhere on your screen. Remembers his coordinates across tabs. |

---

## 📈 Pet Leveling System

Bandit gains experience points (XP) as you use him to prompt and write:

| Level | XP Required | Accessory Unlocked |
|:---:|:---:|:---|
| **1** | 0 XP | Classic Bandit 🦝 |
| **2** | 20 XP | 😎 Cool Sunglasses |
| **3** | 50 XP | 🧣 Cozy Red Scarf |
| **4** | 100 XP | 👑 Royal Crown — *King of Prompting* |

*XP Rewards:* Prompt Enhancement (+10) · Summarization (+15) · Cookie Treat (+5) · Apple Fetch (+3) · Petting (+1) · Daily Streak Bonus (+5).

---

## 🔒 Bring Your Own Key (BYOK) & Privacy

Bandit is **100% serverless and private**:
- **Zero middleman servers:** API requests are dispatched directly from your browser's background worker to the official provider endpoint.
- **Zero telemetry:** No analytics, no tracking pixels, no remote logs.
- **Closed Shadow DOM:** Host page scripts cannot access Bandit's internal elements or inspect your API keys.
- **Supported Providers:**
  - **Anthropic Claude** (Claude 3.5 Sonnet / Haiku)
  - **OpenAI** (GPT-4o, GPT-4o-mini)
  - **Google Gemini** (Gemini 2.0 Flash, Gemini 1.5 Pro)
  - **Groq** (Llama 3.3, ultra-fast & free tier available)
  - **NVIDIA NIM** (Llama 3.1, free tier available)
  - **Built-in Browser AI** (Works out of the box with zero keys needed)

📄 Read the full [Privacy Policy](PRIVACY.md) and [Terms and Conditions](TERMS.md).

---

## 🛠️ Development & Building

Bandit is written in pure vanilla JavaScript with zero runtime frameworks.

### Build from source:
```bash
# Clone the repository
git clone https://github.com/manishankar0922/Bandit.git
cd Bandit

# Install dev dependencies (esbuild)
npm install

# Build for both Firefox and Chrome:
npm run build

# Or build specifically for Firefox:
npm run build:firefox

# Or specifically for Chrome:
npm run build:chrome
```

Generated bundles will be in:
- `dist/firefox/` (Target 1: Ready to load via `about:debugging`)
- `dist/chrome/` (Target 2: Ready to load via `chrome://extensions`)

---

## ❓ FAQ & Troubleshooting

<details>
<summary><b>Q: Do I need a paid API key to use Bandit?</b></summary>
No! You can use Groq or Google Gemini API keys which both offer generous free tiers. You can also use the built-in browser AI mode with zero keys.
</details>

<details>
<summary><b>Q: How do I hide Bandit on a specific website?</b></summary>
Click Bandit, select <code>🚫 Disable</code> on the radial menu, or click Bandit's icon in your browser toolbar and toggle off "Active on this site". To re-enable, click the toolbar icon and toggle it back on.
</details>

<details>
<summary><b>Q: Can websites read my API keys?</b></summary>
No. Bandit's UI is contained inside a closed Shadow DOM, and API calls are executed strictly from the background extension worker. The webpage's JavaScript cannot read your keys.
</details>

<details>
<summary><b>Q: How do I move my settings and pet level to a new computer?</b></summary>
Open Bandit Settings (click Bandit → ⚙️ Settings), click <code>💾 Export Backup</code>, and save the JSON file. On your new browser, click <code>📂 Import Backup</code> and your pet name, level, XP, custom templates, and keys will restore instantly!
</details>

---

## 📄 License & Terms

- **License:** [MIT License](LICENSE)
- **Privacy Policy:** [PRIVACY.md](PRIVACY.md)
- **Terms and Conditions:** [TERMS.md](TERMS.md)

<div align="center">
<br>
<i>Built with ❤️ for cleaner prompts, happier browsing, and delightful companion workflows.</i>
<br><br>
<b>© 2026 Manishankar</b>
</div>
