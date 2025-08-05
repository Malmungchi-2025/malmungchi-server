const express = require('express');
const router = express.Router();
const { generateQuote } = require('../controllers/gptController');

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

const { getWordDefinition } = require('../controllers/gptController');
router.post('/word-definition', getWordDefinition);

module.exports = router;