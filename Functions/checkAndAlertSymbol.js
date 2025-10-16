// Functions/checkAndAlertSymbol.js
import { fetchPricePuppeteer } from './fetchPricePuppeteer.js';
import { sendAlertEmail } from './sendAlertEmail.js';

export async function checkAndAlertSymbol(page, symbol, deps) {
  const { prices, saveDB, sseSend } = deps;
  try {
    let current;
    const attempts = 3;
    for (let i = 0; i < attempts; i++) {
      try {
        current = await fetchPricePuppeteer(page, symbol);
        break;
      } catch (err) {
        console.log(`fetch ${symbol} attempt ${i+1} failed: ${err.message}`);
        if (i < attempts - 1) await page.waitForTimeout(2000);
        else throw err;
      }
    }

    const prev = prices[symbol] ? prices[symbol].last : null;
    console.log(new Date().toISOString(), symbol, 'current', current, 'prev', prev);

    try { sseSend({ type:'price', symbol, current, prev, ts: Date.now() }); } catch(e){}

    if (prev !== null) {
      const change = (current - prev) / prev * 100;
      if (change <= -5 || change >= 5) {
        await sendAlertEmail(symbol, prev, current, change, deps);
        try { sseSend({ type:'status', msg:`ALERT ${symbol} ${change.toFixed(2)}%` }); } catch(e){}
      }
    }

    prices[symbol] = { last: current, ts: Date.now() };
    saveDB(prices);
  } catch (err) {
    console.error('Error checking', symbol, ':', err && err.message ? err.message : err);
    try { sseSend({ type:'status', msg:`Error checking ${symbol}: ${err.message}` }); } catch(e){}
  }
}
