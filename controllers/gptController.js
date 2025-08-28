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
각 단어의 정의와 예문을 **JSON 배열만** 반환해줘.
**코드블록/설명/마크다운 금지**. 예시 형식:
[
  {"word":"", "meaning":"", "example":""},
  {"word":"", "meaning":"", "example":""},
  {"word":"", "meaning":"", "example":""},
  {"word":"", "meaning":"", "example":""},
  {"word":"", "meaning":"", "example":""}
]
글: ${content}
    `;

    const gptRes = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7
      },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );

    const raw = gptRes.data.choices?.[0]?.message?.content ?? '';
    let words = parseJsonLoose(raw);
    if (!Array.isArray(words)) words = [words];

    // 🔒 중복 방지: (study_id, word) 유니크 권장
    for (const w of words) {
      await pool.query(
        `INSERT INTO vocabulary (study_id, word, meaning, example)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (study_id, word) DO UPDATE
           SET meaning = EXCLUDED.meaning,
               example = COALESCE(EXCLUDED.example, vocabulary.example)`,
        [studyId, w.word, w.meaning, w.example || null]
      );
    }
  } catch (err) {
    console.error('단어 저장 오류:', err.message);
  }
}
//saveVocabulary()에서 parseJsonLoose(raw)함수
function parseJsonLoose(txt) {
  try { return JSON.parse(txt); } catch {}
  // ```json ... ``` 같은 코드블록 제거
  const cleaned = txt
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  try { return JSON.parse(cleaned); } catch {}
  // 배열 괄호 추출
  const m = cleaned.match(/\[[\s\S]*\]/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  // 객체 괄호 추출
  const m2 = cleaned.match(/\{[\s\S]*\}/);
  if (m2) { try { return JSON.parse(m2[0]); } catch {} }
  return [];
}
// ──────────────────────────────────────────────────────────────
/**
* 1. 오늘의 학습 글감 생성 API
* POST /api/gpt/generate-quote
* - ✅ user_id 필수
* - ✅ (user_id, date) UNIQUE에 맞춰 UPSERT
* - ✅ level 사용: 기본은 DB값, req.body.level(1~4)이 오면 override
*/
exports.generateQuote = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '인증 필요' });

    const today = getKstToday();

    // 0) 유저 레벨 조회 (없으면 1)
    const lvQ = await pool.query(
      'SELECT level FROM public.users WHERE id = $1 LIMIT 1',
      [userId]
    );
    let userLevel = lvQ.rows[0]?.level ?? 1;

    // (옵션) 프론트에서 level을 전송하면 1~4에 한해 override
    const bodyLv = Number(req.body?.level);
    if ([1,2,3,4].includes(bodyLv)) userLevel = bodyLv;

    // 1) 이미 있으면 그대로 반환 (+ level 포함)
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
        studyId: existing.rows[0].study_id,
        level: userLevel
      });
    }

    // 레벨별 프롬프트 정의 (PM 전달 기준 적용)
    const levelPrompts = {
      1: `20대 사회초년생을 위한 문해력 학습용 글을 작성하세요.
주제는 문학적이거나 사무적인 내용 중 자유롭게 정해도 좋습니다.
일상적이고 실무적인 소재(예: 직장, 친구, 일상 습관 등)를 사용하고, 쉬운 단어 위주로 작성하며 너무 길거나 복잡한 문장은 피해주세요.
어휘: 아주 쉬운 일상 어휘 (예: 금일, 작성, 참조 등 기초 어휘 포함)
분량: 480~520자
스타일: 짧고 명확한 문장, 부드럽고 이해하기 쉬운 톤
오늘만의 포인트(사건/감정/관찰) 1개 포함
출력은 본문 텍스트만 (코드블록/머리말 금지)`,
      2: `20대 사회초년생을 위한 문해력 학습용 글을 작성하세요.
