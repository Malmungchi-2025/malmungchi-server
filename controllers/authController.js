// controllers/authController.js
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../config/db');
const { sign } = require('../utils/jwt');
const { sendMail } = require('../utils/mailer');
const { renderOtpHtml, renderOtpPlain } = require('../utils/emailTemplates');  //메일 otp 템플릿 추가

// 같은 트랜잭션 client 사용 (단일 정의만 유지)
async function issueEmailToken(client, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 30); // 30분
  await client.query(
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
 * - email/nickname UNIQUE 충돌 분기
 * - 트랜잭션 COMMIT 후 메일 발송
 */
exports.register = async (req, res) => {
  const client = await pool.connect();
  try {
    let { email, password, name, nickname } = req.body || {};
    if (!email || !password || !name) {
      return res.status(400).json({ success:false, message:'이메일/비밀번호/이름이 필요합니다.' });
    }
    email = String(email).trim().toLowerCase();
    name = String(name).trim();
    nickname = nickname != null ? String(nickname).trim() : null;

    // (권장) 길이 체크: DB 제약과 맞추기
    if (email.length > 255 || name.length > 100 || (nickname && nickname.length > 50)) {
      return res.status(400).json({ success:false, message:'입력 길이가 너무 깁니다.' });
    }

    const hash = await bcrypt.hash(password, 10);
    await client.query('BEGIN');

    const insertQ = `
      INSERT INTO users (email, password, name, nickname, is_verified)
      VALUES ($1, $2, $3, $4, false)
      RETURNING id, email, name, nickname, is_verified
    `;
    let r;
    try {
      r = await client.query(insertQ, [email, hash, name, nickname || null]);
    } catch (e) {
      if (e?.code === '23505' && e?.constraint === 'users_email_key') {
        await client.query('ROLLBACK');
        return res.status(409).json({ success:false, message:'이미 가입된 이메일입니다.' });
      }
      if (e?.code === '23505' && e?.constraint === 'users_nickname_key') {
        await client.query('ROLLBACK');
        return res.status(409).json({ success:false, message:'이미 사용 중인 닉네임입니다.' });
      }
      throw e;
    }

    const user = r.rows[0];

    // 같은 트랜잭션으로 토큰 저장
    const token = await issueEmailToken(client, user.id);

    // 1) 먼저 커밋해서 DB 일관성 보장
    await client.query('COMMIT');

    // ✅ 여기서 OTP 생성 + 로그 (최소 수정)
    const otp = generateNumericOtp(6);
    console.log(`[DEBUG][EMAIL_OTP] ${user.email} → ${otp}`);

    // (선택) 인증 링크도 로그로 보고 싶으면
    const link = `${process.env.APP_BASE_URL}/api/auth/verify-email?token=${token}`;
    console.log('[DEBUG][VERIFY_LINK][REGISTER]', link);

    // 2) 그 다음 메일 발송 (실패해도 가입은 성공) - throw 방지
    let mailed = true;
    try {
      const link = `${process.env.APP_BASE_URL}/api/auth/verify-email?token=${token}`;
      mailed = await sendMail({
        to: user.email,
        subject: '[말뭉치] 이메일 인증을 완료해주세요',
        html: `
          <p>아래 버튼을 눌러 이메일 인증을 완료해주세요.</p>
          <p><a href="${link}">이메일 인증</a></p>
          <p>이 링크는 30분간 유효합니다.</p>
        `
      });
    } catch {
      mailed = false;
    }

    if (!mailed) {
      return res.status(202).json({
        success: true,
        message: '가입은 완료되었습니다. 메일 발송에 문제가 있어 재전송을 시도해주세요.'
      });
    }

    return res.json({ success:true, message:'회원가입 완료. 이메일을 확인해주세요.' });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('register error:', e);
    res.status(500).json({ success:false, message:'회원가입 실패' });
  } finally {
    client.release();
  }
};



function generateNumericOtp(digits = 6) {
  const n = Math.floor(Math.random() * Math.pow(10, digits));
  return n.toString().padStart(digits, '0');
}




// 2) 이메일 인증
exports.verifyEmail = async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ success:false, message:'토큰이 필요합니다.' });

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
      return res.status(400).json({ success:false, message:'유효하지 않은 토큰입니다.' });
    }

    const { user_id, expires_at, is_verified } = r.rows[0];
    if (new Date(expires_at) < new Date()) {
      return res.status(400).json({ success:false, message:'토큰이 만료되었습니다.' });
    }
    if (is_verified) {
      return res.json({ success:true, message:'이미 인증된 계정입니다.' });
    }

    await pool.query(`UPDATE users SET is_verified = true, updated_at = NOW() WHERE id = $1`, [user_id]);
    await pool.query(`DELETE FROM email_verifications WHERE token = $1`, [token]); // 선택

    res.json({ success:true, message:'이메일 인증이 완료되었습니다.' });
  } catch (e) {
    console.error('verifyEmail error:', e);
    res.status(500).json({ success:false, message:'이메일 인증 실패' });
  }
};

