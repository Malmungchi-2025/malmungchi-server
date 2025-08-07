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
    // ✅ userId가 없으면 무조건 새로 생성
    const checkQuery = `
      SELECT * FROM today_study 
      WHERE date = $1 AND user_id IS NOT DISTINCT FROM $2 
      LIMIT 1
    `;
    const existing = await pool.query(checkQuery, [today, userId]);

    if (existing.rows.length > 0) {
      return res.json({
        success: true,
        result: existing.rows[0].content,
        studyId: existing.rows[0].study_id
      });
    }

    // ✅ GPT 호출
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

    // ✅ DB 저장
    const insertQuery = `
      INSERT INTO today_study (user_id, content, date)
      VALUES ($1, $2, $3)
      RETURNING study_id
    `;
    const inserted = await pool.query(insertQuery, [userId, generatedText, today]);
    const studyId = inserted.rows[0].study_id;

    // ✅ 단어 저장 로직
    await saveVocabulary(studyId, generatedText);

    res.json({ success: true, result: generatedText, studyId });
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
    res.json({
      success: true,
      result: result.rows,   // ✅ 프론트가 기대하는 필드명으로 변경
      message: null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '단어 조회 실패' });
  }
};
/**
 * ✅ 5. 필사 내용 저장 API
 * POST /api/study/handwriting
 */
exports.saveHandwriting = async (req, res) => {
  const { study_id, content } = req.body;
  const userId = req.user?.id || null;

  if (!study_id || !content) {
    return res.status(400).json({ success: false, message: "필수 값 누락" });
  }

  try {
    await pool.query(
      `UPDATE today_study SET handwriting = $1 WHERE study_id = $2 AND user_id IS NOT DISTINCT FROM $3`,
      [content, study_id, userId]
    );
    res.json({ success: true, message: "필사 내용 저장 완료" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "필사 저장 실패" });
  }
};

/**
 * ✅ 6. 필사 내용 조회 API
 * GET /api/study/handwriting/:studyId
 */
exports.getHandwriting = async (req, res) => {
  const { studyId } = req.params;
  const userId = req.user?.id || null;

  try {
    const result = await pool.query(
      `SELECT handwriting FROM today_study WHERE study_id = $1 AND user_id IS NOT DISTINCT FROM $2 LIMIT 1`,
      [studyId, userId]
    );

    if (result.rows.length === 0) {
      return res.json({ success: true, result: "" }); // ✅ 필사 내용이 없으면 빈 문자열 반환
    }

    res.json({ success: true, result: result.rows[0].handwriting });
  } catch (err) {
    console.error("필사 내용 조회 실패:", err.message);
    res.status(500).json({ success: false, message: "필사 내용 조회 실패" });
  }
};

/*gpt로 퀴즈 생성 */
exports.generateQuiz = async (req, res) => {
  const { text, studyId } = req.body;

  if (!text || !studyId) {
    return res.status(400).json({ success: false, message: 'text 또는 studyId가 필요합니다.' });
  }

  try {
    // ✅ 중복 생성 방지
    const existing = await pool.query(
      `SELECT 1 FROM quiz_set WHERE study_id = $1 LIMIT 1`,
      [studyId]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, message: '이미 퀴즈가 생성되어 있습니다.' });
    }

    const prompt = `
너는 국어 교사야. 아래 글을 바탕으로 다음 문제 유형 중 3가지를 **랜덤으로 하나씩 골라서**, 각 유형에 맞는 객관식 문제를 **한 문장 질문으로만** 만들어줘.

[문제 유형]
1. 이 글의 핵심 내용을 가장 잘 요약한 것은?
2. 이 글을 읽고 추론할 수 있는 것은?
3. 이 글의 가장 적절한 제목을 선택하시오.
4. 이 글의 가장 적절한 결론은?
5. 해당 문장에 쓰인 단어와 같은 의미로 사용된 문장은?

[출력 형식]
[
  {
    "type": "이 글의 가장 적절한 결론은?",
    "question": "글의 마지막에서 강조된 삶의 태도는 무엇인가?",
    "options": ["포기", "도전", "불안", "냉소"],
    "answer": "도전",
    "explanation": "글의 결말에서 도전하는 자세가 중요하다고 강조했기 때문입니다."
  },
  ...
]

[반드시 지켜야 할 조건]
- JSON 배열로만 출력할 것 (그 외 설명 절대 X)
- 각 문제는 서로 다른 유형이어야 함
- options는 무조건 4개이며 answer는 그 중 하나
- **question은 반드시 유형에 맞는 자연스러운 한 문장**으로 작성 (부가설명·번호 금지)
- **question에 "1/3", "2/3" 같은 숫자 포함 금지**
- type은 유지하되 화면에는 표시하지 않을 예정이므로, 실제 질문은 question에만 들어가야 함

다음 글을 기반으로 문제를 생성해줘:
"""${text}"""
`;

    const gptRes = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const raw = gptRes.data.choices[0].message.content;

    let quizzes;
    try {
      quizzes = JSON.parse(raw);
    } catch (err) {
      console.error('❌ GPT 응답 파싱 실패:', raw);
      return res.status(500).json({ success: false, message: 'GPT 응답을 JSON으로 파싱할 수 없습니다.', raw });
    }

    // ✅ DB 저장
    for (let i = 0; i < quizzes.length; i++) {
      const q = quizzes[i];
      await pool.query(
        `INSERT INTO quiz_set (
          study_id, question_index, type, question, options, answer, explanation
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          studyId,
          i + 1,
          q.type || '유형 없음',
          q.question,
          JSON.stringify(q.options),  // ✅ 핵심 수정
          q.answer,
          q.explanation
        ]
      );
}

    res.json({ success: true, quizzes });

  } catch (err) {
    console.error('❌ GPT API 오류:', err.message);
    res.status(500).json({ success: false, message: '퀴즈 생성 실패' });
  }
};

//특정 학습 글의 퀴즈 모두 조회
exports.getQuizzesByStudyId = async (req, res) => {
  const { studyId } = req.params;

  try {
    const result = await pool.query(
      `SELECT question_index, question, options, answer, explanation FROM quiz_set WHERE study_id = $1 ORDER BY question_index`,
      [studyId]
    );

    const quizzes = result.rows.map(row => ({
      questionIndex: row.question_index,
      question: row.question,
      options: row.options,
      answer: row.answer,
      explanation: row.explanation
    }));

    res.json({ success: true, quizzes });
  } catch (err) {
    console.error('❌ 퀴즈 조회 실패:', err.message);
    res.status(500).json({ success: false, message: '퀴즈 조회 실패' });
  }
};

//퀴즈에 대한 사용자의 응답 저장
exports.saveQuizAnswer = async (req, res) => {
  const { studyId, questionIndex, userChoice, isCorrect } = req.body;

  if (!studyId || !questionIndex || !userChoice || isCorrect == null) {
    return res.status(400).json({ success: false, message: '필수 값 누락' });
  }

  try {
    await pool.query(
      `UPDATE quiz_set
       SET user_choice = $1,
           is_correct = $2
       WHERE study_id = $3 AND question_index = $4`,
      [userChoice, isCorrect, studyId, questionIndex]
    );

    res.json({ success: true, message: '응답 저장 완료' });
  } catch (err) {
    console.error('❌ 응답 저장 실패:', err.message);
    res.status(500).json({ success: false, message: '응답 저장 실패' });
  }
};