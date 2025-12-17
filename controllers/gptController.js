// controllers/gptController.js
// gpt 프롬프트를 사용하는 모든 api 구현
// 앱 : 오늘의 학습 글감 생성, ai 대화, 퀴즈 api를 생성함.(윤지/감자)
const axios = require('axios');
const http = require('http');
const https = require('https');
const pool = require('../config/db');  // 공용 pool 사용

// 로그인 필수 전제: app 레벨에서 requireLogin 미들웨어로 보호할 것
//    예) app.use('/api/gpt', auth, requireLogin, gptRoutes);

// axios 공통 기본값 (직접 호출 방어)
axios.defaults.timeout = 20000;
axios.defaults.maxBodyLength = 1024 * 1024;
axios.defaults.httpAgent  = new http.Agent({ keepAlive: false });
axios.defaults.httpsAgent = new https.Agent({ keepAlive: false });

//2) OpenAI 네트워크 에러만 502/504로 매핑 (사고 원인만 분리)
function replyOpenAIError(res, err, fallbackMsg = 'GPT API 오류') {
  const httpStatus = err?.response?.status;
  const code = err?.code;

  const retryables = new Set(['ECONNRESET','ETIMEDOUT','ECONNABORTED','ENOTFOUND','EPIPE']);
  const isRetryableNet = retryables.has(code);
  const isOpenAIOverload = httpStatus === 429 || (httpStatus >= 500 && httpStatus < 600);

  const status = isRetryableNet ? 504
               : isOpenAIOverload ? 502
               : 500;

  logOpenAIError(err, 'OpenAI');
  return res.status(status).json({ success:false, message: fallbackMsg });
}


// 0) OpenAI axios 인스턴스 (단일 진입점)
const oa = axios.create({
  baseURL: 'https://api.openai.com/v1',
  headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  timeout: 20000, // 20s 하드 타임아웃
  // keep-alive 재사용 소켓에서 발생하는 ECONNRESET 회피 (간단모드)
  httpAgent: new http.Agent({ keepAlive: false }),
  httpsAgent: new https.Agent({ keepAlive: false }),
  maxBodyLength: 1024 * 1024,
});

// 0-1) 안전 로거 (키 노출 방지)
function logOpenAIError(err, label = 'OpenAI') {
  const status = err?.response?.status;
  const data = err?.response?.data;
  // Authorization 등 민감정보는 절대 로그에 남기지 않음
  console.error(`[${label}] status=${status || 'N/A'} msg=${data?.error?.message || err.message}`);
}

