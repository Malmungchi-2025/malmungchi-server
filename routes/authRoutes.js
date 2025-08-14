// routes/authRoutes.js
const express = require('express');
const router = express.Router();

// 컨트롤러
const {
  register,
  login: loginUser,
  verifyEmail,
  resendVerification,
  me,
} = require('../controllers/authController');

// 미들웨어 (폴더명이 middlewares 라서 경로 주의!)
const auth = require('../middlewares/auth');          // Bearer 토큰 파싱 → req.user
const { requireLogin } = require('../middlewares/auth'); // 401 가드 (auth에서 export)

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

module.exports = router;