// 3) 인증 메일 재전송
exports.resendVerification = async (req, res) => {
  try {
    let { email } = req.body || {};
    if (!email) return res.status(400).json({ success:false, message:'이메일이 필요합니다.' });
    email = String(email).trim().toLowerCase();

    const u = await pool.query(`SELECT id, is_verified FROM users WHERE email = $1 LIMIT 1`, [email]);
    if (u.rows.length === 0) {
      return res.status(404).json({ success:false, message:'가입되지 않은 이메일입니다.' });
    }
    if (u.rows[0].is_verified) {
      return res.status(400).json({ success:false, message:'이미 인증된 계정입니다.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 30);
    await pool.query(
      `INSERT INTO email_verifications(user_id, token, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
      [u.rows[0].id, token, expiresAt]
    );

    // ✅ 여기 추가: OTP 생성 + 로그 (메일 본문엔 넣지 않아도 됨)
    const otp = generateNumericOtp(6);
    console.log(`[DEBUG][EMAIL_OTP] ${email} → ${otp}`);

    // (선택) 인증 링크 로그
    const link = `${process.env.APP_BASE_URL}/api/auth/verify-email?token=${token}`;
    console.log('[DEBUG][VERIFY_LINK][RESEND]', link);

    let mailed = true;
    try {
      const link = `${process.env.APP_BASE_URL}/api/auth/verify-email?token=${token}`;
      mailed = await sendMail({
        to: email,
        subject: '[말뭉치] 이메일 인증 다시 보내기',
        html: `<p>다시 인증을 진행하려면 아래를 클릭하세요.</p><p><a href="${link}">이메일 인증</a></p>`
      });
    } catch {
      mailed = false;
    }

    if (!mailed) {
      return res.status(202).json({ success:true, message:'메일 발송에 문제가 있습니다. 잠시 후 다시 시도해주세요.' });
    }
    res.json({ success:true, message:'인증 메일을 재전송했습니다.' });
  } catch (e) {
    console.error('resendVerification error:', e);
    res.status(500).json({ success:false, message:'재전송 실패' });
  }
};

// 4) 로그인
// 4) 로그인 (level 포함 — 최소 변경)
exports.login = async (req, res) => {
  try {
    let { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success:false, message:'이메일/비밀번호가 필요합니다.' });
    }
    email = String(email).trim().toLowerCase();

    const r = await pool.query(
       `SELECT id, email, password, is_verified, name, nickname, level, friend_code
       FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );
    if (r.rows.length === 0) {
      return res.status(401).json({ success:false, message:'이메일 또는 비밀번호가 올바르지 않습니다.' });
    }
    const user = r.rows[0];

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ success:false, message:'이메일 또는 비밀번호가 올바르지 않습니다.' });
    }

    // JWT 페이로드는 기존과 동일 (레벨은 응답 바디에서만 제공)
    const token = sign({ id: user.id, email: user.email, nickname: user.nickname });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        nickname: user.nickname,
        is_verified: user.is_verified,
        level: user.level,   // ✅ 추가
        friend_code: user.friend_code 
      }
    });
  } catch (e) {
    console.error('login error:', e);
    res.status(500).json({ success:false, message:'로그인 실패' });
  }
};


