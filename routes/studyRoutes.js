// src/routes/studyRoutes.js
const express = require('express');
const router = express.Router();
const { auth } = require('../middlewares/auth');
const {
  getStudyProgressByDate,
  getStudyProgressByWeek,
  updateStudyProgress
} = require('../controllers/studyController');

// ✅ 단일 날짜 조회
router.get('/progress/:date', auth, getStudyProgressByDate);

// ✅ 주간 조회
router.get('/progress/week/:date', auth, getStudyProgressByWeek);

// ✅ 학습 단계 업데이트
router.patch('/progress', auth, updateStudyProgress);

module.exports = router;
