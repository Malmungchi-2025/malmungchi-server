const bcrypt = require("bcrypt");
const pool = require("../../config/db_web");
const { sign } = require("../../utils/jwt_web");

// ==================================================
// ✅ [유지] 기본 로그인 (앱/웹 공용)
// - 깃허브에 그대로 두고, 앱 + 웹에서 사용
// ==================================================
exports.login = async (req, res) => {
  try {
    let { email, password } = req.body || {};
    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "이메일/비밀번호가 필요합니다." });
    }
    email = String(email).trim().toLowerCase();

    const r = await pool.query(
      `SELECT id, email, password, is_verified, name, nickname, level
       FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );
    if (r.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "이메일 또는 비밀번호가 올바르지 않습니다.",
      });
    }
    const user = r.rows[0];

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({
        success: false,
        message: "이메일 또는 비밀번호가 올바르지 않습니다.",
      });
    }

    // JWT 발급
    const token = sign({
      id: user.id,
      email: user.email,
      nickname: user.nickname,
    });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        nickname: user.nickname,
        is_verified: user.is_verified,
        level: user.level, // 레벨은 앱에서 필요
      },
    });
  } catch (e) {
    console.error("login error:", e);
    res.status(500).json({ success: false, message: "로그인 실패" });
  }
};

// ==================================================
// ✅ [로컬 테스트 전용] 웹 로그인 함수
// - React 프론트에서 /api/auth/login/web 호출 시 동작
// - 나중에 깃허브 push 할 땐 삭제하거나 authController_web.js로 분리 가능
// ==================================================
exports.loginWeb = async (req, res) => {
  try {
    let { email, password } = req.body || {};
    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "이메일/비밀번호가 필요합니다." });
    }
    email = String(email).trim().toLowerCase();

    const r = await pool.query(
      `SELECT id, email, password, name, nickname
       FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );
    if (r.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "이메일 또는 비밀번호가 올바르지 않습니다.",
      });
    }
    const user = r.rows[0];

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({
        success: false,
        message: "이메일 또는 비밀번호가 올바르지 않습니다.",
      });
    }

    // JWT 발급 (payload 단순화)
    const token = sign({ id: user.id, email: user.email });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        nickname: user.nickname,
      },
    });
  } catch (e) {
    console.error("loginWeb error:", e);
    res.status(500).json({ success: false, message: "웹 로그인 실패" });
  }
};

const jwt = require("jsonwebtoken");

exports.getUserProfile = async (req, res) => {
  try {
    const h = req.headers["authorization"] || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token)
      return res.status(401).json({ success: false, message: "토큰 없음" });

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const r = await pool.query(
      `SELECT id, email, name, nickname, point
       FROM users
       WHERE id = $1`,
      [payload.id]
    );

    if (r.rows.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "사용자를 찾을 수 없습니다." });

    res.json({
      success: true,
      user: r.rows[0],
    });
  } catch (e) {
    console.error("getUserProfile error:", e);
    res.status(401).json({ success: false, message: "토큰 검증 실패" });
  }
};