// 0-2) 재시도 유틸 (ECONNRESET/ETIMEDOUT/ECONNABORTED/429)
const RETRYABLE_CODES = new Set(['ECONNRESET','ETIMEDOUT','ECONNABORTED','ENOTFOUND','EPIPE']);
async function withRetry(fn, { tries = 2, baseDelay = 300, label } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      const httpStatus = err?.response?.status;
      const code = err?.code;
      const retryable = RETRYABLE_CODES.has(code) || httpStatus === 429 || (httpStatus >= 500 && httpStatus < 600);
      logOpenAIError(err, label || 'OpenAI');
      if (i === tries - 1 || !retryable) break;
      const delay = baseDelay * (i + 1); // 300ms, 600ms …
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// 1) 공통 호출 (Chat Completions)
async function callChat(messages, { temperature = 0.6, max_tokens = 900, label } = {}) {
  return withRetry(
    () => oa.post('/chat/completions', {
      model: 'gpt-4o-mini',
      messages,
      temperature,
      max_tokens, // 응답 길이 상한
    }),
    { tries: 2, baseDelay: 400, label }
  );
}

//1-2) 퍼플렉시티 함수 호출
async function callPerplexityChat(messages, { temperature = 0.7, max_tokens = 1200, label } = {}) {
  return axios.post(
    'https://api.perplexity.ai/chat/completions',
    {
      model: 'sonar-pro',
      messages,
      temperature,
      max_tokens,
      label
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.PPLX_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  ).then(res => res.data);
}

//전문가용 난이도 검증 함수
function checkDifficulty(text) {
  if (!text) return false;

  const length = text.replace(/\s/g, "").length;
  if (length < 450) return false; // 480~520자 기준 기초 필터

  // ❶ 금지된 일상·사건·직장 묘사 필터
  const bannedWords = [
    "오늘","어제","아침","점심","저녁","사무실","회사","직장",
    "출근","퇴근","회의","동료","팀원","이메일","프로젝트",
    "점심","식사","학교","경험","일상","상황","함께","친구",
    "왔다","했다","갔다","사용했다","사용했다","시작했다"
  ];
  if (bannedWords.some(w => text.includes(w))) return false;

  // ❷ 금지된 단순 서술 패턴 필터
  const diaryPattern = /(했다|하였다|합니다|되었습니다)\s/g;
  if (diaryPattern.test(text)) return false;

  // ❸ 단순 보고문 패턴 (너가 추가한 것)
  const simpleVerbPattern = /(된다|이었다|이었다가|되고|되어)/g;
  if (simpleVerbPattern.test(text)) return false;

  // ❸ 금지된 문장 구성 (대화체, 질문 등)
  if (/[?]/.test(text)) return false;
  if (/["“”'’]/.test(text)) return false;

  // ❹ 전문·추상 개념어 최소 포함 수
  const conceptWords = [
    "구조","요인","관계","맥락","경향","변동","조정","상호작용",
    "제약","정합성","상충","효율성","지속 가능성","담론",
    "제도적","구조적","추상화","조건","가정","분석","모형",
    "체계","규범","합리성","긴장","비대칭"
  ];
  let hit = conceptWords.filter(w => text.includes(w)).length;
  if (hit < 5) return false;

  // ❺ 문장 수 (최소 4~8문장)
  const sentenceCount = text.split(/[.]/).filter(s => s.trim().length > 5).length;
  if (sentenceCount < 4) return false;

  // ❻ 문장 길이 평균 (복문 여부 체크)
  const sentences = text.split(/[.]/).map(s => s.trim());
  const longSentences = sentences.filter(s => s.length >= 25).length;
  if (longSentences < 4) return false;

  return true;
}

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
 * POST /api/gpt/generate-quote -> 여기 gpt 별로라 부득이하게 퍼플렉시티 api로 수정
 *  -  user_id 필수
 *  -  (user_id, date) UNIQUE UPSERT
 *  -  level: DB 기본값, req.body.level(1~4) 오면 override
 *  -  refresh=1 쿼리로 강제 재생성

 */
exports.generateQuote = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '인증 필요' });

    const today = getKstToday();
    const forceRefresh = req.query.refresh === '1';

    // ────────── 레벨 결정 ──────────
    const lvQ = await pool.query('SELECT level FROM public.users WHERE id = $1 LIMIT 1', [userId]);
    let userLevel = lvQ.rows[0]?.level ?? 1;
    const bodyLv = Number(req.body?.level);
    if ([1, 2, 3, 4].includes(bodyLv)) userLevel = bodyLv;

    // ────────── 이미 존재 시 재사용 ──────────
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

        // ────────────────────────────────────────────────
    // 1) 강화된 프롬프트 (난이도별 1~4)
    // 2) 공통 규칙 -> 기존 솔직히 별로... 여서... 수정함.
    // ────────────────────────────────────────────────

    const basePrompt = `
    당신은 20대 사회초년생을 위한 실무형 어휘·문해력 학습용 글을 쓰는 작가입니다.
    글은 모두 실제 사회생활에서 대화 소재로 쓰일 수 있는
    경제·노동·조직 문화·기술·부동산·정책·심리·문화생활 등의 주제를 다루세요.

    수능 지문처럼 인위적인 글이나 추상적인 자기계발 조언이 아니라,
    현실에서 마주칠 수 있는 장면과 개념 설명에 초점을 맞춰 주세요.
    정치·종교·시사 금지입니다.

    분량은 반드시 480~520자 사이여야 하며, 이 범위를 벗어나면 안 됩니다.
    출력은 본문 텍스트만 반환하고, 제목·번호·문제·해설 등은 절대 붙이지 마세요.
    학술 논문 스타일의 인용 표시 [1], [2], (1), (2) 등은 절대 사용하지 마세요.
    마크다운 문법(**, __, *, -, •)을 절대 사용하지 마세요.
    글자 수를 나타내는 표현(예: ~자, n자, [n자])을 절대 출력하지 마세요.
    강조, 굵게 표시, 기호 강조 없이 순수한 서술문만 작성하세요.

    `;


    // ────────── 프롬프트 개선판 ──────────
    const levelPrompts = {
      1: `
    [레벨1]
    - 일상·직장 생활에서 자주 듣지만 설명하기 애매한 기초 개념 1가지를 다룹니다.
      (예: 연차, 마감, 인수인계, 계약, 월세, 적금, 회의, 보고 등)
    - 그 개념의 뜻과 기본 쓰임을 설명하고, 회사·알바·학교 등 구체적인 상황 예시 2가지 포함.
    - ‘금일, 익일, 권한’처럼 낯설지만 자주 쓰는 단어 3~5개 포함.
    - 은유·비유 금지, 하나의 주제만 다룸.
    - 1~2단락으로 자연스럽게 마무리.
    `,
    
      2: `
    [레벨2]
    - 회사 공지·보고서·뉴스 기사에서 자주 등장하는 개념 2~3개 중심으로 글 작성.
    - 정의 → 실제 문맥 속 쓰임 → 날짜/수치 포함한 현실감 있는 구성.
    - 회사 메일처럼 정중하지만 과도하게 딱딱하지 않은 톤.
    - 정보 전달 위주로 작성, 추상적 조언 금지.
    `,
    
      3: `
    [레벨3]
    - 사회생활에서 자주 등장하는 경제·사회 개념 1가지를 선택해 설명 + 관점 제시.
    - 개념 정의 → 상황 예시 → 서로 다른 입장 대비.
    - 잡지 칼럼 난이도, 논리 연결 표현 적극 사용.
    - 원인·결과·비교 등 복합 문장 최소 3개 포함.
    `,
    
      4: `
    [레벨4]
    - 하나의 사회적·인문학적·경제적 주제를 골라, 비판·통찰·문제 제기 포함한 짧은 칼럼 작성.
    - 구체적 현상 → 구조/담론 설명 → 성찰 지점 제시.
    - ‘합의, 구조, 담론…’ 같은 고급 어휘 포함.
    - 모든 문단이 논리적으로 이어져야 함.
    `,
    };


    const seed = Math.floor(Math.random() * 100000);

    

// // ────────── 🔧 고정 글감 삽입 (GPT 대신 발표용으로 임시 사용) ──────────


//     let generatedText = `
//     열역학 제1법칙은 다음과 같이 표현된다.
//     "어떤 계의 내부 에너지의 증가량은 계에 더해진 열에너지에서 계가 외부에 해준 일을 뺀 양과 같다."
//     열의 이동에 따라 계 내부의 에너지가 변하는데, 이때 열에너지 또한 변한다.
//     이 에너지는 계 내부의 원자·분자의 역학적 에너지를 일컫는다.

//     일반적으로, 어떤 체계에 외부로부터 에너지가 가해지면 그만큼 체계의 에너지가 증가한다.
//     이와 같이, 물체에 열을 가하면 그 물체의 내부 에너지가 가해진 열에너지만큼 증가한다.
//     또한 물체에 역학적인 일이 더해져도 역시 내부 에너지는 더해진 일의 양만큼 증가한다.
//     따라서 물체에 열과 일이 동시에 가해졌을 때 내부 에너지는 가해진 열과 일의 양만큼 증가한다.
//     이것을 열역학의 제1법칙이라고 한다.

//     이 법칙에 따르면 에너지는 형태가 변할 수 있을 뿐 새로 만들어지거나 없어질 수 없다.
//     즉, 일정량의 열을 일로 바꾸었을 때 그 열은 소멸된 것이 아니라 다른 형태의 에너지로 변환된 것이다.
//     열역학 제1법칙은 보다 일반화된 에너지 보존 법칙의 표현이다.
//     `;
     // ────────── 프롬프트 세팅 ──────────
     const sys = {
      role: 'system',
      content: '너는 한국어 글쓰기 교사이자 작가다. 사용자에게 대화하지 말고, 요구한 본문만 정확히 작성한다.'
    };

    const topics = [
      // 💼 직장 실무
      "보고·커뮤니케이션",
      "업무 협업과 역할 분담",
      "프로젝트 일정 관리",
      "회의 문화와 의사소통",
      "직장 조직 문화 이해",
      "인수인계의 기본 구조",
    
      // 🧠 일하는 태도·심리
      "자기효능감과 업무 몰입",
      "번아웃과 감정노동",
      "직장 내 갈등 관리",
      "업무 스트레스 조절 전략",
      "신규 입사자 적응",
    
      // 📊 경제·금융 기초
      "급여 명세서 용어 이해",
      "연말정산과 세금 기초",
      "적금·예금·금리 구조",
      "사회초년생 소비·지출 관리",
      "주거 비용과 월세 계약",
    
      // 🏛 사회·기술 변화
      "원격 근무와 디지털 협업",
      "새로운 기술 트렌드 이해",
      "데이터 기반 의사결정",
      "알고리즘·자동화의 확산",
    
      // 📚 시민·생활 지식
      "보험의 기본 개념",
      "사회보장제도 기초",
      "노동권과 근로계약",
      "기초 법률·계약 상식"
    ];
    const user = {
      role: 'user',
      content: [
        `오늘 날짜: ${today}, 난수: ${seed}`,
        `주제 후보: ${topics.join(', ')} 중 1개를 내부적으로 임의 선택(최근 7일 중복 금지).`,
        levelPrompts[userLevel] ?? levelPrompts[1],
        // `제약: 출력은 한국어 **서술형 본문 1개 단락만**.`,
        // `금지: 질문/제안/대화체/머리말/따옴표/코드블록/메타설명/제목.`,
        // `금지어 예: "주제", "하시겠어요", "원하시면" 등.`
      ].join('\n')
    };

    const getLevelPrompt = (level, retryCount) => {
      const basePrompt = levelPrompts[level] ?? levelPrompts[1];
      if (retryCount === 0) return basePrompt;
      if (retryCount === 1)
        return basePrompt + '\n더 심오하고 학문적 어휘를 사용하여 작성하세요.';
      if (retryCount === 2)
        return basePrompt + '\n복잡한 이론 간 상호작용 설명을 추가하여 난이도를 최대화하세요.';
      return basePrompt;
    };
    

    // ────────── 생성 및 품질 검증 ──────────
    let generatedText = '';
    for (let attempt = 0; attempt < 3; attempt++) {

      const combinedPrompt = [
        basePrompt,
        `오늘 날짜: ${today}, 난수: ${seed}`,
        `주제 후보: ${topics.join(', ')} 중 1개를 내부적으로 임의 선택(최근 7일 중복 금지).`,
        getLevelPrompt(userLevel, attempt)
      ].join("\n\n");

      const perplexityRes = await callPerplexityChat(
        [
          { role: 'system', content: sys.content },
          { role: 'user', content: combinedPrompt } 
        ],
        { temperature: attempt < 1 ? 0.8 : 0.9, max_tokens: 1500, label: 'generateQuote' }
      );

      //기존 gpt api호출 입니다! -> 퍼플렉시티도 별로면....이걸 살려야...
      // const gptRes = await callChat(
      //   [
      //     { role: 'system', content: sys.content },
      //     { role: 'user', content: user.content }
      //   ],
      //   {
      //     temperature: 0.7,
      //     max_tokens: 1200,
      //     label: 'generateQuote'
      //   }
      // );

      //generatedText = pplxRes.data?.choices?.[0]?.message?.content ?? "";
      //generatedText = generatedText.trim();

      // // 안전한 raw 추출
      // const raw = perplexityRes?.choices?.[0]?.message?.content;

      // // null/undefined 대비
      // generatedText = (raw ?? '').trim();


      
      // // 코드블록 제거 (이거 꼭 있어야 함!)
      // generatedText = generatedText.replace(/^```[\s\S]*?```/gm, "").trim();

      
      generatedText = (perplexityRes?.choices?.[0]?.message?.content ?? '').trim();
      generatedText = generatedText.replace(/^```[\s\S]*?```/gm, "").trim();
      //generatedText = generatedText.replace(/^```[\s\S]*?```/gm, "").trim();
      
      
      // 공백 정리
      generatedText = generatedText
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/(?<!\n)\n(?!\n)/g, " ")
      .trim();

      // --- 논문 스타일 인용 완전 제거 ---
      // [1][2][5][7] 같은 연속 인용
      generatedText = generatedText.replace(/(\[\d+\])+/g, "");

      // (1)(2)(3) 같은 인용
      generatedText = generatedText.replace(/(\(\d+\))+/g, "");

      // 인용 제거 후 남은 이중 공백/이상한 공백 정리
      generatedText = generatedText.replace(/\s{2,}/g, " ").trim();

      //  여기가 핵심: 난이도 통과했으면 break
      if (checkDifficulty(generatedText)) break;

      // 마지막 시도면 그래도 최소한의 정리
      if (attempt === 2) {
        generatedText = generatedText.replace(/["“”'’]/g, '').trim();
      }
    }

    

    // ────────── DB UPSERT ──────────
    const upsert = await pool.query(
      `INSERT INTO today_study (user_id, content, date)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, date) DO UPDATE SET content = EXCLUDED.content
       RETURNING study_id`,
      [userId, generatedText, today]
    );
    const studyId = upsert.rows[0].study_id;

    // ────────── 단어 추출 저장 ──────────
    await saveVocabulary(studyId, generatedText);

    return res.json({ success: true, result: generatedText, studyId, level: userLevel });
  } catch (err) {
    console.error(err);
    return replyOpenAIError(res, err, 'GPT API 오류');
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
  if (!word) {
    return res.status(400).json({ success: false, message: '단어 필요' });
  }

  try {
    /* -----------------------------
     * ① GPT 프롬프트 (markdown 금지)
     * ----------------------------- */
    const prompt = `
너는 한국어 어휘 사전 전문가야.
"${word}"의 국립국어원 기준 정의와 예문을 JSON 형식으로만 반환해.
\`\`\`json 금지\`\`\`
설명이나 텍스트 없이 오직 JSON 객체만 응답해야 해.
형식 예시:
{"word": "단어", "meaning": "뜻", "example": "예문"}
`;

    /* -----------------------------
     * ② GPT API 호출
     * ----------------------------- */
    const gptRes = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    /* -----------------------------
     * ③ GPT 응답 정제 및 JSON 파싱
     * ----------------------------- */
    let raw = gptRes.data.choices[0].message.content?.trim() || '';

    // 코드블록(````json ... ````, 백틱) 제거 함수
    const sanitizeJsonString = (str) => {
      return str
        .replace(/^```json\s*/i, '') // 맨 앞의 ```json 제거
        .replace(/^```\s*/i, '')     // 혹시 그냥 ``` 만 있는 경우 제거
        .replace(/\s*```$/i, '')     // 끝의 ``` 제거
        .replace(/[\u0000-\u001F]+/g, '') // 제어문자 제거
        .trim();
    };

    const clean = sanitizeJsonString(raw);

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      console.error('[OpenAI] JSON 파싱 실패:', e.message, '\n원본:', raw);
      return res
        .status(500)
        .json({ success: false, message: 'GPT 응답 JSON 파싱 오류' });
    }

    /* -----------------------------
     * ④ 응답 데이터 정규화
     * ----------------------------- */
    const dataArray = Array.isArray(parsed) ? parsed : [parsed];
    const cleaned = dataArray.map((item) => ({
      word: item.word ?? word,
      meaning: item.meaning ?? '',
      example: item.example ?? '',
    }));

    /* -----------------------------
     * ⑤ 클라이언트로 응답
     * ----------------------------- */
    return res.json({ success: true, result: cleaned });
  } catch (err) {
    console.error('[OpenAI] 오류:', err.response?.data || err.message);
    return replyOpenAIError(res, err, 'GPT API 오류');
  }
};

// ──────────────────────────────────────────────────────────────
/**
 * 3. 단어 저장 (프론트 저장 버튼)
 * POST /api/vocabulary
 *  -  user_id 필수
 *  - study_id가 해당 user의 것인지 검증
 *  - study_id 미지정 시: 해당 user의 오늘 study로 보정
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
 *  - user_id 필수
 *  - study가 해당 user의 것인지 검증 후 조회
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
 *  - user_id 필수
 *  - study 소유권 검증 후 업데이트
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
 *  -  user_id 필수
 *  - study 소유권 검증 후 조회
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
// 7. 퀴즈 생성 (중복이면 기존 반환)
// POST /api/gpt/generate-quiz
//  -  user_id 필수
//  -  study 소유권 검증
// ──────────────────────────────────────────────────────────────
exports.generateQuiz = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '인증 필요' });

    const { text, studyId } = req.body;
    if (!text || !studyId) {
      return res.status(400).json({ success: false, message: 'text 또는 studyId가 필요합니다.' });
    }

    await assertStudyOwnerOrThrow(studyId, userId);

    // 1) 기존 퀴즈 있으면 그대로 반환 (type 포함)
    const existed = await pool.query(
      `SELECT question_index, type, question, options, answer, explanation
         FROM quiz_set
        WHERE study_id = $1
        ORDER BY question_index`,
      [studyId]
    );
    if (existed.rows.length > 0) {
      const quizzes = existed.rows.map(r => ({
        questionIndex: r.question_index,
        type: r.type,
        question: r.question,
        options: Array.isArray(r.options) ? r.options : JSON.parse(r.options || '[]'),
        answer: r.answer,
        explanation: r.explanation
      }));
      return res.json({ success: true, result: quizzes });
    }

    // 2) GPT 프롬프트
    const prompt = `
너는 국어 교사야. 아래 글을 바탕으로 다음 문제 유형 중 3가지를 **랜덤으로 하나씩** 골라,
각 유형에 맞는 객관식 문제를 **한 문장 질문으로만** 만들어줘.

[문제 유형]
1) 중심 내용 파악  2) 세부 내용 파악  3) 어휘/표현 추론
4) 화자의 태도/감정 5) 주제/의도 파악

[출력 형식]
[
  {"type":"...", "question":"...", "options":["...","...","...","..."], "answer":"...", "explanation":"..."},
  {"type":"...", "question":"...", "options":["...","...","...","..."], "answer":"...", "explanation":"..."},
  {"type":"...", "question":"...", "options":["...","...","...","..."], "answer":"...", "explanation":"..."}
]

[필수 규칙]
- **오직 위 JSON 배열만** 출력 (설명, 코드블록, 마크다운 금지)
- 각 문제 유형은 서로 달라야 함
- options 정확히 4개
- answer는 options 중 하나
- question은 한 문장

원문:
"""${text}"""
`.trim();

    // 2-1) 요청 바디 (JSON 강제 옵션까지 포함) — 가능하면 최신 모델 사용 권장
    const payload = {
      model: process.env.OPENAI_QUIZ_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: '당신은 JSON만 출력하는 보조자입니다.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 900,
      // Chat Completions에서 허용되는 타입
      response_format: { type: 'json_object' }
      // 더 강하게 보장하고 싶으면 아래 주석 해제해 json_schema 사용
      // response_format: {
      //   type: 'json_schema',
      //   json_schema: {
      //     name: 'quiz_array',
      //     schema: {
      //       type: 'array',
      //       minItems: 3,
      //       maxItems: 3,
      //       items: {
      //         type: 'object',
      //         required: ['type','question','options','answer','explanation'],
      //         properties: {
      //           type: { type: 'string' },
      //           question: { type: 'string' },
      //           options: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string' } },
      //           answer: { type: 'string' },
      //           explanation: { type: 'string' }
      //         },
      //         additionalProperties: false
      //       }
      //     },
      //     strict: true
      //   }
      // }
    };
    // 2-2) 실제 요청 — 반드시 payload 사용!
    const gptRes = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const raw = gptRes?.data?.choices?.[0]?.message?.content ?? '';

    // 2-3) 방어적 JSON 추출기
    const extractJsonArray = (s) => {
      if (!s) return null;
      // 코드블록 ```json ... ``` 제거
      const cleaned = s.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
      // 첫 '[' 부터 마지막 ']' 사이만 추출
      const start = cleaned.indexOf('[');
      const end = cleaned.lastIndexOf(']');
      if (start === -1 || end === -1 || end < start) return null;
      return cleaned.slice(start, end + 1);
    };

    let quizzes;
    try {
      const candidate = extractJsonArray(raw);
      if (!candidate) throw new Error('JSON 배열을 찾지 못했습니다.');
      quizzes = JSON.parse(candidate);
    } catch (e) {
      console.error('❌ GPT 응답 파싱 실패:', raw);
      return res.status(500).json({ success: false, message: 'GPT 응답을 JSON 배열로 파싱할 수 없습니다.' });
    }

    // 2-4) 최소 스키마 검증 & 자동 보정
    const normalize = (arr) => {
      if (!Array.isArray(arr)) throw new Error('결과가 배열이 아닙니다.');
      return arr.map((q, idx) => {
        const type = (q.type || '').toString().trim() || '유형 없음';
        const question = (q.question || '').toString().trim();
        let options = Array.isArray(q.options) ? q.options.map(o => (o ?? '').toString()) : [];
        let answer = (q.answer ?? '').toString();
        const explanation = (q.explanation ?? '').toString();

        // 옵션 개수 맞추기(모자라면 빈 보강, 넘치면 4개 자르기)
        if (options.length < 4) {
          while (options.length < 4) options.push('');
        } else if (options.length > 4) {
          options = options.slice(0, 4);
        }

        // answer가 options에 없다면 첫 번째로 보정
        if (!options.includes(answer) && options.length > 0) {
          answer = options[0];
        }

        // 질문 한 문장 강제(개행 제거)
        const oneLineQuestion = question.replace(/\s+/g, ' ').trim();

        return {
          type,
          question: oneLineQuestion,
          options,
          answer,
          explanation
        };
      });
    };

    try {
      quizzes = normalize(quizzes);
    } catch (e) {
      console.error('❌ 검증 실패:', e.message);
      return res.status(500).json({ success: false, message: '퀴즈 스키마 검증에 실패했습니다.' });
    }

    // 3) 트랜잭션으로 저장 (중복 방지용 유니크 제약을 권장: (study_id, question_index))
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (let i = 0; i < quizzes.length; i++) {
        const q = quizzes[i];
        await client.query(
          `INSERT INTO quiz_set (
             study_id, question_index, type, question, options, answer, explanation
           ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
          [
            studyId,
            i + 1,
            q.type,
            q.question,
            JSON.stringify(q.options || []),
            q.answer,
            q.explanation
          ]
        );
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    // 4) 저장 후 조회(항상 동일 포맷 반환) — type 포함
    const saved = await pool.query(
      `SELECT question_index, type, question, options, answer, explanation
         FROM quiz_set
        WHERE study_id = $1
        ORDER BY question_index`,
      [studyId]
    );
    const result = saved.rows.map(r => ({
      questionIndex: r.question_index,
      type: r.type,
      question: r.question,
      options: Array.isArray(r.options) ? r.options : JSON.parse(r.options || '[]'),
      answer: r.answer,
      explanation: r.explanation
    }));

    return res.json({ success: true, result });
  } catch (err) {
    console.error('❌ 퀴즈 생성 실패:', err?.response?.data || err.message);
    res.status(err.status || 500).json({ success: false, message: err.message || '퀴즈 생성 실패' });
  }
};

// ──────────────────────────────────────────────────────────────
/**
 * 8. 퀴즈 조회
 * GET /api/gpt/quiz/:studyId
 *  -  user_id 필수
 *  -  study 소유권 검증 후 조회
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
 *  -  user_id 필수
 *  -  study 소유권 검증 후 UPDATE
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
 *  - user_id 필수
 *  - 하루 1번만 지급 (user_id + date 유니크)
 *  - 포인트 지급 후 현재 포인트/이력 반환
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
      todayReward: POINT,                 // 안드 명세 유지
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
//  * 11. 레벨 테스트 생성 -> 기획 수정으로 해당 api 사용하지 않지만.. 혹시 몰라 api 주석처리함.
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

// ▼ helpers 근처에 추가
// function defaultExplanationFor(item) {
//   if (!item) return '';
//   if (item.type === 'MCQ') {
//     if (Array.isArray(item.options) && item.correct_option_id) {
//       const opt = item.options.find(o => Number(o.id) === Number(item.correct_option_id));
//       return opt ? `정답: ${opt.label}` : '';
//     }
//     return '';
//   }
//   if (item.type === 'OX') {
//     if (typeof item.answer_is_o === 'boolean') {
//       return `정답: ${item.answer_is_o ? 'O' : 'X'}`;
//     }
//     return '';
//   }
//   if (item.type === 'SHORT') {
//     if (item.answer_text) return `정답: ${item.answer_text}`;
//     return '';
//   }
//   return '';
// }

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

    // 초기 레벨 테스트(로그인 후 처음)일 때만 레벨 0으로 리셋
    if (stage === 0) {
      await client.query(
        `UPDATE public.users SET level = 0, updated_at = now() WHERE id = $1`,
        [userId]
      );
    }

    // 프리셋 로드
    const { rows } = await client.query(
      `SELECT payload FROM quiz_level_test_template WHERE stage = $1 LIMIT 1`,
      [stage]
    );
    const questions = rows[0]?.payload;

    // 기본 검증 (길이/형태)
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

    // 사용자 기존 문제 삭제 후 저장
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
     // 프론트로 나가는 응답만 깨끗하게 정리해서 전달
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

// 새 프롬프트 적용
function buildPrompt({ categoryKor, len = 80 }) {
  const cfg = { category: categoryKor, len };
  return `
  **************퀴즈뭉치 프롬프트*************
  너는 어휘력 학습용 퀴즈 생성기야.
  사용자에게 7문제(4지선다형 3개, O/X형 2개, 단답형 2개)를 랜덤으로 만들어줘.
  각 문제는 "${cfg.category}" 수준에 맞게 생성하고, 문제 자체 또는 질문에 사용되는 핵심 문장은 짧지만 함축적이거나 복합적인 의미를 담고 있어야 해.
  
  조건:
  - 반드시 한국어로 작성
  - 정치, 종교, 시사 관련 내용 금지
  - 문제 난이도와 어휘 수준은 아래 '수준별 기준'에 명시된 20대 대학 졸업자의 학습 목적에 맞도록 출제할 것.
  - 문제 형식은 JSON 배열로 출력할 것
  - 각 항목은 { "type": "...", "question": "...", "options": [...], "answer": "..." } 형식.
    단, 4지선다형 문제에만 "options" 필드를 포함하고,
    O/X형 및 단답형 문제에서는 "options" 필드를 생략하거나 빈 배열 [] 로 처리할 것.
  - 단답형 문제는 ‘밑줄 친 단어를 상황에 맞게 바꿔 쓰세요’ 또는
    ‘다음 설명을 포괄하는 전문 용어를 작성하세요’와 같은 형태로 출제할 것.
  
  문제 조건:
  [중요 규칙: 밑줄(underline) 사용 기준]
  - MCQ와 OX 문제에는 밑줄 마크다운(_word_)을 절대 사용하지 않는다.
  - 만약 GPT가 실수로 밑줄 마크다운을 넣으면 그 문제는 무효이며 즉시 다시 생성한다.
  - SHORT 문제에서만 밑줄 마크다운을 사용하며, 문장 안에서 단 한 개의 _word_ 만 허용한다.

    1) 4지선다형(MCQ)
    - question 문장에서 밑줄 마크다운(_단어_)을 절대 사용하지 않는다.
    - 텍스트 강조(볼드, 따옴표, 백틱 등)도 절대 사용하지 않는다.
    - 순수 문장으로만 작성한다.

    2) OX형
    - statement 문장에서 밑줄 마크다운(_단어_)을 절대 사용하지 않는다.
    - 텍스트 강조(볼드, 따옴표, 백틱 등)도 절대 사용하지 않는다.
    - (O/X) 표현 외 강조 금지.

    3) 단답형(short answer)

    단답형 문제는 아래 7가지 조건을 반드시 모두 만족해야 한다.
    이 조건들은 절대 생략하거나 변형해서는 안 된다.

    [필수 조건]

    (1) 문제 문장(sentece or question) 안에는 밑줄 마크다운(_단어_)이 **정확히 1번** 등장해야 한다.  
        - 예: “다음 문장을 보고 밑줄 친 단어를 바꿔 쓰세요. 오늘은 _바람_ 이 차갑다.”

    (2) 밑줄 친 단어는 단어 1개만 가능하며, 문장 내에서 단 한 번만 등장해야 한다.  
        - 밑줄 친 단어는 문맥상 치환 가능한 의미를 가져야 한다.

    (3) "underline_text" 필드에는 밑줄 표시된 단어를 **정확히 그대로** 넣는다.  
        - 예: underline_text: "바람"  
        - 띄어쓰기, 조사, 문장부호 포함 금지

    (4) "answer" 필드는 밑줄 친 단어를 **문맥상 적절하게 바꿀 수 있는 단어 1개**로 작성한다.  
        - answer는 절대 빈 문자열("")이 될 수 없다.  
        - answer는 표준 한국어 단어 1개여야 한다.
        - 예: answer: "기온"

    (5) JSON 객체는 아래 구조를 반드시 그대로 따라야 한다.  
        필드 누락 금지. 빈 값 금지. 잘못된 타입 금지.

    {
      "type": "SHORT",
      "question": "<문장 전체>",
      "underline_text": "<밑줄 친 단어>",
      "answer": "<정답 단어>"
    }

    (6) options 필드는 사용하지 않는다. (MCQ 전용)

    (7) 모든 필드(question, underline_text, answer)가 비어 있거나 null이면 즉시 오류이다.
        GPT는 빈 값이 절대 들어가지 않도록 해야 한다.

    [금지 사항]
    - 밑줄 두 번 이상 등장 금지
    - answer가 빈 문자열, null, 공백 문자열 금지
    - underline_text 누락 금지
    - options 사용 금지
    - 여분의 텍스트, 설명, 예시 출력 금지

    단답형 문제는 위 조건을 반드시 지키면서 생성한다.
  - 문제 유형은 [4지선다형] / [O,X형] / [단답형]을 섞어 구성할 것.
  - 4지선다형: 보기는 모두 그럴듯해야 하며, 정답 외 선택지들은 실제 비즈니스/학술 상황에서 오용될 가능성이 높은 함정 보기여야 함. 정답은 1개만 명확히 존재할 것.
  - OX형: 직장·사회생활 맥락에 맞는 복잡한 문맥의 진술이나, 특정 현상/개념에 대한 심층적 해석을 담은 문장을 제시 후 사실 여부·타당성·적절성 판단.
  - 단답형: 단순 단어 맞히기가 아닌, 빈칸 채우기·부분 단어 변경·문맥상 전문 용어 선택 등 주관적 해석 없는 문제로 출제.
  
  ---------------------------------------------
  [수준별 기준]
  
  1) [취업준비]
  대학교를 졸업한 20대 사회초년생이 실질적인 비즈니스 상황에서 접할 수 있는
  심층적인 커뮤니케이션 능력과 전략적 어휘 선택 능력을 점검할 수 있는 문해력 문제를 작성하세요.
  조건:
  - 자기소개서, 면접, 기업 내부 보고, 외부 협상 등 실제 비즈니스 맥락에서 발생하는 복잡한 상황을 압축한 짧은 문장 제시
  - 문맥적 적절성을 판단해야 하는 미묘한 비즈니스 어휘 활용
  - 예시: 지양/지향, 제고/고취, 피력/역설, 함의/시사점, 간극/격차
  
  ---------------------------------------------
  2) [기초]
  20대 사회초년생의 기본적인 어휘력과 개념적 이해도를 점검할 수 있는 문제 작성.
  조건:
  - 일상적이지만 혼동될 수 있는 기본 개념, 다의어, 동음이의어
  - 익숙하지만 문맥 이해 없이는 맞히기 어려운 어휘 활용
  - 예시: 로서/로써, 개발/계발, 금세/금새, 되물림/대물림, 이따금/이따가
  
  ---------------------------------------------
  3) [활용]
  직장에서 실제 활용되는 전문적인 문해력을 점검하는 문제 작성.
  조건:
  - 비즈니스 보고서, 공지문, 경제/사회 뉴스 기반 문맥
  - 유사하지만 뉘앙스가 다른 전문 용어 활용
  - 예시: 고지/공지, 소상히/상세히, 심사숙고/재고, 대두/부각, 수렴/통합
  
  ---------------------------------------------
  4) [심화]
  논리적 사고·추상적 개념 이해·관점 분석 능력을 평가하는 문제 작성.
  조건:
  - 학술적/비평적 문맥의 핵심 문장 활용
  - 심도 있는 학술 어휘 사용
  - 예시: 패러다임, 내재적/외재적, 담론, 헤게모니, 변증법적, 해체
  
  ---------------------------------------------
  5) [고급]
  최상위 수준의 비판적 사고·학술적 어휘 활용 능력 평가.
  조건:
  - 사회·인문학적 논의, 철학적/윤리적 개념을 압축한 문장 출제
  - 최고급 이론 기반 어휘 포함
  - 예시: 존재론적, 인식론적, 재구조화, 메타포, 레토릭, 에토스/파토스/로고스
  ---------------------------------------------
  
  **중요: JSON 배열만 출력하세요. 코드블록(\`\`\`) 없이, 설명 없이.**
    `;
  }

//2) “해설 정제/검증” 유틸 추가
function sanitizeExplanation(raw, { type, answer, options }) {
  let s = String(raw || '').trim()
    .replace(/^```json|^```|```$/g, '').trim();

  if (!s) return '';

  // '정답:' 접두 제거
  s = s.replace(/^정답\s*[:：]?\s*/i, '').trim();

  // 정답 텍스트만 반복하거나 4자 미만은 무효
  const justAnswer =
    s === String(answer).trim() ||
    s.replace(/[.。!！?？]$/, '') === String(answer).trim();
  if (justAnswer || s.length < 4) return '';

  // 의미 없는 패턴들 제거
  if (/^해설\s*[:：]?\s*$/i.test(s)) return '';

  return s;
}

// ★ JSON 배열 추출 보강: 코드블록/텍스트 섞여도 [] 구간만 뽑아 파싱 시도
function tryParseJsonArray(text) {
  try {
    const arr = JSON.parse(text);
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    // 첫 번째 대괄호 배열 구간만 캡처
    const m = text.match(/\[[\s\S]*\]/);
    if (m) {
      try {
        const arr2 = JSON.parse(m[0]);
        return Array.isArray(arr2) ? arr2 : [];
      } catch (_) { /* ignore */ }
    }
    return [];
  }
}

async function generateQuizArray(prompt) {
  const resp = await callChat(
    [{ role: 'user', content: prompt }],
    { temperature: 0.8, max_tokens: 1200, label: 'QuizArray' }
  );
  let text = (resp.data?.choices?.[0]?.message?.content || '[]').trim()
    .replace(/^```json/gi, '')
    .replace(/^```/gi, '')
    .replace(/```$/gi, '')
    .trim();

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try { return JSON.parse(m[0]) } catch { return []; }
  }
}



// ──────────────────────────────────────────────
// Helpers: OX 판정/정답 파싱
// ──────────────────────────────────────────────
function isTruthyOXAnswer(a) {
  const A = String(a ?? '').trim().toUpperCase();
  return ['O','X','TRUE','FALSE','T','F','YES','NO','Y','N','1','0'].includes(A);
}

function toAnswerIsO(a) {
  const A = String(a ?? '').trim().toUpperCase();
  if (['O','TRUE','T','1','YES','Y'].includes(A)) return true;
  if (['X','FALSE','F','0','NO','N'].includes(A)) return false;
  return null;
}

function looksLikeOX(it) {
  const rawType = String(it.type || '').toUpperCase();
  const qText   = String(it.question ?? it.statement ?? '').toUpperCase();
  const noOpts  = !(Array.isArray(it.options) && it.options.length > 0);

  const typeSaysOX =
    rawType.includes('OX') || rawType.includes('O/X') || rawType.includes('O-X');

  const textSaysOX = /\(O\/X\)/.test(qText);

  const answerSaysOX = noOpts && isTruthyOXAnswer(it.answer);

  return typeSaysOX || textSaysOX || answerSaysOX;
}

// ──────────────────────────────────────────────
// GPT 결과를 우리 스키마에 맞게 정규화
//  - MCQ 3, OX 2, SHORT 2
//  - OX 관용 판정 강화
//  - 보기 없는 MCQ는 스킵(오판정 방지)
// ──────────────────────────────────────────────
// ──────────────────────────────────────────────
// GPT 결과를 우리 스키마에 맞게 정규화
//  - MCQ 3, OX 2, SHORT 2
//  - 해설(explanation) 없는 문항은 제외
// ──────────────────────────────────────────────
function normalizeItems(rawItems) {
  const items = [];
  let mcq = 0, ox = 0, shortx = 0;

  //const hasExp = (it) => typeof it.explanation === 'string' && it.explanation.trim().length > 0;
//  const ensureExp = (it) => {
//     const exp = (it.explanation ?? defaultExplanationFor(it) ?? '').toString();
//     return exp;
//  };
  // MCQ 텍스트 일치 시 대소문자/공백/NFC 무시
  const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ').normalize('NFC');

  for (const it of rawItems) {
    const t = String(it.type || '').toUpperCase();
    const qText = String(it.question || it.statement || '').trim();

    // 1) OX
    if (looksLikeOX(it)) {
      if (ox >= 2) continue;
      // if (!hasExp(it)) continue; // ✨ 해설 없으면 스킵
      items.push({
        type: 'OX',
         statement: qText,
         answer_is_o: toAnswerIsO(it.answer),
         explanation: sanitizeExplanation(it.explanation, { type: 'OX', answer: it.answer })
         //explanation: ensureExp(it),
      });
      ox++;
      if (items.length === 7) break;
      continue;
    }

    // 2) SHORT
    if (t.includes('단답') || t.includes('SHORT')) {
      if (shortx >= 2) continue;
      //if (!hasExp(it)) continue; // ✨ 해설 없으면 스킵
      items.push({
        type: 'SHORT',
        guide: String(it.guide || '밑줄 친(또는 문맥상) 단어를 적절히 바꿔 쓰세요.'),
        sentence: qText,
        underline_text: it.underline_text ?? null,
        answer_text: String(it.answer || '').trim(),
        explanation: sanitizeExplanation(it.explanation, { type: 'SHORT', answer: it.answer })
        //explanation: ensureExp(it),
      });
      shortx++;
      if (items.length === 7) break;
      continue;
    }

    // 3) MCQ
    const opts = Array.isArray(it.options) ? it.options : [];
    if (opts.length >= 2 && mcq < 3) {
      const mapped = opts.map((o, idx) => {
        const label = typeof o === 'string' ? o : (o?.label ?? o?.text ?? '');
        return { id: idx + 1, label: String(label) };
      });

      const answer = String(it.answer || '').trim();
      let correctId = null;

      const asNum = Number(answer);
      if (!Number.isNaN(asNum) && asNum >= 1 && asNum <= mapped.length) {
        correctId = asNum;
      } else {
        for (const m of mapped) { if (m.label === answer) { correctId = m.id; break; } }
        if (correctId == null) {
          const ansN = norm(answer);
          for (const m of mapped) { if (norm(m.label) === ansN) { correctId = m.id; break; } }
        }
      }

      const mcqItem = {
        type: 'MCQ',
        text: qText,
        options: mapped,
        correct_option_id: correctId,
        explanation: sanitizeExplanation(it.explanation, { type: 'MCQ', answer, options: mapped.map(o=>o.label) })
        //explanation: ensureExp(it)
      };

      // // 해설이 비어 있으면, 정규화 아이템 기준으로 기본 해설 생성
      // if (!mcqItem.explanation) {
      //   mcqItem.explanation = defaultExplanationFor(mcqItem);
      // }

      items.push(mcqItem);
      mcq++;
      if (items.length === 7) break;
      continue;
    }

    // 4) 그 외는 스킵 (더미를 여기서 만들지 않음)
  }

  // 진행 순서 고정: MCQ → OX → SHORT
  // const orderScore = { 'MCQ': 1, 'OX': 2, 'SHORT': 3 };
  // items.sort((a, b) => orderScore[a.type] - orderScore[b.type]);

  return items.slice(0, 7);
}


//4) “해설이 비었으면” 즉시 보강 생성
async function generateExplanationForItem(it) {
  const sys = { role: 'system', content: '너는 한국어 시험 해설 작성자다.' };

  let user;
  if (it.type === 'MCQ') {
    const options = it.options.map(o => `${o.id}. ${o.label}`).join('\n');
    user = {
      role: 'user',
      content:
`다음 선택형 문제의 정답 이유를 1~2문장으로 간결히 한국어로 설명해줘.
금지: '정답:' 접두, 정답 텍스트만 반복, 코드블록.
문항:
${it.text}
보기:
${options}
정답 번호: ${it.correct_option_id}`
    };
  } else if (it.type === 'OX') {
    user = {
      role: 'user',
      content:
`다음 진술이 ${it.answer_is_o ? '참' : '거짓'}인 이유를 1문장으로 한국어로 설명해줘.
금지: '정답:' 접두, 코드블록.
진술: ${it.statement}`
    };
  } else { // SHORT
    user = {
      role: 'user',
      content:
`다음 문장에서 정답 단어("${it.answer_text}")가 적절한 이유를 1문장으로 한국어로 설명해줘.
금지: '정답:' 접두, 코드블록.
문장: ${it.sentence}`
    };
  }

  const resp = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    { model: 'gpt-4o-mini', temperature: 0.2, messages: [sys, user], max_tokens: 120 },
    { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, timeout: 12000 }
  );

  return sanitizeExplanation(resp.data?.choices?.[0]?.message?.content, {
    type: it.type,
    answer: it.answer_text ?? it.answer_is_o ?? it.correct_option_id
  });
}

async function ensureExplanations(items) {
  for (const it of items) {
    if (!it.explanation) {
      try {
        it.explanation = await generateExplanationForItem(it);
      } catch { /* 무시하고 빈 해설 유지 */ }
    }
  }
  return items;
}

function resolveCorrectOption(options, answer) {
  const clean = String(answer ?? "").trim();

  // 1) 완전 일치
  for (const o of options) {
    if (o.label.trim() === clean) return o.id;
  }

  // 2) 공백 제거 후 유사 일치
  for (const o of options) {
    if (
      o.label.replace(/\s+/g, '') === clean.replace(/\s+/g, '')
    ) return o.id;
  }

  // 3) GPT가 “1번, 2번…” 형식으로 답한 경우
  const num = Number(clean.replace(/[^0-9]/g, ""));
  if (!isNaN(num) && num >= 1 && num <= options.length) {
    return options[num - 1].id;
  }

  return null; // 못 찾으면 null
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ──────────────────────────────────────────────
//  (UPDATED) 문제 순서 유지 + 정답 순서 랜덤
// ──────────────────────────────────────────────
function normalizeItemsFixed(rawItems) {
  const items = [];
  let mcq = 0, ox = 0, shortx = 0;

  for (const it of rawItems) {
    const t = String(it.type || '').toUpperCase();
    const qText = String(it.question || it.statement || '').trim();

    // 1️⃣ MCQ — 보기 랜덤 + 정답 위치 재계산
    if (Array.isArray(it.options) && it.options.length >= 4 && mcq < 3) {
      const originalOptions = it.options.map((o, i) => ({
        id: i + 1,
        label: typeof o === 'string' ? o : (o?.label ?? o?.text ?? '')
      }));

      const correctLabel = String(it.answer || '').trim();

      // 보기 섞기
      const shuffled = shuffle(originalOptions);

      // id 재부여
      const finalOptions = shuffled.map((o, idx) => ({
        id: idx + 1,
        label: o.label
      }));

      const correctOptionId =
        resolveCorrectOption(finalOptions, correctLabel);
        //finalOptions.find(o => o.label === correctLabel)?.id ?? null;

      items.push({
        type: 'MCQ',
        text: qText,
        options: finalOptions,
        correct_option_id: correctOptionId,
        explanation: sanitizeExplanation(it.explanation, {
          type: 'MCQ',
          answer: correctLabel,
          options: finalOptions.map(o => o.label)
        })
      });

      mcq++;
      continue;
    }

    // 2️⃣ OX — O/X 랜덤
    if (looksLikeOX(it) && ox < 2) {
      const isO = Math.random() < 0.5;

      items.push({
        type: 'OX',
        statement: qText,
        answer_is_o: isO,
        explanation: sanitizeExplanation(it.explanation, {
          type: 'OX',
          answer: isO ? 'O' : 'X'
        })
      });

      ox++;
      continue;
    }

    // 3️⃣ SHORT — 그대로 유지
    if ((t.includes('단답') || t.includes('SHORT')) && shortx < 2) {
      items.push({
        type: 'SHORT',
        guide: String(it.guide || '밑줄 친(또는 문맥상) 단어를 적절히 바꿔 쓰세요.'),
        sentence: qText,
        underline_text: it.underline_text ?? null,
        answer_text: String(it.answer || '').trim(),
        explanation: sanitizeExplanation(it.explanation, {
          type: 'SHORT',
          answer: it.answer
        })
      });

      shortx++;
      continue;
    }
  }

  // 문제 순서 유지: MCQ → OX → SHORT
  return [
    ...items.filter(i => i.type === 'MCQ').slice(0, 3),
    ...items.filter(i => i.type === 'OX').slice(0, 2),
    ...items.filter(i => i.type === 'SHORT').slice(0, 2)
  ].slice(0, 7);
}

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
    await client.query('BEGIN');

    // 1) GPT로 생성 → 정규화 (★ 부족 시 재호출 2회까지)
    const prompt = buildPrompt({ categoryKor, len });

    let raw = await generateQuizArray(prompt);
    //let items = normalizeItems(raw);
    let items = normalizeItemsFixed(raw);

    
    // 해설 비어있는 문항 보강 생성
    //items = await ensureExplanations(items);

    let retries = 0;
    while (items.length < 7 && retries < 2) {
      retries++;
      raw = await generateQuizArray(prompt);
      // const more = normalizeItems(raw);
      const more = normalizeItemsFixed(raw);
      // 타입별 부족분 채워넣기
      const need = 7 - items.length;
      for (const it of more) {
        if (items.length >= 7) break;
        // 동일 index/문구 중복 방지 대략적 처리
        if (it.type === 'MCQ' && items.filter(x=>x.type==='MCQ').length>=3) continue;
        if (it.type === 'OX'  && items.filter(x=>x.type==='OX').length>=2) continue;
        if (it.type === 'SHORT' && items.filter(x=>x.type==='SHORT').length>=2) continue;
        items.push(it);
      }
    }

  
    // 더미 주입 금지: GPT 응답으로만 7문항을 구성
      if (items.length !== 7) {
        await client.query('ROLLBACK');
        return res.status(502).json({
          success: false,
          message: '퀴즈 7문항 생성 실패',
          detail: `생성된 문항 수: ${items.length} (요구: 7)`
        });
      }

      // 필요한 만큼만 해설 보강 (네트워크 호출 최소화)
      items = await ensureExplanations(items);

      //임시 정답 위치 고정 -> 추후 꼭 삭제!!!!! 아직은 QA 및, 기말 발표로 부득이하게 정답 위치 고정함.
      // const mcqPattern = [4, 2, 1];
      // let mcqCount = 0; //12.18 주석처리함.
      // let oxCount = 0;

      // for (const it of items) {
      //   if (it.type === 'MCQ' && Array.isArray(it.options) && it.options.length >= 4) {
      //     const correctIdx = mcqPattern[mcqCount % mcqPattern.length] - 1; // 0-based
      //     mcqCount++;

      //     // 정답 보기를 "id" 기반으로 안전하게 찾아옴
      //     console.log('[MCQ before fix]', it.text, it.options.map(o => o.label), '정답ID:', it.correct_option_id);

      //     // 정답 ID가 null/non-number 이면 4번으로 강제
      //     let cid = Number(it.correct_option_id);
      //     if (!cid || cid < 1 || cid > it.options.length) cid = 4;

      //     const correct = it.options[cid - 1];
      //     const others = it.options.filter((_, i) => i !== cid - 1);

      //     const fixedOptions = [...others];
      //     fixedOptions.splice(correctIdx, 0, correct);

      //     // 보기 ID 다시 1~n으로 재부여 (정렬 후 혼선 방지)
      //     it.options = fixedOptions.map((o, i) => ({ id: i + 1, label: o.label }));
      //     it.correct_option_id = correctIdx + 1;

      //     console.log('[MCQ after fix]', it.text, it.options.map(o => o.label), '최종 정답:', it.correct_option_id)
      //             }

      //   // OX 순서 고정: 첫 번째 O, 두 번째 X
      //   else if (it.type === 'OX') {
      //     it.answer_is_o = (oxCount % 2 === 0);
      //     oxCount++;
      //   }
      // }  

    // 2) 항상 새 배치 생성
    const ins = await client.query(
      `INSERT INTO quiz_batch (user_id, category, total)
       VALUES ($1,$2,$3) RETURNING id`,
      [userId, categoryCode, 7]
    );
    const batchId = ins.rows[0].id;

    // 3) 문항 일괄 삽입
    let idx = 1;
for (const it of items) {
  // const exp = String(it.explanation ?? defaultExplanationFor(it) ?? '');
   const exp = String(it.explanation ?? '').trim();

  if (it.type === 'MCQ') {
    await client.query(
      `INSERT INTO quiz_question
          (batch_id, question_index, type, text, options_json, correct_option_id, explanation)
        VALUES ($1,$2,'MCQ',$3,$4::jsonb,$5,$6)`,
      [batchId, idx, it.text, JSON.stringify(it.options || []), Number(it.correct_option_id || 4), exp]
    );
  } else if (it.type === 'OX') {
    await client.query(
      `INSERT INTO quiz_question
         (batch_id, question_index, type, statement, answer_is_o, explanation)
       VALUES ($1,$2,'OX',$3,$4,$5)`,
      [batchId, idx, it.statement, (it.answer_is_o ?? null), exp]
    );
  } else { // SHORT
    await client.query(
      `INSERT INTO quiz_question
         (batch_id, question_index, type, guide, sentence, underline_text, answer_text, explanation)
       VALUES ($1,$2,'SHORT',$3,$4,$5,$6,$7)`,
      [batchId, idx, it.guide ?? null, it.sentence ?? null, it.underline_text ?? null, it.answer_text ?? null, exp]
    );
  }
  idx++;
}

    await client.query('COMMIT');

    // 4) 조회 형태로 응답(화면 VM이 바로 바인딩 가능)
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
          underlineText: r.underline_text, answerText: r.answer_text,
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
    try { await client.query('ROLLBACK'); } catch (_) {}
    logOpenAIError(e, 'QuizBatch');
    // console.error(e);
    // ★ 에러 메시지 가시성 강화
    return res.status(500).json({
      success:false,
      message:'퀴즈 생성/조회 실패',
      detail: e?.message ?? null
    });
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
    // console.error(e);
    logOpenAIError(e, 'QuizBatch');
    return res.status(500).json({ success:false, message:'세트 조회 실패', detail: e?.message ?? null });
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
    // console.error(e);
    logOpenAIError(e, 'QuizBatch');
    return res.status(500).json({ success:false, message:'응답 저장/채점 실패', detail: e?.message ?? null });
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
    // console.error(e);
    logOpenAIError(e, 'QuizBatch');
    return res.status(500).json({ success:false, message:'일자별 요약 조회 실패', detail: e?.message ?? null });
  }
};

// POST /api/gpt/quiz/attempt/reward
// attemptId = quiz_batch.id 로 사용
// 시도 1건 보상 지급: 기본 15p + 전부 정답이면 +5p
exports.giveQuizAttemptPoint = async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user?.id;
    const { attemptId } = req.body;

    if (!userId)
      return res.status(401).json({ success: false, message: "인증 필요" });
    if (!attemptId)
      return res.status(400).json({ success: false, message: "attemptId가 필요합니다." });

    const BASE_POINT = 15;
    const BONUS_ALL_CORRECT = 5;

    await client.query("BEGIN");

    //  1) 오늘 날짜
    const now = new Date();
    const today = new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(now)
      .replace(/\./g, '')
      .replace(/\s/g, '')
      .replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");

    //  2) rewarded_today, last_reward_date 가져오기
    const user = await client.query(
      `SELECT rewarded_today, last_reward_date
        FROM users
        WHERE id = $1`,
      [userId]
    );

    const rewarded_today = user.rows[0]?.rewarded_today;
    const last_date_raw = user.rows[0]?.last_reward_date;

    //  3) last_reward_date null-safe 처리
    const last_date = last_date_raw ?? null;

    //  4) 날짜 달라지면 초기화
    if (last_date !== today) {
      await client.query(`
        UPDATE users
          SET rewarded_today = false,
              last_reward_date = $2
        WHERE id = $1
      `, [userId, today]);
    }
    // 다시 불러오기
    const check = await client.query(
      `SELECT rewarded_today FROM users WHERE id = $1`,
      [userId]
    );

    if (check.rows[0].rewarded_today === true) {
      await client.query("ROLLBACK");
      return res.status(403).json({ success: false, message: "오늘은 이미 보상을 받았습니다." });
    }

    // 2) batch 존재 확인
    const ownBatch = await client.query(
      `SELECT 1 FROM quiz_batch WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [attemptId, userId]
    );

    if (ownBatch.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "해당 퀴즈 세트를 찾을 수 없습니다." });
    }

    // 3) 채점
    const resp = await client.query(
      `SELECT is_correct FROM quiz_response WHERE user_id = $1 AND batch_id = $2`,
      [userId, attemptId]
    );

    if (resp.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "퀴즈를 모두 완료하지 않았습니다." });
    }

    const total = resp.rowCount;
    const correct = resp.rows.filter(r => r.is_correct === true).length;
    const allCorrect = correct === total;

    const reward = BASE_POINT + (allCorrect ? BONUS_ALL_CORRECT : 0);

    // 4) 포인트 지급
    const updateUser = await client.query(
      `UPDATE users
          SET point = COALESCE(point, 0) + $2,
              rewarded_today = true,
              last_reward_date = $3,
              updated_at = now()
        WHERE id = $1
     RETURNING point`,
      [userId, reward, today]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      rewardPoint: reward,
      basePoint: BASE_POINT,
      bonusAllCorrect: allCorrect ? BONUS_ALL_CORRECT : 0,
      allCorrect,
      totalPoint: updateUser.rows[0]?.point ?? 0
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ 퀴즈 포인트 지급 오류:", err);
    res.status(500).json({ success: false, message: "포인트 지급 실패" });
  } finally {
    client.release();
  }
};

