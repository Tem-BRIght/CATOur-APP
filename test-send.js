// test-send.js
const nodemailer = require('nodemailer');

const host = process.env.SMTP_HOST;
const port = parseInt(process.env.SMTP_PORT || '587', 10);
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const from = process.env.SMTP_FROM; // e.g. noreply@yourdomain.com
const to = process.env.SMTP_TO;     // your personal email to receive test

async function main() {
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for 587/25
    auth: user && pass ? { user, pass } : undefined,
    tls: { rejectUnauthorized: false },
  });

  const info = await transporter.sendMail({
    from,
    to,
    subject: 'Test email from nodemailer',
    text: 'If you receive this, SMTP is working.',
    html: '<p>If you receive this, <b>SMTP is working</b>.</p>',
  });
  console.log('Message sent:', info.messageId, info);
}

main().catch(err => {
  console.error('Send failed:', err);
  process.exit(1);
});