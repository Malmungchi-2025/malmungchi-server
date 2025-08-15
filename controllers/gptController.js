// controllers/gptController.js
const axios = require('axios');
const pool = require('../config/db');  // ✅ 공용 pool 사용

// ✅ 로그인 필수 전제: app 레벨에서 requireLogin 미들웨어로 보호할 것
//    예) app.use('/api/gpt', auth, requireLogin, gptRoutes);

// 1) KST 기준 yyyy-mm-dd
function getKstToday() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
  return fmt.format(new Date()); // e.g., "2025-08-12"
}

// ──────────────────────────────────────────────────────────────
// 공용 헬퍼: 오늘 study_id 조회(해당 user의 오늘 것만)
// ──────────────────────────────────────────────────────────────
async function getTodayStudyIdOrNull(userId) {
  const today = getKstToday();
  const q = `
    SELECT study_id
      FROM today_study
     WHERE date = $1
       AND user_id = $2
     LIMIT 1
  `;
  const r = await pool.query(q, [today, userId]);
  return r.rows[0]?.study_id ?? null;
}

// ──────────────────────────────────────────────────────────────
/** 공용 헬퍼: study가 사용자 소유인지 검사 (없으면 null, 아니면 row 반환) */
async function getStudyForUserOrNull(studyId, userId) {
  const q = `SELECT study_id, user_id, date FROM today_study WHERE study_id = $1 AND user_id = $2 LIMIT 1`;
  const r = await pool.query(q, [studyId, userId]);
  return r.rows[0] ?? null;
}

// ──────────────────────────────────────────────────────────────
/** 공용 헬퍼: study가 사용자 소유인지 강제 (아니면 404/403 던짐) */
async function assertStudyOwnerOrThrow(studyId, userId) {
  const row = await getStudyForUserOrNull(studyId, userId);
  if (!row) {
    const err = new Error('해당 학습(study)이 없거나 접근 권한이 없습니다.');
    err.status = 404;
    throw err;
  }
  return row;
}

// ──────────────────────────────────────────────────────────────
/** GPT 단어 추출 → DB 저장 (기능 동일) */
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
        `INSERT INTO vocabulary (study_id, word, meaning, example)
         VALUES ($1, $2, $3, $4)`,
        [studyId, w.word, w.meaning, w.example]
      );
    }
  } catch (err) {
    console.error('단어 저장 오류:', err.message);
  }
}

// ──────────────────────────────────────────────────────────────
/**
 * 1. 오늘의 학습 글감 생성 API
 * POST /api/gpt/generate-quote
 *  - ✅ user_id 필수
 *  - ✅ (user_id, date) UNIQUE에 맞춰 UPSERT
 */
exports.generateQuote = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '인증 필요' });

    const today = getKstToday();

    // 1) 이미 있으면 그대로 반환
    const checkQuery = `
      SELECT study_id, content
        FROM today_study
       WHERE date = $1
         AND user_id = $2
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

    const topics = ['직장', '일상', '친구', '습관'];
    const seed = Math.floor(Math.random()*100000);
    const prompt = `
    오늘 날짜: ${today}, 난수: ${seed}
    아래 4개 주제를 돌아가며 1개만 선택해 글을 작성해줘(최근 7일 동안 쓴 것과 중복 금지): ${topics.join(', ')}
    조건: 쉬운 단어, 480~520자, 오늘만의 포인트 1개 포함.
    출력은 본문 텍스트만(코드블록 금지).
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

    // 3) UPSERT 저장 (user_id, date 유니크)
    const insertQuery = `
      INSERT INTO today_study (user_id, content, date)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, date)
      DO UPDATE SET content = EXCLUDED.content
      RETURNING study_id
    `;
    const inserted = await pool.query(insertQuery, [userId, generatedText, today]);
    const studyId = inserted.rows[0].study_id;

    // 4) 단어 자동 추출 저장 (기능 동일)
    await saveVocabulary(studyId, generatedText);

    res.json({ success: true, result: generatedText, studyId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'GPT API 오류' });
  }
};

// ──────────────────────────────────────────────────────────────
/**
 * 2. 단어 검색 (GPT, DB 저장 없음)
 * POST /api/vocabulary/search
 *  - user_id 불필요 (검색만)
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

// ──────────────────────────────────────────────────────────────
/**
 * 3. 단어 저장 (프론트 저장 버튼)
 * POST /api/vocabulary
 *  - ✅ user_id 필수
 *  - ✅ study_id가 해당 user의 것인지 검증
 *  - ✅ study_id 미지정 시: 해당 user의 오늘 study로 보정
 */
