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
    page.on('console', msg => {
      console.log('BROWSER LOG:', msg.text());
    });
    page.on('pageerror', err => {
      console.log('BROWSER ERR:', err.message);
    });
    
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    
    const rootExists = await page.evaluate(() => {
      return !!document.getElementById('bandit-extension-host');
    });
    console.log("Root exists:", rootExists);
    
    await browser.close();
  } catch (err) {
    console.error(err);
  }
})();
