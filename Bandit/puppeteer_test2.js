const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  
  await page.goto('https://example.com');
  
  // Inject the bundle
  await page.addScriptTag({ path: '/home/mohan/GoodStuf/Bandit/Bandit/content.bundle.js' });
  
  // Wait a bit to see if anything happens
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Check if shadow root exists
  const hasShadow = await page.evaluate(() => {
    return !!window.rockyShadowRoot;
  });
  console.log('Has shadow root:', hasShadow);
  
  // Also see if rocky-root is actually appended
  const rockyFound = await page.evaluate(() => {
    return !!(window.rockyShadowRoot && window.rockyShadowRoot.querySelector('#rocky-root'));
  });
  console.log('rocky-root found in shadow:', rockyFound);
  
  await browser.close();
})();