exports.saveVocabularyManual = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '인증 필요' });

    let { study_id, word, meaning, example } = req.body;
    if (!word || !meaning) {
      return res.status(400).json({ success: false, message: '필수 값 누락' });
    }

    // study_id 보정: 없거나 오늘 것과 다르면 오늘 것으로 교체
    const todayStudyId = await getTodayStudyIdOrNull(userId);
    if (!study_id || (todayStudyId && study_id != todayStudyId)) {
      study_id = todayStudyId;
    }
    if (!study_id) {
      return res.status(400).json({ success: false, message: '오늘의 학습이 없습니다. 먼저 글감을 생성하세요.' });
    }

    // 소유권 확인
    await assertStudyOwnerOrThrow(study_id, userId);

    await pool.query(
      `INSERT INTO vocabulary (study_id, word, meaning, example)
       VALUES ($1, $2, $3, $4)`,
      [study_id, word, meaning, example || null]
    );
    res.json({ success: true, message: '단어가 저장되었습니다.' });
  } catch (err) {
    console.error(err.message);
    res.status(err.status || 500).json({ success: false, message: err.message || '단어 저장 실패' });
  }
};

// ──────────────────────────────────────────────────────────────
/**
 * 4. 단어 목록 조회 (특정 학습 문단의 단어들)
 * GET /api/vocabulary/:studyId[?today=1]
 *  - ✅ user_id 필수
 *  - ✅ study가 해당 user의 것인지 검증 후 조회
 */
exports.getVocabularyByStudy = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '인증 필요' });

    const { studyId } = req.params;
    const { today: todayOnly } = req.query;

    let targetStudyId = studyId;

    if (todayOnly === '1') {
      const sid = await getTodayStudyIdOrNull(userId);
      if (sid) targetStudyId = sid;
    }

    await assertStudyOwnerOrThrow(targetStudyId, userId);

    const result = await pool.query(
      `SELECT word, meaning, example
         FROM vocabulary
        WHERE study_id = $1`,
      [targetStudyId]
    );

    res.json({ success: true, result: result.rows, message: null });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message || '단어 조회 실패' });
  }
};

// ──────────────────────────────────────────────────────────────
/**
 * 5. 필사 내용 저장
 * POST /api/study/handwriting
 *  - ✅ user_id 필수
 *  - ✅ study 소유권 검증 후 업데이트
 */
exports.saveHandwriting = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '인증 필요' });

    const { study_id, content } = req.body;
    if (!study_id || !content) {
      return res.status(400).json({ success: false, message: "필수 값 누락" });
    }

    await assertStudyOwnerOrThrow(study_id, userId);

    await pool.query(
      `UPDATE today_study
          SET handwriting = $1
        WHERE study_id = $2
          AND user_id = $3`,
      [content, study_id, userId]
    );
    res.json({ success: true, message: "필사 내용 저장 완료" });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message || "필사 저장 실패" });
  }
};

// ──────────────────────────────────────────────────────────────
/**
 * 6. 필사 내용 조회
 * GET /api/study/handwriting/:studyId
 *  - ✅ user_id 필수
 *  - ✅ study 소유권 검증 후 조회
 */
exports.getHandwriting = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '인증 필요' });

    const { studyId } = req.params;

    await assertStudyOwnerOrThrow(studyId, userId);

    const result = await pool.query(
      `SELECT handwriting
         FROM today_study
        WHERE study_id = $1
          AND user_id = $2
        LIMIT 1`,
      [studyId, userId]
    );

    if (result.rows.length === 0) {
      return res.json({ success: true, result: "" });
    }

    res.json({ success: true, result: result.rows[0].handwriting || "" });
  } catch (err) {
    console.error("필사 내용 조회 실패:", err.message);
    res.status(err.status || 500).json({ success: false, message: err.message || "필사 내용 조회 실패" });
  }
};

// ──────────────────────────────────────────────────────────────
/**
 * 7. 퀴즈 생성 (중복이면 기존 반환)
 * POST /api/gpt/generate-quiz
 *  - ✅ user_id 필수
 *  - ✅ study 소유권 검증
 */
