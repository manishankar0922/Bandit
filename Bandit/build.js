const fs = require('fs');
const path = require('path');

console.log('Building Bandit Extension...');

// 1. Generate template code
const html = fs.readFileSync(path.join(__dirname, 'ui/template.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'ui/template.css'), 'utf8');

// Escape backticks and standard JS string escaping
const escapeForJs = (str) => {
  return str.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
};


const scriptOrder = [
  'storage.js',
  'ai/utils.js',
  'ai/prompts.js',
  'ai/pipeline.js',
  '<TEMPLATE>',
  'ui/injector.js',
  'ui/modals.js',
  'ui/popup.js',
  'ui/settings.js',
  'ui/history.js',
  'pet/shared.js',
  'pet/state.js',
  'pet/drag.js',
  'pet/animations.js',
  'pet/ui.js',
  'pet/core.js',
  'content.js'
];

let finalBundle = '(() => {\nconst BanditEnv = {};\n'; // Wrap in IIFE and define shared env
for (const scriptPath of scriptOrder) {
  if (scriptPath === '<TEMPLATE>') {
    finalBundle += `// --- START: ui/template.js (compiled) ---\n`;
    finalBundle += `BanditEnv.BanditTemplate = { html: \`${escapeForJs(html)}\`, css: \`${escapeForJs(css)}\` };\n`;
    finalBundle += `// --- END: ui/template.js ---\n\n`;
  } else {
    finalBundle += `// --- START: ${scriptPath} ---\n`;
    const content = fs.readFileSync(path.join(__dirname, scriptPath), 'utf8');
    finalBundle += content + '\n';
    finalBundle += `// --- END: ${scriptPath} ---\n\n`;
  }
}
finalBundle += '})();\n';

fs.writeFileSync(path.join(__dirname, 'content.bundle.js'), finalBundle);
console.log('Successfully generated content.bundle.js');

try {
  fs.unlinkSync(path.join(__dirname, 'ui/template.js'));
  console.log('Removed old ui/template.js');
} catch(e) {}
