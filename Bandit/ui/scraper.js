(function(root) {
  const SCRAPER_CONFIG = {
    'claude.ai': {
      user: '[data-testid="user-message"]',
      assistant: '.font-claude-message'
    },
    'gemini.google.com': {
      user: 'user-query',
      assistant: 'model-response'
    },
    'chatgpt.com': {
      turnContainer: '[data-message-author-role]'
    },
    'chat.openai.com': {
      turnContainer: '[data-message-author-role]'
    }
  };

  function scrapeConfigured(config) {
    let out = [];
    if (config.turnContainer) {
      const nodes = Array.from(document.querySelectorAll(config.turnContainer));
      if (!nodes.length) return null;
      for (const el of nodes) {
        const role = el.getAttribute('data-message-author-role') === 'user' ? 'user' : 'assistant';
        const text = (el.innerText || el.textContent || '').trim();
        if (text) out.push({ role, text });
      }
      return out.length ? out : null;
    }

    if (config.user && config.assistant) {
      const userNodes = Array.from(document.querySelectorAll(config.user));
      const assistantNodes = Array.from(document.querySelectorAll(config.assistant));
      if (!userNodes.length && !assistantNodes.length) return null;

      const tagged = [
        ...userNodes.map(el => ({ el, role: 'user' })),
        ...assistantNodes.map(el => ({ el, role: 'assistant' })),
      ].sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);

      for (const { el, role } of tagged) {
        const text = (el.innerText || el.textContent || '').trim();
        if (text) out.push({ role, text });
      }
      return out.length ? out : null;
    }
    return null;
  }

  function scrapeGenericFallback() {
    let main = document.querySelector('[role="main"]') || document.querySelector('[role="log"]') || document.querySelector('main') || document.body;
    const text = (main.innerText || main.textContent || '').trim();
    return text ? text.slice(-8000) : '';
  }

  function scrapeConversation() {
    try {
      const host = location.hostname || '';
      let turns = null;
      
      for (const [domain, config] of Object.entries(SCRAPER_CONFIG)) {
        if (host.includes(domain)) {
          turns = scrapeConfigured(config);
          break;
        }
      }

      if (turns && turns.length) {
        const joined = turns.map(t => \`\${t.role.toUpperCase()}: \${t.text}\`).join('\\n\\n');
        return joined.slice(-8000);
      }
    } catch (err) {
      console.warn('Bandit: site-specific scrape failed, falling back to generic', err);
    }

    try {
      return scrapeGenericFallback();
    } catch (err) {
      console.warn('Bandit: generic scrape failed', err);
      return '';
    }
  }

  root.BanditScraper = { scrapeConversation };
})(typeof window !== 'undefined' ? window : globalThis);
