const fs = require('fs');

const sharedContent = fs.readFileSync('pet/shared.js', 'utf8');
const varRegex = /var\s+([^;]+);/g;
let match;
const globalVars = new Set();
while ((match = varRegex.exec(sharedContent)) !== null) {
  const vars = match[1].split(',').map(s => s.trim());
  for (const v of vars) {
    if (v) globalVars.add(v);
  }
}

const files = ['pet/animations.js', 'pet/drag.js', 'pet/ui.js'];
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  for (const g of globalVars) {
    const regex = new RegExp(`^(\\s*)function\\s+${g}\\s*\\(`, 'gm');
    content = content.replace(regex, `$1${g} = function(`);
  }
  fs.writeFileSync(file, content);
  console.log(`Processed ${file}`);
}
