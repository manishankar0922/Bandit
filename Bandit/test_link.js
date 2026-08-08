const puppeteer = require('puppeteer');
(async () => {
  try {
    const browser = await puppeteer.launch({
      product: 'firefox',
      headless: true
    });
    const page = await browser.newPage();
    page.on('console', msg => console.log('LOG:', msg.text()));
    page.on('pageerror', err => console.log('ERR:', err.message));
    
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    
    const cspTest = await page.evaluate(() => {
      try {
        const div = document.createElement('div');
        div.id = "test-host";
        document.body.appendChild(div);
        
        const shadow = div.attachShadow({mode: 'open'});
        
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        // We use a dummy extension URL to see if Firefox blocks the link tag itself
        link.href = 'moz-extension://12345-67890/template.css';
        shadow.appendChild(link);
        
        return "Link injected";
      } catch(err) {
        return "ERROR: " + err.message;
      }
    });
    console.log("Result:", cspTest);
    
    // Wait a bit to see if Firefox throws a CSP error in the console
    await new Promise(r => setTimeout(r, 2000));
    await browser.close();
  } catch (err) {
    console.error(err);
  }
})();
