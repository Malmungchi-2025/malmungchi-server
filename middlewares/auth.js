// middlewares/auth.js
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

module.exports = async function auth(req, _res, next) {
  try {
    const h = req.headers['authorization'] || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (token) {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const { rows } = await pool.query(
        'SELECT id, email, is_verified FROM users WHERE id=$1',
        [payload.id]
      );
      if (rows[0]) {
        req.user = {
          id: rows[0].id,
          email: rows[0].email,
          isVerified: rows[0].is_verified,
        };
      }
    }
  } catch (e) {
    // optional: console.warn('auth error', e);
  }
  next();
};