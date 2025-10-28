const pool = require("../../config/db_web");

exports.createWriting = async (req, res) => {
  const userId = req.user?.id; // ✅ 로그인된 사용자 ID (authMiddleware에서 설정)
  const { title, content, promptId, isPublished, customColor } = req.body;

  if (!userId) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO writings (user_id, title, content, prompt_id, is_published, custom_color)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, title, content, promptId, isPublished, customColor]
    );

    res.json({ success: true, writing: result.rows[0] });
  } catch (error) {
    console.error("❌ DB 저장 오류:", error);
    res.status(500).json({ success: false });
  }
};

exports.getWritingsByPrompt = async (req, res) => {
  const promptId = req.query.promptId;
  try {
    const result = await pool.query(
      `SELECT * FROM writings
       WHERE prompt_id = $1 AND is_published = true
       ORDER BY created_at DESC`,
      [promptId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("❌ DB 조회 오류:", error);
    res.status(500).json({ error: "서버 오류" });
  }
};

exports.getMyWritings = async (req, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: "로그인이 필요합니다." });
  }

  try {
    const result = await pool.query(
      `SELECT 
      w.id,
      w.title,
      w.content,
      w.prompt_id,
      p.word AS prompt_title,         -- ✅ 글감 제목 추가
      w.custom_color AS color,
      w.created_at
   FROM writings w
   LEFT JOIN prompts p ON w.prompt_id = p.id
   WHERE w.user_id = $1
   ORDER BY w.created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("❌ 내 글 조회 오류:", error);
    res.status(500).json({ error: "서버 오류" });
  }
};

exports.getWritingById = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT 
         w.id,
         w.title,
         w.content,
         w.created_at,
         w.is_published,
         w.custom_color AS color,
         p.word AS prompt_title,
         COALESCE(u.name, '익명') AS author,
         COUNT(DISTINCT l.id) AS likes,
         COUNT(DISTINCT s.id) AS scraps
       FROM writings w
       LEFT JOIN prompts p ON w.prompt_id = p.id
       LEFT JOIN users u ON w.user_id = u.id
       LEFT JOIN likes l ON w.id = l.writing_id
       LEFT JOIN scraps s ON w.id = s.writing_id
       WHERE w.id = $1
       GROUP BY w.id, w.title, w.content, w.created_at, w.is_published, w.custom_color, p.word, u.name;`,
      [id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ message: "해당 글을 찾을 수 없습니다." });

    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ 글 단건 조회 오류:", error);
    res.status(500).json({ message: "서버 오류" });
  }
};

// ✅ 전체 공개글 조회 (좋아요/스크랩 포함)
exports.getAllPublishedWritings = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        w.id,
        w.title,
        w.content,
        w.custom_color AS color,
        w.created_at,
        COALESCE(u.name, '익명') AS author,  -- ✅ 여기 수정됨
        COUNT(DISTINCT l.id) AS likes,
        COUNT(DISTINCT s.id) AS scraps
      FROM writings w
      LEFT JOIN users u ON w.user_id = u.id
      LEFT JOIN likes l ON w.id = l.writing_id
      LEFT JOIN scraps s ON w.id = s.writing_id
      WHERE w.is_published = true
      GROUP BY w.id, w.title, w.content, w.custom_color, w.created_at, u.name
      ORDER BY w.created_at DESC;
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("❌ 전체글 조회 오류:", error);
    res.status(500).json({ message: "서버 오류", detail: error.message });
  }
};