주제는 문학적이거나 사무적인 내용 중 자유롭게 정하되, 실무나 뉴스, 사회생활과 관련된 문장이면 좋습니다.
보고서, 공지문, 기사체 문장 톤을 일부 포함하고, 맥락 속에서 어휘를 해석할 수 있도록 자연스럽게 녹여주세요.
어휘: 쉬운~보통 어휘 (예: 기준, 조치, 보고, 문서 등 활용 어휘 포함)
분량: 480~520자
스타일: 간단한 접속사/부사, 공식적이되 부담스럽지 않음
오늘만의 포인트(사건/감정/관찰) 1개 포함
출력은 본문 텍스트만 (코드블록/머리말 금지)`,
      3: `20대 사회초년생의 사고 확장과 표현력 향상을 위한 문해력 학습용 글을 작성하세요.
주제는 문학적 또는 사무적인 내용 중 자유롭게 선택하되, 논리적 사고나 관점을 담을 수 있는 글이어야 합니다.
어휘를 활용해 자신의 입장을 설명하거나 관점을 정리하는 문장 포함하고, 원인-결과, 비교, 예시 등 복합 문장을 사용해주세요.
어휘: 보통 난이도 어휘 (예: 의견, 분석, 의의, 한계, 갈등 등 심화 어휘 포함)
분량: 480~520자
스타일: 복문과 다양한 표현, 조금 더 분석적이고 진지한 톤
오늘만의 포인트(사건/감정/관찰) 1개 포함
출력은 본문 텍스트만 (코드블록/머리말 금지)`,
      4: `20대 사회초년생의 성숙한 사고력과 비판적 분석을 돕는 문해력 학습용 글을 작성하세요.
주제는 하나의 사회적/인문학적 주제에 대한 비판, 통찰, 문제 제기를 담아야 합니다.
고급 어휘와 추상적 개념 일부(예: 합의, 구조, 담론, 성찰, 관계자 등)를 포함하고, 다소 압축적인 문장 구성과 문장 간 논리 흐름을 강조해주세요.
독자가 스스로 사고를 이어가도록 유도하는 문장으로 마무리하세요.
어휘: 약간 높은 난이도 어휘, 고급 수준 어휘 포함
분량: 480~520자
스타일: 구체적 묘사와 미묘한 뉘앙스, 비판적이되 학습자 친화적인 톤
오늘만의 포인트(사건/감정/관찰) 1개 포함
출력은 본문 텍스트만 (코드블록/머리말 금지)`
    };

    // 주제 후보 및 난수는 유지
    const topics = ['직장', '일상', '친구', '습관'];
    const seed = Math.floor(Math.random() * 100000);

    // 프롬프트 최종 조합 (레벨별 프롬프트에 날짜/난수 붙임)
    const prompt =
      `오늘 날짜: ${today}, 난수: ${seed}\n주제 후보: ${topics.join(', ')} (최근 7일 내 쓴 주제와 중복 금지, 1개만 선택)\n` +
      levelPrompts[userLevel];

    // gpt 호출
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

    res.json({ success: true, result: generatedText, studyId, level: userLevel });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'GPT API 오류' });
  }
};

// // ──────────────────────────────────────────────────────────────
// /**
//  * 1. 오늘의 학습 글감 생성 API
//  * POST /api/gpt/generate-quote
//  *  - ✅ user_id 필수
//  *  - ✅ (user_id, date) UNIQUE에 맞춰 UPSERT
//  *  - ✅ level 사용: 기본은 DB값, req.body.level(1~4)이 오면 override
//  */
// exports.generateQuote = async (req, res) => {
//   try {
//     const userId = req.user?.id;
//     if (!userId) return res.status(401).json({ success: false, message: '인증 필요' });

//     const today = getKstToday();

//     // 0) 유저 레벨 조회 (없으면 1)
//     const lvQ = await pool.query(
//       'SELECT level FROM public.users WHERE id = $1 LIMIT 1',
//       [userId]
//     );
//     let userLevel = lvQ.rows[0]?.level ?? 1;

//     // (옵션) 프론트에서 level을 전송하면 1~4에 한해 override
//     const bodyLv = Number(req.body?.level);
//     if ([1, 2, 3, 4].includes(bodyLv)) userLevel = bodyLv;

//     // 1) 이미 있으면 그대로 반환 (+ level 포함)
//     const checkQuery = `
//       SELECT study_id, content
//         FROM today_study
//        WHERE date = $1
//          AND user_id = $2
//        LIMIT 1
//     `;
//     const existing = await pool.query(checkQuery, [today, userId]);

