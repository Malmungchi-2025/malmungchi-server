const express = require("express");
const {
  createWriting,
  getWritingsByPrompt,
  getMyWritings,
  getWritingById,
  getAllPublishedWritings,
} = require("../../controllers/web/writingController");
const { auth, requireLogin } = require("../../utils/authMiddleware_web");
const router = express.Router();
router.use(auth);

// ✅ 공개용 (로그인 안 해도 접근 가능)
router.get("/", getWritingsByPrompt);
router.get("/allpost", getAllPublishedWritings);
// router.post("/", createWriting);
// router.get("/", getWritingsByPrompt);
// ✅ 로그인한 사용자만 접근 가능한 라우트
router.get("/my", requireLogin, getMyWritings);
router.post("/", requireLogin, createWriting);
router.get("/:id", requireLogin, getWritingById);

module.exports = router;
