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

// ✅ GET /api/study/progress/week/:date
exports.getStudyProgressByWeek = async (req, res) => {
  const userId = req.user?.id;
  const { date } = req.params;

  if (!userId) return res.status(401).json({ success: false, message: '인증 필요' });
  if (!date) return res.status(400).json({ success: false, message: 'date 파라미터 필요' });

  try {
    // 🗓️ 기준 날짜 계산
    const baseDate = new Date(date);
    const monday = new Date(baseDate);
    monday.setDate(baseDate.getDate() - baseDate.getDay() + 1); // 월요일
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    // 📅 한 달 제한 (현재 날짜 기준 30일 이전까지만)
    const now = new Date();
    const limit = new Date();
    limit.setDate(now.getDate() - 30);
    if (monday < limit) {
      return res.status(403).json({ 
        success: false, 
        message: '한 달 이전의 학습 내역은 조회할 수 없습니다.' 
      });
    }

    // 🧠 이번 주 전체 조회
    const q = `
      SELECT date, progress_step1, progress_step2, progress_step3
      FROM today_study
      WHERE user_id = $1
        AND date BETWEEN $2 AND $3
      ORDER BY date ASC;
    `;
    const { rows } = await pool.query(q, [userId, monday, sunday]);

    // 📊 날짜별 학습 단계 매핑
    const progressMap = {};
    for (let i = 0; i < 7; i++) {
      const cur = new Date(monday);
      cur.setDate(monday.getDate() + i);
      const key = cur.toISOString().slice(0, 10);
      progressMap[key] = 0; // 기본값 0
    }

    rows.forEach(r => {
      let level = 0;
      if (r.progress_step3) level = 3;
      else if (r.progress_step2) level = 2;
      else if (r.progress_step1) level = 1;
      progressMap[r.date.toISOString().slice(0, 10)] = level;
    });

    // ✅ BaseResponse 규격으로 응답
    return res.json({
      success: true,
      result: { progress_map: progressMap }
    });

    //return res.json({ success: true, progress_map: progressMap });
  } catch (e) {
    console.error('getStudyProgressByWeek error:', e);
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