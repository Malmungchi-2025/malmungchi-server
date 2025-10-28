const express = require("express");
const { auth, requireLogin } = require("../../utils/authMiddleware_web");
const {
  addLike,
  removeLike,
  checkLike,
} = require("../../controllers/web/likeController");

const router = express.Router();

router.use(auth);
router.post("/:writingId", requireLogin, addLike);
router.delete("/:writingId", requireLogin, removeLike);
router.get("/:writingId", requireLogin, checkLike);

module.exports = router;
