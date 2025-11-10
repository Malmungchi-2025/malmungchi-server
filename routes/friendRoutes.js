/**
 * @swagger
 * tags:
 *   name: Friends
 *   description: 친구 관련 API (친구 추가 및 랭킹)
 */

/**
 * @swagger
 * /api/friends/by-code:
 *   post:
 *     summary: 친구 추가 (초대코드로 추가)
 *     description: 사용자의 초대코드를 이용해 친구를 추가합니다.
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []   # JWT 토큰 인증 필요
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - code
 *             properties:
 *               code:
 *                 type: string
 *                 example: "ABCD1234"
 *     responses:
 *       200:
 *         description: 친구 추가 성공
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
 *                   example: "친구가 성공적으로 추가되었습니다."
 *       400:
 *         description: 잘못된 코드 혹은 이미 등록된 친구
 *       401:
 *         description: 인증 실패 (토큰 누락/만료)
 */

/**
 * @swagger
 * /api/friends/ranking:
 *   get:
 *     summary: 친구 랭킹 조회
 *     description: 내 친구들 중 학습 포인트 기준 랭킹을 조회합니다.
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 친구 랭킹 목록
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       user_id:
 *                         type: integer
 *                         example: 101
 *                       nickname:
 *                         type: string
 *                         example: "우빈"
 *                       score:
 *                         type: integer
 *                         example: 1240
 */

/**
 * @swagger
 * /api/friends/ranking/all:
 *   get:
 *     summary: 전체 유저 랭킹 조회
 *     description: 모든 사용자 기준의 전역 랭킹을 조회합니다.
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 전체 랭킹 목록
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       rank:
 *                         type: integer
 *                         example: 1
 *                       nickname:
 *                         type: string
 *                         example: "채영"
 *                       score:
 *                         type: integer
 *                         example: 3280
 */


// routes/friendRoutes.js -> (윤지/감자)
const router = require('express').Router();
const {
  addFriendByCode,
  getFriendsRanking,
  getGlobalRanking,
} = require('../controllers/friendController');

const { requireLogin } = require('../middlewares/auth');

// 친구 추가(코드)
router.post('/by-code', requireLogin, addFriendByCode);

// 친구 랭킹(내 친구들만)
router.get('/ranking', requireLogin, getFriendsRanking);

// 전체 랭킹(모든 유저)
router.get('/ranking/all', requireLogin, getGlobalRanking);

module.exports = router;

//router.get('/ping', (req, res) => res.json({ ok: true, where: 'friends' }));