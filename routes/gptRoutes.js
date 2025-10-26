// routes/gptRoutes.js
const express = require('express');
const router = express.Router();

const gptController = require('../controllers/gptController');

// ✅ JWT 파싱 + 로그인 강제 미들웨어 (프로젝트에 맞게 import)
// 예시 1) 하나로 합쳐진 미들웨어인 경우:
// const requireLogin = require('../middleware/requireLogin');

// 예시 2) 토큰 파싱(auth) + 로그인필수(requireLogin) 분리된 경우:
const { auth, requireLogin } = require('../middlewares/auth');
// const auth = require('../middlewares/auth');              // req.user 채우기
// const { requireLogin } = require('../middlewares/authGuard'); // 401 처리

// 🔒 이하 모든 GPT/Study/Vocabulary/Quiz API는 로그인 필수
router.use(auth, requireLogin);


/**
 * @swagger
 * /api/gpt/study/by-date:
 *   get:
 *     summary: 특정 날짜의 학습(글감/필사/단어/퀴즈+채점) 통합 조회
 *     tags: [GPT]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: date
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^\d{4}-\d{2}-\d{2}$'
 *         example: "2025-08-16"
 *     responses:
 *       200:
 *         description: 통합 조회 성공
 *       404:
 *         description: 해당 날짜 학습 없음
 */
router.get('/study/by-date', gptController.getStudyByDate);

/**
 * @swagger
 * /api/gpt/study/available-dates:
 *   get:
 *     summary: 특정 월에 사용자가 학습한 날짜 목록
 *     tags: [GPT]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: year
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *           example: "2025"
 *       - name: month
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *           example: "08"
 *     responses:
 *       200:
 *         description: |
 *           다음과 같은 문자열 배열입니다.
 *           ["2025-08-01","2025-08-03","..."] 형태로 반환
 */
router.get('/study/available-dates', gptController.getAvailableDates);

/**
 * @swagger
 * tags:
 *   - name: GPT
 *   - name: Vocabulary
 *   - name: Quiz
 *   - name: Handwriting
 *
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 */

/**
 * @swagger
 * /api/gpt/generate-quote:
 *   post:
 *     summary: GPT로 오늘의 학습 글귀 생성 (하루 1개, 단어 자동 저장)
 *     tags: [GPT]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 글귀 생성 성공
 */
router.post('/generate-quote', gptController.generateQuote);

/**
 * @swagger
 * /api/gpt/vocabulary/search:
 *   post:
 *     summary: 단어 정의 및 예문 조회 (GPT 호출만, DB 저장 없음)
 *     tags: [Vocabulary]
 *     security:
 *       - bearerAuth: []
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
router.post('/vocabulary/search', gptController.searchWordDefinition);

/**
 * @swagger
 * /api/gpt/vocabulary:
 *   post:
 *     summary: 단어 저장 API (사용자가 저장 버튼 클릭 시 호출)
 *     tags: [Vocabulary]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [word, meaning]
 *             properties:
 *               study_id:
 *                 type: integer
 *                 example: 123
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
router.post('/vocabulary', gptController.saveVocabularyManual);

/**
 * @swagger
 * /api/gpt/vocabulary/{studyId}:
 *   get:
 *     summary: 특정 학습 문단(studyId)의 단어 목록 조회
 *     tags: [Vocabulary]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: studyId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *       - name: today
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *           enum: ["1"]
 *         description: today=1이면 해당 사용자의 '오늘' 학습으로 강제 조회
 *     responses:
 *       200:
 *         description: 단어 목록 반환
 */
router.get('/vocabulary/:studyId', gptController.getVocabularyByStudy);

/**
 * @swagger
 * /api/gpt/generate-quiz:
 *   post:
 *     summary: GPT로 객관식 퀴즈 3개 생성 (유형 랜덤 선택, 중복 생성 시 기존 반환)
 *     tags: [GPT]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text, studyId]
 *             properties:
 *               text:
 *                 type: string
 *                 description: 문제 생성을 위한 학습 글
 *               studyId:
 *                 type: integer
 *                 description: 학습 ID
 *     responses:
 *       200:
 *         description: 퀴즈 생성 성공
 */
router.post('/generate-quiz', gptController.generateQuiz);

/**
 * @swagger
 * /api/gpt/quiz/{studyId}:
 *   get:
 *     summary: 특정 학습 ID의 퀴즈 목록 조회
 *     tags: [Quiz]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: studyId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: 퀴즈 목록 반환
 */
router.get('/quiz/:studyId', gptController.getQuizzesByStudyId);

