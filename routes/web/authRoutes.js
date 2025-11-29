const express = require("express");
const router = express.Router();
const {
  login: loginUser,
  loginWeb, // ✅ 로컬 테스트 전용
  getUserProfile,
  updateProfileImage,
} = require("../../controllers/web/authController");

// 추가
const { auth, requireLogin } = require("../../utils/authMiddleware_web");

// ==================================================
// ✅ [유지] 기본 로그인 라우트 (앱/웹 공용)
// ==================================================
router.post("/login", loginUser);

// ==================================================
// ✅ [로컬 테스트 전용] 웹 로그인 라우트
// - React 프론트엔드에서 /api/auth/login/web 로 요청
// - 나중에 깃허브 push 전에 삭제 가능
// ==================================================
router.post("/login/web", loginWeb);

// 추가
// router.get("/me", auth, requireLogin, async (req, res) => {
//   res.json({
//     id: req.user.id,
//     email: req.user.email,
//     isVerified: req.user.isVerified,
//   });
// });
router.get("/me", auth, requireLogin, getUserProfile);

// 프로필 업로드 추가(예원)
router.patch("/profile-image", auth, requireLogin, updateProfileImage);

module.exports = router;
