const express = require('express');
const router = express.Router();
const { generateQuote, getWordDefinition } = require('../controllers/gptController');

/**
 * @swagger
 * /api/gpt/generate-quote:
 *   post:
 *     summary: GPT로 오늘의 학습 글귀 생성
 *     tags: [GPT]
 *     responses:
 *       200:
 *         description: 글귀 생성 성공
 */
router.post('/generate-quote', generateQuote);

/**
 * @swagger
 * /api/gpt/word-definition:
 *   post:
 *     summary: 단어 정의 및 예문 조회 + DB 저장
 *     tags: [GPT]
 *     responses:
 *       200:
 *         description: 단어 정보 반환
 */
router.post('/word-definition', getWordDefinition);

module.exports = router;