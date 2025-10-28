const pool = require("../../config/db_web");

// ✅ 스크랩 추가
exports.addScrap = async (req, res) => {
  const userId = req.user?.id;
  const { writingId } = req.params;
  if (!userId) return res.status(401).json({ message: "로그인이 필요합니다." });

  try {
    await pool.query(
      `INSERT INTO scraps (user_id, writing_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, writing_id) DO NOTHING`,
      [userId, writingId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("❌ 스크랩 추가 오류:", err);
    res.status(500).json({ message: "서버 오류" });
  }
};

// ✅ 스크랩 취소
exports.removeScrap = async (req, res) => {
  const userId = req.user?.id;
  const { writingId } = req.params;
  if (!userId) return res.status(401).json({ message: "로그인이 필요합니다." });

  try {
    await pool.query(
      `DELETE FROM scraps WHERE user_id = $1 AND writing_id = $2`,
      [userId, writingId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("❌ 스크랩 삭제 오류:", err);
    res.status(500).json({ message: "서버 오류" });
  }
};

// ✅ 스크랩 여부 확인
exports.checkScrap = async (req, res) => {
  const userId = req.user?.id;
  const { writingId } = req.params;
  if (!userId) return res.status(401).json({ message: "로그인이 필요합니다." });

  try {
    const result = await pool.query(
      `SELECT id FROM scraps WHERE user_id = $1 AND writing_id = $2`,
      [userId, writingId]
    );
    res.json({ scrapped: result.rows.length > 0 });
  } catch (err) {
    console.error("❌ 스크랩 확인 오류:", err);
    res.status(500).json({ message: "서버 오류" });
  }
};

exports.getMyScraps = async (req, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }

  try {
    const result = await pool.query(
      `
      SELECT 
        w.id,
        w.title,
        w.content,
        w.custom_color AS color,
        w.created_at,
        p.word AS prompt_title,
        COALESCE(u.name, '익명') AS author
      FROM scraps s
      JOIN writings w ON s.writing_id = w.id
      LEFT JOIN prompts p ON w.prompt_id = p.id
      LEFT JOIN users u ON w.user_id = u.id
      WHERE s.user_id = $1
      ORDER BY s.created_at DESC
    `,
      [userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("❌ 스크랩 목록 조회 오류:", error);
    res.status(500).json({ message: "서버 오류" });
  }
};
