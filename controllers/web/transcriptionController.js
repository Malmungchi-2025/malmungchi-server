const pool = require("../../config/db_web");

// 필사 저장
const createTranscription = async (req, res) => {
  const userId = req.user.id; // authMiddleware에서 세팅해줘야 함
  const {
    type,
    sourceId,
    customTitle,
    customContent,
    typedContent,
    customColor,
  } = req.body;

  if (!typedContent || typedContent.trim() === "") {
    return res.status(400).json({ message: "필사 내용이 비어있습니다." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO transcriptions 
       (user_id, type, source_id, custom_title, custom_content, typed_content, custom_color) 
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        userId,
        type,
        sourceId,
        customTitle,
        customContent,
        typedContent,
        customColor,
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("❌ createTranscription error:", err);
    res.status(500).json({ message: "DB 저장 실패" });
  }
};

// 내 필사 기록 조회
const getMyTranscriptions = async (req, res) => {
  const userId = req.user.id;
  try {
    // const result = await pool.query(
    //   `SELECT * FROM transcriptions WHERE user_id=$1 ORDER BY created_at DESC`,
    //   [userId]
    // );
    // res.json(result.rows);
    const result = await pool.query(
      `SELECT t.id, t.type, t.custom_title, t.custom_content, t.typed_content,
           t.created_at,t.custom_color,
           c.id AS source_id, c.title AS source_title,
           c.author AS source_author,
           c.cover_url AS source_cover_url
    FROM transcriptions t
    LEFT JOIN copy_items c ON t.source_id = c.id
    WHERE t.user_id = $1
    ORDER BY t.created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("❌ getMyTranscriptions error:", err);
    res.status(500).json({ message: "DB 조회 실패" });
  }
};

// 특정 필사글 상세 조회 (글 확인 페이지용)
const getTranscriptionById = async (req, res) => {
  const { id } = req.params; // URL에서 필사 ID 받기

  try {
    const result = await pool.query(
      `
      SELECT 
        t.id,
        COALESCE(t.custom_title, c.title) AS title,
        CASE 
          WHEN t.type = 'custom' THEN '사용자'  
          ELSE c.author                              
        END AS author,
        t.typed_content AS content
      FROM transcriptions t
      LEFT JOIN copy_items c ON t.source_id = c.id
      WHERE t.id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "해당 필사글을 찾을 수 없습니다." });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("❌ getTranscriptionById error:", err);
    res.status(500).json({ message: "DB 조회 실패" });
  }
};

// 포인트 누적 저장
const addUserPoints = async (req, res) => {
  const userId = req.user.id;
  const { point } = req.body;

  if (!point || typeof point !== "number") {
    return res.status(400).json({ message: "유효한 포인트 값이 필요합니다." });
  }

  try {
    await pool.query(`UPDATE users SET point = point + $1 WHERE id = $2`, [
      point,
      userId,
    ]);
    res.status(200).json({ message: "포인트가 누적되었습니다.", added: point });
  } catch (err) {
    console.error("❌ addUserPoints error:", err);
    res.status(500).json({ message: "포인트 업데이트 실패" });
  }
};

module.exports = {
  createTranscription,
  getMyTranscriptions,
  getTranscriptionById,
  addUserPoints,
};
