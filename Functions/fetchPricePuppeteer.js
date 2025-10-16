// Functions/fetchPricePuppeteer.js
export async function fetchPricePuppeteer(page, symbol) {
  const url = `https://www.belex.rs/trgovanje/hartija/dnevni/${symbol}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

  // wait for at least one table.tdata
  await page.waitForSelector('table.tdata', { timeout: 30000 });

  // evaluate: pick the table.tdata that has a th containing "Dnevni" (case-insensitive)
  const priceText = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table.tdata'));
    const dailyTable = tables.find(table => {
      const th = table.querySelector('tr th');
      if (!th) return false;
      return /dnevni/i.test(th.innerText || '');
    });
    if (!dailyTable) return null;
    const rows = Array.from(dailyTable.querySelectorAll('tr'));
    for (const tr of rows) {
      const tds = Array.from(tr.querySelectorAll('td'));
      if (tds.length >= 2 && (tds[0].innerText || '').trim() === 'Cena') {
        return (tds[1].innerText || '').trim();
      }
    }
    return null;
  });

  if (!priceText) throw new Error(symbol + ' nije pronađena cena u tabeli');
  const normalized = priceText.replace(/\./g, '').replace(',', '.');
  const price = parseFloat(normalized);
  if (isNaN(price)) throw new Error(symbol + ' parsiranje cene nije uspelo: ' + priceText);
  return price;
}