exports.generateQuiz = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '인증 필요' });

    const { text, studyId } = req.body;
    if (!text || !studyId) {
      return res.status(400).json({ success: false, message: 'text 또는 studyId가 필요합니다.' });
    }

    await assertStudyOwnerOrThrow(studyId, userId);

    // 1) 기존 퀴즈 있으면 그대로 반환
    const existed = await pool.query(
      `SELECT question_index, question, options, answer, explanation
         FROM quiz_set
        WHERE study_id = $1
        ORDER BY question_index`,
      [studyId]
    );
    if (existed.rows.length > 0) {
      const quizzes = existed.rows.map(r => ({
        questionIndex: r.question_index,
        question: r.question,
        options: Array.isArray(r.options) ? r.options : JSON.parse(r.options || '[]'),
        answer: r.answer,
        explanation: r.explanation
      }));
      return res.json({ success: true, result: quizzes });
    }

    // 2) GPT 호출 (기능 동일)
    const prompt = `
너는 국어 교사야. 아래 글을 바탕으로 다음 문제 유형 중 3가지를 **랜덤으로 하나씩 골라서**, 각 유형에 맞는 객관식 문제를 **한 문장 질문으로만** 만들어줘.
[문제 유형] 1~5 ...
[출력 형식] [{"type":"...","question":"...","options":["...","...","...","..."],"answer":"...","explanation":"..."}]
[조건] JSON 배열만, 각 문제 유형은 서로 달라야 함, options 4개, answer는 그 중 하나, question은 한 문장
원문:
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

    const raw = gptRes.data.choices?.[0]?.message?.content ?? '';
    let quizzes;
    try {
      quizzes = JSON.parse(raw);
    } catch (e) {
      console.error('❌ GPT 응답 파싱 실패:', raw);
      return res.status(500).json({ success: false, message: 'GPT 응답을 JSON으로 파싱할 수 없습니다.' });
    }

    // 3) DB 저장 (options jsonb)
    for (let i = 0; i < quizzes.length; i++) {
      const q = quizzes[i];
      await pool.query(
        `INSERT INTO quiz_set (
           study_id, question_index, type, question, options, answer, explanation
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
        [
          studyId,
          i + 1,
          q.type || '유형 없음',
          q.question,
          JSON.stringify(q.options || []),
          q.answer,
          q.explanation
        ]
      );
    }

    // 4) 저장 후 조회 동일 포맷 반환
    const saved = await pool.query(
      `SELECT question_index, question, options, answer, explanation
         FROM quiz_set
        WHERE study_id = $1
        ORDER BY question_index`,
      [studyId]
    );
    const result = saved.rows.map(r => ({
      questionIndex: r.question_index,
      question: r.question,
      options: Array.isArray(r.options) ? r.options : JSON.parse(r.options || '[]'),
      answer: r.answer,
      explanation: r.explanation
    }));

    return res.json({ success: true, result });
  } catch (err) {
    console.error('❌ 퀴즈 생성 실패:', err.message);
    res.status(err.status || 500).json({ success: false, message: err.message || '퀴즈 생성 실패' });
  }
};

// ──────────────────────────────────────────────────────────────
/**
 * 8. 퀴즈 조회
 * GET /api/gpt/quiz/:studyId
 *  - ✅ user_id 필수
 *  - ✅ study 소유권 검증 후 조회
 */
exports.getQuizzesByStudyId = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '인증 필요' });

    const { studyId } = req.params;
    await assertStudyOwnerOrThrow(studyId, userId);

    const db = await pool.query(
      `SELECT question_index, question, options, answer, explanation,
              user_choice, is_correct
         FROM quiz_set
        WHERE study_id = $1
        ORDER BY question_index`,
      [studyId]
    );

    const quizzes = db.rows.map(r => ({
      questionIndex: r.question_index,
      question: r.question,
      options: Array.isArray(r.options) ? r.options : JSON.parse(r.options || '[]'),
      answer: r.answer,
      explanation: r.explanation,
      userChoice: r.user_choice ?? null,
      isCorrect: typeof r.is_correct === 'boolean' ? r.is_correct : null
    }));

    res.json({ success: true, result: quizzes });
  } catch (err) {
    console.error('❌ 퀴즈 조회 실패:', err.message);
    res.status(err.status || 500).json({ success: false, message: err.message || '퀴즈 조회 실패' });
  }
};

// ──────────────────────────────────────────────────────────────
/**
 * 9. 사용자 응답 저장 (서버 채점)
 * POST /api/gpt/quiz/answer
 *  - ✅ user_id 필수
 *  - ✅ study 소유권 검증 후 UPDATE
 */
exports.saveQuizAnswer = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '인증 필요' });

    const { studyId, questionIndex, userChoice } = req.body;
    if (!studyId || !questionIndex || !userChoice) {
      return res.status(400).json({ success: false, message: '필수 값 누락' });
    }

    await assertStudyOwnerOrThrow(studyId, userId);

    // 정답 조회
    const row = await pool.query(
      `SELECT answer FROM quiz_set WHERE study_id = $1 AND question_index = $2 LIMIT 1`,
      [studyId, questionIndex]
    );
    if (row.rows.length === 0) {
      return res.status(404).json({ success: false, message: '문항 없음' });
    }

    const correct = row.rows[0].answer;
    const isCorrect = userChoice === correct;

    await pool.query(
      `UPDATE quiz_set
          SET user_choice = $1,
              is_correct  = $2
        WHERE study_id = $3
          AND question_index = $4`,
      [userChoice, isCorrect, studyId, questionIndex]
    );

    res.json({ success: true, message: '응답 저장 완료' });
  } catch (err) {
    console.error('❌ 응답 저장 실패:', err.message);
    res.status(err.status || 500).json({ success: false, message: err.message || '응답 저장 실패' });
  }
};



