// utils/mailer.js
const nodemailer = require('nodemailer');

const MAIL_ENABLED = String(process.env.MAIL_ENABLED || 'true').toLowerCase() === 'true';

// 안전한 secure 판정
const isSecure = (port) => Number(port) === 465;

// Gmail transporter
const gmailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST_GMAIL,
  port: Number(process.env.SMTP_PORT_GMAIL || 587),
  secure: isSecure(process.env.SMTP_PORT_GMAIL || 587),
  auth: {
    user: process.env.SMTP_USER_GMAIL,
    pass: process.env.SMTP_PASS_GMAIL,
  },
  requireTLS: !isSecure(process.env.SMTP_PORT_GMAIL || 587),
  tls: { minVersion: 'TLSv1.2' },
});

// Naver transporter
const naverTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST_NAVER,
  port: Number(process.env.SMTP_PORT_NAVER || 587),
  secure: isSecure(process.env.SMTP_PORT_NAVER || 587),
  auth: {
    user: process.env.SMTP_USER_NAVER,
    pass: process.env.SMTP_PASS_NAVER,
  },
  requireTLS: !isSecure(process.env.SMTP_PORT_NAVER || 587),
  tls: { minVersion: 'TLSv1.2' },
});

// FROM 주소 정규화 (표시명 유지 + 주소는 provider와 일치)
function pickFromAddress(provider) {
  if (provider === 'naver') {
    return (
      process.env.MAIL_FROM_NAVER ||
      '말뭉치 <' + (process.env.SMTP_USER_NAVER || '') + '>'
    );
  }
  // gmail
  return (
    process.env.MAIL_FROM_GMAIL || // ✅ 요청하신 키 우선 사용
    process.env.MAIL_FROM ||       // 과거 호환
    '말뭉치 <' + (process.env.SMTP_USER_GMAIL || '') + '>'
  );
}

/**
 * 수신자 이메일을 보고 provider 선택
 */
function selectTransport(email) {
  const addr = String(email || '').trim().toLowerCase();
  if (/@naver\.com$/.test(addr)) {
    return { transporter: naverTransporter, from: pickFromAddress('naver') };
  }
  return { transporter: gmailTransporter, from: pickFromAddress('gmail') };
}

/**
 * 실제 메일 발송
 */
async function sendMail({ to, subject, html, text }) {
  if (!MAIL_ENABLED) {
    console.warn('[MAIL] disabled by MAIL_ENABLED=false');
    return true; // 메일 비활성화 시에도 API 플로우는 통과
  }
  const { transporter, from } = selectTransport(to);

  try {
    const info = await transporter.sendMail({ from, to, subject, html, text });
    console.log('[MAIL] sent', {
      id: info?.messageId,
      response: info?.response,
      accepted: info?.accepted,
      rejected: info?.rejected,
    });
    return true;
  } catch (e) {
    console.error('[MAIL] send FAILED', {
      message: e?.message,
      code: e?.code,
      response: e?.response,
      responseCode: e?.responseCode,
      command: e?.command,
    });
    return false;
  }
}

/**
 * 부팅 시 SMTP 연결 검증 (Gmail/Naver 모두)
 */
async function verifySmtp() {
  if (!MAIL_ENABLED) {
    console.warn('[MAIL] disabled by MAIL_ENABLED=false');
    return;
  }
  const verifyOne = async (label, t) => {
    try {
      await t.verify();
      console.log(`[MAIL] ${label} SMTP OK`);
    } catch (e) {
      console.error(`[MAIL] ${label} SMTP FAIL`, e?.message || e);
    }
  };
  await verifyOne('Gmail', gmailTransporter);
  await verifyOne('Naver', naverTransporter);
}

module.exports = { sendMail, verifySmtp };




// // utils/mailer.js
// const nodemailer = require('nodemailer');

// const MAIL_ENABLED = String(process.env.MAIL_ENABLED || 'true').toLowerCase() === 'true';
// const SMTP_HOST = process.env.SMTP_HOST;
// const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
// const SMTP_SECURE = SMTP_PORT === 465 || process.env.SMTP_SECURE === 'true';
// const SMTP_USER = process.env.SMTP_USER;
// const SMTP_PASS = process.env.SMTP_PASS;
// const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_USER;

