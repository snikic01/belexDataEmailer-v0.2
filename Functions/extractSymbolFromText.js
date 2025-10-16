// Functions/extractSymbolFromText.js
export function extractSymbolFromText(text, deps) {
  if (!text) return null;
  const t = text.toUpperCase();
  const SYMBOLS = (deps && deps.SYMBOLS) || [];
  for (const s of SYMBOLS) {
    const re = new RegExp('\\b' + s + '\\b', 'i');
    if (re.test(t)) return s;
  }
  return null;
}