/**
 * @swagger
 * /api/gpt/quiz/answer:
 *   post:
 *     summary: 사용자 퀴즈 응답 저장 (서버에서 채점)
 *     tags: [Quiz]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [studyId, questionIndex, userChoice]
 *             properties:
 *               studyId:
 *                 type: integer
 *               questionIndex:
 *                 type: integer
 *               userChoice:
 *                 type: string
 *     responses:
 *       200:
 *         description: 정답 저장 성공
 */
router.post('/quiz/answer', gptController.saveQuizAnswer);

/**
 * @swagger
 * /api/gpt/study/handwriting:
 *   post:
 *     summary: 사용자의 필사 내용 저장
 *     tags: [Handwriting]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [study_id, content]
 *             properties:
 *               study_id:
 *                 type: integer
 *               content:
 *                 type: string
 *     responses:
 *       200:
 *         description: 필사 저장 성공
 */
router.post('/study/handwriting', gptController.saveHandwriting);

/**
 * @swagger
 * /api/gpt/study/handwriting/{studyId}:
 *   get:
 *     summary: 특정 학습의 필사 내용 조회
 *     tags: [Handwriting]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: studyId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: 필사 내용 반환
 */
router.get('/study/handwriting/:studyId', gptController.getHandwriting);


/**  
 * @swagger  
 * /api/gpt/study/complete-reward:  
 *   post:  
 *     summary: 오늘의 학습 완료 시 포인트 지급 (하루 1회, +15)  
 *     tags: [GPT]  
 *     security:  
 *       - bearerAuth: []  
 *     responses:  
 *       200:  
 *         description: 지급 성공  
 *       400:  
 *         description: 이미 지급됨  
 */  
router.post('/study/complete-reward', gptController.giveTodayStudyPoint); 


/**
 * @swagger
 * tags:
 *   name: LevelTest
 *   description: 레벨 테스트 API
 */

/**
 * @swagger
 * /api/gpt/level-test/generate:
 *   post:
 *     summary: 레벨 테스트 생성
 *     tags: [LevelTest]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stage]
 *             properties:
 *               stage:
 *                 type: integer
 *                 enum: [0, 1, 2, 3]
 *                 description: |
 *                   - 0: 회원가입 직후 종합 테스트  
 *                   - 1: 기초→활용  
 *                   - 2: 활용→심화  
 *                   - 3: 심화→고급
 *     responses:
 *       200:
 *         description: 생성 성공
 *       400:
 *         description: 잘못된 요청
 *       401:
 *         description: 인증 필요
 *       500:
 *         description: 서버 오류
 */
router.post('/level-test/generate', gptController.generateLevelTest);

/**
 * @swagger
 * /api/gpt/level-test/submit:
 *   post:
 *     summary: 레벨 테스트 제출 및 채점
 *     tags: [LevelTest]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [answers]
 *             properties:
 *               answers:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [questionIndex, choice]
 *                   properties:
 *                     questionIndex:
 *                       type: integer
 *                     choice:
 *                       type: string
 *     responses:
 *       200:
 *         description: 채점 성공
 *       400:
 *         description: 잘못된 요청
 *       401:
 *         description: 인증 필요
 *       500:
 *         description: 서버 오류
 */
router.post('/level-test/submit', gptController.submitLevelTest);

/* ------------------------------------------------------------------
 * 🧩 퀴즈 뭉치 API (안드 VM: MCQ → OX → SHORT, 총 7문항)
 *  - POST /api/gpt/quiz           : 카테고리별 오늘자 세트 생성/재사용
 *  - GET  /api/gpt/quiz/:batchId  : 세트 조회
 *  - POST /api/gpt/quiz/submit    : 문항 단위 제출/채점
 *  - GET  /api/gpt/summary/daily  : 날짜별 정답률 요약
 * ------------------------------------------------------------------*/

/**
 * @swagger
 * /api/gpt/quiz:
 *   post:
 *     summary: 카테고리별 7문항 세트 생성/재사용 (MCQ 3, OX 2, SHORT 2)
 *     description: 같은 날 같은 카테고리는 가장 최근 세트를 재사용합니다.
 *     tags: [Quiz]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [category]
 *             properties:
 *               category:
 *                 type: string
 *                 enum: [취업준비, 기초, 활용, 심화, 고급]
 *               len:
 *                 type: integer
 *                 example: 80
 *                 description: 각 문제 지문 길이 힌트 (선택)
 *     responses:
 *       200:
 *         description: 생성 또는 재사용 성공
 */
router.post('/quiz', gptController.createOrGetBatch);

/**
 * @swagger
 * /api/gpt/quiz/{batchId}:
 *   get:
 *     summary: 생성된 7문항 세트 조회
 *     tags: [Quiz]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: batchId
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: 세트 조회 성공 }
 *       404: { description: 세트를 찾을 수 없음 }
 */
router.get('/quiz/:batchId', gptController.getBatch);

