const puppeteer = require('puppeteer');
(async () => {
  try {
    const browser = await puppeteer.launch({
      product: 'firefox',
      headless: true
    });
    const page = await browser.newPage();
    page.on('console', msg => {
      console.log('BROWSER LOG:', msg.text());
    });
    page.on('pageerror', err => {
      console.log('BROWSER ERR:', err.message);
    });
    
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    
    const cspTest = await page.evaluate(() => {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync('body { color: red; }');
        return "SUCCESS";
      } catch(err) {
        return "ERROR: " + err.message;
      }
    });
    console.log("replaceSync result:", cspTest);
    
    await browser.close();
  } catch (err) {
    console.error(err);
  }
})();
