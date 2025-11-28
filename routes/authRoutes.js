// routes/authRoutes.js
//auth 라우터, 스웨거를 통해 프론트에게 api 명세서 제공함. (윤지/감자)
const express = require('express');
const router = express.Router();
const { sendMail } = require('../utils/mailer'); 

const axios = require("axios");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");


const {
  register,
  login: loginUser,
  verifyEmail,
  resendVerification,
  me,
  // 추가: 단어 목록 API
  getMyRecentVocabulary,
  getMyVocabulary,
  toggleMyVocabularyLike,
  getMyLikedVocabulary,
  saveNicknameTestIntoUsers,
  updateMyAvatar,
  getMyBadges,
} = require('../controllers/authController');


// 미들웨어 (폴더명이 middlewares 라서 경로 주의!)
const { auth, requireLogin } = require('../middlewares/auth');
// const auth = require('../middlewares/auth');                    //  기본 내보내기(함수)
//const { requireLogin } = require('../middlewares/authGuard');   //  named export

// 예: 보호된 라우트
//router.post('/your-protected-endpoint', auth, requireLogin, controllerFn);
/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: 인증 관련 API
 */

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: 회원가입
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, name]
 *             properties:
 *               email:
 *                 type: string
 *                 example: hajin@gmail.com
 *               password:
 *                 type: string
 *                 example: 1234qwer!
 *               name:
 *                 type: string
 *                 example: 하진
 *               nickname:
 *                 type: string
 *                 example: hajin
 *     responses:
 *       200:
 *         description: 회원가입 완료(인증 메일 발송)
 *       409:
 *         description: 이미 가입된 이메일/닉네임
 */
router.post('/register', register);

/**
 * @swagger
 * /api/auth/verify-email:
 *   get:
 *     summary: 이메일 인증
 *     tags: [Auth]
 *     parameters:
 *       - in: query
 *         name: token
 *         schema:
 *           type: string
 *         required: true
 *         description: 이메일 인증 토큰
 *     responses:
 *       200:
 *         description: 인증 성공
 *       400:
 *         description: 토큰 오류/만료
 */
router.get('/verify-email', verifyEmail);

/**
 * @swagger
 * /api/auth/resend:
 *   post:
 *     summary: 인증 메일 재전송
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 example: hajin@gmail.com
 *     responses:
 *       200:
 *         description: 재전송 성공
 *       404:
 *         description: 가입되지 않은 이메일
 *       400:
 *         description: 이미 인증된 계정
 */
router.post('/resend', resendVerification);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: 사용자 로그인
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 example: hajin@gmail.com
 *               password:
 *                 type: string
 *                 example: 1234qwer!
 *     responses:
 *       200:
 *         description: 로그인 성공 (JWT 반환)
 *       401:
 *         description: 이메일 또는 비밀번호가 올바르지 않음
 */
router.post('/login', loginUser);

//아바타

/**
 * @swagger
 * /api/auth/me/avatar:
 *   patch:
 *     summary: 아바타 변경
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [avatarName]
 *             properties:
 *               avatarName:
 *                 type: string
 *                 enum: [img_glass_malchi, img_malchi, img_mungchi, img_glass_mungchi]
 *                 example: img_malchi
 *     responses:
 *       200:
 *         description: 아바타 저장 성공
 *       400:
 *         description: 잘못된 요청(허용되지 않은 아바타 등)
 *       401:
 *         description: 인증 필요
 */
router.patch('/me/avatar', auth, requireLogin, updateMyAvatar); //  상대경로+보호 미들웨어

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: 내 정보
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 내 정보 조회 성공
 *       401:
 *         description: 인증 필요
 */
router.get('/me', auth, requireLogin, me);

/**
 * @swagger
 * /api/auth/me/vocabulary/recent:
 *   get:
 *     summary: 최신 저장 단어 N개 조회 (기본 5개)
 *     description: 사용자가 저장한 단어 중 최신순으로 N개를 반환합니다.
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 20, default: 5 }
 *         description: 반환 개수 (최대 20)
 *       - in: query
 *         name: includeId
 *         schema: { type: string, enum: ['0','1'], default: '0' }
 *         description: 응답에 vocab id 포함 여부
 *       - in: query
 *         name: includeLiked
 *         schema: { type: string, enum: ['0','1'], default: '0' }
 *         description: 응답에 isLiked 포함 여부
 *     responses:
 *       200:
 *         description: 성공
 */
router.get('/me/vocabulary/recent', auth, requireLogin, getMyRecentVocabulary);

