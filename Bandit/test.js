const { JSDOM } = require('jsdom');
const dom = new JSDOM();
global.DOMParser = dom.window.DOMParser;
global.document = dom.window.document;

const html = `<!DOCTYPE html>
<html><body><div class="app"><div id="rocky-root">hi</div></div></body></html>`;

const parser = new DOMParser();
const parsedDoc = parser.parseFromString(html, 'text/html');
const fragment = document.createDocumentFragment();
while (parsedDoc.body.firstChild) {
  fragment.appendChild(parsedDoc.body.firstChild);
}
console.log(fragment.querySelector('#rocky-root'));
