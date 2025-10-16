import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// __dirname za ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_FILE = path.join(__dirname, 'prices.json');

let savePending = false;
let lastData = null;

export function saveDB(data) {
  lastData = data;

  if (savePending) return;

  savePending = true;

  setTimeout(() => {
    const tempFile = DB_FILE + '.tmp';
    try {
      fs.writeFileSync(tempFile, JSON.stringify(lastData, null, 2));
      fs.renameSync(tempFile, DB_FILE);
      // console.log('prices.json saved');
    } catch (err) {
      console.error('saveDB error:', err.message);
    } finally {
      savePending = false;
    }
  }, 50);
}
