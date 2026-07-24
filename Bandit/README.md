# Bandit: The AI Prompt Companion

Bandit is a pixel-art raccoon that lives on every webpage. He acts as your AI sidekick, helping you write better prompts, summarize long chats, and providing a fun, interactive desktop-pet experience!

## Features
- **Prompt Enhancement**: Type a rough idea, press `Ctrl+Shift+E`, and Bandit will rewrite it into a professional, structured prompt using Claude, ChatGPT, Gemini, or Groq.
- **Chat Summarization**: Highlight a long chat thread, right click, and Bandit will generate a crisp summary.
- **Virtual Pet Mechanics**: Bandit sleeps, runs around, chases apples (double-click anywhere!), and gains XP as you use him. Level him up to unlock accessories like sunglasses and a wizard hat.
- **Cross-Site Persistence**: Bandit remembers where you left him and his XP levels sync across all your tabs automatically.

## Installation
1. Download or clone this repository.
2. Open Chrome (or any Chromium browser) and go to `chrome://extensions/`.
3. Enable **Developer mode** in the top right.
4. Click **Load unpacked** and select the Bandit directory.
5. Pin Bandit to your toolbar and right-click on any page to interact!

## Checkpoints (Backups)
Bandit features a full local-storage save system. If you want to backup your pet's XP, level, name, and API settings, click on Bandit, open **Settings ⚙️**, and click **Export Backup**. This will save a JSON checkpoint file. You can restore your pet's state anytime using the **Import Backup** button.
