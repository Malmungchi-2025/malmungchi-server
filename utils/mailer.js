// utils/mailer.js
const nodemailer = require('nodemailer');

const MAIL_ENABLED = String(process.env.MAIL_ENABLED || 'true').toLowerCase() === 'true';
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = SMTP_PORT === 465 || process.env.SMTP_SECURE === 'true'; // 465면 true
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_USER;

function normalizeFrom(from, user) {
  // "말뭉치 <abc@gmail.com>" 같은 형태에서 실제 주소만 추출
  const m = /<([^>]+)>/.exec(from || '') || [];
  const addr = (m[1] || from || '').trim().toLowerCase();
  // Gmail은 USER와 from 주소 불일치 시 거부/치환 가능 → 불일치면 USER로 강제
  if (!addr || !user || addr !== user.toLowerCase()) return user;
  return from; // 표시명 포함 원본 유지
}

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,         // e.g. smtp.gmail.com
  port: SMTP_PORT,         // 587(STARTTLS) or 465(SSL)
  secure: SMTP_SECURE,     // 465 => true, 587 => false
  pool: true,              // 선택 (빈번 발송시 효율↑)
  auth: (SMTP_USER && SMTP_PASS) ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  requireTLS: !SMTP_SECURE,   // 587에서 STARTTLS 강제
  tls: {
    minVersion: 'TLSv1.2',
    // ciphers 지정은 가급적 비권장: 서버/클라이언트 상호지원 세트가 이미 충분
  },
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
});

/** 서버 부팅 시 1회 실행 권장 (server.js에서 호출) */
async function verifySmtp() {
  if (!MAIL_ENABLED) {
    console.warn('[MAIL] disabled by MAIL_ENABLED=false');
    return false;
  }
  if (!SMTP_HOST) {
    console.warn('[MAIL] SMTP_HOST missing: mail disabled');
    return false;
  }
  try {
    await transporter.verify();
    console.log('[MAIL] SMTP verify OK');
    return true;
  } catch (e) {
    console.error('[MAIL] SMTP verify FAILED:', {
      message: e?.message,
      code: e?.code,
      responseCode: e?.responseCode,
      command: e?.command,
    });
    return false;
  }
}

/** 실제 메일 전송 (컨트롤러에서는 true/false만 사용) */
async function sendMail({ to, subject, html, text }) {
  if (!MAIL_ENABLED) {
    console.warn('[MAIL] disabled by MAIL_ENABLED=false → skip send');
    return true; // 흐름은 통과
  }
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn('[MAIL] SMTP not configured properly → skip send');
    return false;
  }
  try {
    const from = normalizeFrom(MAIL_FROM, SMTP_USER);
    const info = await transporter.sendMail({ from, to, subject, html, text });
    console.log('[MAIL] sent', {
      messageId: info?.messageId,
      response: info?.response,
      accepted: info?.accepted,
      rejected: info?.rejected,
      envelope: info?.envelope,
    });
    return true;
  } catch (e) {
    console.error('[MAIL] send FAILED', {
      message: e?.message,
      code: e?.code,            // e.g. 'EAUTH', 'ECONNECTION'
      response: e?.response,    // SMTP raw
      responseCode: e?.responseCode, // 421/450/5xx 등
      command: e?.command,
    });
    return false;
  }
}

module.exports = { transporter, verifySmtp, sendMail };