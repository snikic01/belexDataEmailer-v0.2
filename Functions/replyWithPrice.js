// Functions/replyWithPrice.js
import fs from 'fs';

export async function replyWithPrice(toEmail, origSubject, symbol, deps = {}) {
  try {
    const now = Date.now();
    const lastReplyAt = deps.lastReplyAt || new Map();
    const cooldown = (typeof deps.AUTO_REPLY_COOLDOWN_MS === 'number') ? deps.AUTO_REPLY_COOLDOWN_MS : 0;
    const last = lastReplyAt.get(toEmail) || 0;
    if (now - last < cooldown) {
      console.log(`Skipping auto-reply to ${toEmail} due to cooldown.`);
      return false;
    }

    // try cached price from disk first
    let current = null;
    try {
      const DB_FILE = deps.DB_FILE || 'prices.json';
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      if (raw) {
        const disk = JSON.parse(raw);
        if (disk && disk[symbol] && typeof disk[symbol].last !== 'undefined') {
          current = disk[symbol].last;
        }
      }
    } catch (e) {
      // ignore, fallback to memory
    }

    if (current == null && deps.prices && deps.prices[symbol] && typeof deps.prices[symbol].last !== 'undefined') {
      current = deps.prices[symbol].last;
    }

    const EMAIL_USER = deps.EMAIL_USER || process.env.EMAIL_USER;
    const transporter = deps.transporter || null;
    if (!transporter || !EMAIL_USER) {
      console.log('Cannot send reply (no transporter/credentials).');
      return false;
    }

    if (current == null) {
      const subject = `Re: ${origSubject || ('Cena ' + symbol)}`;
      const text = `Trenutno nemam podatke o ceni za ${symbol}. Molim pokušajte kasnije.`;
      try {
        await transporter.sendMail({ from: EMAIL_USER, to: toEmail, subject, text });
        lastReplyAt.set(toEmail, now);
        console.log(`Sent 'no data' reply to ${toEmail}`);
      } catch (errSend) {
        console.error('Failed to send no-data reply:', errSend && errSend.message ? errSend.message : errSend);
      }
      return false;
    }

    const subject = `Re: ${origSubject || ('Cena ' + symbol)}`;
    const text = `Trenutna (keširana) cena za ${symbol} je ${current}.\n\nPozdrav,\nBelex Watcher`;

    await transporter.sendMail({ from: EMAIL_USER, to: toEmail, subject, text });
    lastReplyAt.set(toEmail, now);
    console.log(`Auto-reply (from cache) sent to ${toEmail} for ${symbol}: ${current}`);
    return true;
  } catch (err) {
    console.error('Failed to reply with price (cache method):', err && err.message ? err.message : err);
    return false;
  }
}