// const axios = require('axios');
// const pool = require('../config/db');  // ✅ 공용 pool 사용

// //1) KST 기준으로 “오늘” 계산 + 하루 1개 보장 (UPSERT)
// function getKstToday() {
//   // KST(UTC+9) 기준 yyyy-mm-dd
//   const fmt = new Intl.DateTimeFormat('en-CA', {
//     timeZone: 'Asia/Seoul',
//     year: 'numeric', month: '2-digit', day: '2-digit'
//   });
//   return fmt.format(new Date()); // e.g., "2025-08-12"
// }

// /**
//  * 1. 오늘의 학습 글감 생성 API
//  * POST /api/gpt/generate-quote
//  */
// exports.generateQuote = async (req, res) => {
//   const userId = req.user?.id || null;
//   // const today = new Date().toISOString().split('T')[0];
//   const today = getKstToday(); // ✅ KST 기준 날짜

//    try {
//     // ✅ KST 오늘 기준으로 조회
//     const checkQuery = `
//       SELECT study_id, content FROM today_study
//       WHERE date = $1 AND user_id IS NOT DISTINCT FROM $2
//       LIMIT 1
//     `;
//     const existing = await pool.query(checkQuery, [today, userId]);

//     if (existing.rows.length > 0) {
//       return res.json({
//         success: true,
//         result: existing.rows[0].content,
//         studyId: existing.rows[0].study_id
//       });
//     }

//     // ✅ GPT 호출
//     const prompt = `
//       20대 사회초년생을 위한 문해력 학습용 글을 작성해줘.
//       조건: 쉬운 단어, 480~520자, 직장/일상/친구/습관 주제.
//     `;
//     const gptRes = await axios.post(
//       'https://api.openai.com/v1/chat/completions',
//       {
//         model: 'gpt-3.5-turbo',
//         messages: [{ role: 'user', content: prompt }],
//       },
//       { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
//     );

//     const generatedText = gptRes.data.choices[0].message.content;
    

//     // // ✅ DB 저장
//     // const insertQuery = `
//     //   INSERT INTO today_study (user_id, content, date)
//     //   VALUES ($1, $2, $3)
//     //   RETURNING study_id
//     // `;
//     // ✅ 하루 1개 보장: (user_id, date) 유니크 + UPSERT
//     //   - 먼저 유니크 제약 권장:
//     //     ALTER TABLE today_study ADD CONSTRAINT uq_today UNIQUE (user_id, date);
//     const insertQuery = `
//       INSERT INTO today_study (user_id, content, date)
//       VALUES ($1, $2, $3)
//       ON CONFLICT (user_id, date)
//       DO UPDATE SET content = EXCLUDED.content
//       RETURNING study_id
//     `;
//     const inserted = await pool.query(insertQuery, [userId, generatedText, today]);
//     const studyId = inserted.rows[0].study_id;

//     // ✅ 단어 저장 로직
//     await saveVocabulary(studyId, generatedText);

//     res.json({ success: true, result: generatedText, studyId });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ success: false, message: 'GPT API 오류' });
//   }
// };

// /**
//  * GPT 단어 추출 → DB 저장
//  */
// async function saveVocabulary(studyId, content) {
//   try {
//     const prompt = `
//       다음 글에서 중요한 단어 5개를 선택하고,
//       각 단어의 정의와 예문을 JSON 배열 형식으로 반환해줘.
//       형식: [{"word":"단어","meaning":"정의","example":"예문"}, ...]
      
//       글: ${content}
//     `;

//     const gptRes = await axios.post(
//       'https://api.openai.com/v1/chat/completions',
//       {
//         model: 'gpt-3.5-turbo',
//         messages: [{ role: 'user', content: prompt }],
//       },
//       { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
//     );

//     const words = JSON.parse(gptRes.data.choices[0].message.content);

//     for (const w of words) {
//       await pool.query(
//         `INSERT INTO vocabulary (study_id, word, meaning, example) VALUES ($1, $2, $3, $4)`,
//         [studyId, w.word, w.meaning, w.example]
//       );
//     }
//   } catch (err) {
//     console.error('단어 저장 오류:', err.message);
//   }
// }

// /**
//  * 2. 단어 검색 API (GPT, DB 저장 없음)
//  * POST /api/vocabulary/search
//  */
// exports.searchWordDefinition = async (req, res) => {
//   const { word } = req.body;
//   if (!word) return res.status(400).json({ success: false, message: '단어 필요' });

