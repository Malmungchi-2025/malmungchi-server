const express = require('express');
const router = express.Router();
const { auth } = require('../middlewares/auth'); // ✅ 수정
const { getStudyProgressByDate, updateStudyProgress } = require('../controllers/studyController');

// ✅ 변경된 미들웨어 이름 반영
router.get('/progress/:date', authMiddleware, getStudyProgressByDate);
router.get('/progress/week/:date', authMiddleware, getStudyProgressByWeek); // ✅ 추가
router.patch('/progress', authMiddleware, updateStudyProgress);
module.exports = router;