//아바타 저장
// PATCH /api/auth/me/avatar
exports.updateMyAvatar = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success:false, message:'인증 필요' });

  try {
    let { avatarName } = req.body || {};
    if (typeof avatarName !== 'string' || !avatarName.trim()) {
      return res.status(400).json({ success:false, message:'avatarName이 필요합니다.' });
    }
    avatarName = avatarName.trim();

    // DB CHECK 제약과 동일한 화이트리스트(서버단 1차 방어)
    const ALLOWED = new Set([
      'img_glass_malchi','img_malchi','img_mungchi','img_glass_mungchi'
    ]);
    if (!ALLOWED.has(avatarName)) {
      return res.status(400).json({ success:false, message:'허용되지 않은 아바타입니다.' });
    }

    await pool.query(
      `UPDATE users
         SET avatar_name = $1,
             updated_at  = NOW()
       WHERE id = $2`,
      [avatarName, userId]
    );

    return res.json({ success:true, result:{ avatarName }});
  } catch (e) {
    console.error('updateMyAvatar error:', e);
    return res.status(500).json({ success:false, message:'아바타 저장 실패' });
  }
};

// 5) 내 정보
exports.me = async (req, res) => {
  if (!req.user?.id) {
    return res.status(401).json({ success: false, message: '인증 필요' });
  }

  try {
    const q = `
      SELECT 
        id, 
        email, 
        name, 
        nickname, 
        is_verified, 
        created_at, 
        level,
        point,
        nickname_title,
        avatar_name,
        friend_code        
      FROM users 
      WHERE id = $1
      LIMIT 1
    `;
    const { rows } = await pool.query(q, [req.user.id]);
    const user = rows[0];

    if (!user) {
      return res.status(404).json({ success: false, message: '사용자를 찾을 수 없음' });
    }

    // (선택) null 안전 처리 및 카멜케이스로 변환하고 싶다면:
    const result = {
      id: user.id,
      email: user.email,
      name: user.name,
      nickname: user.nickname ?? '',
      isVerified: user.is_verified,
      createdAt: user.created_at, // 필요하면 ISO로 변환 new Date(user.created_at).toISOString()
      level: user.level ?? 0,
      point: user.point ?? 0,
      nicknameTitle: user.nickname_title ?? '',  // nickname_title 필드를 응답에 추가
      avatarName: user.avatar_name ?? 'img_malchi', 
      friendCode: user.friend_code 
    
    };

    return res.json({ success: true, result });
  } catch (e) {
    console.error('me error:', e);
    return res.status(500).json({ success: false, message: '조회 실패' });
  }
};
//최신 저장한 단어 5개 불러오는 api
//1) 최신 저장 단어 5개 (마이페이지 상단)
// GET /api/me/vocabulary/recent?limit=5
exports.getMyRecentVocabulary = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success:false, message:'인증 필요' });

    const raw = Number(req.query.limit);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 20) : 5;

    const includeId = req.query.includeId === '1';
    const includeLiked = req.query.includeLiked === '1';

    const orderCol = (process.env.VOCAB_SORT_BY_CREATED_AT === '1') ? 'v.created_at' : 'v.id';
    const sql = `
      SELECT v.id, v.word, v.meaning, v.example, v.is_liked
        FROM vocabulary v
        JOIN today_study ts ON ts.study_id = v.study_id
       WHERE ts.user_id = $1
       ORDER BY ${orderCol} DESC
       LIMIT $2
    `;
    const { rows } = await pool.query(sql, [userId, limit]);

    return res.json({
      success:true,
      result: rows.map(r => ({
        ...(includeId ? { id: r.id } : {}),
        word: r.word,
        meaning: r.meaning,
        example: r.example,
        ...(includeLiked ? { isLiked: r.is_liked } : {}),
      })),
      message: null
    });
  } catch (err) {
    console.error('getMyRecentVocabulary error:', err);
    return res.status(500).json({ success:false, message:'최근 단어 조회 실패' });
  }
};

