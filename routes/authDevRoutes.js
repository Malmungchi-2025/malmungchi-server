// routes/authDevRoutes.js
const express = require('express');
const router = express.Router();

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
    if (!email) return res.status(400).json({ success: false, message: 'email 필요' });

    const code = gen6();
    const expiresAt = Date.now() + EXPIRES_SEC * 1000;
    otpStore.set(email.toLowerCase().trim(), { code, expiresAt });

    // 콘솔 로그에만 노출 (메일 전송 안 함)
    console.log(`[DEV][OTP] ${email} -> ${code} (5분 유효)`);

    return res.json({ success: true, message: 'OTP 생성 완료(서버 로그 확인)' });
  } catch (e) {
    console.error('dev/request-otp error:', e);
    res.status(500).json({ success: false, message: 'OTP 생성 실패' });
  }
});

// 2) OTP 검증
router.post('/dev/verify-otp', async (req, res) => {
  try {
    const { email, code } = req.body || {};
    if (!email || !code) return res.status(400).json({ success: false, message: 'email/code 필요' });

    const rec = otpStore.get(email.toLowerCase().trim());
    if (!rec) return res.status(400).json({ success: false, message: 'OTP 없음' });

    if (Date.now() > rec.expiresAt) {
      otpStore.delete(email.toLowerCase().trim());
      return res.status(400).json({ success: false, message: 'OTP 만료' });
    }
    if (rec.code !== code) return res.status(400).json({ success: false, message: 'OTP 불일치' });

    // 일치하면 1회성으로 제거(선호)
    otpStore.delete(email.toLowerCase().trim());
    return res.json({ success: true, message: 'OTP 인증 성공' });
  } catch (e) {
    console.error('dev/verify-otp error:', e);
    res.status(500).json({ success: false, message: 'OTP 검증 실패' });
  }
});

module.exports = router;