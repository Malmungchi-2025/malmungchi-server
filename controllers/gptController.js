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
 *  - ✅ user_id 필수
 *  - ✅ (user_id, date) UNIQUE UPSERT
 *  - ✅ level: DB 기본값, req.body.level(1~4) 오면 override
 *  - ✅ refresh=1 쿼리로 강제 재생성
 */
exports.generateQuote = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '인증 필요' });

    const today = getKstToday();
    const forceRefresh = req.query.refresh === '1';

    // 레벨 결정
    const lvQ = await pool.query('SELECT level FROM public.users WHERE id = $1 LIMIT 1', [userId]);
    let userLevel = lvQ.rows[0]?.level ?? 1;
    const bodyLv = Number(req.body?.level);
    if ([1, 2, 3, 4].includes(bodyLv)) userLevel = bodyLv;

    // 이미 있으면 재사용(단, refresh=1이면 새로 생성)
    if (!forceRefresh) {
      const existed = await pool.query(
        'SELECT study_id, content FROM today_study WHERE date = $1 AND user_id = $2 LIMIT 1',
        [today, userId]
      );
      if (existed.rows.length > 0) {
        return res.json({
          success: true,
          result: existed.rows[0].content,
          studyId: existed.rows[0].study_id,
          level: userLevel
        });
      }
    }

    // PM 스펙(480~520자) 레벨 프롬프트
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

    const topics = ['직장', '일상', '친구', '습관'];
    const seed = Math.floor(Math.random() * 100000);

    // 프롬프트(대화/질문/따옴표 금지)
    const sys = {
      role: 'system',
      content: '너는 한국어 글쓰기 교사이자 작가다. 사용자에게 대화하지 말고, 요구한 본문만 정확히 작성한다.'
    };
    const user = {
      role: 'user',
      content: [
        `오늘 날짜: ${today}, 난수: ${seed}`,
        `주제 후보: ${topics.join(', ')} 중 1개를 내부적으로 임의 선택(최근 7일 중복 금지).`,
        levelPrompts[userLevel] ?? levelPrompts[1],
        `제약: 출력은 한국어 **서술형 본문 1개 단락만**.`,
        `금지: 질문/제안/대화체/머리말/따옴표/코드블록/메타설명/제목.`,
        `금지어 예: "주제", "하시겠어요", "원하시면" 등.`
      ].join('\n')
    };

    // 생성 + 검증(최대 3회 시도)
    let generatedText = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      const gptRes = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        { model: 'gpt-3.5-turbo', messages: [sys, user], temperature: 0.7 },
        { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
      );
      generatedText = (gptRes.data.choices?.[0]?.message?.content || '').trim();
      // 코드펜스 제거
      generatedText = generatedText.replace(/^```[\s\S]*?$/gm, '').trim();

      const badPhrase = /(주제|하시겠어요|원하시면|어떠신가요)/.test(generatedText);
      const hasQuestion = /\?/.test(generatedText);
      const hasQuotes = /["“”'’]/.test(generatedText);
      const tooShort = generatedText.replace(/\s/g, '').length < 350; // 안전 하한

      if (!badPhrase && !hasQuestion && !hasQuotes && !tooShort) break;

      // 마지막 시도면 강제 정제
      if (attempt === 2) {
        generatedText = generatedText
          .replace(/["“”'’]/g, '')
          .replace(/(^|\n).*?(주제|하시겠어요|원하시면|어떠신가요).*?\n?/g, '')
          .replace(/\?/g, '')
          .trim();
      }
    }

    // UPSERT 저장
    const upsert = await pool.query(
      `INSERT INTO today_study (user_id, content, date)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, date) DO UPDATE SET content = EXCLUDED.content
       RETURNING study_id`,
      [userId, generatedText, today]
    );
    const studyId = upsert.rows[0].study_id;

    // 단어 추출 저장
    await saveVocabulary(studyId, generatedText);

    return res.json({ success: true, result: generatedText, studyId, level: userLevel });
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
    // 문자열 비교로 고정
    const alreadyRewarded = rewardedDate && String(rewardedDate) === today;
    if (alreadyRewarded) {
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

// /**
//  * 11. 레벨 테스트 생성
//  * POST /api/gpt/level-test/generate
//  *  - user_id 필요
//  *  - 단계별 프롬프트 기반 15문항 생성
//  */
// exports.generateLevelTest = async (req, res) => {
//   try {
//     const userId = req.user?.id;
//     if (!userId) return res.status(401).json({ success: false, message: '인증 필요' });

//     const { stage } = req.body; // 0,1,2,3 (0=회원가입 직후 첫 테스트)
//     if (![0,1,2,3].includes(stage)) {
//       return res.status(400).json({ success: false, message: '잘못된 단계 값' });
//     }

//     // 단계별 프롬프트 (파일에 정의한 규칙 활용)
//     const stagePrompts = {
//       0: "20대 사회초년생의 어휘력과 문해력을 객관적으로 평가할 수 있는 15문항의 사지선다형 테스트를 만들어 줘...",
//       1: "기초→활용 단계 전환 테스트 (15문항, 4지선다, 정답 1개)...",
//       2: "활용→심화 단계 전환 테스트 (15문항, 4지선다, 정답 1개)...",
//       3: "심화→고급 단계 전환 테스트 (15문항, 4지선다, 정답 1개)..."
//     };

//     const prompt = stagePrompts[stage];

//     // GPT 호출
//     const gptRes = await axios.post(
//       "https://api.openai.com/v1/chat/completions",
//       {
//         model: "gpt-3.5-turbo",
//         messages: [{ role: "user", content: prompt }],
//         temperature: 0.7
//       },
//       { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
//     );

//     let raw = gptRes.data.choices[0].message.content;
//     let questions = JSON.parse(raw); // [{"question":"...","options":["..."],"answer":"..."}]

//     // DB 저장
//     await pool.query("DELETE FROM quiz_level_test WHERE user_id = $1", [userId]); // 중복 방지
//     for (let i = 0; i < questions.length; i++) {
//       const q = questions[i];
//       await pool.query(
//         `INSERT INTO quiz_level_test (user_id, question_index, question, options, answer)
//          VALUES ($1,$2,$3,$4::jsonb,$5)`,
//         [userId, i+1, q.question, JSON.stringify(q.options), q.answer]
//       );
//     }

