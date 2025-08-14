const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../config/db');
const { sign } = require('../utils/jwt');
const { sendMail } = require('../utils/mailer');

// 이메일 인증 토큰 생성 헬퍼
async function issueEmailToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 30); // 30분
  await pool.query(
    `INSERT INTO email_verifications(user_id, token, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
    [userId, token, expiresAt]
  );
  return token;
}

/**
 * 1) 회원가입
 * - name 필수, nickname 옵션(NULL 허용)
 * - 비밀번호는 DB의 'password' 컬럼에 해시로 저장
 * - email/nickname UNIQUE 충돌 → 409
 * - 이메일은 소문자/trim 정규화하여 중복 방지(케이스 무시)
 */
exports.register = async (req, res) => {
  const client = await pool.connect();
  try {
    let { email, password, name, nickname } = req.body || {};
    if (!email || !password || !name) {
      return res.status(400).json({ success: false, message: '이메일/비밀번호/이름이 필요합니다.' });
    }

    email = String(email).trim().toLowerCase();      // 이메일 정규화
    const hash = await bcrypt.hash(password, 10);

    await client.query('BEGIN');

    const insertQ = `
      INSERT INTO users (email, password, name, nickname, is_verified)
      VALUES ($1, $2, $3, $4, false)
      RETURNING id, email, name, nickname, is_verified
    `;
    let r;
    try {
      r = await client.query(insertQ, [email, hash, name, nickname ?? null]);
    } catch (e) {
      if (e?.code === '23505') {
        if (e?.constraint === 'users_email_key') {
          await client.query('ROLLBACK');
          return res.status(409).json({ success: false, message: '이미 가입된 이메일입니다.' });
        }
        if (e?.constraint === 'users_nickname_key') {
          await client.query('ROLLBACK');
          return res.status(409).json({ success: false, message: '이미 사용 중인 닉네임입니다.' });
        }
      }
      throw e;
    }

    const user = r.rows[0]; // { id, email, name, nickname, is_verified }

    // 이메일 인증 토큰 발급 & 메일 전송
    const token = await issueEmailToken(user.id);
    const link = `${process.env.APP_BASE_URL}/api/auth/verify-email?token=${token}`;
    await sendMail({
      to: user.email,
      subject: '[말뭉치] 이메일 인증을 완료해주세요',
      html: `<p>아래 버튼을 눌러 이메일 인증을 완료해주세요.</p>
             <p><a href="${link}">이메일 인증</a></p>
             <p>이 링크는 30분간 유효합니다.</p>`
    });

    await client.query('COMMIT');
    // ✅ id 포함 응답
    return res.json({
      success: true,
      message: '회원가입 완료. 이메일을 확인해주세요.',
      user
    });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('register error:', e);
    res.status(500).json({ success: false, message: '회원가입 실패' });
  } finally {
    client.release();
  }
};

/**
 * 2) 이메일 인증
 */
exports.verifyEmail = async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ success: false, message: '토큰이 필요합니다.' });

  try {
    const q = `
      SELECT ev.user_id, ev.expires_at, u.is_verified
      FROM email_verifications ev
      JOIN users u ON u.id = ev.user_id
      WHERE ev.token = $1
      LIMIT 1
    `;
    const r = await pool.query(q, [token]);
    if (r.rows.length === 0) {
      return res.status(400).json({ success: false, message: '유효하지 않은 토큰입니다.' });
    }

    const { user_id, expires_at, is_verified } = r.rows[0];
    if (new Date(expires_at) < new Date()) {
      return res.status(400).json({ success: false, message: '토큰이 만료되었습니다.' });
    }
    if (is_verified) {
      return res.json({ success: true, message: '이미 인증된 계정입니다.' });
    }

    await pool.query(
      `UPDATE users SET is_verified = true, updated_at = NOW() WHERE id = $1`,
      [user_id]
    );
    // 사용된 토큰 제거(선택)
    await pool.query(`DELETE FROM email_verifications WHERE token = $1`, [token]);

    res.json({ success: true, message: '이메일 인증이 완료되었습니다.' });
  } catch (e) {
    console.error('verifyEmail error:', e);
    res.status(500).json({ success: false, message: '이메일 인증 실패' });
  }
};

/**
 * 3) 인증 메일 재전송
 */
exports.resendVerification = async (req, res) => {
  try {
    let { email } = req.body || {};
    if (!email) return res.status(400).json({ success: false, message: '이메일이 필요합니다.' });
    email = String(email).trim().toLowerCase();

    const u = await pool.query(
      `SELECT id, is_verified FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );
    if (u.rows.length === 0) {
      return res.status(404).json({ success: false, message: '가입되지 않은 이메일입니다.' });
    }
    if (u.rows[0].is_verified) {
      return res.status(400).json({ success: false, message: '이미 인증된 계정입니다.' });
    }

    const token = await issueEmailToken(u.rows[0].id);
    const link = `${process.env.APP_BASE_URL}/api/auth/verify-email?token=${token}`;
    await sendMail({
      to: email,
      subject: '[말뭉치] 이메일 인증 다시 보내기',
      html: `<p>다시 인증을 진행하려면 아래를 클릭하세요.</p><p><a href="${link}">이메일 인증</a></p>`
    });
    res.json({ success: true, message: '인증 메일을 재전송했습니다.' });
  } catch (e) {
    console.error('resendVerification error:', e);
    res.status(500).json({ success: false, message: '재전송 실패' });
  }
};