/**
 * POST /api/gpt/ai-chat/touch-today
 * - 오늘 최초 호출 시 today_ai_chat upsert (first_chat_at 기록)
 * - 보상과 무관, 단순 존재 마킹용
 */
exports.touchTodayAiChat = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success:false, message:'인증 필요' });

    const today = getKstToday();
    await pool.query(
      `INSERT INTO public.today_ai_chat (user_id, date, first_chat_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id, date)
       DO UPDATE SET first_chat_at = COALESCE(public.today_ai_chat.first_chat_at, EXCLUDED.first_chat_at)`,
      [userId, today]
    );
    return res.json({ success:true, message:'오늘 AI 채팅 기록됨' });
  } catch (e) {
    console.error('touchTodayAiChat error:', e?.message || e);
    return res.status(500).json({ success:false, message:'기록 실패' });
  }
};

/**
 * POST /api/gpt/ai-chat/complete-reward
 * - user_id 필수
 * - 하루 1회만 지급 (user_id+date 유니크)
 * - today_ai_chat 테이블 기반
 * - 선택: ?autoTouch=1 이면 행 없을 때 자동 생성
 * 응답: { success, message, todayReward, totalPoint }
 */
exports.giveAiChatDailyReward = async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success:false, message:'인증 필요' });

    const today = getKstToday();
    const POINT = 15;
    const autoTouch = req.query.autoTouch === '1'; // ← 프론트에서 편하게 쓰고 싶으면 ?autoTouch=1

    await client.query('BEGIN');

    // (A) 동시성 제어: 유저+일자 기준 advisory tx lock
    const todayKey = Number(today.replaceAll('-', '')); // YYYYMMDD -> int
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [Number(userId), todayKey]);

    // (B) 오늘 행 잠금 조회
    let check = await client.query(
      `SELECT rewarded_date
         FROM public.today_ai_chat
        WHERE user_id = $1 AND date = $2
        FOR UPDATE`,
      [userId, today]
    );

    // (옵션) 없으면 자동 생성
    if (check.rowCount === 0 && autoTouch) {
      await client.query(
        `INSERT INTO public.today_ai_chat (user_id, date, first_chat_at)
         VALUES ($1, $2, now())`,
        [userId, today]
      );
      check = await client.query(
        `SELECT rewarded_date
           FROM public.today_ai_chat
          WHERE user_id = $1 AND date = $2
          FOR UPDATE`,
        [userId, today]
      );
    }

    if (check.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success:false, message:'오늘 AI 채팅 내역이 없습니다.' });
    }

    const rewardedDate = check.rows[0].rewarded_date;
    const alreadyRewarded = rewardedDate && String(rewardedDate) === today;
    if (alreadyRewarded) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success:false, message:'이미 포인트가 지급되었습니다.' });
    }

    // (C) 포인트 적립
    const upd = await client.query(
      `UPDATE public.users
          SET point = COALESCE(point, 0) + $2,
              updated_at = now()
        WHERE id = $1
        RETURNING point`,
      [userId, POINT]
    );

    // (D) 보상 마킹
    await client.query(
      `UPDATE public.today_ai_chat
          SET rewarded_date = $3
        WHERE user_id = $1 AND date = $2`,
      [userId, today, today]
    );

    // (E) (선택) 포인트 이력 남기기
    try {
      await client.query(
        `INSERT INTO public.point_history(user_id, delta, reason, ref_id, created_at)
         VALUES ($1, $2, $3, $4, now())`,
        [userId, POINT, 'ai_chat_daily', null]
      );
    } catch (_) { /* 이력 실패는 치명 아님 */ }

    await client.query('COMMIT');

    return res.json({
      success: true,
      message: '포인트가 지급되었습니다.',
      todayReward: POINT,
      totalPoint: upd.rows[0]?.point ?? 0
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ AI 채팅 보상 오류:', err);
    return res.status(500).json({ success:false, message:'포인트 지급 실패' });
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────
// 0) 단계별 글감: 지금은 모든 stage(0~3)에 동일 본문 사용
//    (나중에 단계별로 교체만 하면 됨)
// ─────────────────────────────────────────────
const PASSAGES = {
  0: `“빛을 보기 위해 눈이 있고, 소리를 듣기 위해 귀가 있듯이, 너희들은 시간을 느끼기 위해 가슴을 갖고 있단다. 가슴으로 느끼지 않은 시간은 모두 없어져 버리지. (중략) 허나 슬프게도 이 세상에는 쿵쿵 뛰고 있는데도 아무것도 느끼지 못하는, 눈멀고, 귀 먹은 가슴들이 수두룩하단다.”
“그럼 제 가슴이 언젠가 뛰기를 멈추면 어떻게 돼요?”
“그럼, 네게 지정된 시간도 멈추게 되지. 아가, 네가 살아 온 시간, 다시 말해서 지나 온 너의 낮과 밤들, 달과 해들을 지나 되돌아간다고 말할 수도 있을 게다. 너는 너의 일생을 지나 되돌아가는 게야. 언젠가 네가 그 문을 통해 들어왔던 둥근 은빛 성문에 닿을 때까지 말이지. 거기서 너는 그 문을 다시 나가게 되지.”`,
  1: `“빛을 보기 위해 눈이 있고, 소리를 듣기 위해 귀가 있듯이, 너희들은 시간을 느끼기 위해 가슴을 갖고 있단다. 가슴으로 느끼지 않은 시간은 모두 없어져 버리지. (중략) 허나 슬프게도 이 세상에는 쿵쿵 뛰고 있는데도 아무것도 느끼지 못하는, 눈멀고, 귀 먹은 가슴들이 수두룩하단다.”
“그럼 제 가슴이 언젠가 뛰기를 멈추면 어떻게 돼요?”
“그럼, 네게 지정된 시간도 멈추게 되지. 아가, 네가 살아 온 시간, 다시 말해서 지나 온 너의 낮과 밤들, 달과 해들을 지나 되돌아간다고 말할 수도 있을 게다. 너는 너의 일생을 지나 되돌아가는 게야. 언젠가 네가 그 문을 통해 들어왔던 둥근 은빛 성문에 닿을 때까지 말이지. 거기서 너는 그 문을 다시 나가게 되지.”`,
  2: `“빛을 보기 위해 눈이 있고, 소리를 듣기 위해 귀가 있듯이, 너희들은 시간을 느끼기 위해 가슴을 갖고 있단다. 가슴으로 느끼지 않은 시간은 모두 없어져 버리지. (중략) 허나 슬프게도 이 세상에는 쿵쿵 뛰고 있는데도 아무것도 느끼지 못하는, 눈멀고, 귀 먹은 가슴들이 수두룩하단다.”
“그럼 제 가슴이 언젠가 뛰기를 멈추면 어떻게 돼요?”
“그럼, 네게 지정된 시간도 멈추게 되지. 아가, 네가 살아 온 시간, 다시 말해서 지나 온 너의 낮과 밤들, 달과 해들을 지나 되돌아간다고 말할 수도 있을 게다. 너는 너의 일생을 지나 되돌아가는 게야. 언젠가 네가 그 문을 통해 들어왔던 둥근 은빛 성문에 닿을 때까지 말이지. 거기서 너는 그 문을 다시 나가게 되지.”`,
  3: `“빛을 보기 위해 눈이 있고, 소리를 듣기 위해 귀가 있듯이, 너희들은 시간을 느끼기 위해 가슴을 갖고 있단다. 가슴으로 느끼지 않은 시간은 모두 없어져 버리지. (중략) 허나 슬프게도 이 세상에는 쿵쿵 뛰고 있는데도 아무것도 느끼지 못하는, 눈멀고, 귀 먹은 가슴들이 수두룩하단다.”
“그럼 제 가슴이 언젠가 뛰기를 멈추면 어떻게 돼요?”
“그럼, 네게 지정된 시간도 멈추게 되지. 아가, 네가 살아 온 시간, 다시 말해서 지나 온 너의 낮과 밤들, 달과 해들을 지나 되돌아간다고 말할 수도 있을 게다. 너는 너의 일생을 지나 되돌아가는 게야. 언젠가 네가 그 문을 통해 들어왔던 둥근 은빛 성문에 닿을 때까지 말이지. 거기서 너는 그 문을 다시 나가게 되지.”`,
};

// ─────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────
function isStringArray4(arr) {
  return Array.isArray(arr) && arr.length === 4 && arr.every(s => typeof s === 'string' && s.trim().length > 0);
}
function clampChoice(i) {
  const n = Number(i);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(3, n));
}
// ─────────────────────────────────────────────
// NEW 3-문항 레벨 테스트: 컨트롤러 핸들러 (routes에서 /levels로 연결)
// ─────────────────────────────────────────────

// 1) 시작: POST /api/gpt/levels/start
exports.levelsStart = async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '인증 필요' });

    const { stage } = req.body || {};
    if (![0,1,2,3].includes(stage)) {
      return res.status(400).json({ success: false, message: '잘못된 단계 값' });
    }

    await client.query('BEGIN');

    if (stage === 0) {
      await client.query(
        `UPDATE public.users SET level = 0, updated_at = now() WHERE id = $1`,
        [userId]
      );
    }

    await client.query(
      `DELETE FROM quiz_level_test_new WHERE user_id = $1 AND stage = $2`,
      [userId, stage]
    );

    await client.query('COMMIT');
    return res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ /levels/start 오류:', err);
    return res.status(500).json({ success: false, message: '시작 처리 실패' });
  } finally {
    client.release();
  }
};

