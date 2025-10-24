const pool = require('../config/db');

// ✅ GET /api/study/progress/:date
exports.getStudyProgressByDate = async (req, res) => {
  const userId = req.user?.id;
  const { date } = req.params;

  if (!userId) return res.status(401).json({ success: false, message: '인증 필요' });
  if (!date) return res.status(400).json({ success: false, message: 'date 파라미터 필요' });

  try {
    const q = `
      SELECT progress_step1, progress_step2, progress_step3
      FROM today_study
      WHERE user_id = $1 AND date = $2
      LIMIT 1
    `;
    const { rows } = await pool.query(q, [userId, date]);

    if (rows.length === 0) {
      return res.json({ success: true, progress_level: 0 });
    }

    const s = rows[0];
    let level = 0;
    if (s.progress_step3) level = 3;
    else if (s.progress_step2) level = 2;
    else if (s.progress_step1) level = 1;

    return res.json({ success: true, progress_level: level });
  } catch (e) {
    console.error('getStudyProgressByDate error:', e);
    return res.status(500).json({ success: false, message: '조회 실패' });
  }
};

// ✅ PATCH /api/study/progress
// body: { date: "2025-10-24", step: 1|2|3 }
exports.updateStudyProgress = async (req, res) => {
  const userId = req.user?.id;
  const { date, step } = req.body || {};

  if (!userId) return res.status(401).json({ success: false, message: '인증 필요' });
  if (!date || ![1, 2, 3].includes(step))
    return res.status(400).json({ success: false, message: 'date와 step(1~3)이 필요합니다.' });

  try {
    const column = `progress_step${step}`;
    const q = `
      INSERT INTO today_study (user_id, date, ${column})
      VALUES ($1, $2, true)
      ON CONFLICT (user_id, date)
      DO UPDATE SET ${column} = true, updated_at = NOW()
    `;
    await pool.query(q, [userId, date]);
    return res.json({ success: true, message: `단계 ${step} 완료 저장` });
  } catch (e) {
    console.error('updateStudyProgress error:', e);
    return res.status(500).json({ success: false, message: '업데이트 실패' });
  }
};