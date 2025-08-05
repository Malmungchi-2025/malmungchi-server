const axios = require('axios');
const pool = require('../config/db');  // ✅ 공용 pool 사용
/**
 * 1. 오늘의 학습 글감 생성 API
 * POST /api/gpt/generate-quote
 */
exports.generateQuote = async (req, res) => {
  const userId = req.user?.id || null;
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

    // 4. 글에서 단어 추출 & vocabulary 저장 (자동)
    await saveVocabulary(studyId, generatedText);

    res.json({ success: true, result: generatedText });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'GPT API 오류' });
  }
};

/**
 * GPT 단어 추출 → DB 저장
 */
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

/**
 * 2. 단어 검색 API (GPT, DB 저장 없음)
 * POST /api/vocabulary/search
 */
exports.searchWordDefinition = async (req, res) => {
  const { word } = req.body;
  if (!word) return res.status(400).json({ success: false, message: '단어 필요' });

  try {
    const prompt = `"${word}"의 국립국어원 기준 정의와 예문을 JSON으로 반환해줘. {"word":"","meaning":"","example":""} 형식으로.`;

    const gptRes = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
      },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );

    const result = JSON.parse(gptRes.data.choices[0].message.content);
    res.json({ success: true, result });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: '단어 검색 실패' });
  }
};

/**
 * 3. 단어 저장 API (프론트에서 저장 버튼 클릭 시 호출)
 * POST /api/vocabulary
 */
exports.saveVocabularyManual = async (req, res) => {
  const { study_id, word, meaning, example } = req.body;
  if (!study_id || !word || !meaning) {
    return res.status(400).json({ success: false, message: '필수 값 누락' });
  }

  try {
    await pool.query(
      `INSERT INTO vocabulary (study_id, word, meaning, example) VALUES ($1, $2, $3, $4)`,
      [study_id, word, meaning, example || null]
    );
    res.json({ success: true, message: '단어가 저장되었습니다.' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: '단어 저장 실패' });
  }
};

/**
 * 4. 단어 목록 조회 API (특정 학습 문단의 단어들)
 * GET /api/vocabulary/:studyId
 */
exports.getVocabularyByStudy = async (req, res) => {
  const { studyId } = req.params;
  try {
    const result = await pool.query(
      `SELECT word, meaning, example FROM vocabulary WHERE study_id = $1`,
      [studyId]
    );
    res.json({ success: true, words: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '단어 조회 실패' });
  }
};