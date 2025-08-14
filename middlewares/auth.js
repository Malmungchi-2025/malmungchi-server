const { verify } = require('../utils/jwt');

module.exports = function auth(req, _res, next) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return next(); // 비로그인 허용 라우트도 있으니 패스
  try {
    const decoded = verify(token); // { id, email }
    req.user = { id: decoded.id, email: decoded.email };
  } catch (e) {
    // 토큰 무효면 무시(필요 시 401 내리고 싶으면 여기에서 처리)
  }
  next();
};