(function() {
  const sendBtn = document.getElementById('sendBtn');
  const input = document.getElementById('promptInput'); // assuming this exists in demo
  const messages = document.getElementById('messages');
  const hint = document.getElementById('hint');

  if (sendBtn) sendBtn.addEventListener('click', () => {
    // Just the fake demo logic from the original script
    if (!input) return;
    const v = input.value.trim(); if (!v) return;

    const m = document.createElement('div');
    m.className = 'msg you' + (v.startsWith('GOAL') ? ' enhanced' : '');
    m.replaceChildren(...new DOMParser().parseFromString('<div class="who">' + (v.startsWith('GOAL') ? 'You · enhanced by Bandit' : 'You') + '</div>' + v.replace(/</g, '&lt;'), 'text/html').body.childNodes);
    if (messages) messages.appendChild(m);

    input.value = ''; input.style.height = 'auto';
    if (hint) hint.textContent = 'Bandit watches this box 👀';

    // Instead of directly calling stopRun() / setState() from engine.js,
    // we would dispatch events, but for demo.js we just mock the DOM update
    // as it's just for demo.
    
    if (!messages) return;
    const aiMsg = document.createElement('div');
    aiMsg.className = 'msg ai';
    aiMsg.replaceChildren(...new DOMParser().parseFromString('<div class="who">VibeBuild AI</div><span class="stream"></span><span class="cursor">█</span>', 'text/html').body.childNodes);
    messages.appendChild(aiMsg);
    messages.scrollTop = messages.scrollHeight;

    const streamTarget = aiMsg.querySelector('.stream');
    const cursor = aiMsg.querySelector('.cursor');

    const fakeCode = `I've updated the components according to your prompt.
Here is the generated output:

\`\`\`javascript
export default function App() {
  return (
    <div className="flex h-screen bg-neutral-900 text-white">
      <h1 className="m-auto text-4xl font-bold">Hello World</h1>
    </div>
  );
}
\`\`\`

Let me know if you need any adjustments!`;

    let i = 0;
    const interval = setInterval(() => {
      streamTarget.textContent += fakeCode[i];
      messages.scrollTop = messages.scrollHeight;
      i++;
      if (i >= fakeCode.length) {
        clearInterval(interval);
        cursor.remove();
      }
    }, 25);
  });
})();