/**
 * @swagger
 * /api/auth/me/vocabulary:
 *   get:
 *     summary: 저장 단어 전체 목록 (최신→과거) 페이지네이션
 *     description: created_at 정렬(ENV `VOCAB_SORT_BY_CREATED_AT=1`) 또는 id 정렬 기반 커서 페이지네이션.
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 20 }
 *         description: 페이지당 개수
 *       - in: query
 *         name: lastCreatedAt
 *         schema: { type: string, format: date-time }
 *         description: created_at 모드일 때 커서
 *       - in: query
 *         name: lastId
 *         schema: { type: integer }
 *         description: id 커서(또는 created_at 모드에서 튜플 커서의 id)
 *       - in: query
 *         name: includeId
 *         schema: { type: string, enum: ['0','1'], default: '0' }
 *         description: 응답에 vocab id 포함 여부
 *       - in: query
 *         name: includeLiked
 *         schema: { type: string, enum: ['0','1'], default: '0' }
 *         description: 응답에 isLiked 포함 여부
 *     responses:
 *       200:
 *         description: 성공
 */
router.get('/me/vocabulary', auth, requireLogin, getMyVocabulary);

/**
 * @swagger
 * /api/auth/me/vocabulary/{vocabId}/like:
 *   patch:
 *     summary: 단어 즐겨찾기/해제 (별 토글)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: vocabId
 *         required: true
 *         schema: { type: integer }
 *         description: vocabulary PK
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [liked]
 *             properties:
 *               liked: { type: boolean, example: true }
 *     responses:
 *       200: { description: 성공 }
 *       401: { description: 인증 필요 }
 *       404: { description: 권한 없음/존재하지 않음 }
 */
router.patch('/me/vocabulary/:vocabId/like', auth, requireLogin, toggleMyVocabularyLike);

/**
 * @swagger
 * /api/auth/me/vocabulary/liked:
 *   get:
 *     summary: 즐겨찾기한 단어 목록 (최신→과거)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 20 }
 *       - in: query
 *         name: lastCreatedAt
 *         schema: { type: string, format: date-time }
 *         description: created_at 모드일 때 커서
 *       - in: query
 *         name: lastId
 *         schema: { type: integer }
 *         description: id 또는 튜플 커서용 id
 *       - in: query
 *         name: includeId
 *         schema: { type: string, enum: ['0','1'], default: '1' }
 *         description: 응답에 vocab id 포함 여부
 *       - in: query
 *         name: includeLiked
 *         schema: { type: string, enum: ['0','1'], default: '1' }
 *         description: 응답에 isLiked 포함 여부
 *     responses:
 *       200: { description: 성공 }
 *       401: { description: 인증 필요 }
 */
router.get('/me/vocabulary/liked', auth, requireLogin, getMyLikedVocabulary);
// 단일 스냅샷 저장(히스토리 없이)
router.post('/me/nickname-test/result', auth, requireLogin, saveNicknameTestIntoUsers);


/**
 * @swagger
 * /api/auth/me/badges:
 *   get:
 *     summary: 사용자 배지 상태 조회 (DB 자동 업데이트 포함)
 *     description: 활동(출석, 학습, 퀴즈, AI 대화 등)을 기반으로 배지를 계산하고, users.badges 컬럼을 자동 업데이트합니다.
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 성공적으로 배지 상태 반환
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               result:
 *                 1_week_attendance: true
 *                 first_lesson: true
 *                 five_quizzes: false
 *                 first_ai_chat: true
 *                 early_morning: false
 */
router.get('/me/badges', auth, requireLogin, getMyBadges);


 /**
 * @swagger
 * /api/auth/kakao:
 *   get:
 *     summary: 카카오 로그인 시작 (Redirect)
 *     description: >
 *       카카오 계정으로 로그인하기 위해 카카오 인증 페이지로 리다이렉트합니다.  
 *       브라우저 또는 앱(WebView)이 이 URL을 호출하면 카카오 로그인 화면이 열립니다.
 *     tags: [Auth]
 *     responses:
 *       302:
 *         description: 카카오 인증 페이지로 리다이렉트됨
 */
// 카카오 로그인 시작 -> 11.27 구현.
router.get("/kakao", (req, res) => {
  const kakaoURL = `https://kauth.kakao.com/oauth/authorize?response_type=code&client_id=${process.env.KAKAO_REST_API_KEY}&redirect_uri=${process.env.KAKAO_REDIRECT_URI}`;
  return res.redirect(kakaoURL);
});


/**
 * @swagger
 * /api/auth/kakao/callback:
 *   get:
 *     summary: 카카오 로그인 Callback (카카오 서버 → 우리 서버)
 *     description: >
 *       카카오 로그인 성공 후 카카오 서버가 우리 서버로 전달하는 리다이렉트 엔드포인트입니다.  
 *       카카오는 인증 코드(code)를 보내며, 서버는 해당 코드로 access_token을 요청하고  
 *       사용자 정보를 조회하여 회원가입/로그인을 처리한 후 JWT 토큰을 반환합니다.
 *     tags: [Auth]
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: 카카오 인증 후 전달되는 인가 코드(authorization code)
 *     responses:
 *       200:
 *         description: 카카오 로그인 처리 성공 (JWT 발급)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: 카카오 로그인 성공
 *                 token:
 *                   type: string
 *                   example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *                 user:
 *                   type: object
 *                   description: 데이터베이스에 저장된 사용자 정보
 *       500:
 *         description: 카카오 로그인 중 서버 오류 발생
 */
