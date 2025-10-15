// test-puppeteer.js
const puppeteer = require('puppeteer');

(async () => {
  try {
    const launchOpts = {
      headless: true,
      dumpio: true,                  // PRIKAŽI Chromium stdout/stderr
      timeout: 120000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    };
    if (process.env.CHROME_PATH) launchOpts.executablePath = process.env.CHROME_PATH;

    console.log('Launching with options:', launchOpts);
    const browser = await puppeteer.launch(launchOpts);
    console.log('Browser launched OK');
    const page = await browser.newPage();
    await page.goto('https://example.com', { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('Page loaded OK');
    await browser.close();
    console.log('Done');
  } catch (err) {
    console.error('LAUNCH ERROR (full):', err);
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
  }
})();
