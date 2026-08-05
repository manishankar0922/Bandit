# 🦝 Bandit: The AI Prompt Companion

**Bandit** is an interactive, pixel-art raccoon that lives right on your webpages. He acts as your personal AI sidekick, helping you write better prompts, summarize long chats, and providing a fun, gamified desktop-pet experience!

## ✨ Features

- **🪄 Prompt Enhancement**: Type a rough idea, press `Ctrl+Shift+E`, and Bandit will rewrite it into a professional, structured prompt using the AI model of your choice.
- **📋 Chat Summarization**: Highlight a long chat thread, right-click, and Bandit will instantly generate a crisp summary.
- **🎮 Virtual Pet Mechanics**: Bandit sleeps, runs around, chases apples (double-click anywhere!), and gains XP as you use him. Level him up to unlock cool accessories like sunglasses and a crown!
- **💾 Cross-Site Persistence**: Bandit remembers where you left him. His position, XP, and settings sync across all your tabs seamlessly.
- **🔒 Privacy First**: Bandit uses a 100% local-storage architecture. Your data never touches our servers. Read more in our [Privacy Policy](PRIVACY.md).

## 🚀 Installation & Testing

1. Download or clone this repository.
2. For a quick local demo, simply open `index.html` in your browser. *(Note: The local demo runs in a sandbox mode with mock AI responses to demonstrate the UI).*

### 🛠️ Installing the Extension (Developer Mode)

1. Run `npm install` and `npm run build` to generate the compiled extension bundles.
2. **For Firefox**: 
   - Go to `about:debugging` -> **This Firefox**
   - Click **Load Temporary Add-on** and select `dist/firefox/manifest.json`.
3. **For Chrome**: 
   - Go to `chrome://extensions/` and enable **Developer Mode**.
   - Click **Load unpacked** and select the `dist/chrome` directory.
4. Pin Bandit to your browser toolbar and right-click on any page to interact!

## ⚙️ Development & Architecture

Bandit uses a modern module architecture compiled via `esbuild`. 
- **Source Code**: All extension logic lives inside the `src/` directory.
- **Building**: If you modify any files in `src/`, you must rebuild the extension. Run `npm run build` to bundle everything into the `dist/` folders.
- **Note**: Do not edit the compiled bundle files directly.

## 💾 Backups & Checkpoints

Bandit features a robust local-storage save system. If you want to backup your pet's XP, level, name, and API configurations:
1. Double-click Bandit to open his radial menu.
2. Click the **Settings ⚙️** icon.
3. Scroll to the bottom and click **Export Backup**. This will download a `.json` checkpoint file.
4. You can restore your pet's state anytime across browsers using the **Import Backup** button!
