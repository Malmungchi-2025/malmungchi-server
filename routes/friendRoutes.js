const express = require('express');
const router = express.Router();
const { addFriendByCode } = require('../controllers/friendController');

// 🔒 인증 미들웨어는 프로젝트에서 쓰는 걸로 교체하세요.
const requireAuth = require('../middleware/auth'); // 예: module.exports = (req,res,next)=>{...}

router.post('/by-code', requireAuth, addFriendByCode);

module.exports = router;