//전체 목록 (최근 → 오래된 순) + 커서 기반 페이지네이션
// GET /api/me/vocabulary?limit=20&lastId=12345
//   - 첫 페이지: lastId 없이 호출
//   - 다음 페이지: 직전 응답의 nextCursor를 lastId로 전달
exports.getMyVocabulary = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success:false, message:'인증 필요' });

    const raw = Number(req.query.limit);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 50) : 20;

    const includeId = req.query.includeId === '1';
    const includeLiked = req.query.includeLiked === '1';

    if (process.env.VOCAB_SORT_BY_CREATED_AT === '1') {
      const lastCreatedAt = req.query.lastCreatedAt ? new Date(req.query.lastCreatedAt) : null;
      const lastId = req.query.lastId ? Number(req.query.lastId) : null;

      const whereCursor = (lastCreatedAt && Number.isFinite(lastId))
        ? `AND (v.created_at < $2 OR (v.created_at = $2 AND v.id < $3))`
        : ``;

      const sql = `
        SELECT v.id, v.word, v.meaning, v.example, v.created_at, v.is_liked
          FROM vocabulary v
          JOIN today_study ts ON ts.study_id = v.study_id
         WHERE ts.user_id = $1
           ${whereCursor}
         ORDER BY v.created_at DESC, v.id DESC
         LIMIT ${limit + 1}
      `;
      const params = (lastCreatedAt && Number.isFinite(lastId))
        ? [userId, lastCreatedAt.toISOString(), lastId]
        : [userId];

      const { rows } = await pool.query(sql, params);
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      return res.json({
        success: true,
        result: page.map(r => ({
          ...(includeId ? { id: r.id } : {}),
          word: r.word,
          meaning: r.meaning,
          example: r.example,
          ...(includeLiked ? { isLiked: r.is_liked } : {}),
        })),
        message: null,
        nextCursor: hasMore
          ? { lastCreatedAt: page[page.length - 1].created_at, lastId: page[page.length - 1].id }
          : null
      });
    }

    // id 커서
    const lastId = req.query.lastId ? Number(req.query.lastId) : null;
    const sql = `
      SELECT v.id, v.word, v.meaning, v.example, v.is_liked
        FROM vocabulary v
        JOIN today_study ts ON ts.study_id = v.study_id
       WHERE ts.user_id = $1
         ${Number.isFinite(lastId) ? 'AND v.id < $2' : ''}
       ORDER BY v.id DESC
       LIMIT ${limit + 1}
    `;
    const params = Number.isFinite(lastId) ? [userId, lastId] : [userId];
    const { rows } = await pool.query(sql, params);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return res.json({
      success: true,
      result: page.map(r => ({
        ...(includeId ? { id: r.id } : {}),
        word: r.word,
        meaning: r.meaning,
        example: r.example,
        ...(includeLiked ? { isLiked: r.is_liked } : {}),
      })),
      message: null,
      nextCursor: hasMore ? { lastId: page[page.length - 1].id } : null
    });
  } catch (err) {
    console.error('getMyVocabulary error:', err);
    return res.status(500).json({ success:false, message:'단어 목록 조회 실패' });
  }
};

