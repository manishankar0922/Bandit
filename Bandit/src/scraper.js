// Conversation scraper for summarizing chats.
// Attempts multiple strategies to extract conversation text from popular AI chat UIs.

export function scrapeConversation() {
  const host = window.location.hostname;
  let text = '';
  try {
    if (host.includes('chatgpt.com')) {
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
  // ChatGPT usually has articles with data-message-author-role
  const messages = document.querySelectorAll('article[data-message-author-role]');
  if (messages.length) {
    for (const msg of messages) {
      const role = msg.getAttribute('data-message-author-role');
      const content = msg.querySelector('.markdown, .whitespace-pre-wrap');
      if (role && content) {
        parts.push(`[${role.toUpperCase()}]\n${content.innerText}`);
      }
    }
    return parts.join('\n\n');
  }
  return '';
}

function scrapeClaude() {
  const parts = [];
  // Claude usually uses div.font-user-message and div.font-claude-message
  const userMessages = document.querySelectorAll('.font-user-message');
  const aiMessages = document.querySelectorAll('.font-claude-message');
  
  // They are usually interlaced, but this is a rough approximation if we can't find a single parent
  // A better way is to find a common container, but Claude's DOM changes often.
  // Let's try finding the chat container first.
  const container = document.querySelector('.flex-1.flex.flex-col.gap-3, .flex-1.flex.flex-col.items-center');
  if (container) {
    const children = container.querySelectorAll('.font-user-message, .font-claude-message');
    for (const child of children) {
      const role = child.classList.contains('font-user-message') ? 'USER' : 'CLAUDE';
      parts.push(`[${role}]\n${child.innerText}`);
    }
    return parts.join('\n\n');
  }
  
  return '';
}

function scrapeGemini() {
  const parts = [];
  // Gemini uses custom elements like message-content, query-content
  const queries = document.querySelectorAll('query-content');
  const responses = document.querySelectorAll('message-content');
  
  const allNodes = document.querySelectorAll('query-content, message-content');
  for (const node of allNodes) {
    const role = node.tagName.toLowerCase() === 'query-content' ? 'USER' : 'GEMINI';
    parts.push(`[${role}]\n${node.innerText}`);
  }
  
  return parts.join('\n\n');
}

function scrapeGeneric() {
  // Very rough generic fallback: just grab all paragraphs in the main content area
  const main = document.querySelector('main') || document.body;
  const pText = Array.from(main.querySelectorAll('p'))
    .map(p => p.innerText.trim())
    .filter(t => t.length > 20); // ignore short UI text
  return pText.join('\n\n');
}
