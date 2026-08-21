// test-send.js - simple SMTP test using nodemailer
// Usage (PowerShell):
// $env:SMTP_HOST='smtp.sendgrid.net'; $env:SMTP_PORT='587'; $env:SMTP_USER='apikey'; $env:SMTP_PASS='YOUR_SENDGRID_KEY'; $env:SMTP_FROM='noreply@yourdomain.com'; $env:SMTP_TO='you@example.com'; node test-send.js

const nodemailer = require('nodemailer');

const host = process.env.SMTP_HOST;
const port = parseInt(process.env.SMTP_PORT || '587', 10);
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const from = process.env.SMTP_FROM;
const to = process.env.SMTP_TO;

if (!host || !port || !to || !from) {
  console.error('Missing required env vars. Set SMTP_HOST, SMTP_PORT, SMTP_FROM, SMTP_TO, and SMTP_USER/PASS if needed.');
  process.exit(1);
}

async function main() {
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465
    auth: user && pass ? { user, pass } : undefined,
    tls: { rejectUnauthorized: false },
  });

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject: 'CATOUR - SMTP test',
      text: 'This is a test message from your local SMTP test script.',
      html: '<p>This is a test message from your local <b>SMTP test script</b>.</p>'
    });
    console.log('Message sent. Response:', info);
    process.exit(0);
  } catch (err) {
    console.error('Send failed:', err);
    process.exit(2);
  }
}

main();