//     return res.json({ success: true, result: questions });
//   } catch (err) {
//     console.error("❌ 레벨 테스트 생성 오류:", err.message);
//     res.status(500).json({ success: false, message: "레벨 테스트 생성 실패" });
//   }
// };

// controllers/levelTestController.js (혹은 현재 파일 위치)
// 필요한 모듈: axios, pool (pg), 그리고 아래 helper 포함

// const axios = require("axios");

// ---------- Helpers ----------
/** 코드블록 제거 + JSON 파싱(실패 시 null) */
function safeJsonParse(text) {
  try {
    const stripped = String(text || "")
      .replace(/```json\s*|```\s*|```/gi, "")
      .trim();
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

/** 4지선다/스키마 검증 */
function validateQuestions(arr) {
  if (!Array.isArray(arr) || arr.length !== 15) return false;
  for (const q of arr) {
    if (
      !q ||
      typeof q.question !== "string" ||
      !Array.isArray(q.options) ||
      q.options.length !== 4 ||
      !q.options.every((o) => typeof o === "string") ||
      typeof q.answer !== "string" ||
      !q.options.includes(q.answer)
    ) {
      return false;
    }
  }
  return true;
}

/** (선택) 11~13은 3~5줄, 14~15는 7~10줄 소프트 체크 */
function softCheckPositions(arr) {
  try {
    const countLines = (s) => String(s || "").split(/\r?\n/).filter(Boolean).length;
    for (let i = 10; i <= 12; i++) {
      const L = countLines(arr[i]?.question);
      if (L < 3 || L > 6) console.warn(`[softCheck] Q${i + 1} expected 3~5 lines, got ${L}`);
    }
    for (let i = 13; i <= 14; i++) {
      const L = countLines(arr[i]?.question);
      if (L < 7 || L > 11) console.warn(`[softCheck] Q${i + 1} expected 7~10 lines, got ${L}`);
    }
  } catch {}
}

/** stage별 프롬프트 — 난이도/유형/문항 위치 고정 반영 */
function promptForStage(stage) {
  const COMMON_RULE =
    '출력은 "오직 JSON 배열" 하나만. 마크다운/설명/코드블록/여는말 금지. ' +
    '배열 길이=15. 각 원소는 {"question":string,"options":string[4],"answer":string} 형식. ' +
    '"answer"는 반드시 options 중 하나와 동일. ' +
    '모든 문항의 question에는 정답 판단 근거가 드러나도록 **지문/짧은 맥락 또는 발문**을 포함(별도 필드 금지). ' +
    '보기는 자연스러운 한국어로, 중복·모호함·오탈자 금지.';

  const map = {
    // 0단계: (회원가입 직후) 기초→활용
    0: `20대 사회초년생의 초기 진단을 위해, 실생활·사회생활 맥락에서 어휘·문해력을 객관적으로 평가하는 15문항을 생성하라.
난이도 분포: 기초 40%, 활용 30%, 심화 20%, 고급 10% (자연스럽게 섞을 것).
유형 풀: (5.1 어휘 추론, 5.2 문맥 이해, 5.3 중심 내용/주제, 5.4 작가 의도·함의·비유, 5.5 비판적 사고(주장-근거/논리오류), 5.6 짧은 글(3~5줄) 맥락 이해, 5.7 긴 글(7~10줄) 맥락 이해).
**위치 고정**: 11~13번=5.6(각각 3~5줄 지문+질문), 14~15번=5.7(각각 7~10줄 지문+질문).
각 문항은 실무/생활/사회 이슈 등 현실 맥락을 활용하고, 정답의 근거가 질문/지문에 분명히 드러나도록 하라.
${COMMON_RULE}`,

    // 1단계: 활용→심화
    1: `20대 사회초년생이 활용 단계로 도약할 수 있는지 평가하는 15문항을 생성하라.
목표: 일상·실무·사회 맥락 속 단어·문장을 정확히 해석하고, 문장 관계(원인-결과/대조/조건 등)와 논지를 파악하는 능력 평가.
유형 풀: (2.1 어휘 의미/유추, 2.2 문맥 이해, 2.3 중심 내용/주제(추상 포함), 2.4 작가 의도·비유/풍자·함의, 2.5 비판적 사고(주장-근거/반박/논리오류), 2.6 짧은 글(3~5줄), 2.7 긴 글(7~10줄)).
**위치 고정**: 14~15번=2.7(각 7~10줄 지문+질문). 나머지는 2.1~2.6을 고르게 섞어라.
난이도는 활용을 중심으로 일부 심화/기초가 섞이도록 자연스럽게 분포시켜라.
${COMMON_RULE}`,

    // 2단계: 심화→고급
    2: `20대 사회초년생이 심화 단계에서 고급 단계로 갈 수 있는지 평가하는 15문항을 생성하라.
목표: 추상 개념, 은유/풍자, 미묘한 함의, 논증 구조(주장-근거-반박), 논리 오류 분석 등 고난도 문해력 평가.
유형은 위와 동등 범주를 섞되, **마지막 2문항은 긴 글(7~10줄) 기반**으로 고정하고 고급 난이도 사고를 요구하게 하라.
전 문항에서 정답이 되는 논리/근거가 텍스트에 충분히 드러나야 한다.
${COMMON_RULE}`,

    // 3단계: (옵션) 고급 유지/평가
    3: `심화된 고급 학습자를 대상으로, 비판적 사고/추상 개념/담론 분석을 요구하는 15문항을 생성하라.
마지막 2문항은 긴 글(7~10줄) 기반으로 고정한다.
${COMMON_RULE}`,
  };
  return map[stage];
}

/** OpenAI 호출 (3.5 유지, 재시도 1회, 서버 타임아웃 12s) */
async function callOpenAIWithRetry(messages, { tries = 1, timeout = 42000 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o-mini",
          messages,
          temperature: 0.2,
          max_tokens: 2000,        // ← 상한
        },
        {
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          timeout: 49000,           // ← 9초로 단일화
        }
      );
      // const resp = await axios.post(
      //   "https://api.openai.com/v1/chat/completions",
      //   {
      //     //model: "gpt-3.5-turbo",
      //     model: "gpt-4o-mini", //속도 느리면 model: "gpt-4o", 고민하기!
      //     messages,
      //     temperature: 0.2, // 변동성 낮춤 (안정성)
      //     // max_tokens 미지정: 한국어 문항이 잘리지 않도록 응답 길이 제한 완화
      //   },
      //   {
      //     headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      //     timeout, // 서버는 클라이언트보다 짧게 (권장 12s)
      //   }
      // );
      return resp;
    } catch (err) {
      lastErr = err;
      console.error(`[OpenAI][try ${i + 1}]`, err?.response?.data || err.message);
      if (i < tries - 1) continue;
    }
  }
  throw lastErr;
}

// ====== 상단 공통 util로 추가 ======
const cleanForDisplay = (s) =>
  String(s ?? "")
    // 1) 리터럴 \n 또는 /n -> 실제 개행
    .replace(/\\n|\/n/g, "\n")
    // 2) CRLF/CR 표준화
    .replace(/\r\n|\r/g, "\n")
    // 3) 개행을 공백 하나로 (줄바꿈 '지우기' 요구사항)
    .replace(/\s*\n\s*/g, " ")
    // 4) 연속 공백 압축
    .replace(/\s{2,}/g, " ")
    .trim();

const cleanQuestionObj = (q) => ({
  ...q,
  question: cleanForDisplay(q.question),
  options: Array.isArray(q.options) ? q.options.map(cleanForDisplay) : [],
  answer: cleanForDisplay(q.answer),
});


/**
 * 11. 레벨 테스트 생성
 * POST /api/gpt/level-test/generate
 * body: { stage: 0|1|2|3 }
 * 응답: { success: true, result: Question[] }
 *
 * 변경점:
 * - GPT 호출 제거
 * - DB 프리셋(quiz_level_test_template.payload) 로드
 * - stage == 0 인 경우 시작 시 users.level = 0 으로 리셋(최초/재측정용)
 */
exports.generateLevelTest = async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "인증 필요" });
    }

    const { stage } = req.body; // 0,1,2,3 (0=회원가입 직후 초기 레벨테스트)
    if (![0, 1, 2, 3].includes(stage)) {
      return res.status(400).json({ success: false, message: "잘못된 단계 값" });
    }

    await client.query("BEGIN");

    // ✅ 초기 레벨 테스트(로그인 후 처음)일 때만 레벨 0으로 리셋
    if (stage === 0) {
      await client.query(
        `UPDATE public.users SET level = 0, updated_at = now() WHERE id = $1`,
        [userId]
      );
    }

    // ✅ 프리셋 로드
    const { rows } = await client.query(
      `SELECT payload FROM quiz_level_test_template WHERE stage = $1 LIMIT 1`,
      [stage]
    );
    const questions = rows[0]?.payload;

    // ✅ 기본 검증 (길이/형태)
    if (
      !Array.isArray(questions) ||
      questions.length !== 15 ||
      !questions.every(
        (q) =>
          q &&
          typeof q.question === "string" &&
          Array.isArray(q.options) &&
          q.options.length === 4 &&
          q.options.every((o) => typeof o === "string") &&
          typeof q.answer === "string" &&
          q.options.includes(q.answer)
      )
    ) {
      await client.query("ROLLBACK");
      return res.status(500).json({
        success: false,
        message: `프리셋(stage=${stage})이 없거나 형식 오류(15문항/4지선다/answer 포함)`,
      });
    }

    // (선택) 위치 기반 소프트 체크 로그를 그대로 쓰고 싶다면:
    // softCheckPositions(questions);

    // ✅ 사용자 기존 문제 삭제 후 저장
    await client.query(`DELETE FROM quiz_level_test WHERE user_id = $1`, [userId]);

    const insertSql = `
      INSERT INTO quiz_level_test (user_id, question_index, question, options, answer)
      VALUES ($1, $2, $3, $4::jsonb, $5)
    `;
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      await client.query(insertSql, [
        userId,
        i + 1,
        String(q.question || ""),
        JSON.stringify(q.options || []),
        String(q.answer || ""),
      ]);
    }

    await client.query("COMMIT");
     // ✅ 프론트로 나가는 응답만 깨끗하게 정리해서 전달
     const resultForDisplay = questions.map(cleanQuestionObj);
     return res.json({ success: true, result: resultForDisplay });
 
    // return res.json({ success: true, result: questions });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ 레벨 테스트 생성 오류:", err.message);
    return res.status(500).json({
      success: false,
      message: "레벨 테스트 생성 실패(프리셋 로드 오류)",
    });
  } finally {
    client.release();
  }
};

/**
 * 12. 레벨 테스트 응답 및 채점
 * POST /api/gpt/level-test/submit
 * (기존 로직 그대로 사용)
 */
exports.submitLevelTest = async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "인증 필요" });

    const { answers } = req.body; // [{questionIndex:1, choice:"..."}]
    if (!Array.isArray(answers)) {
      return res.status(400).json({ success: false, message: "answers 배열 필요" });
    }

    await client.query("BEGIN");

    // 정답 채점
    let correctCount = 0;
    for (const a of answers) {
      const row = await client.query(
        `SELECT answer FROM quiz_level_test
           WHERE user_id=$1 AND question_index=$2
           LIMIT 1`,
        [userId, a.questionIndex]
      );
      if (row.rows.length === 0) continue;

      const isCorrect = row.rows[0].answer === a.choice;
      if (isCorrect) correctCount++;

      await client.query(
        `UPDATE quiz_level_test
            SET user_choice=$1, is_correct=$2
          WHERE user_id=$3 AND question_index=$4`,
        [a.choice, isCorrect, userId, a.questionIndex]
      );
    }

    // 단계 승급 규칙(정답수 → 레벨 매핑)
    let newLevel = null;
    if (correctCount >= 13) newLevel = "고급";
    else if (correctCount >= 9) newLevel = "심화";
    else if (correctCount >= 5) newLevel = "활용";
    else newLevel = "기초";

    // users.level 직접 세팅
    const levelMap = { "기초": 1, "활용": 2, "심화": 3, "고급": 4 };
    const targetLevel = levelMap[newLevel] ?? null;
    if (targetLevel !== null) {
      await client.query(
        `UPDATE public.users SET level = $2, updated_at=now() WHERE id=$1`,
        [userId, targetLevel]
      );
    }

    await client.query("COMMIT");
    return res.json({
      success: true,
      correctCount,
      resultLevel: newLevel,
      message: "레벨 테스트 채점 완료, 레벨이 갱신되었습니다.",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ 레벨 테스트 제출 오류:", err.message);
    res.status(500).json({ success: false, message: "레벨 테스트 채점 실패" });
  } finally {
    client.release();
  }
};

// 7문항 고정(4지선다 3, OX 2, 단답 2)
const PLAN = ['MCQ','MCQ','MCQ','OX','OX','SHORT','SHORT'];

// 카테고리 한글 ↔ 서버 내부 코드 매핑(요청 바디는 한글로 받는 걸 가정)
const CATEGORY_MAP = {
  '취업준비': 'JOB_PREP',
  '기초': 'BASIC',
  '활용': 'PRACTICE',
  '심화': 'DEEP',
  '고급': 'ADVANCED'
};

// 프롬프트(사용자 제공 형식 그대로 적용)
function buildPrompt({ categoryKor, len = 80 }) {
  const cfg = { category: categoryKor, len }; // 사용자가 준 서식 그대로 사용
  return `
너는 문해력 학습용 퀴즈 생성기야. 사용자에게 7문제(4지선다형 3개, O/X형 2개, 단답형 2개)를 랜덤으로 만들어줘.
각 문제는 ${cfg.category} 수준에 맞게 생성하고, ${cfg.len}자 내외의 짧은 지문 또는 문장을 포함해.

조건:
- 반드시 한국어로 작성
- 문제 난이도와 어휘 수준은 아래 기준에 맞출 것
- 문제 형식은 JSON 배열로 출력할 것
- 각 항목은 { "type": "...", "question": "...", "options": [...], "answer": "..." } 형식
- 단답형 문제는 ‘밑줄 친 단어를 상황에 맞게 바꿔 쓰세요’ 형태 포함

수준별 기준:
1) [취업준비] 프롬프트
  취업준비중인 20대 사회초년생의 비즈니스 상황 속 활용 어휘를 점검할 수 있는 문해력 퀴즈 문제를 작성하세요.
  조건:  자기소개서, 면접, 기업 커뮤니케이션 등 실제 취업 맥락에서 출제
       혼동되기 쉬운 비즈니스 표현을 보기로 구성
-------------------------------------------------
2) [기초] 프롬프트
  20대 사회초년생의 기초 어휘력을 점검할 수 있는 문해력 퀴즈 문제를 작성하세요.
  조건: 일상적이고 간단한 상황 속에서 출제
       보기 단어는 서로 헷갈릴 수 있지만, 난이도는 낮게 설정
-------------------------------------------------
3) [활용] 프롬프트
  20대 사회초년생의 실무적 어휘 활용 능력을 점검할 수 있는 문해력 퀴즈 문제를 작성하세요.
  조건: 직장/보고/공지/뉴스 등 실제 사회생활 맥락 반영
       보기는 실제 상황에서 혼동될 수 있는 단어 포함
