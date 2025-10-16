// debug-env.js
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

const imapUser = (process.env.IMAP_USER || process.env.EMAIL_USER || '').trim();
const imapPass = (process.env.IMAP_PASS || process.env.EMAIL_PASS || '');
console.log('IMAP_USER present?', !!imapUser);
console.log('IMAP_USER (masked):', imapUser ? imapUser.replace(/(.).+(@.+)$/, '$1***$2') : 'MISSING');
console.log('IMAP_PASS length:', imapPass ? imapPass.length : 0);
