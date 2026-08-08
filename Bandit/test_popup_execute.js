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
    
    // Open a blank page first
    const page = await browser.newPage();
    await page.goto('https://example.com/', { waitUntil: 'domcontentloaded' });
    
    // Now trigger the extension popup (simulate activeTab and click)
    // In puppeteer Firefox, we can't easily click the action button.
    // Let's just manually trigger a background script to executeScript
    const bgPage = await browser.newPage();
    
    // Find extension ID
    const targets = await browser.targets();
    const extTarget = targets.find(t => t.type() === 'background_page' || t.type() === 'service_worker');
    const extUrl = extTarget ? extTarget.url() : 'none';
    console.log("Ext URL:", extUrl);
    
    await browser.close();
  } catch (err) {
    console.error(err);
  }
})();
