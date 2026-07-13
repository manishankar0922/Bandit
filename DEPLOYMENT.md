# 🚀 Rocky — Deployment Guide (pin to pin)

Every step from a working tree to a published extension, for Firefox and Chrome/Edge. Follow top to bottom; nothing here assumes prior store experience.

---

## 0. One-time prerequisites

| Tool | Why | Install |
|---|---|---|
| `zip` | package the extension | usually preinstalled on Linux/macOS |
| Node.js + `web-ext` | lint, run, and sign for Firefox | `npm i -g web-ext` |
| Firefox account | AMO (addons.mozilla.org) listing | https://addons.mozilla.org |
| Google account + $5 one-time fee | Chrome Web Store developer registration | https://chrome.google.com/webstore/devconsole |

---

## 1. Pre-flight checklist (every release)

Run through this in the repo root before packaging **anything**:

- [ ] **Bump the version** in `Bandit/manifest.json` (`"version": "1.1"` — stores reject re-uploads of the same version).
- [ ] **Debug flags off**: no shipped code sets `localStorage.rocky_debug`; grep to be sure:
  ```bash
  grep -rn "rocky_debug" Bandit/ | grep -v "getItem"   # should return nothing
  ```
- [ ] **Syntax-check every file**:
  ```bash
  cd Bandit && for f in *.js ai/*.js; do node --check "$f" || echo "$f FAILED"; done
  python3 -c "import json; json.load(open('manifest.json'))" && echo "manifest OK"
  ```
- [ ] **Manual smoke test** (load temporarily, see §2.1/§3.1): pet renders · drag persists across refresh · Enhance works with your provider · Summarize copies to clipboard · History lists both · Settings save.
- [ ] **No secrets in the tree**: your own API keys live in `chrome.storage.local`, never in code — but check you didn't paste one into a file while testing:
  ```bash
  grep -rnE "sk-ant-|sk-proj-|gsk_" Bandit/ && echo "REMOVE THESE" || echo "clean"
  ```

---

## 2. Firefox

### 2.1 Local test build (temporary add-on)

1. `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → select `Bandit/manifest.json`.
2. Temporary add-ons vanish when Firefox closes — this is for testing only.

### 2.2 Lint before submitting

```bash
cd Bandit
web-ext lint
```
Fix anything flagged as an **error**; warnings about `<all_urls>` are expected (Rocky genuinely runs on every page).

### 2.3 Package

```bash
cd Bandit
zip -r ../rocky-firefox-v1.0.zip . -x "*.DS_Store"
```
The zip must contain `manifest.json` at its **root** (not inside a `Bandit/` folder) — hence zipping from inside the directory.

### 2.4 Submit to AMO

1. https://addons.mozilla.org/developers/ → **Submit a New Add-on**.
2. Choose **On this site** (listed) or **On your own** (self-distributed, still signed).
3. Upload the zip. AMO runs an automatic validation, then a human review (usually days; `<all_urls>` extensions get closer scrutiny).
4. Reviewer notes to include, verbatim:
   > Content script injects a cosmetic pet UI in a closed shadow DOM on all pages. `host_permissions` for api.anthropic.com / api.openai.com / generativelanguage.googleapis.com / api.groq.com are used ONLY from the background script to call the AI provider the user selects, with the user's own API key. No analytics, no remote code, no data leaves the machine except the user-triggered AI request.
5. The `browser_specific_settings.gecko.id` (`rocky@vibecoding.pet`) in the manifest is your stable add-on ID — never change it between versions.

### 2.5 Self-distribution alternative (no store listing)

```bash
web-ext sign --api-key=YOUR_JWT_ISSUER --api-secret=YOUR_JWT_SECRET --channel=unlisted
```
Produces a signed `.xpi` you can host anywhere; users install it by opening the file in Firefox. API credentials come from https://addons.mozilla.org/developers/addon/api/key/.

---

## 3. Chrome / Edge

### 3.1 Switch the manifest background key

Chrome's MV3 ignores `background.scripts` and requires `service_worker`. In `Bandit/manifest.json`, replace:

```json
"background": {
  "scripts": ["storage.js", "ai/providers.js", "background.js"]
}
```

with:

```json
"background": {
  "service_worker": "background.js"
}
```

`background.js` detects either mode at runtime (it calls `importScripts` only when its dependencies aren't already loaded), so **no JS changes are needed** — only this manifest key. Keep the Firefox variant on a branch or restore it after packaging.

> Optional: keep two manifests (`manifest.firefox.json` / `manifest.chrome.json`) and copy the right one to `manifest.json` at package time.

### 3.2 Local test build

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the `Bandit/` folder.
2. Full smoke test again (§1) — the background context differs from Firefox's, so re-test Enhance/Summarize/Test-key specifically.

### 3.3 Package

```bash
cd Bandit
zip -r ../rocky-chrome-v1.0.zip . -x "*.DS_Store"
```

### 3.4 Submit to the Chrome Web Store

1. https://chrome.google.com/webstore/devconsole → **New item** → upload the zip.
2. Fill the listing: description, at least one 1280×800 screenshot, 128×128 icon (**note:** the manifest currently declares no `icons` — add PNGs and an `"icons"` key before store submission, or the listing will use a grey placeholder).
3. **Privacy tab** (this is what reviews hinge on):
   - Single purpose: "desktop pet that rewrites/summarizes prompts on the user's request".
   - Justify each `host_permissions` entry: background-only AI calls with the user's own key.
   - Justify `<all_urls>` content script: the pet is a page overlay by design.
   - Data usage: declare that prompt text is sent to the user's chosen AI provider **only on explicit user action**; nothing else collected.
4. Submit for review (typically 1–3 days; `<all_urls>` can take longer).

### 3.5 Edge (optional)

Edge accepts the same Chrome zip at https://partner.microsoft.com/dashboard/microsoftedge — separate registration, same package.

---

## 4. Post-deploy verification

After the store version goes live, install it on a **clean profile** (no dev copy) and verify:

1. Rocky appears on an ordinary site within a few seconds of page load.
2. Settings → paste key → **Test key** returns ✅.
3. Enhance round-trips on a real AI site (claude.ai or gemini.google.com).
4. Close the browser fully, reopen: XP/level/name/position all survived.
5. `about:debugging` / `chrome://extensions` shows **no errors** on the extension card.

---

## 5. Versioning & rollback

- Version scheme: `MAJOR.MINOR` in the manifest; bump MINOR for features, MAJOR for storage-schema changes (the `mergeDefaults` migration in `storage.js` must keep accepting every shape you've ever shipped).
- **Rollback**: stores don't support instant rollbacks — you re-submit the previous zip with a **higher** version number. Keep every shipped zip in a `releases/` folder (git-tag the matching commit: `git tag v1.0 && git push --tags`).
- Firefox self-distributed `.xpi`s can be swapped instantly since you host them yourself.
