const { Pool } = require('pg');
const axios = require('axios');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// 글감 생성 API
exports.generateQuote = async (req, res) => {
  const userId = req.user?.id || null; // JWT 인증 사용 시
  const today = new Date().toISOString().split('T')[0];

  try {
    // 1. 오늘 글감 있는지 체크
    const checkQuery = `SELECT * FROM today_study WHERE date = $1 AND user_id IS NOT DISTINCT FROM $2 LIMIT 1`;
    const existing = await pool.query(checkQuery, [today, userId]);

    if (existing.rows.length > 0) {
      return res.json({ success: true, result: existing.rows[0].content });
    }

    // 2. GPT 호출
    const prompt = `
      20대 사회초년생을 위한 문해력 학습용 글을 작성해줘.
      조건: 쉬운 단어, 480~520자, 직장/일상/친구/습관 주제.
    `;
    const gptRes = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
      },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );

    const generatedText = gptRes.data.choices[0].message.content;

    // 3. DB 저장
    const insertQuery = `
      INSERT INTO today_study (user_id, content, date)
      VALUES ($1, $2, $3)
      RETURNING study_id
    `;
    const inserted = await pool.query(insertQuery, [userId, generatedText, today]);
    const studyId = inserted.rows[0].study_id;

    // 4. 글에서 단어 추출 & vocabulary 저장
    await saveVocabulary(studyId, generatedText);

    res.json({ success: true, result: generatedText });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'GPT API 오류' });
  }
};

// 단어 추출 & 저장 함수
async function saveVocabulary(studyId, content) {
  try {
    const prompt = `
      다음 글에서 중요한 단어 5개를 선택하고,
      각 단어의 정의와 예문을 JSON 배열 형식으로 반환해줘.
      형식: [{"word":"단어","meaning":"정의","example":"예문"}, ...]
      
      글: ${content}
    `;

    const gptRes = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
      },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );

    const words = JSON.parse(gptRes.data.choices[0].message.content);

    for (const w of words) {
      await pool.query(
        `INSERT INTO vocabulary (study_id, word, meaning, example) VALUES ($1, $2, $3, $4)`,
        [studyId, w.word, w.meaning, w.example]
      );
    }
  } catch (err) {
    console.error('단어 저장 오류:', err.message);
  }
}