-------------------------------------------------
4) [심화] 프롬프트
  20대 사회초년생의 논리적 사고와 표현을 점검할 수 있는 문해력 퀴즈 문제를 작성하세요.
  조건: 논리적 사고, 분석, 관점 관련 문장 맥락 반영
       심화 어휘 사용 (예: ‘의의’, ‘분석’, ‘한계’, ‘갈등’)
       보기는 유사한 의미지만 뉘앙스가 다른 단어들로 구성
-------------------------------------------------
5) [고급] 프롬프트
  20대 사회초년생의 비판적 사고와 고급 어휘 활용을 점검할 수 있는 문해력 퀴즈 문제를 작성하세요.
  조건: 사회/인문학적 주제에 관련된 문맥에서 출제
       고급 어휘 (예: ‘합의’, ‘구조’, ‘담론’, ‘성찰’) 포함
       보기는 모두 비슷해 보이지만 뉘앙스가 뚜렷이 다른 단어로 구성

추가 조건:
1. 문제 유형은 [사지선다형] / [O,X형] / [단답형]을 섞어 구성할 것.
 - 사지선다형: 보기는 모두 그럴듯해야 하며, 정답은 1개만 명확히 존재할 것.
 - OX형: 직장·사회생활 맥락에 맞는 짧은 지문 제시 후, 사실 여부 판단.
 - 단답형: 단순 설명에 해당하는 단어 맞히기가 아닌, 빈칸 채우기·부분 단어 변경·문맥상 적절한 단어 선택 등의 문제로 출제.
   또한 정답은 반드시 단어 1~2개로 명확해야 하며, 주관적 해석 여지를 아예 없앨 것.

