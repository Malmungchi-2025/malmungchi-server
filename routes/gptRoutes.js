const express = require('express');
const router = express.Router();

const gptController = require('../controllers/gptController');

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

//퀴즈 생성
/**
 * @swagger
 * /api/gpt/generate-quiz:
 *   post:
 *     summary: GPT로 객관식 퀴즈 3개 생성 (유형 랜덤 선택, 중복 생성 방지)
 *     tags: [GPT]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               text:
 *                 type: string
 *                 description: 문제 생성을 위한 학습 글
 *               studyId:
 *                 type: string
 *                 description: 학습 ID (UUID)
 *     responses:
 *       200:
 *         description: 퀴즈 생성 성공
 */
router.post('/generate-quiz', gptController.generateQuiz);

//퀴즈 조회
/**
 * @swagger
 * /api/quiz/{studyId}:
 *   get:
 *     summary: 특정 학습 ID의 퀴즈 목록 조회
 *     tags: [Quiz]
 *     parameters:
 *       - name: studyId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: 학습 ID
 *     responses:
 *       200:
 *         description: 퀴즈 목록 반환
 */
router.get('/quiz/:studyId', gptController.getQuizzesByStudyId);

//퀴즈 응답 저장
/**
 * @swagger
 * /api/quiz/answer:
 *   post:
 *     summary: 사용자 퀴즈 응답 저장 (userChoice & isCorrect)
 *     tags: [Quiz]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               studyId:
 *                 type: string
 *               questionIndex:
 *                 type: integer
 *               userChoice:
 *                 type: string
 *               isCorrect:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: 정답 저장 성공
 */
router.post('/quiz/answer', gptController.saveQuizAnswer);

//필사 저장
/**
 * @swagger
 * /api/study/handwriting:
 *   post:
 *     summary: 사용자의 필사 내용 저장
 *     tags: [Handwriting]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               study_id:
 *                 type: string
 *               content:
 *                 type: string
 *     responses:
 *       200:
 *         description: 필사 저장 성공
 */
router.post('/study/handwriting', gptController.saveHandwriting);

//필사 조회
/**
 * @swagger
 * /api/study/handwriting/{studyId}:
 *   get:
 *     summary: 특정 학습의 필사 내용 조회
 *     tags: [Handwriting]
 *     parameters:
 *       - name: studyId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 필사 내용 반환
 */
router.get('/study/handwriting/:studyId', gptController.getHandwriting);

module.exports = router;