# Bandit Feature Proposal: Prompt Templates Library

## Executive Summary

Add a curated library of 30+ prompt templates across 5 categories to Bandit, allowing users to select a starting-point template, fill in variables, and feed it directly into the existing enhance pipeline. This extends Bandit's core value proposition from "rewrite your prompts" to "give you great prompts to start with."

## Problem Statement

Users of AI tools frequently search for "best prompts for X" because crafting effective prompts from scratch is hard. Bandit currently enhances prompts users write themselves, but doesn't provide starting points. A templates library solves this directly.

## Feature Scope

### Phase 1: Core Templates (MVP)
- 30 curated templates across 5 categories
- Template variable system with `{{placeholders}}`
- Category filter tabs + text search
- One-click "Use Template" feeds into existing enhance pipeline

### Phase 2: Custom Templates
- User-created templates saved to `chrome.storage.local`
- Template editing and deletion UI
- Import/export templates (extends existing backup system)

### Phase 3: Smart Suggestions (Future)
- Template usage analytics
- Context-aware suggestions based on host page

## Categories & Templates

| Category | Count | Examples |
|----------|-------|----------|
| Writing | 8 | Blog intro, email draft, product description, social post, essay outline, headline generator, story prompt, technical docs |
| Coding | 7 | Code review, refactor, debug, explain code, write tests, API docs, algorithm explanation |
| Business | 6 | Meeting agenda, project proposal, SWOT analysis, customer persona, pitch deck, OKR framework |
| Creative | 5 | Character backstory, world building, dialogue scene, poem, song lyrics |
| Learning | 4 | Study guide, concept explanation, flashcard set, quiz questions |

## Template Data Structure

```js
{
  id: 'writing-blog-intro',
  category: 'writing',
  name: 'Blog Post Introduction',
  description: 'Hook readers with a compelling opening',
  template: 'Write a blog introduction about {{topic}} for {{audience}}. Tone: {{tone}}. Length: {{length}} words.',
  variables: ['topic', 'audience', 'tone', 'length'],
  tags: ['blog', 'intro', 'writing']
}
```

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/ui/templates.js` | CREATE | Template data, search/filter, modal rendering, variable form |
| `src/ui/template.html` | MODIFY | Add 🧩 Templates button to toolbar |
| `src/ui/template.css` | MODIFY | Add template modal and card styles |
| `src/content.js` | MODIFY | Import and wire templates button |
| `src/storage.js` | MODIFY | Add `customTemplates: []` to DEFAULTS |

## User Flow

1. User clicks 🧩 Templates button on pet toolbar
2. Modal opens with category tabs (All / Writing / Coding / Business / Creative / Learning)
3. Search bar filters templates by name, description, or tags
4. User clicks a template card
5. Variable input form appears (dynamically generated from template.variables)
6. User fills in variable values
7. User clicks "Use Template"
8. Modal closes, substituted template text appears in enhance textarea
9. User clicks "Enhance" to run through AI pipeline

## Implementation Steps

### Step 1: Create `src/ui/templates.js`
- Export `TEMPLATES` array with 30 curated templates
- Export `showTemplateModal({ onApply, persist, stateObj })` function
- Category filter tabs (click to filter)
- Search input (client-side array filter)
- Variable input form (dynamic based on template.variables)
- "Use Template" button substitutes `{{var}}` placeholders

### Step 2: Modify `src/ui/template.html`
- Add `<button id="templatesBtn" title="Templates">🧩</button>` in toolbar after summarize button

### Step 3: Modify `src/ui/template.css`
- `.templates-modal` — full-screen modal layout with scrollable list
- `.template-category-tabs` — horizontal tab bar
- `.template-card` — card with name, description, tags, use button
- `.template-variables` — variable input form
- `.template-search` — search input styles
- Responsive breakpoints for mobile

### Step 4: Modify `src/content.js`
- Import `showTemplateModal` from `./ui/templates.js`
- Add `templatesBtn` click handler
- Pass `onApply` callback that sets the enhance textarea value

### Step 5: Modify `src/storage.js`
- Add `customTemplates: []` to DEFAULTS object

## Design Decisions

1. **Templates are starting points, not pre-enhanced** — they go through the existing enhance pipeline, keeping architecture simple
2. **No external dependencies** — all template data bundled in JS
3. **Simple variable syntax** — `{{name}}` with string replacement, no templating engine
4. **Client-side search** — array filter, no indexing needed for <100 templates
5. **Custom templates** use same storage pattern as existing state

## Success Metrics

- Template usage rate (templates used / total enhances)
- User retention (do users with templates return more?)
- Template diversity (are all categories used?)
- Custom template creation rate (Phase 2)

## Future Considerations

- Template sharing/export between users
- Community-submitted templates
- AI-generated template suggestions based on usage patterns
- Template versioning (track which versions users prefer)