**중요: JSON 배열만 출력하세요. 코드블록(\`\`\`) 없이, 설명 없이.**
`;}

// 모델 호출 & JSON 파싱 유틸
async function generateQuizArray(prompt) {
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini', // 필요시 환경변수로 분리
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.8
  });
  let text = resp.choices?.[0]?.message?.content || '[]';
  // 코드펜스 제거/트레일링 텍스트 제거 방어
  text = text.trim()
    .replace(/^```json/gi,'')
    .replace(/^```/gi,'')
    .replace(/```$/gi,'')
    .trim();
  let arr;
  try { arr = JSON.parse(text); }
  catch(e){ arr = []; }
  if (!Array.isArray(arr)) arr = [];
  return arr;
}

// GPT 결과를 우리 스키마에 맞게 정규화
function normalizeItems(rawItems) {
  const items = [];
  let mcq = 0, ox = 0, shortx = 0;

  for (const it of rawItems) {
    const t = String(it.type || '').toUpperCase();
    if (t.includes('OX')) {
      if (ox >= 2) continue;
      items.push({
        type: 'OX',
        statement: String(it.question || '').trim(),
        answer_is_o: (String(it.answer || '').trim().toUpperCase() === 'O')
      });
      ox++;
    } else if (t.includes('단답') || t.includes('SHORT')) {
      if (shortx >= 2) continue;
      items.push({
        type: 'SHORT',
        guide: '밑줄 친(또는 문맥상) 단어를 적절히 바꿔 쓰세요.',
        sentence: String(it.question || '').trim(),
        underline_text: null,
        answer_text: String(it.answer || '').trim()
      });
      shortx++;
    } else { // MCQ
      if (mcq >= 3) continue;
      const opts = Array.isArray(it.options) ? it.options : [];
      const answer = String(it.answer || '').trim();
      // 보기와 정답 매칭 (일치 텍스트의 인덱스)
      let correctId = null;
      const mapped = opts.map((o, idx) => {
        const label = typeof o === 'string' ? o : (o?.label ?? o?.text ?? '');
        if (label === answer && correctId === null) correctId = idx + 1;
        return { id: idx + 1, label: String(label) };
      });
      items.push({
        type: 'MCQ',
        text: String(it.question || '').trim(),
        options: mapped,
        correct_option_id: correctId, // 없을 수도 있으므로 서버 채점 시 null 체크
      });
      mcq++;
    }
    if (items.length === 7) break;
  }

  // 혹시 부족하면 간단한 더미로 채움(실서비스는 재호출 권장)
  while (items.length < 7) {
    items.push({
      type: 'OX',
      statement: '임시 문장입니다. 사실인가요?',
      answer_is_o: false
    });
  }
  // 화면 진행 순서 고정: MCQ→OX→SHORT
  const orderScore = { 'MCQ': 1, 'OX': 2, 'SHORT': 3 };
  items.sort((a,b) => orderScore[a.type]-orderScore[b.type]);
  return items.slice(0,7);
}

// =============== Controller ===============

// POST /api/gpt/quiz
// body: { category: '취업준비'|'기초'|'활용'|'심화'|'고급', len?: number }
// req.user.id 가 있다고 가정(미들웨어에서 주입)
exports.createOrGetBatch = async (req, res) => {
  const userId = req.user?.id;
  const categoryKor = String(req.body?.category || '').trim();
  const len = Number(req.body?.len || 80);

  if (!userId) return res.status(401).json({ success:false, message:'인증 필요' });
  if (!CATEGORY_MAP[categoryKor]) {
    return res.status(400).json({ success:false, message:'category(한글) 값이 올바르지 않습니다.' });
  }
  const categoryCode = CATEGORY_MAP[categoryKor];

  const client = await pool.connect();
  try {
    // 1) 오늘자 동일 카테고리 가장 최근 세트 재사용(요청문 관례) :contentReference[oaicite:2]{index=2}
    const reuse = await client.query(
      `SELECT id FROM quiz_batch
       WHERE user_id = $1 AND category = $2
       AND (created_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, categoryCode]
    );

    let batchId;
    if (reuse.rows[0]) {
      batchId = reuse.rows[0].id;
    } else {
      // 2) GPT로 생성 → 정규화 → 저장
      const prompt = buildPrompt({ categoryKor, len });
      const raw = await generateQuizArray(prompt);
      const items = normalizeItems(raw);

      const ins = await client.query(
        `INSERT INTO quiz_batch (user_id, category, total)
         VALUES ($1,$2,$3) RETURNING id`,
        [userId, categoryCode, 7]
      );
      batchId = ins.rows[0].id;

      let idx = 1;
      for (const it of items) {
        if (it.type === 'MCQ') {
          await client.query(
            `INSERT INTO quiz_question
             (batch_id, question_index, type, text, options_json, correct_option_id, explanation)
             VALUES ($1,$2,'MCQ',$3,$4,$5,$6)`,
            [batchId, idx, it.text, JSON.stringify(it.options), it.correct_option_id, it.explanation ?? null]
          );
        } else if (it.type === 'OX') {
          await client.query(
            `INSERT INTO quiz_question
             (batch_id, question_index, type, statement, answer_is_o, explanation)
             VALUES ($1,$2,'OX',$3,$4,$5)`,
            [batchId, idx, it.statement, it.answer_is_o, it.explanation ?? null]
          );
        } else { // SHORT
          await client.query(
            `INSERT INTO quiz_question
             (batch_id, question_index, type, guide, sentence, underline_text, answer_text, explanation)
             VALUES ($1,$2,'SHORT',$3,$4,$5,$6,$7)`,
            [batchId, idx, it.guide ?? null, it.sentence ?? null, it.underline_text ?? null, it.answer_text ?? null, it.explanation ?? null]
          );
        }
        idx++;
      }
    }

    // 3) 조회 형태로 응답(화면 VM이 바로 바인딩 가능) :contentReference[oaicite:3]{index=3}
    const rows = await client.query(
      `SELECT question_index, type,
              text, options_json, correct_option_id,
              statement, answer_is_o,
              guide, sentence, underline_text, answer_text, explanation
       FROM quiz_question
       WHERE batch_id = $1
       ORDER BY question_index`,
      [batchId]
    );

    // 화면 모델에 맞춘 변환
    const steps = rows.rows.map(r => {
      if (r.type === 'MCQ') {
        return {
          index: r.question_index, type: r.type,
          text: r.text,
          options: r.options_json || [],
          correctOptionId: r.correct_option_id, // 프리뷰/학습 목적이면 숨길 수도 있음
          explanation: r.explanation
        };
      } else if (r.type === 'OX') {
        return {
          index: r.question_index, type: r.type,
          statement: r.statement,
          answerIsO: r.answer_is_o,
          explanation: r.explanation
        };
      } else {
        return {
          index: r.question_index, type: r.type,
          guide: r.guide, sentence: r.sentence,
          underlineText: r.underline_text,
          answerText: r.answer_text,
          explanation: r.explanation
        };
      }
    });

    return res.json({
      success: true,
      result: {
        batchId,
        category: categoryCode,
        total: steps.length,
        steps
      }
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success:false, message:'퀴즈 생성/조회 실패' });
  } finally {
    client.release();
  }
};

