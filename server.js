require('dotenv').config();

const express = require('express');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// IMAP deps
const Imap = require('node-imap');
const { simpleParser } = require('mailparser');

//////////////////////
// Config / Globals //
//////////////////////

const PORT = process.env.PORT || 3000;
const SYMBOLS = ["JESV","NIIS","IMPL","MTLC","DNOS","DINN","DINNPB","AERO","TGAS","FINT","INFM","ENHL","ZTPK","DNREM"];
const DB_FILE = path.join(__dirname, 'prices.json');

let prices = {};
if (fs.existsSync(DB_FILE)) {
  try { prices = JSON.parse(fs.readFileSync(DB_FILE)); } catch (e) { prices = {}; }
}
function saveDB(){ fs.writeFileSync(DB_FILE, JSON.stringify(prices, null, 2)); }

const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const ALERT_TO_RAW = process.env.ALERT_TO || EMAIL_USER;
const ALERT_TO_LIST = ALERT_TO_RAW.split(',').map(s => s.trim()).filter(Boolean);

// IMAP config (optional)
const IMAP_HOST = process.env.IMAP_HOST || 'imap.gmail.com';
const IMAP_PORT = parseInt(process.env.IMAP_PORT || '993', 10);
const IMAP_USER = process.env.IMAP_USER || process.env.EMAIL_USER;
const IMAP_PASS = process.env.IMAP_PASS || process.env.EMAIL_PASS;
const IMAP_TLS = (process.env.IMAP_TLS || 'true') === 'true';

// rate-limit for auto-replies: min ms between replies to same sender
const AUTO_REPLY_COOLDOWN_MS = 0 * 0 * 1000; // 
const lastReplyAt = new Map(); // sender -> timestamp ms

if (!EMAIL_USER || !EMAIL_PASS) {
  console.warn('WARNING: EMAIL_USER or EMAIL_PASS not set. Emails (outbound) will not be sent.');
}

//////////////////////
// Nodemailer setup //
//////////////////////

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: EMAIL_USER, pass: EMAIL_PASS }
});

////////////////////////////
// Puppeteer price fetch  //
////////////////////////////

async function fetchPricePuppeteer(page, symbol) {
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

/////////////////////
// Alert emailing  //
/////////////////////

async function sendAlertEmail(symbol, prev, current, change) {
  if (!EMAIL_USER || !EMAIL_PASS) {
    console.log('Email not sent (no credentials). Alert would be:', symbol, prev, current, change);
    return;
  }

  const subject = `ALERT: ${symbol} pao ${change.toFixed(2)}%`;
  const text = `${symbol} je pao sa ${prev} na ${current} (${change.toFixed(2)}%).`;
  const mail = {
    from: EMAIL_USER,
    to: ALERT_TO_LIST,
    subject,
    text,
    html: `<p><b>${symbol}</b> je pao sa <b>${prev}</b> na <b>${current}</b> (<b>${change.toFixed(2)}%</b>).</p>`
  };

  try {
    const info = await transporter.sendMail(mail);
    console.log('Email poslat:', subject, info && (info.messageId || info.response));
  } catch (err) {
    console.error('Greška pri slanju alert emaila:', err && err.message ? err.message : err);
  }
}

/////////////////////////
// Check + alert logic //
/////////////////////////

function sseSend(obj) {
  // placeholder; will get assigned after SSE setup
}

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

    const prev = prices[symbol] ? prices[symbol].last : null;
    console.log(new Date().toISOString(), symbol, 'current', current, 'prev', prev);

    // emit SSE price event
    try { sseSend({ type:'price', symbol, current, prev, ts: Date.now() }); } catch(e){}

    if (prev !== null) {
      const change = (current - prev) / prev * 100;
      if (change <= -5) {
        await sendAlertEmail(symbol, prev, current, change);
        try { sseSend({ type:'status', msg:`ALERT ${symbol} ${change.toFixed(2)}%` }); } catch(e){}
      }
    }
    prices[symbol] = { last: current, ts: Date.now() };
    saveDB();
  } catch (err) {
    console.error('Error checking', symbol, ':', err.message);
    try { sseSend({ type:'status', msg:`Error checking ${symbol}: ${err.message}` }); } catch(e){}
  }
}

async function checkAll(browser) {
  for (const sym of SYMBOLS) {
    const page = await browser.newPage();
    try {
      await checkAndAlertSymbol(page, sym);
    } finally {
      await page.close();
    }
    await new Promise(r => setTimeout(r, 700));
  }
}

////////////////////
// Express server //
////////////////////

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// SSE clients
const sseClients = [];
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();

  const client = res;
  sseClients.push(client);
  console.log('SSE client connected. Total:', sseClients.length);

  try {
    client.write(`data: ${JSON.stringify({ type:'status', msg:'connected' })}\n\n`);
    client.write(`data: ${JSON.stringify({ type:'snapshot', prices })}\n\n`);
  } catch(e){}

  req.on('close', () => {
    const idx = sseClients.indexOf(client);
    if (idx !== -1) sseClients.splice(idx, 1);
    console.log('SSE client disconnected. Total:', sseClients.length);
  });
});

