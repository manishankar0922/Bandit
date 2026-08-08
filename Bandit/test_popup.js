const puppeteer = require('puppeteer');
(async () => {
  try {
    const browser = await puppeteer.launch({
      headless: "new",
      args: [
        '--no-sandbox',
        '--disable-extensions-except=' + process.cwd() + '/dist/chrome',
        '--load-extension=' + process.cwd() + '/dist/chrome'
      ]
    });
    
    // We can't easily click the popup in puppeteer, but we can open popup.html in a tab!
    const page = await browser.newPage();
    // Get extension ID
    const targets = await browser.targets();
    const extTarget = targets.find(t => t.type() === 'background_page' || t.type() === 'service_worker');
    if (!extTarget) { console.log("No ext"); await browser.close(); return; }
    
    const extUrl = extTarget.url();
    const extId = extUrl.split('/')[2];
    
    await page.goto(`chrome-extension://${extId}/popup.html`);
    
    // Check if there are any errors in the console
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
    
    // Wait for it to load
    await new Promise(r => setTimeout(r, 1000));
    
    await browser.close();
  } catch (err) {
    console.error(err);
  }
})();
