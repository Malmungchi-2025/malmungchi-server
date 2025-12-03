const express = require("express");
const {
  createTranscription,
  getMyTranscriptions,
  getTranscriptionById,
  addUserPoints,
} = require("../../controllers/web/transcriptionController");
const { auth, requireLogin } = require("../../utils/authMiddleware_web");

const router = express.Router();

// 필사 저장
router.post("/", auth, requireLogin, createTranscription);

// 내 필사 기록 조회
router.get("/me", auth, requireLogin, getMyTranscriptions);

// 단일 필사 조회 (글확인 페이지)
router.get("/:id", getTranscriptionById);

// 포인트 누적 (XP 지급)
router.patch("/points", auth, requireLogin, addUserPoints);

module.exports = router;
