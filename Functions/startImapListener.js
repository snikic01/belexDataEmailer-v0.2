// Functions/startImapListener.js (robust)
import Imap from 'node-imap';
import { simpleParser } from 'mailparser';
import { extractSymbolFromText } from './extractSymbolFromText.js';
import { replyWithPrice } from './replyWithPrice.js';

export function startImapListener(deps = {}) {
  const IMAP_USER = (deps.IMAP_USER || process.env.IMAP_USER || process.env.EMAIL_USER || '').trim();
  const IMAP_PASS = (deps.IMAP_PASS || process.env.IMAP_PASS || process.env.EMAIL_PASS || '').trim();
  const IMAP_HOST = deps.IMAP_HOST || process.env.IMAP_HOST || 'imap.gmail.com';
  const IMAP_PORT = Number(deps.IMAP_PORT || process.env.IMAP_PORT || 993);
  const IMAP_TLS = typeof deps.IMAP_TLS !== 'undefined' ? deps.IMAP_TLS : ((process.env.IMAP_TLS || 'true') === 'true');

  if (!IMAP_USER || !IMAP_PASS) {
    console.warn('IMAP disabled — IMAP_USER or IMAP_PASS not set.');
    return;
  }

  let backoffMs = 5000;
  let authFailed = false;
  let imap;

  function connectOnce() {
    if (authFailed) {
      console.warn('IMAP previously failed auth — not retrying. Fix credentials and restart.');
      return;
    }

    console.log('IMAP connecting (masked):', IMAP_USER.replace(/(.).+(@.+)$/, '$1***$2'));
    imap = new Imap({
      user: IMAP_USER,
      password: IMAP_PASS,
      host: IMAP_HOST,
      port: IMAP_PORT,
      tls: IMAP_TLS,
      tlsOptions: { rejectUnauthorized: false },
      debug: (msg) => { console.log('[imap debug]', msg); }
    });

    imap.once('ready', () => {
      console.log('IMAP ready — listening for new messages');
      backoffMs = 5000;
      openInboxAndWatch();
    });

    imap.once('error', (err) => {
      console.error('IMAP error:', err && err.message ? err.message : err);
      if (err && (err.textCode === 'AUTHENTICATIONFAILED' || /auth/i.test(String(err.message)))) {
        console.error('IMAP authentication failed. Check IMAP_USER/IMAP_PASS (use Google App Password if 2FA enabled).');
        authFailed = true;
        try { imap.end(); } catch(e){}
        return;
      }
      try { imap.end(); } catch(e){}
      console.log(`IMAP will retry in ${Math.round(backoffMs/1000)}s`);
      setTimeout(() => { backoffMs = Math.min(backoffMs * 2, 5 * 60 * 1000); connectOnce(); }, backoffMs);
    });

    imap.once('end', () => {
      if (!authFailed) {
        console.log('IMAP connection ended — scheduling reconnect');
        setTimeout(() => { backoffMs = Math.min(backoffMs * 2, 5 * 60 * 1000); connectOnce(); }, backoffMs);
      } else {
        console.log('IMAP ended due to auth failure — manual fix required.');
      }
    });

    imap.connect();
  }

  function openInboxAndWatch() {
    imap.openBox('INBOX', false, (err, box) => {
      if (err) { console.error('IMAP openInbox error:', err); return; }
      imap.on('mail', () => {
        imap.search(['UNSEEN'], (err, results) => {
          if (err || !results || !results.length) return;
          const f = imap.fetch(results, { bodies: '', markSeen: true });
          f.on('message', (msg) => {
            let buffer = '';
            msg.on('body', (stream) => {
              stream.on('data', chunk => buffer += chunk.toString('utf8'));
            });
            msg.once('end', async () => {
              try {
                const parsed = await simpleParser(buffer);
                const from = parsed.from && parsed.from.value && parsed.from.value[0] && parsed.from.value[0].address;
                const subject = (parsed.subject || '').trim();
                const bodyText = (parsed.text || '') + ' ' + (parsed.html ? parsed.html.replace(/<[^>]*>/g,' ') : '');
                const symbol = extractSymbolFromText(subject, deps) || extractSymbolFromText(bodyText, deps);
                if (symbol && from) await replyWithPrice(from, subject, symbol, deps);
              } catch (err) {
                console.error('Failed to parse incoming mail:', err);
              }
            });
          });
          f.once('error', (fetchErr) => { console.error('Fetch error:', fetchErr); });
        });
      });
    });
  }

  connectOnce();
}