// ✅ 1) 단어 좋아요 토글
// PATCH /api/auth/me/vocabulary/:vocabId/like  body: { liked: true|false }
exports.toggleMyVocabularyLike = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success:false, message:'인증 필요' });

    const vocabId = Number(req.params.vocabId);
    const liked = !!req.body?.liked;
    if (!Number.isFinite(vocabId)) {
      return res.status(400).json({ success:false, message:'잘못된 vocabId' });
    }

    // 소유권 검증 (내 today_study에 속한 vocabulary 인지)
    const ownCheck = await pool.query(
      `SELECT 1
         FROM vocabulary v
         JOIN today_study ts ON ts.study_id = v.study_id
        WHERE v.id = $1 AND ts.user_id = $2
        LIMIT 1`,
      [vocabId, userId]
    );
    if (ownCheck.rowCount === 0) {
      return res.status(404).json({ success:false, message:'단어가 없거나 접근 권한이 없습니다.' });
    }

    // 토글
    const { rows } = await pool.query(
      `UPDATE vocabulary
          SET is_liked = $2
        WHERE id = $1
        RETURNING id, is_liked`,
      [vocabId, liked]
    );

    return res.json({
      success: true,
      result: { id: rows[0].id, isLiked: rows[0].is_liked },
      message: liked ? '즐겨찾기에 추가되었습니다.' : '즐겨찾기가 해제되었습니다.'
    });
  } catch (err) {
    console.error('toggleMyVocabularyLike error:', err);
    return res.status(500).json({ success:false, message:'즐겨찾기 변경 실패' });
  }
};

// ✅ getMyLikedVocabulary (created_at 모드) 수정본
exports.getMyLikedVocabulary = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success:false, message:'인증 필요' });

    const raw = Number(req.query.limit);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 50) : 20;

    const includeId = req.query.includeId === '1';
    const includeLiked = req.query.includeLiked === '1';

    if (process.env.VOCAB_SORT_BY_CREATED_AT === '1') {
      const lastCreatedAt = req.query.lastCreatedAt ? new Date(req.query.lastCreatedAt) : null;
      const lastId = req.query.lastId ? Number(req.query.lastId) : null;

      const whereCursor = (lastCreatedAt && Number.isFinite(lastId))
        ? `AND (v.created_at < $2 OR (v.created_at = $2 AND v.id < $3))`
        : ``;

      const sql = `
        SELECT v.id, v.word, v.meaning, v.example, v.created_at, v.is_liked
          FROM vocabulary v
          JOIN today_study ts ON ts.study_id = v.study_id
         WHERE ts.user_id = $1
           AND v.is_liked = true
           ${whereCursor}
         ORDER BY v.created_at DESC, v.id DESC
         LIMIT ${limit + 1}
      `;
      const params = (lastCreatedAt && Number.isFinite(lastId))
        ? [userId, lastCreatedAt.toISOString(), lastId]
        : [userId];

      const { rows } = await pool.query(sql, params);
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      return res.json({
        success: true,
        result: page.map(r => ({
          ...(includeId ? { id: r.id } : {}),
          word: r.word,
          meaning: r.meaning,
          example: r.example,
          ...(includeLiked ? { isLiked: r.is_liked } : {}),
        })),
        message: null,
        nextCursor: hasMore
          ? { lastCreatedAt: page[page.length - 1].created_at, lastId: page[page.length - 1].id }
          : null
      });
    }

    // id 커서
    const lastId = req.query.lastId ? Number(req.query.lastId) : null;
    const sql = `
      SELECT v.id, v.word, v.meaning, v.example, v.is_liked
        FROM vocabulary v
        JOIN today_study ts ON ts.study_id = v.study_id
       WHERE ts.user_id = $1
         AND v.is_liked = true
         ${Number.isFinite(lastId) ? 'AND v.id < $2' : ''}
       ORDER BY v.id DESC
       LIMIT ${limit + 1}
    `;
    const params = Number.isFinite(lastId) ? [userId, lastId] : [userId];
    const { rows } = await pool.query(sql, params);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return res.json({
      success: true,
      result: page.map(r => ({
        ...(includeId ? { id: r.id } : {}),
        word: r.word,
        meaning: r.meaning,
        example: r.example,
        ...(includeLiked ? { isLiked: r.is_liked } : {}),
      })),
      message: null,
      nextCursor: hasMore ? { lastId: page[page.length - 1].id } : null
    });
  } catch (err) {
    console.error('getMyLikedVocabulary error:', err);
    return res.status(500).json({ success:false, message:'즐겨찾기 목록 조회 실패' });
  }
};

