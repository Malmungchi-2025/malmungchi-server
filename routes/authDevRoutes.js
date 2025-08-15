// routes/authDevRoutes.js
const express = require('express');
const router = express.Router();
const { sendMail } = require('../utils/mailer'); // ★ 메일 발송 추가

// 이메일별 최근 OTP 저장 (인메모리)
const otpStore = new Map();
// 유효시간(초)
const EXPIRES_SEC = 300; // 5분

function gen6() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// 1) OTP 요청
router.post('/dev/request-otp', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, message: 'email 필요' });
    }

    const key = email.toLowerCase().trim();
    const code = gen6();
    const expiresAt = Date.now() + EXPIRES_SEC * 1000;
    otpStore.set(key, { code, expiresAt });

    console.log(`[DEV][OTP] ${key} -> ${code} (5분 유효)`);

    // ★ 실제 메일 전송
    const mailed = await sendMail({
      to: key,
      subject: '[말뭉치] 개발용 OTP 코드',
      html: `
        <p>아래 일회용 코드로 인증을 진행하세요. (5분 유효)</p>
        <h2 style="font-size:24px;letter-spacing:2px">${code}</h2>
      `,
      text: `OTP: ${code} (5분 유효)`,
    });

    return res.status(mailed ? 200 : 202).json({
      success: true,
      message: mailed
        ? 'OTP 생성 및 메일 전송 완료'
        : 'OTP 생성은 완료. 메일 발송에 문제가 있습니다(서버 로그 확인).',
    });
  } catch (e) {
    console.error('dev/request-otp error:', e);
    res.status(500).json({ success: false, message: 'OTP 생성 실패' });
  }
});

// 2) OTP 검증
router.post('/dev/verify-otp', async (req, res) => {
  try {
    const { email, code } = req.body || {};
    if (!email || !code) {
      return res.status(400).json({ success: false, message: 'email/code 필요' });
    }

    const key = email.toLowerCase().trim();
    const rec = otpStore.get(key);
    if (!rec) return res.status(400).json({ success: false, message: 'OTP 없음' });

    if (Date.now() > rec.expiresAt) {
      otpStore.delete(key);
      return res.status(400).json({ success: false, message: 'OTP 만료' });
    }
    if (rec.code !== code) {
      return res.status(400).json({ success: false, message: 'OTP 불일치' });
    }

    // 일치하면 1회성으로 제거
    otpStore.delete(key);
    return res.json({ success: true, message: 'OTP 인증 성공' });
  } catch (e) {
    console.error('dev/verify-otp error:', e);
    res.status(500).json({ success: false, message: 'OTP 검증 실패' });
  }
});

module.exports = router;