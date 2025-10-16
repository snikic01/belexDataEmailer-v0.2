// test-imap-verbose.js
import Imap from 'node-imap';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

const IMAP_USER = (process.env.IMAP_USER || process.env.EMAIL_USER || '').trim();
const IMAP_PASS = (process.env.IMAP_PASS || process.env.EMAIL_PASS || '').trim();
const IMAP_HOST = process.env.IMAP_HOST || 'imap.gmail.com';
const IMAP_PORT = Number(process.env.IMAP_PORT || 993);
const IMAP_TLS  = (process.env.IMAP_TLS || 'true') === 'true';

console.log('Attempting IMAP connect (masked):', IMAP_USER ? IMAP_USER.replace(/(.).+(@.+)$/, '$1***$2') : 'MISSING');
console.log('IMAP_PASS length:', IMAP_PASS.length);
console.log('Host/port/tls:', IMAP_HOST, IMAP_PORT, IMAP_TLS);

const imap = new Imap({
  user: IMAP_USER,
  password: IMAP_PASS,
  host: IMAP_HOST,
  port: IMAP_PORT,
  tls: IMAP_TLS,
  tlsOptions: { rejectUnauthorized: false },
  debug: (msg) => { console.log('[imap debug]', msg); } // raw conversation
});

imap.once('ready', () => {
  console.log('IMAP ready!');
  imap.end();
});

imap.once('error', (err) => {
  console.error('IMAP error:', err && err.message ? err.message : err);
});

imap.once('end', () => {
  console.log('IMAP connection ended');
});

imap.connect();
