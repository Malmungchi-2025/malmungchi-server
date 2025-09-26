// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const { sendMail } = require('../utils/mailer'); // ★ 추가


// 컨트롤러
const {
  register,
  login: loginUser,
  verifyEmail,
  resendVerification,
  me,
  // ✅ 추가: 단어 목록 API
  getMyRecentVocabulary,
  getMyVocabulary,
  toggleMyVocabularyLike,
  getMyLikedVocabulary,
  saveNicknameTestIntoUsers,
  updateMyAvatar,
} = require('../controllers/authController');


// 미들웨어 (폴더명이 middlewares 라서 경로 주의!)
const { auth, requireLogin } = require('../middlewares/auth');
// const auth = require('../middlewares/auth');                    // ✅ 기본 내보내기(함수)
//const { requireLogin } = require('../middlewares/authGuard');   // ✅ named export

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
router.patch('/me/avatar', auth, requireLogin, updateMyAvatar); // ✅ 상대경로+보호 미들웨어

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

module.exports = router;