// GET /api/gpt/quiz/:batchId
exports.getBatch = async (req, res) => {
  const userId = req.user?.id;
  const batchId = Number(req.params.batchId);
  if (!userId) return res.status(401).json({ success:false, message:'인증 필요' });

  try {
    const own = await pool.query(
      `SELECT 1 FROM quiz_batch WHERE id = $1 AND user_id = $2`,
      [batchId, userId]
    );
    if (!own.rows[0]) {
      return res.status(404).json({ success:false, message:'세트를 찾을 수 없습니다.' });
    }

    const rows = await pool.query(
      `SELECT question_index, type,
              text, options_json, correct_option_id,
              statement, answer_is_o,
              guide, sentence, underline_text, answer_text, explanation
       FROM quiz_question
       WHERE batch_id = $1
       ORDER BY question_index`,
      [batchId]
    );

    const steps = rows.rows.map(r => {
      if (r.type === 'MCQ') {
        return { index:r.question_index, type:r.type, text:r.text, options:r.options_json||[], correctOptionId:r.correct_option_id, explanation:r.explanation };
      } else if (r.type === 'OX') {
        return { index:r.question_index, type:r.type, statement:r.statement, answerIsO:r.answer_is_o, explanation:r.explanation };
      } else {
        return { index:r.question_index, type:r.type, guide:r.guide, sentence:r.sentence, underlineText:r.underline_text, answerText:r.answer_text, explanation:r.explanation };
      }
    });

    return res.json({ success:true, result:{ batchId, total: steps.length, steps }});
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success:false, message:'세트 조회 실패' });
  }
};

