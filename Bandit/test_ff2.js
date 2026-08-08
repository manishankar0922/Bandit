const puppeteer = require('puppeteer');
(async () => {
  try {
    const browser = await puppeteer.launch({
      product: 'firefox',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-extensions-except=' + process.cwd() + '/dist/firefox',
        '--load-extension=' + process.cwd() + '/dist/firefox'
      ]
    });
    const page = await browser.newPage();
    page.on('console', msg => console.log('LOG:', msg.text()));
    
    // Inject a script to listen for DOMContentLoaded to see if our script runs
    await page.evaluateOnNewDocument(() => {
      window.addEventListener('DOMContentLoaded', () => {
        console.log("PAGE DOMContentLoaded fired");
      });
    });
    
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    
    // Check if the script object was even injected by the browser
    const state = await page.evaluate(() => {
      return {
        hasShadow: !!window.banditShadowRoot,
        readyState: document.readyState
      };
    });
    console.log("State:", state);
    
    await browser.close();
  } catch (err) {
    console.error(err);
  }
})();