/**
 * 4) 로그인
 * - DB 컬럼명: password (해시 저장)
 * - 응답에 id, name, nickname 포함
 */
exports.login = async (req, res) => {
  try {
    let { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, message: '이메일/비밀번호가 필요합니다.' });
    }
    email = String(email).trim().toLowerCase();

    const r = await pool.query(
      `SELECT id, email, password, is_verified, name, nickname
         FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );
    if (r.rows.length === 0) {
      return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }
    const user = r.rows[0];

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }

    const token = sign({ id: user.id, email: user.email, nickname: user.nickname });
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        nickname: user.nickname,
        is_verified: user.is_verified
      }
    });
  } catch (e) {
    console.error('login error:', e);
    res.status(500).json({ success: false, message: '로그인 실패' });
  }
};

/**
 * 5) 내 정보
 * - id, name, nickname 포함
 */
exports.me = async (req, res) => {
  if (!req.user?.id) return res.status(401).json({ success: false, message: '인증 필요' });
  try {
    const r = await pool.query(
      `SELECT id, email, name, nickname, is_verified, created_at
         FROM users WHERE id = $1 LIMIT 1`,
      [req.user.id]
    );
    res.json({ success: true, user: r.rows[0] || null });
  } catch (e) {
    console.error('me error:', e);
    res.status(500).json({ success: false, message: '조회 실패' });
  }
};

// const pool = require('../config/db');
// const jwt = require('jsonwebtoken');
// const bcrypt = require('bcryptjs');

// exports.loginUser = async (req, res) => {
//   const { email, password } = req.body;

//   if (!email || !password) {
//     return res.status(400).json({ isSuccess: false, code: "COMMON400", message: "이메일과 비밀번호를 입력해주세요." });
//   }

//   try {
//     const result = await pool.query('SELECT * FROM users WHERE email = $1 LIMIT 1', [email]);

//     if (result.rows.length === 0) {
//       return res.status(401).json({ isSuccess: false, code: "AUTH401", message: "이메일 또는 비밀번호가 올바르지 않습니다." });
//     }

//     const user = result.rows[0];

//     // 비밀번호 확인 (bcrypt 사용)
//     const isMatch = await bcrypt.compare(password, user.password);
//     if (!isMatch) {
//       return res.status(401).json({ isSuccess: false, code: "AUTH401", message: "이메일 또는 비밀번호가 올바르지 않습니다." });
//     }

//     // JWT 발급
//     const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '24h' });

//     res.json({
//       isSuccess: true,
//       code: "COMMON200",
//       message: "성공입니다.",
//       result: {
//         userId: user.id,
//         accessToken: token,
//         status: user.status,
//         inactiveDate: user.inactive_date || null
//       }
//     });
//   } catch (err) {
//     console.error('❌ 로그인 오류:', err.message);
//     res.status(500).json({ isSuccess: false, code: "SERVER500", message: "서버 오류" });
//   }
// };