sseSend = function(obj) {
  const str = `data: ${JSON.stringify(obj)}\n\n`;
  for (const c of sseClients) {
    try { c.write(str); } catch(e) { /* ignore */ }
  }
};

app.get('/api/price/:symbol', (req, res) => {
  const sym = (req.params.symbol || '').toUpperCase();
  res.json(prices[sym] || { error: 'no data yet' });
});

app.get('/api/prices', (req, res) => {
  res.json(prices);
});

app.post('/api/check-now', (req, res) => {
  if (!browserInstance) return res.status(503).json({ ok:false, error:'browser not ready' });
  // run in background
  checkAll(browserInstance).catch(err => console.error('checkAll background error:', err.message));
  res.json({ ok: true, msg: 'Triggered check in background' });
});

//////////////////////////
// IMAP Auto-reply stuff //
//////////////////////////

function extractSymbolFromText(text) {
  if (!text) return null;
  const t = text.toUpperCase();
  for (const s of SYMBOLS) {
    const re = new RegExp('\\b' + s + '\\b', 'i');
    if (re.test(t)) return s;
  }
  return null;
}

// zameni postojeću replyWithPrice funkciju ovim kodom
// zameni postojeću replyWithPrice funkciju ovim kodom
async function replyWithPrice(toEmail, origSubject, symbol) {
  try {
    // rate-limit check (isti kao pre)
    const now = Date.now();
    const last = lastReplyAt.get(toEmail) || 0;
    if (now - last < AUTO_REPLY_COOLDOWN_MS) {
      console.log(`Skipping auto-reply to ${toEmail} due to cooldown.`);
      return false;
    }

    // pokušaj prvo da pročitaš najnovije cene sa diska (prices.json)
    let current = null;
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      if (raw) {
        const disk = JSON.parse(raw);
        if (disk && disk[symbol] && typeof disk[symbol].last !== 'undefined') {
          current = disk[symbol].last;
        }
      }
    } catch (e) {
      // čitanje fajla nije uspelo — nastavi i probaj memorijski keš
      console.warn('Warning: cannot read prices.json from disk:', e.message);
    }

    // fallback: proveri memorijsku promenljivu prices
    if (current == null && prices[symbol] && typeof prices[symbol].last !== 'undefined') {
      current = prices[symbol].last;
    }

    // ako nema cene u kešu — odgovori da nema podataka
    if (current == null) {
      const subject = `Re: ${origSubject || ('Cena ' + symbol)}`;
      const text = `Trenutno nemam podatke o ceni za ${symbol}. Molim pokušajte kasnije (server možda još nije obavio proveru).`;
      try {
        await transporter.sendMail({ from: EMAIL_USER, to: toEmail, subject, text });
        console.log(`Sent 'no data' reply to ${toEmail} for ${symbol}`);
        lastReplyAt.set(toEmail, now);
      } catch (errSend) {
        console.error('Failed to send no-data reply:', errSend && errSend.message ? errSend.message : errSend);
      }
      return false;
    }

    // imamo cenu iz fajla ili memorije — pošalji odgovor
    const subject = `Re: ${origSubject || ('Cena ' + symbol)}`;
    const text = `Trenutna (keširana) cena za ${symbol} je ${current}.\n\nNapomena: cena je uzeta iz keš fajla prices.json.\n\nPozdrav,\nBelex Watcher`;

    await transporter.sendMail({ from: EMAIL_USER, to: toEmail, subject, text });

    // zabeleži vreme odgovora (rate-limit)
    lastReplyAt.set(toEmail, now);
    console.log(`Auto-reply (from cache) sent to ${toEmail} for ${symbol}: ${current}`);
    return true;

  } catch (err) {
    console.error('Failed to reply with price (cache method):', err && err.message ? err.message : err);
    return false;
  }
}



