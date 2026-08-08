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
    await page.goto('https://claude.ai/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    
    // Evaluate if the content script ran
    const didRun = await page.evaluate(() => {
      return !!window.banditShadowRoot;
    });
    console.log("Did run on Claude?:", didRun);
    await browser.close();
  } catch (err) {
    console.error(err);
  }
})();