// 카카오 callback (카카오 서버 → 우리 서버)
router.get("/kakao/callback", async (req, res) => {
  const { code } = req.query;

  try {
    // 1) access_token 받기
    const tokenResp = await axios.post(
      "https://kauth.kakao.com/oauth/token",
      null,
      {
        params: {
          grant_type: "authorization_code",
          client_id: process.env.KAKAO_REST_API_KEY,
          redirect_uri: process.env.KAKAO_REDIRECT_URI,
          code,
        },
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
        },
      }
    );

    const accessToken = tokenResp.data.access_token;

    // 2) user info 요청
    const userResp = await axios.get("https://kapi.kakao.com/v2/user/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const data = userResp.data;
    const kakaoId = String(data.id);
    const email = data.kakao_account?.email || null;
    const nickname = data.properties?.nickname || "카카오사용자";
    const profileImage = data.properties?.profile_image || null;

    // email/password/name null 허용 X → 보정
    const finalEmail = email || `kakao_${kakaoId}@social.com`;
    const finalPassword = "SOCIAL_LOGIN";
    const finalName = nickname;

    // 3) 기존 유저 찾기
    const findSql = `SELECT * FROM users WHERE kakao_id = $1 LIMIT 1`;
    const result = await pool.query(findSql, [kakaoId]);
    let user = result.rows[0];
    let isNewUser = false;

    

    // 4) 없으면 신규 생성
    if (!user) {
      //신규 여부 플래그 추가
      isNewUser = true;
      const insertSql = `
        INSERT INTO users (email, password, name, kakao_id, profile_image)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `;
      const values = [
        finalEmail,
        finalPassword,
        finalName,
        kakaoId,
        profileImage,
      ];
      const insertResult = await pool.query(insertSql, values);
      user = insertResult.rows[0];
    }

    // 5) JWT 발급
    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    console.log(" [KAKAO APP LOGIN] JWT_SECRET used =", process.env.JWT_SECRET);
    console.log(" [KAKAO APP LOGIN] generated token =", token);

    

    
    // 웹 / 앱(안드로이드) 분기 처리
   
    const platform = req.query.platform || "app";

    if (platform === "web") {
      // 웹 로그인(JSON)
      return res.json({
        success: true,
        message: "카카오 로그인 성공",
        token,
        user,
        isNewUser,
      });
    }

    // 앱 로그인 (URI 스킴 redirect)
    const appScheme = process.env.APP_SCHEME || "malchi";
    const redirectUri =
      `${appScheme}://kakao-login` +
      `?token=${encodeURIComponent(token)}` +
      `&userId=${user.id}` +
      `&isNewUser=${isNewUser}`;

    return res.redirect(redirectUri);

  } catch (err) {
    console.error("카카오 로그인 오류:", err);
    return res.status(500).json({
      success: false,
      message: "카카오 로그인 처리 실패",
      error: err.message,
    });
  }
});
/**
 * @swagger
 * /api/auth/kakao/app-login:
 *   post:
 *     summary: 안드로이드 전용 카카오 로그인
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [accessToken]
 *             properties:
 *               accessToken:
 *                 type: string
 *                 example: "kakao_access_token_here"
 *     responses:
 *       200:
 *         description: 로그인 성공
 */
router.post("/kakao/app-login", async (req, res) => {
  const { accessToken } = req.body;

  if (!accessToken) {
    return res.status(400).json({ success: false, message: "accessToken 필요" });
  }

  try {
    // 1) 카카오 사용자 정보 요청
    const userResp = await axios.get("https://kapi.kakao.com/v2/user/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const data = userResp.data;
    const kakaoId = String(data.id);
    const email = data.kakao_account?.email || null;
    const nickname = data.properties?.nickname || "카카오사용자";
    const profileImage = data.properties?.profile_image || null;

    const finalEmail = email || `kakao_${kakaoId}@social.com`;
    const finalPassword = "SOCIAL_LOGIN";
    const finalName = nickname;

    // DB 조회
    const findSql = `SELECT * FROM users WHERE kakao_id = $1 LIMIT 1`;
    const result = await pool.query(findSql, [kakaoId]);
    let user = result.rows[0];
    let isNewUser = false;

    // 신규 생성
    if (!user) {
      isNewUser = true;  
      const insertSql = `
        INSERT INTO users (email, password, name, kakao_id, profile_image)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `;
      const values = [
        finalEmail,
        finalPassword,
        finalName,
        kakaoId,
        profileImage,
      ];
      const insertResult = await pool.query(insertSql, values);
      user = insertResult.rows[0];
    }

    // JWT 발급
    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    console.log(" [KAKAO APP LOGIN] JWT_SECRET used =", process.env.JWT_SECRET);
    console.log(" [KAKAO APP LOGIN] generated token =", token);

    return res.json({
      success: true,
      message: "카카오 로그인 성공",
      token,
      user,
      isNewUser, 
    });

  } catch (err) {
    console.error("카카오 앱 로그인 오류:", err);
    return res.status(500).json({
      success: false,
      message: "카카오 앱 로그인 실패",
      error: err.message,
    });
  }
});
module.exports = router;