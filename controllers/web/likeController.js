const pool = require("../../config/db_web");

// ✅ 좋아요 추가
exports.addLike = async (req, res) => {
  const userId = req.user?.id;
  const { writingId } = req.params;
  if (!userId) return res.status(401).json({ message: "로그인이 필요합니다." });

  try {
    await pool.query(
      `INSERT INTO likes (user_id, writing_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, writing_id) DO NOTHING`,
      [userId, writingId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("❌ 좋아요 추가 오류:", err);
    res.status(500).json({ message: "서버 오류" });
  }
};

// ✅ 좋아요 취소
exports.removeLike = async (req, res) => {
  const userId = req.user?.id;
  const { writingId } = req.params;
  if (!userId) return res.status(401).json({ message: "로그인이 필요합니다." });

  try {
    await pool.query(
      `DELETE FROM likes WHERE user_id = $1 AND writing_id = $2`,
      [userId, writingId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("❌ 좋아요 삭제 오류:", err);
    res.status(500).json({ message: "서버 오류" });
  }
};

// ✅ 좋아요 여부 확인
exports.checkLike = async (req, res) => {
  const userId = req.user?.id;
  const { writingId } = req.params;
  if (!userId) return res.status(401).json({ message: "로그인이 필요합니다." });

  try {
    const result = await pool.query(
      `SELECT id FROM likes WHERE user_id = $1 AND writing_id = $2`,
      [userId, writingId]
    );
    res.json({ liked: result.rows.length > 0 });
  } catch (err) {
    console.error("❌ 좋아요 확인 오류:", err);
    res.status(500).json({ message: "서버 오류" });
  }
};
