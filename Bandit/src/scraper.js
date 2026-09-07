// Conversation scraper for summarizing chats.
// Attempts multiple strategies to extract conversation text from popular AI chat UIs.

export function scrapeConversation() {
  const host = window.location.hostname;
  let text = '';
  try {
    if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) {
      text = scrapeChatGPT();
    } else if (host.includes('claude.ai')) {
      text = scrapeClaude();
    } else if (host.includes('gemini.google.com')) {
      text = scrapeGemini();
    } else {
      text = scrapeGeneric();
    }
  } catch (err) {
    console.warn('Bandit scraper failed for ' + host, err);
  }
  return text || scrapeGeneric();
}

function scrapeChatGPT() {
  const parts = [];

  // Strategy 1: article elements with data-message-author-role (current as of 2026)
  const articles = document.querySelectorAll('article[data-message-author-role]');
  if (articles.length) {
    for (const msg of articles) {
      const role = msg.getAttribute('data-message-author-role');
      const content = msg.querySelector('.markdown, .whitespace-pre-wrap, .text-message');
      if (role && content) {
        parts.push(`[${role.toUpperCase()}]\n${content.innerText}`);
      }
    }
    return parts.join('\n\n');
  }

  // Strategy 2: div[data-message-author-role] (alternate ChatGPT layout)
  const divMsgs = document.querySelectorAll('div[data-message-author-role]');
  if (divMsgs.length) {
    for (const msg of divMsgs) {
      const role = msg.getAttribute('data-message-author-role');
      parts.push(`[${role.toUpperCase()}]\n${msg.innerText}`);
    }
    return parts.join('\n\n');
  }

  // Strategy 3: conversation turn containers
  const turns = document.querySelectorAll('[data-testid^="conversation-turn-"]');
  if (turns.length) {
    for (const turn of turns) {
      const isUser = turn.querySelector('[data-message-author-role="user"]');
      const role = isUser ? 'USER' : 'ASSISTANT';
      const content = turn.querySelector('.markdown, .whitespace-pre-wrap, .text-message');
      if (content) {
        parts.push(`[${role}]\n${content.innerText}`);
      }
    }
    return parts.join('\n\n');
  }

  return '';
}

function scrapeClaude() {
  const parts = [];
  // Claude usually uses div.font-user-message and div.font-claude-message
  const container = document.querySelector('.flex-1.flex.flex-col.gap-3, .flex-1.flex.flex-col.items-center');
  if (container) {
    const children = container.querySelectorAll('.font-user-message, .font-claude-message');
    for (const child of children) {
      const role = child.classList.contains('font-user-message') ? 'USER' : 'CLAUDE';
      parts.push(`[${role}]\n${child.innerText}`);
    }
    return parts.join('\n\n');
  }

  // Fallback: find user/claude messages anywhere
  const userMsgs = document.querySelectorAll('.font-user-message');
  const claudeMsgs = document.querySelectorAll('.font-claude-message');
  for (const m of userMsgs) parts.push(`[USER]\n${m.innerText}`);
  for (const m of claudeMsgs) parts.push(`[CLAUDE]\n${m.innerText}`);

  return parts.join('\n\n');
}

function scrapeGemini() {
  const parts = [];

  // Strategy 1: model-response and user-query elements (current Gemini DOM)
  const allNodes = document.querySelectorAll('user-query, model-response, query-content, message-content');
  if (allNodes.length) {
    for (const node of allNodes) {
      const tag = node.tagName.toLowerCase();
      const role = (tag === 'user-query' || tag === 'query-content') ? 'USER' : 'GEMINI';
      const text = node.innerText?.trim();
      if (text) parts.push(`[${role}]\n${text}`);
    }
    return parts.join('\n\n');
  }

  // Strategy 2: conversation turn containers
  const turns = document.querySelectorAll('.conversation-container .turn-content, .chat-turn');
  if (turns.length) {
    for (const turn of turns) {
      const isUser = turn.classList.contains('user-turn') || turn.querySelector('.query-content, user-query');
      const role = isUser ? 'USER' : 'GEMINI';
      parts.push(`[${role}]\n${turn.innerText}`);
    }
    return parts.join('\n\n');
  }

  return '';
}

function scrapeGeneric() {
  // Very rough generic fallback: just grab all paragraphs in the main content area
  const main = document.querySelector('main') || document.body;
  const pText = Array.from(main.querySelectorAll('p'))
    .map(p => p.innerText.trim())
    .filter(t => t.length > 20); // ignore short UI text
  return pText.join('\n\n');
}
