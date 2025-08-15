// utils/mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,                           // smtp.gmail.com
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',            // 465면 true, 587이면 false
  auth: (process.env.SMTP_USER && process.env.SMTP_PASS) ? {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  } : undefined,
  tls: { ciphers: 'TLSv1.2' },
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
});

// 부팅 시 1회 검증(실패해도 서버 계속 진행)
(async () => {
  try {
    if (process.env.SMTP_HOST) {
      await transporter.verify();
      console.log('[MAIL] verify OK');
    } else {
      console.warn('[MAIL] SMTP 미설정: 개발 모드(전송 생략 가능)');
    }
  } catch (e) {
    console.warn('[MAIL] verify 실패(무시하고 계속):', e.message);
  }
})();

async function sendMail({ to, subject, html, text }) {
  try {
    const from = process.env.MAIL_FROM || process.env.SMTP_USER;  // Gmail은 여기서 SMTP_USER 권장
    if (!process.env.SMTP_HOST) {
      console.warn('[MAIL] SMTP 미설정: sendMail 생략(개발)');
      return true; // 개발 단계에서 흐름 막지 않기
    }
    const info = await transporter.sendMail({ from, to, subject, html, text });
    console.log('[MAIL] sent:', info.messageId);
    return true;
  } catch (e) {
    console.warn('[MAIL] sendMail 실패:', e?.message || e);
    return false; // 컨트롤러에서 202로 안내
  }
}

module.exports = { sendMail };
