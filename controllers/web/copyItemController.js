const pool = require("../../config/db_web");

exports.getRandomCopyItem = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, title, author,
             COALESCE(cover_url, '/images/exbook1.png') AS cover_url,
             content
      FROM copy_items
      ORDER BY random()
      LIMIT 1
    `);

    if (result.rows.length > 0) res.json(result.rows[0]);
    else res.status(404).json({ error: "No data found" });
  } catch (error) {
    console.error("❌ DB 조회 오류:", error);
    res.status(500).json({ error: "서버 오류" });
  }
};

exports.getCopyItemById = async (req, res) => {
  const { id } = req.params;
  try {
    const q = `
      SELECT id, title, author,
             COALESCE(cover_url, '/images/exbook1.png') AS cover_url,
             content
      FROM copy_items
      WHERE id = $1
    `;
    const result = await pool.query(q, [id]);
    if (result.rows.length === 0)
      return res.status(404).json({ error: "No data" });
    res.json(result.rows[0]);
  } catch (e) {
    console.error("❌ 단건 조회 오류:", e);
    res.status(500).json({ error: "서버 오류" });
  }
};
