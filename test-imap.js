// test-imap.js
import Imap from 'node-imap';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

const imap = new Imap({
  user: (process.env.IMAP_USER || process.env.EMAIL_USER),
  password: (process.env.IMAP_PASS || process.env.EMAIL_PASS),
  host: process.env.IMAP_HOST || 'imap.gmail.com',
  port: Number(process.env.IMAP_PORT || 993),
  tls: (process.env.IMAP_TLS || 'true') === 'true'
});

imap.once('ready', () => { console.log('IMAP login OK'); imap.end(); });
imap.once('error', (err) => { console.error('IMAP login failed:', err && err.message ? err.message : err); });
imap.connect();
