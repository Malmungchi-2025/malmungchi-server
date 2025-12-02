// src/routes/studyRoutes.js
//라우터 및 스웨거 구현 (윤지/감자)

/**
 * @swagger
 * tags:
 *   name: Study
 *   description: 학습 진도 관련 API (단일 날짜, 주간 조회 및 단계 업데이트)
 */

/**
 * @swagger
 * /api/study/progress/{date}:
 *   get:
 *     summary: 단일 날짜의 학습 진도 조회
 *     description: 특정 날짜의 학습 진도 정보를 반환합니다.
 *     tags: [Study]
 *     security:
 *       - bearerAuth: []   # JWT 인증 필요
 *     parameters:
 *       - name: date
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           example: "2025-11-10"
 *         description: 조회할 날짜 (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: 해당 날짜의 학습 진도 데이터 반환
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     date:
 *                       type: string
 *                       example: "2025-11-10"
 *                     step:
 *                       type: integer
 *                       example: 2
 *                     completed:
 *                       type: boolean
 *                       example: true
 *       401:
 *         description: 인증 실패 (토큰 누락/만료)
 */

/**
 * @swagger
 * /api/study/progress/week/{date}:
 *   get:
 *     summary: 주간 학습 진도 조회
 *     description: 지정한 날짜가 포함된 주간(월~일)의 학습 진도 현황을 조회합니다.
 *     tags: [Study]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: date
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           example: "2025-11-10"
 *         description: 기준 날짜 (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: 주간 학습 진도 데이터 반환
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
 *                       date:
 *                         type: string
 *                         example: "2025-11-06"
 *                       step:
 *                         type: integer
 *                         example: 3
 *                       completed:
 *                         type: boolean
 *                         example: false
 */

/**
 * @swagger
 * /api/study/progress:
 *   patch:
 *     summary: 학습 단계 업데이트
 *     description: "사용자의 학습 단계(예: 1단계 → 2단계)를 업데이트합니다."
 *     tags: [Study]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - date
 *               - step
 *             properties:
 *               date:
 *                 type: string
 *                 example: "2025-11-10"
 *               step:
 *                 type: integer
 *                 example: 2
 *     responses:
 *       200:
 *         description: 학습 단계 업데이트 성공
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
 *                   example: "2단계로 업데이트 완료"
 *       400:
 *         description: 잘못된 요청 데이터
 *       401:
 *         description: 인증 실패
 */
const express = require('express');
const router = express.Router();
const { auth } = require('../middlewares/auth');
const {
  getStudyProgressByDate,
  getStudyProgressByWeek,
  updateStudyProgress
} = require('../controllers/studyController');

//  단일 날짜 조회
router.get('/progress/:date', auth, getStudyProgressByDate);

//  주간 조회
router.get('/progress/week/:date', auth, getStudyProgressByWeek);

//  학습 단계 업데이트
router.patch('/progress', auth, updateStudyProgress);

module.exports = router;
