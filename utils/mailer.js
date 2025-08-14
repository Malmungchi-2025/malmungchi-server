// utils/mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,          // smtp.gmail.com
  port: Number(process.env.SMTP_PORT),  // 587
  secure: false,                        // 587은 false
  auth: {
    user: process.env.SMTP_USER,        // 보내는 계정
    pass: process.env.SMTP_PASS,        // 앱 비밀번호(16자리)
  },
  tls: { ciphers: 'TLSv1.2' }
});

// 부팅 시 1회 검증 로그
transporter.verify((err, success) => {
  if (err) {
    console.error('[MAIL] transporter.verify failed:', err);
  } else {
    console.log('[MAIL] transporter.verify ok');
  }
});

async function sendMail({ to, subject, html, text }) {
  try {
    const from = process.env.MAIL_FROM || process.env.SMTP_USER;
    const info = await transporter.sendMail({ from, to, subject, html, text });
    console.log('[MAIL] sent:', info.messageId, info.response);
    return true;
  } catch (e) {
    console.error('[MAIL] send error:', e && e.response ? e.response : e);
    return false;
  }
}

module.exports = { sendMail };