//     if (existing.rows.length > 0) {
//       return res.json({
//         success: true,
//         result: existing.rows[0].content,
//         studyId: existing.rows[0].study_id,
//         level: userLevel
//       });
//     }

//     const topics = ['직장', '일상', '친구', '습관'];
//     const seed = Math.floor(Math.random() * 100000);

//     const levelConfigs = {
//       1: { len: '300~350자', vocab: '아주 쉬운 일상 어휘', extra: '짧고 명확한 문장' },
//       2: { len: '380~420자', vocab: '쉬운~보통 어휘',      extra: '간단한 접속사/부사' },
//       3: { len: '450~500자', vocab: '보통 난이도 어휘',    extra: '복문과 다양한 표현' },
//       4: { len: '500~550자', vocab: '약간 높은 난이도 어휘', extra: '구체적 묘사와 미묘한 뉘앙스' },
//     };
//     const cfg = levelConfigs[userLevel] ?? levelConfigs[1];

//     const prompt = `
// 오늘 날짜: ${today}, 난수: ${seed}
// 주제 후보: ${topics.join(', ')} (최근 7일 내 쓴 주제와 중복 금지, 1개만 선택)
// [작성 규칙 — 사용자 레벨 ${userLevel}]
// - 분량: ${cfg.len}
// - 어휘: ${cfg.vocab}
// - 스타일: ${cfg.extra}
// - 오늘만의 포인트(사건/감정/관찰) 1개 포함
// - 출력은 본문 텍스트만 (코드블록/머리말 금지)
// `.trim();

//     const gptRes = await axios.post(
//       'https://api.openai.com/v1/chat/completions',
//       {
//         model: 'gpt-3.5-turbo',
//         messages: [{ role: 'user', content: prompt }],
//       },
//       { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
//     );

//     const generatedText = gptRes.data.choices[0].message.content;

//     // 3) UPSERT 저장 (user_id, date 유니크)
//     const insertQuery = `
//       INSERT INTO today_study (user_id, content, date)
//       VALUES ($1, $2, $3)
//       ON CONFLICT (user_id, date)
//       DO UPDATE SET content = EXCLUDED.content
//       RETURNING study_id
//     `;
//     const inserted = await pool.query(insertQuery, [userId, generatedText, today]);
//     const studyId = inserted.rows[0].study_id;

//     // 4) 단어 자동 추출 저장 (기능 동일)
//     await saveVocabulary(studyId, generatedText);

//     res.json({ success: true, result: generatedText, studyId, level: userLevel });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ success: false, message: 'GPT API 오류' });
//   }
// };

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

/**
 * GET /api/gpt/study/by-date?date=YYYY-MM-DD
 * - 해당 날짜 학습(글감/필사/단어/퀴즈+채점)을 한 번에 반환
 */
exports.getStudyByDate = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '인증 필요' });

    const date = req.query.date; // "2025-08-16"
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, message: 'date 형식(YYYY-MM-DD)이 필요합니다.' });
    }

    // today_study 가 date 컬럼을 갖고 있다면 그걸로 바로 조회:
    const studyRow = await pool.query(
      `SELECT study_id, user_id, date, content, handwriting
         FROM today_study
        WHERE user_id = $1 AND date = $2
        LIMIT 1`,
      [userId, date]
    );

    // 만약 today_study가 created_at만 있고 date가 없다면:
    // const { startUtc, endUtc } = kstDayRange(date);
    // const studyRow = await pool.query(
    //   `SELECT study_id, user_id, created_at, content, handwriting
    //      FROM today_study
    //     WHERE user_id = $1 AND created_at >= $2 AND created_at < $3
    //     ORDER BY created_at ASC
    //     LIMIT 1`,
    //   [userId, startUtc, endUtc]
    // );

    if (studyRow.rows.length === 0) {
      return res.status(404).json({ success: false, message: '해당 날짜의 학습이 없습니다.' });
    }

    const { study_id, content, handwriting } = studyRow.rows[0];

    // 단어
    const vocabQ = await pool.query(
      `SELECT word, meaning, example
         FROM vocabulary
        WHERE study_id = $1
        ORDER BY word ASC`,
      [study_id]
    );

    // 퀴즈 (+ 사용자의 응답/채점 결과까지)
    const quizQ = await pool.query(
      `SELECT question_index, type, question, options, answer, explanation,
              user_choice, is_correct
         FROM quiz_set
        WHERE study_id = $1
        ORDER BY question_index ASC`,
      [study_id]
    );

    const quizzes = quizQ.rows.map(r => ({
      questionIndex: r.question_index,
      type: r.type,
      question: r.question,
      options: Array.isArray(r.options) ? r.options : JSON.parse(r.options || '[]'),
      answer: r.answer,
      explanation: r.explanation,
      userChoice: r.user_choice ?? null,
      isCorrect: typeof r.is_correct === 'boolean' ? r.is_correct : null,
    }));

    return res.json({
      success: true,
      result: {
        studyId: study_id,
        date,
        content,
        handwriting: handwriting || '',
        vocabulary: vocabQ.rows,      // [{word, meaning, example}]
        quizzes                       // [{... userChoice, isCorrect}]
      }
    });
  } catch (err) {
    console.error('❌ getStudyByDate 실패:', err);
    res.status(500).json({ success: false, message: '통합 조회 실패' });
  }
};

