const express = require("express");
const { auth, requireLogin } = require("../../utils/authMiddleware_web");
const {
  addScrap,
  removeScrap,
  checkScrap,
  getMyScraps,
} = require("../../controllers/web/scrapController");

const router = express.Router();

router.use(auth);
// ✅ 내가 스크랩한 글 목록 불러오기 (⚠️ 항상 다른 /:writingId 라우트보다 위에 위치해야 함)
router.get("/my", requireLogin, getMyScraps);

// ✅ 특정 글 스크랩 여부 확인
router.get("/:writingId", requireLogin, checkScrap);

// ✅ 스크랩 추가
router.post("/:writingId", requireLogin, addScrap);

// ✅ 스크랩 취소
router.delete("/:writingId", requireLogin, removeScrap);

module.exports = router;
