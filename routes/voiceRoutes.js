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
 *   description: 음성 챗봇 API (STT → GPT → TTS) — 취준생 맞춤 상황 전용
 */

router.get('/prompts', getVoicePrompt);
router.get('/hello', voiceHello);

/**
 * @swagger
 * /api/voice/chat:
 *   post:
 *     summary: 음성 대화 (파일 업로드 → STT → GPT → TTS)
 *     description: 
 *       취준생 맞춤 상황 전용. 서버는 항상 job 모드로 동작합니다.
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
 *                 default: 0.6
 *     responses:
 *       200:
 *         description: 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 mode:    { type: string, example: "job" }
 *                 userText:{ type: string, description: "STT로 인식된 사용자 발화" }
 *                 text:    { type: string, description: "봇 본문(파란 테두리). 재시도 요청 시 '다시 한 번 해볼까요?'로 시작" }
 *                 hint:    { type: string, nullable: true, description: "TIP 텍스트(있으면 표시)" }
 *                 needRetry:{ type: boolean, description: "true면 직전 사용자 말풍선 빨간 테두리" }
 *                 critique:{ type: string, nullable: true, description: "간단한 오류/표현 피드백 요약" }
 *                 audioBase64:{ type: string, nullable: true }
 *                 mimeType: { type: string, example: "audio/mpeg" }
 *       400: { description: 잘못된 요청 }
 *       500: { description: 서버 오류 }
 */
router.post('/chat', upload.single('audio'), voiceChat);

module.exports = router;