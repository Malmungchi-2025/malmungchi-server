const express = require('express');
const router = express.Router();
const {
  generateQuote,
  searchWordDefinition,
  saveVocabularyManual,
  getVocabularyByStudy
} = require('../controllers/gptController');

/**
 * @swagger
 * /api/gpt/generate-quote:
 *   post:
 *     summary: GPT로 오늘의 학습 글귀 생성 (하루 1개, 단어 자동 저장)
 *     tags: [GPT]
 *     responses:
 *       200:
 *         description: 글귀 생성 성공
 */
router.post('/generate-quote', generateQuote);

/**
 * @swagger
 * /api/vocabulary/search:
 *   post:
 *     summary: 단어 정의 및 예문 조회 (GPT 호출만, DB 저장 없음)
 *     tags: [Vocabulary]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               word:
 *                 type: string
 *                 example: "습관"
 *     responses:
 *       200:
 *         description: 단어 정보 반환
 */
router.post('/vocabulary/search', searchWordDefinition);

/**
 * @swagger
 * /api/vocabulary:
 *   post:
 *     summary: 단어 저장 API (사용자가 저장 버튼 클릭 시 호출)
 *     tags: [Vocabulary]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               study_id:
 *                 type: integer
 *                 example: 1
 *               word:
 *                 type: string
 *                 example: "책임"
 *               meaning:
 *                 type: string
 *                 example: "맡아서 해야 할 일"
 *               example:
 *                 type: string
 *                 example: "그는 책임을 다했다."
 *     responses:
 *       200:
 *         description: 단어 저장 성공
 */
router.post('/vocabulary', saveVocabularyManual);

/**
 * @swagger
 * /api/vocabulary/{studyId}:
 *   get:
 *     summary: 특정 학습 문단(studyId)의 단어 목록 조회
 *     tags: [Vocabulary]
 *     parameters:
 *       - name: studyId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: 단어 목록 반환
 */
router.get('/vocabulary/:studyId', getVocabularyByStudy);

module.exports = router;