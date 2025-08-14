// middlewares/auth.js

// 토큰 파싱 (req.user 세팅)
const auth = (req, res, next) => {
  // ... Bearer 파싱 로직 ...
  // req.user = { id: ... } (없으면 undefined)
  next();
};

// 401 가드
const requireLogin = (req, res, next) => {
  if (!req.user?.id) {
    return res.status(401).json({ success: false, message: '인증 필요' });
  }
  next();
};

// ✅ 명시적 내보내기
module.exports = { auth, requireLogin };