/**
 * (옵션) 달력용: 사용자가 학습한 날짜 목록
 * GET /api/gpt/study/available-dates?year=2025&month=08
 */
exports.getAvailableDates = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '인증 필요' });

    const { year, month } = req.query; // ex) 2025, 08
    if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month)) {
      return res.status(400).json({ success: false, message: 'year=YYYY, month=MM 형식이 필요합니다.' });
    }
    const prefix = `${year}-${month}`; // "2025-08"

    const r = await pool.query(
      `SELECT date
         FROM today_study
        WHERE user_id = $1
          AND to_char(date, 'YYYY-MM') = $2
        ORDER BY date ASC`,
      [userId, prefix]
    );

    res.json({ success: true, result: r.rows.map(x => x.date) });
  } catch (err) {
    console.error('❌ getAvailableDates 실패:', err);
    res.status(500).json({ success: false, message: '목록 조회 실패' });
  }
};
// ──────────────────────────────────────────────────────────────
/**
 * 10. 오늘의 학습 완료 시 포인트 지급
 * POST /api/gpt/study/complete-reward
 *  - ✅ user_id 필수
 *  - ✅ 하루 1번만 지급 (user_id + date 유니크)
 *  - ✅ 포인트 지급 후 현재 포인트/이력 반환
 */
// 10. 오늘의 학습 완료 시 포인트 지급 (study_reward 테이블 없이 today_study로 1일 1회 관리)
exports.giveTodayStudyPoint = async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: '인증 필요' });
    }

    const today = getKstToday();
    const POINT = 15;

    await client.query('BEGIN');

    // 1) 오늘 학습 존재 및 보상 여부 확인 (잠금으로 동시성 방지)
    const check = await client.query(
      `
      SELECT study_id, rewarded_date
        FROM public.today_study
       WHERE user_id = $1
         AND date = $2
       LIMIT 1
       FOR UPDATE
      `,
      [userId, today]
    );

    if (check.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: '오늘의 학습이 없습니다.' });
    }

    const rewardedDate = check.rows[0].rewarded_date;
    if (rewardedDate === today || (rewardedDate && rewardedDate.toISOString?.().slice(0,10) === today)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: '이미 포인트가 지급되었습니다.' });
    }

    // 2) 포인트 적립
    const updUser = await client.query(
      `
      UPDATE public.users
         SET point = COALESCE(point, 0) + $2,
             updated_at = now()
       WHERE id = $1
       RETURNING point
      `,
      [userId, POINT]
    );

    // 3) 오늘 학습에 보상지급 날짜 마킹
    await client.query(
      `
      UPDATE public.today_study
         SET rewarded_date = $3
       WHERE user_id = $1
         AND date = $2
      `,
      [userId, today, today]
    );

    await client.query('COMMIT');

    return res.json({
      success: true,
      message: '포인트가 지급되었습니다.',
      todayReward: POINT,                 // ✅ 안드 명세 유지
      totalPoint: updUser.rows[0]?.point ?? 0
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ 포인트 지급 오류:', err);
    return res.status(500).json({ success: false, message: '포인트 지급 실패' });
  } finally {
    client.release();
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