//   try {
//     const prompt = `"${word}"의 국립국어원 기준 정의와 예문을 JSON으로 반환해줘. {"word":"","meaning":"","example":""} 형식으로.`;

//     const gptRes = await axios.post(
//       'https://api.openai.com/v1/chat/completions',
//       {
//         model: 'gpt-3.5-turbo',
//         messages: [{ role: 'user', content: prompt }],
//       },
//       { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
//     );

//     const result = JSON.parse(gptRes.data.choices[0].message.content);
//     res.json({ success: true, result });
//   } catch (err) {
//     console.error(err.message);
//     res.status(500).json({ success: false, message: '단어 검색 실패' });
//   }
// };

// // controllers/gptController.js (헬퍼: 오늘의 study_id 조회)
// async function getTodayStudyIdOrNull(userId) {
//   const today = getKstToday();
//   const q = `
//     SELECT study_id FROM today_study
//     WHERE date = $1 AND user_id IS NOT DISTINCT FROM $2
//     LIMIT 1
//   `;
//   const r = await pool.query(q, [today, userId]);
//   return r.rows[0]?.study_id ?? null;
// }

// /**
//  * 3. 단어 저장 API (프론트에서 저장 버튼 클릭 시 호출)
//  * POST /api/vocabulary
//  */
// exports.saveVocabularyManual = async (req, res) => {
//   let { study_id, word, meaning, example } = req.body;
//   const userId = req.user?.id || null;

//   if (!word || !meaning) {
//     return res.status(400).json({ success: false, message: '필수 값 누락' });
//   }

//   try {
//     // ✅ study_id가 없거나, 오늘 글감이 따로 있으면 "오늘의 study_id"로 보정
//     const todayStudyId = await getTodayStudyIdOrNull(userId);
//     if (!study_id || (todayStudyId && study_id != todayStudyId)) {
//       study_id = todayStudyId;
//     }

//     if (!study_id) {
//       return res.status(400).json({ success: false, message: '오늘의 학습이 없습니다. 먼저 글감을 생성하세요.' });
//     }

//     await pool.query(
//       `INSERT INTO vocabulary (study_id, word, meaning, example)
//        VALUES ($1, $2, $3, $4)`,
//       [study_id, word, meaning, example || null]
//     );
//     res.json({ success: true, message: '단어가 저장되었습니다.' });
//   } catch (err) {
//     console.error(err.message);
//     res.status(500).json({ success: false, message: '단어 저장 실패' });
//   }
// };
// // exports.saveVocabularyManual = async (req, res) => {
// //   const { study_id, word, meaning, example } = req.body;
// //   if (!study_id || !word || !meaning) {
// //     return res.status(400).json({ success: false, message: '필수 값 누락' });
// //   }

// //   try {
// //     await pool.query(
// //       `INSERT INTO vocabulary (study_id, word, meaning, example) VALUES ($1, $2, $3, $4)`,
// //       [study_id, word, meaning, example || null]
// //     );
// //     res.json({ success: true, message: '단어가 저장되었습니다.' });
// //   } catch (err) {
// //     console.error(err.message);
// //     res.status(500).json({ success: false, message: '단어 저장 실패' });
// //   }
// // };

// /**
//  * 4. 단어 목록 조회 API (특정 학습 문단의 단어들)
//  * GET /api/vocabulary/:studyId
//  */
// exports.getVocabularyByStudy = async (req, res) => {
//   const { studyId } = req.params;
//   const { today: todayOnly } = req.query; // today=1 이면 오늘 기준 강제
//   const userId = req.user?.id || null;

//   try {
//     let targetStudyId = studyId;

//     if (todayOnly === '1') {
//       // ✅ 오늘의 studyId 강제 사용
//       const sid = await getTodayStudyIdOrNull(userId);
//       if (sid) targetStudyId = sid;
//     }

//     const result = await pool.query(
//       `SELECT word, meaning, example
//          FROM vocabulary
//        WHERE study_id = $1`,
//       [targetStudyId]
//     );

//     res.json({ success: true, result: result.rows, message: null });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ success: false, message: '단어 조회 실패' });
//   }
// };
// // exports.getVocabularyByStudy = async (req, res) => {
// //   const { studyId } = req.params;
// //   try {
// //     const result = await pool.query(
// //       `SELECT word, meaning, example FROM vocabulary WHERE study_id = $1`,
// //       [studyId]
// //     );
// //     res.json({
// //       success: true,
// //       result: result.rows,   // ✅ 프론트가 기대하는 필드명으로 변경
// //       message: null
// //     });
// //   } catch (err) {
// //     console.error(err);
// //     res.status(500).json({ success: false, message: '단어 조회 실패' });
// //   }
// // };
// /**
//  * ✅ 5. 필사 내용 저장 API
//  * POST /api/study/handwriting
//  */
// exports.saveHandwriting = async (req, res) => {
//   const { study_id, content } = req.body;
//   const userId = req.user?.id || null;

