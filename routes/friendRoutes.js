// const express = require('express');
// const router = express.Router();
// const { addFriendByCode } = require('../controllers/friendController');

// // ✅ 우리 프로젝트 미들웨어 (토큰 파싱은 global, 보호는 여기서)
// const { requireLogin } = require('../middlewares/auth');
// router.post('/by-code', requireLogin, addFriendByCode);

// router.get('/ranking', requireLogin, getFriendsRanking);       // 친구 랭킹
// router.get('/ranking/all', requireLogin, getGlobalRanking);    // 전체 랭킹

// module.exports = router;

// routes/friendRoutes.js
const router = require('express').Router();
const {
  addFriendByCode,
  getFriendsRanking,
  getGlobalRanking,
} = require('../controllers/friendController');

const { requireLogin } = require('../middlewares/auth');

// 친구 추가(코드)
router.post('/by-code', requireLogin, addFriendByCode);

// 친구 랭킹(내 친구들만)
router.get('/ranking', requireLogin, getFriendsRanking);

// 전체 랭킹(모든 유저)
router.get('/ranking/all', requireLogin, getGlobalRanking);

module.exports = router;

//router.get('/ping', (req, res) => res.json({ ok: true, where: 'friends' }));