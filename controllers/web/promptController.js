const pool = require("../../config/db_web");

exports.getPrompts = async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM prompts");
    res.json(result.rows);
  } catch (error) {
    console.error("prompts 조회 오류:", error);
    res.status(500).send("서버 오류");
  }
};