/**
 * @swagger
 * /api/gpt/quiz/submit:
 *   post:
 *     summary: 문항 단위 제출/채점(서버 판정 저장)
 *     tags: [Quiz]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [batchId, questionIndex, payload]
 *             properties:
 *               batchId:       { type: integer, example: 101 }
 *               questionIndex: { type: integer, example: 3 }
 *               payload:
 *                 type: object
 *                 properties:
 *                   selectedOptionId: { type: integer, example: 2 }
 *                   selectedIsO:      { type: boolean, example: true }
 *                   textAnswer:       { type: string,  example: "성찰" }
 *                 description: MCQ/OX/SHORT 중 해당 타입에 맞는 필드만 전송
 *     responses:
 *       200: { description: 저장/채점 성공 }
 *       404: { description: 문항을 찾을 수 없음 }
 */
router.post('/quiz/submit', gptController.submitAndGrade);

/**
 * @swagger
 * /api/gpt/summary/daily:
 *   get:
 *     summary: 날짜별 퀴즈 응답 요약(정답수/정답률)
 *     tags: [Quiz]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: date
 *         in: query
 *         required: false
 *         schema: { type: string, pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
 *         description: 미전달 시 최근순 전체
 *     responses:
 *       200: { description: 요약 조회 성공 }
 */
router.get('/summary/daily', gptController.getDailySummary);

/**
 * @swagger
 * /api/gpt/study/handwriting:
 *   post:
 *     summary: 사용자의 필사 내용 저장
 *     tags: [Handwriting]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [study_id, content]
 *             properties:
 *               study_id: { type: integer }
 *               content:  { type: string }
 *     responses:
 *       200: { description: 필사 저장 성공 }
 */
router.post('/study/handwriting', gptController.saveHandwriting);

/**
 * @swagger
 * /api/gpt/study/handwriting/{studyId}:
 *   get:
 *     summary: 특정 학습의 필사 내용 조회
 *     tags: [Handwriting]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: studyId
 *         in: path
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: 필사 내용 반환 }
 */
router.get('/study/handwriting/:studyId', gptController.getHandwriting);

/**
 * @swagger
 * /api/gpt/study/complete-reward:
 *   post:
 *     summary: 오늘의 학습 완료 시 포인트 지급 (하루 1회, +15)
 *     tags: [GPT]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: 지급 성공 }
 *       400: { description: 이미 지급됨 또는 학습 없음 }
 */
router.post('/study/complete-reward', gptController.giveTodayStudyPoint);

/**
 * @swagger
 * /api/gpt/level-test/generate:
 *   post:
 *     summary: 레벨 테스트 생성 (DB 프리셋 기반 15문항)
 *     tags: [LevelTest]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stage]
 *             properties:
 *               stage:
 *                 type: integer
 *                 enum: [0,1,2,3]
 *                 description: 0=초기 진단, 1=기초→활용, 2=활용→심화, 3=심화→고급
 *     responses:
 *       200: { description: 생성 성공 }
 *       400: { description: 잘못된 요청 }
 *       500: { description: 서버 오류 }
 */
router.post('/level-test/generate', gptController.generateLevelTest);

/**
 * @swagger
 * /api/gpt/level-test/submit:
 *   post:
 *     summary: 레벨 테스트 제출 및 채점
 *     tags: [LevelTest]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [answers]
 *             properties:
 *               answers:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [questionIndex, choice]
 *                   properties:
 *                     questionIndex: { type: integer }
 *                     choice:        { type: string }
 *     responses:
 *       200: { description: 채점 성공 }
 *       400: { description: 잘못된 요청 }
 *       500: { description: 서버 오류 }
 */
router.post('/level-test/submit', gptController.submitLevelTest);

/**
 * @swagger
 * /api/gpt/quiz/attempt/reward:
 *   post:
 *     summary: 퀴즈 시도 1건 보상 지급 (기본 15p, 전부 정답이면 +5p)
 *     tags: [Quiz]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [attemptId]
 *             properties:
 *               attemptId: { type: integer, example: 123 }
 *     responses:
 *       200: { description: 지급 성공 }
 *       400: { description: 이미 지급됨/요청 오류 }
 *       401: { description: 인증 필요 }
 *       403: { description: 본인 시도 아님 }
 *       404: { description: 시도를 찾을 수 없음 }
 */
router.post('/quiz/attempt/reward', gptController.giveQuizAttemptPoint);

/**
 * @swagger
 * /api/gpt/ai-chat/touch-today:
 *   post:
 *     summary: 오늘 AI 채팅 기록(존재 마킹)
 *     tags: [AI Chat]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: 오늘 AI 채팅 기록 성공 }
 *       400: { description: 요청 오류 }
 *       401: { description: 인증 필요 }
 *       500: { description: 서버 오류 }
 */
