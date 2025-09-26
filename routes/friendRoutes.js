const express = require('express');
const router = express.Router();
const { addFriendByCode } = require('../controllers/friendController');

// ✅ 우리 프로젝트 미들웨어 (토큰 파싱은 global, 보호는 여기서)
const { requireLogin } = require('../middlewares/auth');
router.post('/by-code', requireAuth, addFriendByCode);

module.exports = router;