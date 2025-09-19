// const express = require('express');
// const multer  = require('multer');

// // 🔻 명시적으로 메모리 스토리지
// const storage = multer.memoryStorage();
// const upload  = multer({
//   storage,
//   limits: { fileSize: 20 * 1024 * 1024 } // 20MB
// });

// const { voiceChat, getVoicePrompt } = require('../controllers/voiceController');

// const router = express.Router();

// /**
//  * @swagger
//  * tags:
//  *   name: Voice
//  *   description: 음성 챗봇 API (STT → GPT → TTS)
//  */

// /**
//  * @swagger
//  * components:
//  *   schemas:
//  *     VoicePromptResponse:
//  *       type: object
//  *       properties:
//  *         success:
//  *           type: boolean
//  *           example: true
//  *         mode:
//  *           type: string
//  *           example: job
//  *         title:
//  *           type: string
//  *           example: 취업준비
//  *         prompt:
//  *           type: string
//  *           example: "[운영 기준 ...]\n\n[취업준비] ..."
//  *     VoiceChatResponse:
//  *       type: object
//  *       properties:
//  *         success:
//  *           type: boolean
//  *           example: true
//  *         mode:
//  *           type: string
//  *           example: job
//  *         userText:
//  *           type: string
//  *           example: "자기소개 1분 분량으로 말해볼게요..."
//  *         text:
//  *           type: string
//  *           example: "좋아요! 우선 현재 전공과 강점을 중심으로 ..."
//  *         audioBase64:
//  *           type: string
//  *           description: MP3를 base64로 인코딩한 문자열
//  *         mimeType:
//  *           type: string
//  *           example: audio/mpeg
//  *         hint:
//  *           type: string
//  *           example: "다시 한 번 해볼까요?"
//  *     ErrorResponse:
//  *       type: object
//  *       properties:
//  *         success:
//  *           type: boolean
//  *           example: false
//  *         message:
//  *           type: string
//  *           example: "voiceChat 실패"
//  */

// /**
//  * @swagger
//  * /api/voice/prompts:
//  *   get:
//  *     summary: 모드별 프롬프트 원문 조회
//  *     tags: [Voice]
//  *     parameters:
//  *       - in: query
//  *         name: mode
//  *         schema:
//  *           type: string
//  *           enum: [job, work, daily]
//  *         description: 프롬프트 모드 (기본값 job)
//  *     responses:
//  *       200:
//  *         description: 성공
//  *         content:
//  *           application/json:
//  *             schema:
//  *               $ref: '#/components/schemas/VoicePromptResponse'
//  *       500:
//  *         description: 서버 오류
//  *         content:
//  *           application/json:
//  *             schema:
//  *               $ref: '#/components/schemas/ErrorResponse'
//  */
// router.get('/prompts', getVoicePrompt);

// /**
//  * @swagger
//  * /api/voice/chat:
//  *   post:
//  *     summary: 음성 대화 (파일 업로드 → STT → GPT → TTS)
//  *     description: >
//  *       - 기본은 JSON(+audioBase64) 응답.  
//  *       - `Accept: audio/mpeg` 헤더 또는 `?as=stream` 쿼리를 쓰면 MP3 바이너리로 바로 응답합니다.
//  *     tags: [Voice]
//  *     requestBody:
//  *       required: true
//  *       content:
//  *         multipart/form-data:
//  *           schema:
//  *             type: object
//  *             properties:
//  *               audio:
//  *                 type: string
//  *                 format: binary
//  *                 description: m4a/mp3/wav 파일
//  *               mode:
//  *                 type: string
//  *                 enum: [job, work, daily]
//  *                 default: job
//  *               systemPrompt:
//  *                 type: string
//  *                 description: (옵션) 시스템 프롬프트 오버라이드
//  *               temperature:
//  *                 type: number
//  *                 default: 0.6
//  *     responses:
//  *       200:
//  *         description: 성공 (기본 JSON 응답)
//  *         content:
//  *           application/json:
//  *             schema:
//  *               $ref: '#/components/schemas/VoiceChatResponse'
//  *           audio/mpeg:
//  *             schema:
//  *               type: string
//  *               format: binary
//  *       400:
//  *         description: 잘못된 요청(파일 누락 등)
//  *         content:
//  *           application/json:
//  *             schema:
//  *               $ref: '#/components/schemas/ErrorResponse'
//  *       500:
//  *         description: 서버 오류
//  *         content:
//  *           application/json:
//  *             schema:
//  *               $ref: '#/components/schemas/ErrorResponse'
//  */
// router.post('/chat', upload.single('audio'), voiceChat);

// module.exports = router;

// routes/voiceRoutes.js
const express = require('express');
const multer  = require('multer');

const storage = multer.memoryStorage();
const upload  = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB
});

const { voiceChat, getVoicePrompt, voiceHello } = require('../controllers/voiceController');
const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Voice
 *   description: 음성 챗봇 API (STT → GPT → TTS)
 */

router.get('/prompts', getVoicePrompt);
router.get('/hello', voiceHello);

/**
 * @swagger
 * /api/voice/chat:
 *   post:
 *     summary: 음성 대화 (파일 업로드 → STT → GPT → TTS)
 *     description: 기본은 JSON(+audioBase64). Accept: audio/mpeg 또는 ?as=stream 시 MP3 바이너리로 응답.
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
 *               mode:
 *                 type: string
 *                 enum: [job, work, daily]
 *                 default: job
 *               systemPrompt:
 *                 type: string
 *               temperature:
 *                 type: number
 *                 default: 0.6
 *     responses:
 *       200: { description: 성공 }
 *       400: { description: 잘못된 요청 }
 *       500: { description: 서버 오류 }
 */
router.post('/chat', upload.single('audio'), voiceChat);

module.exports = router;