router.post('/ai-chat/touch-today', gptController.touchTodayAiChat);

/**
 * @swagger
 * /api/gpt/ai-chat/complete-reward:
 *   post:
 *     summary: AI 채팅 완료 보상 지급 (하루 1회, 15p)
 *     tags: [AI Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: autoTouch
 *         schema:
 *           type: string
 *           enum: [0, 1]
 *         required: false
 *         description: "1로 주면 today_ai_chat 행 없을 때 자동 생성"
 *     responses:
 *       200: { description: 지급 성공 }
 *       400: { description: 이미 지급됨/채팅 내역 없음 }
 *       401: { description: 인증 필요 }
 *       500: { description: 서버 오류 }
 */
router.post('/ai-chat/complete-reward', gptController.giveAiChatDailyReward);


/**
 * @swagger
 * tags:
 *   - name: Levels (3Q)
 *     description: 3문항·4지선다·해설 포함 신규 레벨 테스트 플로우
 */

/**
 * @swagger
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     LevelsQuestion:
 *       type: object
 *       required: [questionIndex, question, options, answerIndex, explanation]
 *       properties:
 *         questionIndex:
 *           type: integer
 *           enum: [1,2,3]
 *           description: 1~3 고정
 *         question:
 *           type: string
 *         options:
 *           type: array
 *           minItems: 4
 *           maxItems: 4
 *           items: { type: string }
 *         answerIndex:
 *           type: integer
 *           minimum: 0
 *           maximum: 3
 *         explanation:
 *           type: string
 *     LevelsGenerateResponse:
 *       type: object
 *       properties:
 *         success: { type: boolean, example: true }
 *         passage: { type: string }
 *         questions:
 *           type: array
 *           minItems: 3
 *           maxItems: 3
 *           items: { $ref: '#/components/schemas/LevelsQuestion' }
 *     LevelsSubmitRequest:
 *       type: object
 *       required: [stage, questions, answers]
 *       properties:
 *         stage:
 *           type: integer
 *           enum: [0,1,2,3]
 *         questions:
 *           type: array
 *           minItems: 3
 *           maxItems: 3
 *           items: { $ref: '#/components/schemas/LevelsQuestion' }
 *         answers:
 *           type: array
 *           minItems: 3
 *           maxItems: 3
 *           items:
 *             type: integer
 *             minimum: 0
 *             maximum: 3
 */

/**
 * @swagger
 * /api/gpt/levels/start:
 *   post:
 *     summary: 레벨 테스트 시작(3문항 플로우)
 *     description: stage=0이면 users.level=0으로 리셋, 동일 user&stage의 기존 시도 삭제
 *     tags: [Levels (3Q)]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stage]
 *             properties:
 *               stage:
 *                 type: integer
 *                 enum: [0,1,2,3]
 *                 example: 1
 *     responses:
 *       200: { description: 시작 처리 성공 }
 *       400: { description: 잘못된 단계 값 }
 *       401: { description: 인증 필요 }
 *       500: { description: 서버 오류 }
 */
router.post('/levels/start', gptController.levelsStart);

/**
 * @swagger
 * /api/gpt/levels/generate:
 *   post:
 *     summary: 글감 + 3문항(4지선다/해설) 생성
 *     tags: [Levels (3Q)]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stage]
 *             properties:
 *               stage:
 *                 type: integer
 *                 enum: [0,1,2,3]
 *                 example: 1
 *     responses:
 *       200:
 *         description: 생성 성공
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/LevelsGenerateResponse' }
 *       400: { description: 잘못된 단계 값 }
 *       401: { description: 인증 필요 }
 *       500: { description: 문제 생성 실패 }
 */
router.post('/levels/generate', gptController.levelsGenerate);

/**
 * @swagger
 * /api/gpt/levels/submit:
 *   post:
 *     summary: 제출/채점/저장(3문항 플로우)
 *     tags: [Levels (3Q)]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/LevelsSubmitRequest' }
 *     responses:
 *       200:
 *         description: 채점/저장 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 correctCount: { type: integer, example: 2 }
 *                 resultLevel: { type: string, enum: [기초,활용,심화,고급], example: 심화 }
 *                 detail:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       questionIndex: { type: integer, example: 1 }
 *                       isCorrect: { type: boolean, example: true }
 *                       answerIndex: { type: integer, example: 2 }
 *                       userChoice: { type: integer, example: 2 }
 *                       explanation: { type: string }
 *       400: { description: 요청 형식 오류 }
 *       401: { description: 인증 필요 }
 *       500: { description: 서버 오류 }
 */
router.post('/levels/submit', gptController.levelsSubmit);


module.exports = router;

