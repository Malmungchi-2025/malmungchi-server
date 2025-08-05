const pool = require('../config/db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

exports.loginUser = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ isSuccess: false, code: "COMMON400", message: "이메일과 비밀번호를 입력해주세요." });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1 LIMIT 1', [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ isSuccess: false, code: "AUTH401", message: "이메일 또는 비밀번호가 올바르지 않습니다." });
    }

    const user = result.rows[0];

    // 비밀번호 확인 (bcrypt 사용)
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ isSuccess: false, code: "AUTH401", message: "이메일 또는 비밀번호가 올바르지 않습니다." });
    }

    // JWT 발급
    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '24h' });

    res.json({
      isSuccess: true,
      code: "COMMON200",
      message: "성공입니다.",
      result: {
        userId: user.id,
        accessToken: token,
        status: user.status,
        inactiveDate: user.inactive_date || null
      }
    });
  } catch (err) {
    console.error('❌ 로그인 오류:', err.message);
    res.status(500).json({ isSuccess: false, code: "SERVER500", message: "서버 오류" });
  }
};