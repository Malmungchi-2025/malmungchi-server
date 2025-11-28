// middlewares/auth.js
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// 토큰 파싱 + 유저 주입 기능 (윤지/감자)
async function auth(req, _res, next) {
  try {
    const h = req.headers['authorization'] || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;

    console.log("\n============================================");
    console.log(" [AUTH MW] Raw Authorization Header:", h);
    console.log(" [AUTH MW] Extracted token:", token);
    console.log(" [AUTH MW] JWT_SECRET =", process.env.JWT_SECRET);
    
    if (token) {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      console.log(" [AUTH MW] Decoded JWT payload =", payload);

      const userId = payload.userId || payload.id;
      console.log(" [AUTH MW] userId to query =", userId);

      const { rows } = await pool.query(
        'SELECT id, email, is_verified FROM users WHERE id=$1',
        [userId]
      );
      console.log(" [AUTH MW] DB result =", rows[0]);
      if (rows[0]) {
        req.user = {
          id: rows[0].id,
          email: rows[0].email,
          isVerified: rows[0].is_verified,
        };
        console.log(" [AUTH MW] req.user set:", req.user);
      }else {
        console.log(" [AUTH MW] User not found in DB");
      }
      
    }
    
  } catch (e) {
    console.log(" [AUTH MW] Token verification error:", e.message);
  }
  next();
}

// 여기서 포맷 통일: { success: false, ... }
function requireLogin(req, res, next) {
  if (!req.user) {
    console.log("[AUTH MW] requireLogin → No user attached. Returning 401");
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
}

module.exports = { auth, requireLogin };