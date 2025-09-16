// routes/voiceRoutes.js
const express = require('express');
const multer  = require('multer');

// 🔻 명시적으로 메모리 스토리지
const storage = multer.memoryStorage();
const upload  = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB
});

const { voiceChat, getVoicePrompt } = require('../controllers/voiceController');

const router = express.Router();
router.get('/prompts', getVoicePrompt);
router.post('/chat', upload.single('audio'), voiceChat);
module.exports = router;
