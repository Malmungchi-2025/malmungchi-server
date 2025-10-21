
// module.exports = router;

// routes/voiceRoutes.js
const express = require('express');
const multer  = require('multer');

const storage = multer.memoryStorage();
const upload  = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB
});

// ✅ 컨트롤러: job(기존) + daily(신규) 함께 import
const {
  // job(취준생 맞춤)
  getVoicePrompt,
  voiceHello,
  voiceChat,
  // daily(일상 대화)
  getDailyVoicePrompt,
  dailyVoiceHello,
  dailyVoiceChat,
} = require('../controllers/voiceController');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Voice
 *   description: 음성 챗봇 API (STT → GPT → TTS) — 취준생 맞춤 상황 전용
 */

router.get('/prompts', getVoicePrompt);
router.get('/hello', voiceHello);

/**
 * @swagger
 * /api/voice/chat:
 *   post:
 *     summary: 음성 대화 (파일 업로드 → STT → GPT → TTS)
 *     description: |
        취준생 맞춤 상황 전용. 서버는 항상 job 모드로 동작합니다.
        기본 응답은 JSON(+audioBase64). 
        헤더 Accept: audio/mpeg 또는 쿼리 ?as=stream 사용 시 MP3 바이너리로 응답.
        tags: [Voice]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               audio:
 *                 type: string
 *                 format: binary
 *               systemPrompt:
 *                 type: string
 *                 description: (선택) 서버 기본 프롬프트를 오버라이드할 추가 지시문
 *               temperature:
 *                 type: number
 *                 default: 0.6
 *     responses:
 *       200:
 *         description: 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
                    success:
                      type: boolean
                    mode:
                      type: string
                      example: "job"
                    userText:
                      type: string
                      description: "STT로 인식된 사용자 발화"
                    text:
                      type: string
                      description: "봇 본문(파란 테두리). 재시도 요청 시 '다시 한 번 해볼까요?'로 시작"
                    hint:
                      type: string
                      nullable: true
                      description: "TIP 텍스트(있으면 표시)"
                    needRetry:
                      type: boolean
                      description: "true면 직전 사용자 말풍선 빨간 테두리"
                    critique:
                      type: string
                      description: "간단한 오류/표현 피드백 요약"
                      nullable: true
                    audioBase64:
                      type: string
                      nullable: true
                    mimeType:
                      type: string
                      example: "audio/mpeg"
 *       400: { description: 잘못된 요청 }
 *       500: { description: 서버 오류 }
 */
router.post('/chat', upload.single('audio'), voiceChat);

// =======================
// daily(일상 대화) 라우트
// =======================

/**
 * @swagger
 * /api/voice/daily/prompts:
 *   get:
 *     summary: (daily) 프롬프트 원문 조회
 *     tags: [Voice]
 *     responses:
 *       200:
 *         description: 성공
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VoicePromptResponse'
 *       500:
 *         description: 서버 오류
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/daily/prompts', getDailyVoicePrompt);

/**
 * @swagger
 * /api/voice/daily/hello:
 *   get:
 *     summary: (daily) 서버가 먼저 인사/질문(TTS) 제공
 *     description: |
 *       헤더 `Accept: audio/mpeg` 또는 `?as=stream` 사용 시 MP3 바이너리로 응답, 기본은 JSON(+audioBase64)
 *     tags: [Voice]
 *     responses:
 *       200:
 *         description: 성공
 *       500:
 *         description: 서버 오류
 */
router.get('/daily/hello', dailyVoiceHello);

/**
 * @swagger
 * /api/voice/daily/chat:
 *   post:
 *     summary: (daily) 음성 대화 (파일 업로드 → STT → GPT → TTS)
 *     description: >
 *       일상 대화 전용. 서버는 항상 daily 모드로 동작합니다.
 *       기본 응답은 JSON(+audioBase64).
 *       헤더 Accept: audio/mpeg 또는 쿼리 ?as=stream 사용 시 MP3 바이너리로 응답.
 *     tags: [Voice]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               audio:
 *                 type: string
 *                 format: binary
 *               systemPrompt:
 *                 type: string
 *                 description: (선택) 서버 기본 프롬프트를 오버라이드할 추가 지시문
 *               temperature:
 *                 type: number
 *                 default: 0.7
 *     responses:
 *       200:
 *         description: 성공
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VoiceChatResponse'
 *           audio/mpeg:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: 잘못된 요청
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: 서버 오류
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/daily/chat', upload.single('audio'), dailyVoiceChat);

module.exports = router;