// Functions/sendAlertEmail.js
import nodemailer from 'nodemailer';

function makeTransporter(deps) {
  if (deps && deps.transporter) return deps.transporter;
  const user = deps && deps.EMAIL_USER ? deps.EMAIL_USER : process.env.EMAIL_USER;
  const pass = deps && deps.EMAIL_PASS ? deps.EMAIL_PASS : process.env.EMAIL_PASS;
  if (!user || !pass) return null;
  return nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
}

export async function sendAlertEmail(symbol, prev, current, change, deps = {}) {
  const transporter = makeTransporter(deps);
  const ALERT_TO_LIST = deps.ALERT_TO_LIST || (process.env.ALERT_TO || process.env.EMAIL_USER || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!transporter) {
    console.log('Email not sent (no credentials). Alert would be:', symbol, prev, current, change);
    return;
  }

  const subject = `ALERT: ${symbol} promena ${change.toFixed(2)}%`;
  const text = `${symbol} promena sa ${prev} na ${current} (${change.toFixed(2)}%).`;

  const mail = {
    from: deps.EMAIL_USER || process.env.EMAIL_USER,
    to: ALERT_TO_LIST,
    subject,
    text,
    html: `<p><b>${symbol}</b> promena sa <b>${prev}</b> na <b>${current}</b> (<b>${change.toFixed(2)}%</b>).</p>`
  };

  try {
    const info = await transporter.sendMail(mail);
    console.log('Email poslat:', subject, info && (info.messageId || info.response));
  } catch (err) {
    console.error('Greška pri slanju alert emaila:', err && err.message ? err.message : err);
  }
}
