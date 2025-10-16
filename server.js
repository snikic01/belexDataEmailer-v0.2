// server.js
import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// functions (DI style: they accept deps)
import { checkAll } from './Functions/checkAll.js';
import { startImapListener } from './Functions/startImapListener.js';
import { saveDB } from './Functions/saveDB.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// load .env explicitly from project dir (where server.js živi)
dotenv.config({ path: path.resolve(__dirname, '.env') });

//////////////////////
// Config / Globals //
//////////////////////
const PORT = process.env.PORT || 3000;
const SYMBOLS = ["JESV","NIIS","IMPL","MTLC","DNOS","DINN","DINNPB","AERO","TGAS","FINT","INFM","ENHL","ZTPK","DNREM","GFOM"];
const DB_FILE = path.join(__dirname, 'prices.json');

let prices = {};
if (fs.existsSync(DB_FILE)) {
  try { prices = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { prices = {}; }
}

const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const ALERT_TO_RAW = process.env.ALERT_TO || EMAIL_USER;
const ALERT_TO_LIST = (ALERT_TO_RAW || '').split(',').map(s => s.trim()).filter(Boolean);

const IMAP_HOST = process.env.IMAP_HOST || 'imap.gmail.com';
const IMAP_PORT = parseInt(process.env.IMAP_PORT || '993', 10);
const IMAP_USER = process.env.IMAP_USER || process.env.EMAIL_USER;
const IMAP_PASS = process.env.IMAP_PASS || process.env.EMAIL_PASS;
const IMAP_TLS = (process.env.IMAP_TLS || 'true') === 'true';

const AUTO_REPLY_COOLDOWN_MS = Number(process.env.AUTO_REPLY_COOLDOWN_MS || 0); // ms

const lastReplyAt = new Map();

if (!EMAIL_USER || !EMAIL_PASS) {
  console.warn('WARNING: EMAIL_USER or EMAIL_PASS not set. Outgoing emails will be skipped.');
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

const sseSend = (obj) => {
  const str = `data: ${JSON.stringify(obj)}\n\n`;
  for (const c of sseClients) {
    try { c.write(str); } catch(e) {}
  }
};

app.get('/api/price/:symbol', (req, res) => {
  const sym = (req.params.symbol || '').toUpperCase();
  res.json(prices[sym] || { error: 'no data yet' });
});

app.get('/api/prices', (req, res) => {
  res.json(prices);
});

//////////////////////
// Dependency object //
//////////////////////
const deps = {
  SYMBOLS,
  prices,
  saveDB: (p) => saveDB(p, { DB_FILE }), // wrapper to use our relative path
  sseSend,
  EMAIL_USER,
  EMAIL_PASS,
  ALERT_TO_LIST,
  IMAP_HOST,
  IMAP_PORT,
  IMAP_USER,
  IMAP_PASS,
  IMAP_TLS,
  AUTO_REPLY_COOLDOWN_MS,
  lastReplyAt,
  DB_FILE
};

//////////////////////
// INIT: browser +  //
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
  startImapListener(deps);

  // kick off initial check in background
  checkAll(browserInstance, deps).catch(err => console.error('Initial checkAll failed:', err.message));

  // schedule cron every 2 minutes
  cron.schedule('*/2 * * * *', () => {
    console.log('Scheduled check', new Date().toISOString());
    checkAll(browserInstance, deps).catch(e => console.error('Scheduled checkAll error:', e.message));
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
