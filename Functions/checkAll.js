// Functions/checkAll.js
import { checkAndAlertSymbol } from './checkAndAlertSymbol.js';

export async function checkAll(browser, deps) {
  const { SYMBOLS, prices, saveDB, sseSend } = deps;
  for (const sym of SYMBOLS) {
    const page = await browser.newPage();
    try {
      await checkAndAlertSymbol(page, sym, deps);
    } finally {
      try { await page.close(); } catch(e){}
    }
    await new Promise(r => setTimeout(r, 700));
  }
}