function startImapListener() {
  if (!IMAP_USER || !IMAP_PASS) {
    console.warn('IMAP credentials not set — inbound email listening disabled.');
    return;
  }

  const imap = new Imap({
    user: IMAP_USER,
    password: IMAP_PASS,
    host: IMAP_HOST,
    port: IMAP_PORT,
    tls: IMAP_TLS,
    tlsOptions: { rejectUnauthorized: false }
  });

  function openInbox(cb) {
    imap.openBox('INBOX', false, cb);
  }

  imap.once('ready', function() {
    console.log('IMAP ready — listening for new messages');
    openInbox(function(err, box) {
      if (err) { console.error('IMAP openInbox error:', err); return; }
      imap.on('mail', function(numNew) {
        console.log('IMAP mail event — new messages:', numNew);
        imap.search([ 'UNSEEN' ], (err, results) => {
          if (err) { console.error('IMAP search error:', err); return; }
          if (!results || results.length === 0) return;
          const f = imap.fetch(results, { bodies: '', markSeen: true });
          f.on('message', (msg, seqno) => {
            let buffer = '';
            msg.on('body', (stream) => {
              stream.on('data', (chunk) => { buffer += chunk.toString('utf8'); });
            });
            msg.once('attributes', (attrs) => {});
            msg.once('end', async () => {
              try {
                const parsed = await simpleParser(buffer);
                const from = parsed.from && parsed.from.value && parsed.from.value[0] && parsed.from.value[0].address;
                const subject = (parsed.subject || '').trim();
                const bodyText = (parsed.text || '') + ' ' + (parsed.html ? parsed.html.replace(/<[^>]*>/g, ' ') : '');

                console.log('Received mail from', from, 'subject:', subject);

                // Safety checks to avoid replying to system/bounce mails
                const fromNorm = (from || '').toLowerCase();
                if (!fromNorm) { console.log('Skipping: no From address.'); return; }
                if (IMAP_USER && fromNorm === IMAP_USER.toLowerCase()) { console.log('Skipping: from IMAP_USER (self).'); return; }
                if (EMAIL_USER && fromNorm === EMAIL_USER.toLowerCase()) { console.log('Skipping: from EMAIL_USER (self).'); return; }

                const systemPatterns = ['mailer-daemon', 'postmaster', 'no-reply', 'noreply', 'bounce', 'do-not-reply', 'do_not_reply'];
                if (systemPatterns.some(p => fromNorm.includes(p))) {
                  console.log('Skipping: system sender:', from); return;
                }

                const autoSubmitted = parsed.headers && (parsed.headers.get ? parsed.headers.get('auto-submitted') : parsed.headers['auto-submitted']);
                if (autoSubmitted && String(autoSubmitted).toLowerCase() !== 'no') { console.log('Skipping: Auto-Submitted header present:', autoSubmitted); return; }

                const precedence = parsed.headers && (parsed.headers.get ? parsed.headers.get('precedence') : parsed.headers['precedence']);
                if (precedence && /^(bulk|list|junk)$/i.test(precedence)) { console.log('Skipping: Precedence header indicates bulk/list/junk:', precedence); return; }

                const lowSubj = subject.toLowerCase();
                if (/delivery status notification|mail delivery failed|failure notice|undeliverable|returned mail/i.test(lowSubj)) {
                  console.log('Skipping: bounce/delivery subject:', subject); return;
                }

                // extract symbol
                const symbol = extractSymbolFromText(subject) || extractSymbolFromText(bodyText);
                if (!symbol) {
                  if (from) {
                    // guidance reply (rate-limited)
                    const now = Date.now();
                    const last = lastReplyAt.get(from) || 0;
                    if (now - last < AUTO_REPLY_COOLDOWN_MS) {
                      console.log(`Skipping guidance reply to ${from} due to cooldown.`);
                    } else {
                      try {
                        await transporter.sendMail({
                          from: EMAIL_USER,
                          to: from,
                          subject: `Re: ${subject || 'Cena'}`,
                          text: `Nisam pronašao oznaku akcije u vašem email-u. Pošaljite jednu od ovih oznaka: ${SYMBOLS.join(', ')}\nPrimer: Subject: INFM`
                        });
                        lastReplyAt.set(from, now);
                        console.log('Sent guidance reply to', from);
                      } catch (errReply) {
                        console.error('Failed to send guidance reply to', from, ':', errReply && errReply.message);
                      }
                    }
                  } else {
                    console.log('No sender address to reply to.');
                  }
                  return;
                }

                // valid symbol -> reply with price (rate-limited inside replyWithPrice)
                if (from) {
                  await replyWithPrice(from, subject, symbol);
                } else {
                  console.log('No from address to reply to.');
                }

              } catch (parseErr) {
                console.error('Failed to parse incoming mail:', parseErr);
              }
            });
          });
          f.once('error', (fetchErr) => { console.error('Fetch error:', fetchErr); });
        });
      });
    });
  });

  imap.once('error', function(err) {
    console.error('IMAP error:', err);
  });

  imap.once('end', function() {
    console.log('IMAP connection ended — attempting reconnect in 5s');
    setTimeout(() => startImapListener(), 5000);
  });

  imap.connect();
}

//////////////////////
// INIT: browser + //
//////////////////////

let browserInstance;

(async () => {
  try {
    browserInstance = await puppeteer.launch({ headless: true });
  } catch (err) {
    console.error('Puppeteer launch failed:', err.message);
    process.exit(1);
  }

  // start express server
  app.listen(PORT, ()=>console.log(`Server listening on ${PORT}`));
  console.log('Browser launched, server listening on port', PORT);

  // start IMAP listener (non-blocking)
  startImapListener();

  // kick off initial check in background
  checkAll(browserInstance).catch(err => console.error('Initial checkAll failed:', err.message));

  // schedule cron every 2 minutes
  cron.schedule('*/2 * * * *', () => {
    console.log('Scheduled check', new Date().toISOString());
    checkAll(browserInstance).catch(e => console.error('Scheduled checkAll error:', e.message));
  });

  // graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    try { if (browserInstance) await browserInstance.close(); } catch(e){}
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})();