// === 닉네임 테스트 결과를 users 테이블 "한 벌"로만 저장 ===
// POST /api/auth/me/nickname-test/result
// body: { nicknameTitle?: string, vocabCorrect: number(0..9), readingCorrect: number(0..9) }
exports.saveNicknameTestIntoUsers = async (req, res) => {
  //const pool = require('../config/db'); // 상단에 이미 있다면 중복 제거하세요
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success:false, message:'인증 필요' });

  try {
    let { nicknameTitle, vocabCorrect, readingCorrect } = req.body || {};

    // 0) 개수 유효성
    if (!Number.isInteger(vocabCorrect) || vocabCorrect < 0 || vocabCorrect > 9 ||
        !Number.isInteger(readingCorrect) || readingCorrect < 0 || readingCorrect > 9) {
      return res.status(400).json({ success:false, message:'정답 개수는 0~9 사이 정수여야 합니다.' });
    }

    // 1) 서버에서도 티어 계산(안전)
    const toTier = (n) => (n >= 7 ? '상' : n >= 4 ? '중' : '하');
    const vocabTier   = toTier(vocabCorrect);
    const readingTier = toTier(readingCorrect);

    // 2) 별명 매핑 (프론트 미전달 시 서버에서 생성)
    const toNickname = (vt, rt) => {
      if (vt === '상' && rt === '상') return '언어연금술사';
      if (vt === '하' && rt === '상') return '눈치번역가';
      if (vt === '하' && rt === '중') return '감각해석가';
      if (vt === '중' && rt === '상') return '맥락추리자';
      if (vt === '중' && rt === '중') return '언어균형술사';
      if (vt === '중' && rt === '하') return '낱말며행자';
      if (vt === '상' && rt === '하') return '단어수집가';
      if (vt === '상' && rt === '중') return '의미해석가';
      return '언어모험가';
    };

    if (typeof nicknameTitle !== 'string' || nicknameTitle.trim() === '') {
      nicknameTitle = toNickname(vocabTier, readingTier);
    } else {
      nicknameTitle = nicknameTitle.trim();
    }

    // 3) users 업데이트 (스냅샷만 저장)
    const q = `
      UPDATE users
         SET vocab_tier          = $2,
             reading_tier        = $3,
             vocab_correct       = $4,
             reading_correct     = $5,
             nickname_title      = $6,
             nickname_updated_at = NOW(),
             updated_at          = NOW()
       WHERE id = $1
       RETURNING id, email, name, nickname, is_verified, level, point,
                 vocab_tier, reading_tier, vocab_correct, reading_correct,
                 nickname_title, nickname_updated_at
    `;
    const { rows } = await pool.query(q, [
      userId,
      vocabTier, readingTier,
      vocabCorrect, readingCorrect,
      nicknameTitle
    ]);

    return res.json({
      success: true,
      message: '별명 테스트가 저장되었습니다.',
      result: rows[0]
    });
  } catch (e) {
    console.error('saveNicknameTestIntoUsers error:', e);
    return res.status(500).json({ success:false, message:'저장 실패' });
  }
};

