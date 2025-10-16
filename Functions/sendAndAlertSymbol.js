async function checkAndAlertSymbol(page, symbol) {
  try {
    // retry up to 3 attempts
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
    
    //Pad od 5%
    const prev = prices[symbol] ? prices[symbol].last : null;
    console.log(new Date().toISOString(), symbol, 'current', current, 'prev', prev);

    // emit SSE price event -5%
    try { sseSend({ type:'price', symbol, current, prev, ts: Date.now() }); } catch(e){}

    if (prev !== null) {
      const change = (current - prev) / prev * 100;
      if (change <= -5) {
        await sendAlertEmail(symbol, prev, current, change);
        try { sseSend({ type:'status', msg:`ALERT ${symbol} ${change.toFixed(2)}%` }); } catch(e){}
      } else if (change >= 5) {
        await sendAlertEmail(symbol, prev, current, change);
        try { sseSend({ type:'status', msg:`ALERT ${symbol} ${change.toFixed+(2)}%` }); } catch(e){}
      }
    }
    prices[symbol] = { last: current, ts: Date.now() };
    saveDB();
  } catch (err) {
    console.error('Error checking', symbol, ':', err.message);
    try { sseSend({ type:'status', msg:`Error checking ${symbol}: ${err.message}` }); } catch(e){}
  }
}