//   if (!study_id || !content) {
//     return res.status(400).json({ success: false, message: "필수 값 누락" });
//   }

//   try {
//     await pool.query(
//       `UPDATE today_study SET handwriting = $1 WHERE study_id = $2 AND user_id IS NOT DISTINCT FROM $3`,
//       [content, study_id, userId]
//     );
//     res.json({ success: true, message: "필사 내용 저장 완료" });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ success: false, message: "필사 저장 실패" });
//   }
// };

// /**
//  * ✅ 6. 필사 내용 조회 API
//  * GET /api/study/handwriting/:studyId
//  */
// exports.getHandwriting = async (req, res) => {
//   const { studyId } = req.params;
//   const userId = req.user?.id || null;

//   try {
//     const result = await pool.query(
//       `SELECT handwriting FROM today_study WHERE study_id = $1 AND user_id IS NOT DISTINCT FROM $2 LIMIT 1`,
//       [studyId, userId]
//     );

//     if (result.rows.length === 0) {
//       return res.json({ success: true, result: "" }); // ✅ 필사 내용이 없으면 빈 문자열 반환
//     }

//     res.json({ success: true, result: result.rows[0].handwriting });
//   } catch (err) {
//     console.error("필사 내용 조회 실패:", err.message);
//     res.status(500).json({ success: false, message: "필사 내용 조회 실패" });
//   }
// };

// /*gpt로 퀴즈 생성 */
// // ✅ 퀴즈 생성 (중복이면 기존 리스트 반환)
// exports.generateQuiz = async (req, res) => {
//   const { text, studyId } = req.body;

//   if (!text || !studyId) {
//     return res.status(400).json({ success: false, message: 'text 또는 studyId가 필요합니다.' });
//   }

//   try {
//     // 1) 기존 퀴즈 있으면 그대로 반환 (200)
//     const existed = await pool.query(
//       `SELECT question_index, question, options, answer, explanation
//        FROM quiz_set
//        WHERE study_id = $1
//        ORDER BY question_index`,
//       [studyId]
//     );
//     if (existed.rows.length > 0) {
//       const quizzes = existed.rows.map(r => ({
//         questionIndex: r.question_index,
//         question: r.question,
//         options: Array.isArray(r.options) ? r.options : JSON.parse(r.options || '[]'),
//         answer: r.answer,
//         explanation: r.explanation
//       }));
//       return res.json({ success: true, result: quizzes });
//     }

//     // 2) GPT 호출
//     const prompt = `
// 너는 국어 교사야. 아래 글을 바탕으로 다음 문제 유형 중 3가지를 **랜덤으로 하나씩 골라서**, 각 유형에 맞는 객관식 문제를 **한 문장 질문으로만** 만들어줘.
// [문제 유형] 1~5 ...
// [출력 형식] [{"type":"...","question":"...","options":["...","...","...","..."],"answer":"...","explanation":"..."}]
// [조건] JSON 배열만, 각 문제 유형은 서로 달라야 함, options 4개, answer는 그 중 하나, question은 한 문장
// 원문:
// """${text}"""
// `;

//     const gptRes = await axios.post(
//       'https://api.openai.com/v1/chat/completions',
//       {
//         model: 'gpt-3.5-turbo',
//         messages: [{ role: 'user', content: prompt }],
//         temperature: 0.7
//       },
//       {
//         headers: {
//           Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
//           'Content-Type': 'application/json'
//         }
//       }
//     );

//     const raw = gptRes.data.choices?.[0]?.message?.content ?? '';
//     let quizzes;
//     try {
//       quizzes = JSON.parse(raw);
//     } catch (e) {
//       console.error('❌ GPT 응답 파싱 실패:', raw);
//       return res.status(500).json({ success: false, message: 'GPT 응답을 JSON으로 파싱할 수 없습니다.' });
//     }

//     // 3) DB 저장 (options는 jsonb로)
//     for (let i = 0; i < quizzes.length; i++) {
//       const q = quizzes[i];
//       await pool.query(
//         `INSERT INTO quiz_set (
//            study_id, question_index, type, question, options, answer, explanation
//          ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
//         [
//           studyId,
//           i + 1,
//           q.type || '유형 없음',
//           q.question,
//           JSON.stringify(q.options || []),
//           q.answer,
//           q.explanation
//         ]
//       );
//     }

//     // 4) 생성 직후에도 동일 포맷 반환
//     const saved = await pool.query(
//       `SELECT question_index, question, options, answer, explanation
//        FROM quiz_set
//        WHERE study_id = $1
//        ORDER BY question_index`,
//       [studyId]
//     );
//     const result = saved.rows.map(r => ({
//       questionIndex: r.question_index,
//       question: r.question,
//       options: Array.isArray(r.options) ? r.options : JSON.parse(r.options || '[]'),
//       answer: r.answer,
//       explanation: r.explanation
//     }));

