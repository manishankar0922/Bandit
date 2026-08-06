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
    const page = await browser.newPage();
    await page.goto('https://example.com', { waitUntil: 'networkidle0' });
    
    // Check if injected
    const injected = await page.evaluate(() => {
      const el = document.getElementById('bandit-extension-host');
      return el ? true : false;
    });
    
    const logs = await page.evaluate(() => {
      // Just check console logs if we can't get it natively easily
      return "Injection success: " + document.getElementById('bandit-extension-host');
    });
    console.log("Injected:", injected);
    
    await browser.close();
  } catch (err) {
    console.error(err);
  }
})();