// // 🔻 여기서 찍기 (상수 선언 ‘다음’)
// (function logMailEnvOnce() {
//   const mask = (s='') => (s ? `${s.length} chars` : 'none');
//   console.log('[MAIL][ENV]', {
//     enabled: MAIL_ENABLED,
//     host: SMTP_HOST,
//     port: SMTP_PORT,
//     secure: SMTP_SECURE,
//     user: SMTP_USER,
//     pass_len: mask(SMTP_PASS),
//     from: MAIL_FROM,
//   });
// })();


// function normalizeFrom(from, user) {
//   // "말뭉치 <abc@gmail.com>" 같은 형태에서 실제 주소만 추출
//   const m = /<([^>]+)>/.exec(from || '') || [];
//   const addr = (m[1] || from || '').trim().toLowerCase();
//   // Gmail은 USER와 from 주소 불일치 시 거부/치환 가능 → 불일치면 USER로 강제
//   if (!addr || !user || addr !== user.toLowerCase()) return user;
//   return from; // 표시명 포함 원본 유지
// }

// const transporter = nodemailer.createTransport({
//   host: SMTP_HOST,         // e.g. smtp.gmail.com
//   port: SMTP_PORT,         // 587(STARTTLS) or 465(SSL)
//   secure: SMTP_SECURE,     // 465 => true, 587 => false
//   pool: true,              // 선택 (빈번 발송시 효율↑)
//   auth: (SMTP_USER && SMTP_PASS) ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
//   requireTLS: !SMTP_SECURE,   // 587에서 STARTTLS 강제
//   tls: {
//     minVersion: 'TLSv1.2',
//     // ciphers 지정은 가급적 비권장: 서버/클라이언트 상호지원 세트가 이미 충분
//   },
//   connectionTimeout: 10_000,
//   greetingTimeout: 10_000,
//   socketTimeout: 20_000,
// });

// /** 서버 부팅 시 1회 실행 권장 (server.js에서 호출) */
// async function verifySmtp() {
//   if (!MAIL_ENABLED) {
//     console.warn('[MAIL] disabled by MAIL_ENABLED=false');
//     return false;
//   }
//   if (!SMTP_HOST) {
//     console.warn('[MAIL] SMTP_HOST missing: mail disabled');
//     return false;
//   }
//   try {
//     await transporter.verify();
//     console.log('[MAIL] SMTP verify OK');
//     return true;
//   } catch (e) {
//     console.error('[MAIL] SMTP verify FAILED:', {
//       message: e?.message,
//       code: e?.code,
//       responseCode: e?.responseCode,
//       command: e?.command,
//     });
//     return false;
//   }
  
// }

// /** 실제 메일 전송 (컨트롤러에서는 true/false만 사용) */
// async function sendMail({ to, subject, html, text }) {
//   if (!MAIL_ENABLED) {
//     console.warn('[MAIL] disabled by MAIL_ENABLED=false → skip send');
//     return true; // 흐름은 통과
//   }
//   if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
//     console.warn('[MAIL] SMTP not configured properly → skip send');
//     return false;
//   }
//   try {
//     const from = normalizeFrom(MAIL_FROM, SMTP_USER);
//     const info = await transporter.sendMail({ from, to, subject, html, text });
//     console.log('[MAIL] sent', {
//       messageId: info?.messageId,
//       response: info?.response,
//       accepted: info?.accepted,
//       rejected: info?.rejected,
//       envelope: info?.envelope,
//     });
//     return true;
//   } catch (e) {
//     console.error('[MAIL] send FAILED', {
//       message: e?.message,
//       code: e?.code,            // e.g. 'EAUTH', 'ECONNECTION'
//       response: e?.response,    // SMTP raw
//       responseCode: e?.responseCode, // 421/450/5xx 등
//       command: e?.command,
//     });
//     return false;
//   }
// }

// module.exports = { transporter, verifySmtp, sendMail };