// POST /api/gpt/submit
// body: { batchId, questionIndex, payload: { selectedOptionId? , selectedIsO?, textAnswer? } }
function norm(s) {
  return (s || '').trim().toLowerCase().replace(/\s+/g,' ').normalize('NFC');
}

exports.submitAndGrade = async (req, res) => {
  const userId = req.user?.id;
  const { batchId, questionIndex, payload } = req.body || {};
  if (!userId) return res.status(401).json({ success:false, message:'인증 필요' });
  if (!batchId || !questionIndex) {
    return res.status(400).json({ success:false, message:'batchId, questionIndex 필요' });
  }

  const client = await pool.connect();
  try {
    const q = await client.query(
      `SELECT q.id, q.type, q.correct_option_id, q.answer_is_o, q.answer_text
       FROM quiz_question q
       JOIN quiz_batch b ON b.id = q.batch_id
       WHERE q.batch_id = $1 AND q.question_index = $2 AND b.user_id = $3
       LIMIT 1`,
      [batchId, questionIndex, userId]
    );
    if (!q.rows[0]) {
      return res.status(404).json({ success:false, message:'문항을 찾을 수 없습니다.' });
    }
    const step = q.rows[0];

    let isCorrect = null;
    let selOpt = payload?.selectedOptionId ?? null;
    let selIsO = (typeof payload?.selectedIsO === 'boolean') ? payload.selectedIsO : null;
    let textAnswer = payload?.textAnswer ?? null;

    if (step.type === 'MCQ' && step.correct_option_id != null && selOpt != null) {
      isCorrect = (Number(selOpt) === Number(step.correct_option_id));
    } else if (step.type === 'OX' && step.answer_is_o !== null && selIsO !== null) {
      isCorrect = (Boolean(selIsO) === Boolean(step.answer_is_o));
    } else if (step.type === 'SHORT' && step.answer_text) {
      isCorrect = (norm(textAnswer) === norm(step.answer_text));
    }

    await client.query(
      `INSERT INTO quiz_response
         (user_id, batch_id, question_id, question_index, type,
          selected_option_id, selected_is_o, text_answer, is_correct)
       VALUES
         ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (user_id, batch_id, question_index)
       DO UPDATE SET
         selected_option_id = EXCLUDED.selected_option_id,
         selected_is_o      = EXCLUDED.selected_is_o,
         text_answer        = EXCLUDED.text_answer,
         is_correct         = EXCLUDED.is_correct,
         submitted_at       = now()`,
      [userId, batchId, step.id, questionIndex, step.type, selOpt, selIsO, textAnswer, isCorrect]
    );

    return res.json({ success:true, result:{ isCorrect } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success:false, message:'응답 저장/채점 실패' });
  } finally {
    client.release();
  }
};

// GET /api/gpt/summary/daily?date=YYYY-MM-DD
exports.getDailySummary = async (req, res) => {
  const userId = req.user?.id;
  const date = String(req.query?.date || '').trim();
  if (!userId) return res.status(401).json({ success:false, message:'인증 필요' });

  try {
    const rows = await pool.query(
      `SELECT * FROM v_quiz_daily_summary WHERE user_id = $1 ${date ? 'AND ymd = $2' : ''} ORDER BY ymd DESC`,
      date ? [userId, date] : [userId]
    );
    return res.json({ success:true, result: rows.rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success:false, message:'일자별 요약 조회 실패' });
  }
};


