const pool = require('../config/db');

// 개발 모드에서만 사용
module.exports = async function authDebug(req, _res, next) {
  try {
    if (!req.user && req.headers['x-debug-user']) {
      const email = `${req.headers['x-debug-user']}@local.dev`;
      const q = `
        INSERT INTO users(email, password_hash, is_verified)
        VALUES ($1, 'dev', true)
        ON CONFLICT (email) DO UPDATE SET updated_at=NOW()
        RETURNING id
      `;
      const r = await pool.query(q, [email]);
      req.user = { id: r.rows[0].id, email };
    }
  } catch (e) {
    console.error('authDebug error', e);
  }
  next();
};