//     return res.json({ success: true, result });
//   } catch (err) {
//     console.error('❌ 퀴즈 생성 실패:', err.message);
//     res.status(500).json({ success: false, message: '퀴즈 생성 실패' });
//   }
// };
// // exports.generateQuiz = async (req, res) => {
// //   const { text, studyId } = req.body;

// //   if (!text || !studyId) {
// //     return res.status(400).json({ success: false, message: 'text 또는 studyId가 필요합니다.' });
// //   }

// //   try {
// //     // ✅ 중복 생성 방지
// //     const existing = await pool.query(
// //       `SELECT 1 FROM quiz_set WHERE study_id = $1 LIMIT 1`,
// //       [studyId]
// //     );
// //     if (existing.rows.length > 0) {
// //       return res.status(400).json({ success: false, message: '이미 퀴즈가 생성되어 있습니다.' });
// //     }

// //     const prompt = `
// // 너는 국어 교사야. 아래 글을 바탕으로 다음 문제 유형 중 3가지를 **랜덤으로 하나씩 골라서**, 각 유형에 맞는 객관식 문제를 **한 문장 질문으로만** 만들어줘.

// // [문제 유형]
// // 1. 이 글의 핵심 내용을 가장 잘 요약한 것은?
// // 2. 이 글을 읽고 추론할 수 있는 것은?
// // 3. 이 글의 가장 적절한 제목을 선택하시오.
// // 4. 이 글의 가장 적절한 결론은?
// // 5. 해당 문장에 쓰인 단어와 같은 의미로 사용된 문장은?

// // [출력 형식]
// // [
// //   {
// //     "type": "이 글의 가장 적절한 결론은?",
// //     "question": "글의 마지막에서 강조된 삶의 태도는 무엇인가?",
// //     "options": ["포기", "도전", "불안", "냉소"],
// //     "answer": "도전",
// //     "explanation": "글의 결말에서 도전하는 자세가 중요하다고 강조했기 때문입니다."
// //   },
// //   ...
// // ]

// // [반드시 지켜야 할 조건]
// // - JSON 배열로만 출력할 것 (그 외 설명 절대 X)
// // - 각 문제는 서로 다른 유형이어야 함
// // - options는 무조건 4개이며 answer는 그 중 하나
// // - **question은 반드시 유형에 맞는 자연스러운 한 문장**으로 작성 (부가설명·번호 금지)
// // - **question에 "1/3", "2/3" 같은 숫자 포함 금지**
// // - type은 유지하되 화면에는 표시하지 않을 예정이므로, 실제 질문은 question에만 들어가야 함

// // 다음 글을 기반으로 문제를 생성해줘:
// // """${text}"""
// // `;

// //     const gptRes = await axios.post(
// //       'https://api.openai.com/v1/chat/completions',
// //       {
// //         model: 'gpt-3.5-turbo',
// //         messages: [{ role: 'user', content: prompt }],
// //         temperature: 0.7
// //       },
// //       {
// //         headers: {
// //           Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
// //           'Content-Type': 'application/json'
// //         }
// //       }
// //     );

// //     const raw = gptRes.data.choices[0].message.content;

// //     let quizzes;
// //     try {
// //       quizzes = JSON.parse(raw);
// //     } catch (err) {
// //       console.error('❌ GPT 응답 파싱 실패:', raw);
// //       return res.status(500).json({ success: false, message: 'GPT 응답을 JSON으로 파싱할 수 없습니다.', raw });
// //     }

// //     // ✅ DB 저장
// //     for (let i = 0; i < quizzes.length; i++) {
// //       const q = quizzes[i];
// //       await pool.query(
// //         `INSERT INTO quiz_set (
// //           study_id, question_index, type, question, options, answer, explanation
// //         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
// //         [
// //           studyId,
// //           i + 1,
// //           q.type || '유형 없음',
// //           q.question,
// //           JSON.stringify(q.options),  // ✅ 핵심 수정
// //           q.answer,
// //           q.explanation
// //         ]
// //       );
// // }

// //     res.json({ success: true, quizzes });

// //   } catch (err) {
// //     console.error('❌ GPT API 오류:', err.message);
// //     res.status(500).json({ success: false, message: '퀴즈 생성 실패' });
// //   }
// // };

// //특정 학습 글의 퀴즈 모두 조회
// // exports.getQuizzesByStudyId = async (req, res) => {
// //   const { studyId } = req.params;