// GET /api/auth/me/badges
exports.getMyBadges = async (req, res) => {
  const userId = req.user?.id;
  if (!userId)
    return res.status(401).json({ success: false, message: '인증 필요' });

  try {
    // === 1️⃣ 현재 상태 계산
    const [
      { rows: attendRows },
      { rows: studyRows },
      { rows: quizRows },
      { rows: aiRows },
    ] = await Promise.all([
      pool.query(
        `SELECT COUNT(DISTINCT date) AS days FROM today_study WHERE user_id = $1`,
        [userId]
      ),
      pool.query(
        `SELECT COUNT(*) AS cnt FROM today_study WHERE user_id = $1`,
        [userId]
      ),
      pool.query(
        `SELECT COUNT(DISTINCT batch_id) AS cnt FROM quiz_response WHERE user_id = $1`,
        [userId]
      ),
      pool.query(
        `SELECT COUNT(DISTINCT date) AS cnt FROM today_ai_chat WHERE user_id = $1`,
        [userId]
      ),
    ]);

    const days = parseInt(attendRows[0]?.days || 0);
    const studyCnt = parseInt(studyRows[0]?.cnt || 0);
    const quizCnt = parseInt(quizRows[0]?.cnt || 0);
    const aiCnt = parseInt(aiRows[0]?.cnt || 0);

    // === 2️⃣ 랭킹 및 조조 학습 계산
    const { rows: rankRows } = await pool.query(
      `
      SELECT rank FROM (
        SELECT id, RANK() OVER (ORDER BY point DESC) AS rank
        FROM users
      ) AS sub WHERE id = $1
    `,
      [userId]
    );
    const isFirst = rankRows[0]?.rank === 1;

    const { rows: earlyRows } = await pool.query(
      `
      SELECT EXISTS (
        SELECT 1 FROM today_study
        WHERE user_id = $1
          AND date = CURRENT_DATE
          AND EXTRACT(HOUR FROM created_at) < 6
      ) AS early
    `,
      [userId]
    );
    const earlyMorning = earlyRows[0]?.early === true;

    const { rows: todayRows } = await pool.query(
      `
      SELECT COUNT(*) AS cnt
      FROM today_study
      WHERE user_id = $1
        AND date = CURRENT_DATE
    `,
      [userId]
    );
    const todayCnt = parseInt(todayRows[0]?.cnt || 0);

    // === 3️⃣ 랭킹 100일 유지 로직
    let rank100Days = false;

    if (isFirst) {
      const { rows: streakRows } = await pool.query(
        `SELECT rank_streak, first_rank_date FROM users WHERE id = $1`,
        [userId]
      );
      const prevStreak = parseInt(streakRows[0]?.rank_streak || 0);
      const firstRankDate = streakRows[0]?.first_rank_date;

      if (!firstRankDate) {
        // 첫 1위 달성
        await pool.query(
          `UPDATE users SET first_rank_date = CURRENT_DATE, rank_streak = 1 WHERE id = $1`,
          [userId]
        );
      } else {
        // 연속 유지
        await pool.query(
          `UPDATE users SET rank_streak = rank_streak + 1 WHERE id = $1`,
          [userId]
        );
      }

      // 100일 유지 달성 체크
      if (prevStreak + 1 >= 100) rank100Days = true;
    } else {
      // 1위 아님 → streak 초기화
      await pool.query(
        `UPDATE users SET rank_streak = 0 WHERE id = $1`,
        [userId]
      );
    }

    // === 4️⃣ 최종 결과 계산
    const result = {
      "1_week_attendance": days >= 7,
      "1_month_attendance": days >= 30,
      "100_days_attendance": days >= 100,
      "first_lesson": studyCnt >= 1,
      "five_lessons": studyCnt >= 5,
      "first_quizmunch": quizCnt >= 1,
      "five_quizzes": quizCnt >= 5,
      "first_ai_chat": aiCnt >= 1,
      "five_ai_chats": aiCnt >= 5,
      "first_rank": isFirst,
      "rank_1week": false, // 추후 확장 가능
      "rank_1month": false,
      //"rank_100days": rank100Days, // ✅ 추가된 100일 랭킹 배지
      "bonus_month": days >= 30,
      "early_morning": earlyMorning,
      "five_logins_day": todayCnt >= 5,
    };

    // === 5️⃣ 기존 badges 병합 + 저장
    const { rows: userRows } = await pool.query(
      `SELECT badges FROM users WHERE id = $1`,
      [userId]
    );
    const prev =
      userRows[0]?.badges && typeof userRows[0].badges === "object"
        ? userRows[0].badges
        : {};
    const updated = { ...prev, ...result };

    await pool.query(
      `UPDATE users SET badges = $2, updated_at = NOW() WHERE id = $1`,
      [userId, updated]
    );

    // === 6️⃣ 응답
    return res.json({ success: true, result: updated });
  } catch (e) {
    console.error("getMyBadges error:", e);
    return res
      .status(500)
      .json({ success: false, message: "배지 조회 실패" });
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