// 2) 생성: POST /api/gpt/levels/generate
exports.levelsGenerate = async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '인증 필요' });

    const { stage } = req.body || {};
    if (![0,1,2,3].includes(stage)) {
      return res.status(400).json({ success: false, message: '잘못된 단계 값' });
    }

    const passage = PASSAGES[stage] ?? PASSAGES[0];
    if (!passage) {
      return res.status(500).json({ success: false, message: `stage=${stage} 글감 미설정` });
    }

    const system = { role: 'system', content: '너는 한국어 독해/문해력 4지선다 문제 출제자이다.' };
    const user = {
      role: 'user',
      content:
`다음 글감을 바탕으로 총 3개의 4지선다 문제를 만들어라. 모든 출력은 JSON 배열 하나로만 하라(코드블록 금지).
문항 규칙:
1) 1번: 이 글의 핵심 내용을 가장 잘 요약한 것은?
2) 2번: 이 글의 주제를 가장 잘 파악한 것은?
3) 3번: 글감의 어려운 단어 1개를 골라 '정확한 의미'를 묻는 문제.
스키마:
{ "questionIndex": 1|2|3, "question": "…", "options": ["A","B","C","D"], "answerIndex": 0|1|2|3, "explanation": "1~2문장" }
조건: 한국어, options 4개, 중복 금지, explanation은 '정답:' 접두 금지
글감:
${passage}`
    };

    const openaiResp = await oa.post('/chat/completions', {
      model: 'gpt-4o-mini',
      temperature: 0.6,
      max_tokens: 1200,
      messages: [system, user],
    });

    let text = String(openaiResp?.data?.choices?.[0]?.message?.content || '[]')
      .replace(/^```json/i,'').replace(/^```/i,'').replace(/```$/i,'').trim();

    let arr;
    try { arr = JSON.parse(text); }
    catch {
      const m = text.match(/\[[\s\S]*\]/);
      arr = m ? JSON.parse(m[0]) : [];
    }
    if (!Array.isArray(arr)) arr = [];

    const questions = [];
    for (const it of arr) {
      const qi = Number(it?.questionIndex);
      const q  = String(it?.question || '').trim();
      const opts = it?.options;
      const ai = Number(it?.answerIndex);
      const exp = String(it?.explanation || '').trim();

      if (![1,2,3].includes(qi)) continue;
      if (!q || !isStringArray4(opts)) continue;
      if (!(ai>=0 && ai<=3)) continue;
      if (!exp || exp.length < 3) continue;

      questions.push({ questionIndex: qi, question: q, options: opts.map(String), answerIndex: ai, explanation: exp });
    }

    if (questions.length !== 3) {
      return res.status(500).json({ success: false, message: '생성 문항이 3개가 아님(또는 형식 오류)' });
    }

    return res.json({ success: true, passage, questions });
  } catch (err) {
    console.error('❌ /levels/generate 오류:', err?.response?.data || err.message);
    return res.status(500).json({ success: false, message: '문제 생성 실패' });
  } finally {
    client.release();
  }
};

// 3) 제출: POST /api/gpt/levels/submit
exports.levelsSubmit = async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: '인증 필요' });

    const { stage, questions, answers } = req.body || {};
    if (![0,1,2,3].includes(stage)) return res.status(400).json({ success:false, message:'잘못된 단계 값' });
    if (!Array.isArray(questions) || questions.length !== 3) return res.status(400).json({ success:false, message:'questions 3개 필요' });
    if (!Array.isArray(answers) || answers.length !== 3) return res.status(400).json({ success:false, message:'answers 3개 필요' });

    const cleaned = [];
    for (const it of questions) {
      const qi = Number(it?.questionIndex);
      const q  = String(it?.question || '').trim();
      const opts = it?.options;
      const ai = Number(it?.answerIndex);
      const exp = String(it?.explanation || '').trim();
      if (![1,2,3].includes(qi)) return res.status(400).json({ success:false, message:`questionIndex 오류(${qi})` });
      if (!q || !isStringArray4(opts)) return res.status(400).json({ success:false, message:`문항 ${qi} 형식 오류` });
      if (!(ai>=0 && ai<=3)) return res.status(400).json({ success:false, message:`문항 ${qi} answerIndex 오류` });
      if (!exp) return res.status(400).json({ success:false, message:`문항 ${qi} 해설 누락` });
      cleaned.push({ questionIndex: qi, question: q, options: opts, answerIndex: ai, explanation: exp });
    }

    const userChoices = answers.map(clampChoice);
    let correctCount = 0;

    await client.query('BEGIN');
    await client.query(`DELETE FROM quiz_level_test_new WHERE user_id=$1 AND stage=$2`, [userId, stage]);

    const insertSql = `
      INSERT INTO quiz_level_test_new
      (user_id, stage, question_index, question, options, answer_index, explanation, user_choice, is_correct)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)
    `;

    const detail = [];
    for (let i=0;i<cleaned.length;i++) {
      const it = cleaned[i];
      const choice = userChoices[i];
      const ok = (choice === it.answerIndex);
      if (ok) correctCount++;

      await client.query(insertSql, [
        userId, stage, it.questionIndex,
        it.question, JSON.stringify(it.options),
        it.answerIndex, it.explanation,
        choice, ok
      ]);

      detail.push({ questionIndex: it.questionIndex, isCorrect: ok, answerIndex: it.answerIndex, userChoice: choice, explanation: it.explanation });
    }

    let resultLevel = '기초';
    if (correctCount === 3) resultLevel = '고급';
    else if (correctCount === 2) resultLevel = '심화';
    else if (correctCount === 1) resultLevel = '활용';

    const levelMap = { '기초': 1, '활용': 2, '심화': 3, '고급': 4 };
    const targetLevel = levelMap[resultLevel] ?? null;
    if (targetLevel !== null) {
      await client.query(`UPDATE public.users SET level=$2, updated_at=now() WHERE id=$1`, [userId, targetLevel]);
    }

    await client.query('COMMIT');
    return res.json({ success: true, correctCount, resultLevel, detail });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ /levels/submit 오류:', err);
    return res.status(500).json({ success: false, message: '제출/채점 실패' });
  } finally {
    client.release();
  }
};

