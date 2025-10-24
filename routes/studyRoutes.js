const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middlewares/auth');
const { getStudyProgressByDate, updateStudyProgress } = require('../controllers/studyController');

router.get('/progress/:date', verifyToken, getStudyProgressByDate);
router.patch('/progress', verifyToken, updateStudyProgress);

module.exports = router;