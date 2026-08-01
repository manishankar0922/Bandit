import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

// 1. Generate template.js from HTML and CSS
const html = fs.readFileSync('ui/template.html', 'utf8');
const css = fs.readFileSync('ui/template.css', 'utf8');

const escapeForJs = (str) => str.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');

const templateJs = `export const html = \`${escapeForJs(html)}\`;\nexport const css = \`${escapeForJs(css)}\`;\n`;
fs.writeFileSync('ui/template.js', templateJs);

// 2. Build the Content Script
esbuild.build({
  entryPoints: ['content.js'],
  bundle: true,
  outfile: 'content.bundle.js',
  format: 'iife',
  target: 'es2020',
}).then(() => {
  console.log('Successfully bundled content.js -> content.bundle.js');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});

// 3. Build the Background Script
esbuild.build({
  entryPoints: ['background.js'],
  bundle: true,
  outfile: 'background.bundle.js',
  format: 'esm', // or iife if background service worker supports it better
  target: 'es2020',
}).then(() => {
  console.log('Successfully bundled background.js -> background.bundle.js');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