// //   try {
// //     const result = await pool.query(
// //       `SELECT question_index, question, options, answer, explanation FROM quiz_set WHERE study_id = $1 ORDER BY question_index`,
// //       [studyId]
// //     );

// //     const quizzes = result.rows.map(row => ({
// //       questionIndex: row.question_index,
// //       question: row.question,
// //       options: row.options,
// //       answer: row.answer,
// //       explanation: row.explanation
// //     }));

// //     res.json({ success: true, quizzes });
// //   } catch (err) {
// //     console.error('❌ 퀴즈 조회 실패:', err.message);
// //     res.status(500).json({ success: false, message: '퀴즈 조회 실패' });
// //   }
// // };

// // //퀴즈에 대한 사용자의 응답 저장
// // exports.saveQuizAnswer = async (req, res) => {
// //   const { studyId, questionIndex, userChoice, isCorrect } = req.body;

// //   if (!studyId || !questionIndex || !userChoice || isCorrect == null) {
// //     return res.status(400).json({ success: false, message: '필수 값 누락' });
// //   }

// //   try {
// //     await pool.query(
// //       `UPDATE quiz_set
// //        SET user_choice = $1,
// //            is_correct = $2
// //        WHERE study_id = $3 AND question_index = $4`,
// //       [userChoice, isCorrect, studyId, questionIndex]
// //     );

// //     res.json({ success: true, message: '응답 저장 완료' });
// //   } catch (err) {
// //     console.error('❌ 응답 저장 실패:', err.message);
// //     res.status(500).json({ success: false, message: '응답 저장 실패' });
// //   }
// // };
// // 퀴즈 조회
// exports.getQuizzesByStudyId = async (req, res) => {
//   const { studyId } = req.params;

//   try {
//     const db = await pool.query(
//       `SELECT question_index, question, options, answer, explanation,
//               user_choice, is_correct
//          FROM quiz_set
//         WHERE study_id = $1
//         ORDER BY question_index`,
//       [studyId]
//     );

//     const quizzes = db.rows.map(r => ({
//       questionIndex: r.question_index,
//       question: r.question,
//       options: Array.isArray(r.options) ? r.options : JSON.parse(r.options || '[]'),
//       answer: r.answer,
//       explanation: r.explanation,
//       // ★ 추가 필드
//       userChoice: r.user_choice,                     // string | null
//       isCorrect: typeof r.is_correct === 'boolean' ? r.is_correct : null // boolean | null
//     }));

//     res.json({ success: true, result: quizzes });
//   } catch (err) {
//     console.error('❌ 퀴즈 조회 실패:', err.message);
//     res.status(500).json({ success: false, message: '퀴즈 조회 실패' });
//   }
// };
// // exports.getQuizzesByStudyId = async (req, res) => {
// //   const { studyId } = req.params;

// //   try {
// //     const db = await pool.query(
// //       `SELECT question_index, question, options, answer, explanation
// //        FROM quiz_set
// //        WHERE study_id = $1
// //        ORDER BY question_index`,
// //       [studyId]
// //     );

// //     const quizzes = db.rows.map(r => ({
// //       questionIndex: r.question_index,
// //       question: r.question,
// //       options: Array.isArray(r.options) ? r.options : JSON.parse(r.options || '[]'),
// //       answer: r.answer,
// //       explanation: r.explanation
// //     }));

// //     res.json({ success: true, result: quizzes });
// //   } catch (err) {
// //     console.error('❌ 퀴즈 조회 실패:', err.message);
// //     res.status(500).json({ success: false, message: '퀴즈 조회 실패' });
// //   }
// // };
// // 사용자 응답 저장 (서버 채점)
// exports.saveQuizAnswer = async (req, res) => {
//   const { studyId, questionIndex, userChoice } = req.body;

//   if (!studyId || !questionIndex || !userChoice) {
//     return res.status(400).json({ success: false, message: '필수 값 누락' });
//   }

//   try {
//     // 정답 조회
//     const row = await pool.query(
//       `SELECT answer FROM quiz_set WHERE study_id = $1 AND question_index = $2 LIMIT 1`,
//       [studyId, questionIndex]
//     );
//     if (row.rows.length === 0) {
//       return res.status(404).json({ success: false, message: '문항 없음' });
//     }

//     const correct = row.rows[0].answer;
//     const isCorrect = userChoice === correct;

//     await pool.query(
//       `UPDATE quiz_set
//          SET user_choice = $1,
//              is_correct = $2
//        WHERE study_id = $3 AND question_index = $4`,
//       [userChoice, isCorrect, studyId, questionIndex]
//     );

//     res.json({ success: true, message: '응답 저장 완료' });
//   } catch (err) {
//     console.error('❌ 응답 저장 실패:', err.message);
//     res.status(500).json({ success: false, message: '응답 저장 실패' });
//   }
// };