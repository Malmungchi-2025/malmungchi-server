// controllers/voiceController.js
const axios = require('axios');
const FormData = require('form-data');
const http  = require('http');
const https = require('https');
const { ttsClient, meta: ttsMeta } = require('../services/ttsClient');

const OA_BASE    = 'https://api.openai.com/v1';
const OA_KEY     = process.env.OPENAI_API_KEY;
const STT_MODEL  = process.env.STT_MODEL  || 'gpt-4o-mini-transcribe'; // 실패 시 whisper-1 폴백
const GPT_MODEL  = process.env.GPT_MODEL  || 'gpt-4o-mini';

if (!OA_KEY) {
  console.warn('[OpenAI] OPENAI_API_KEY 미설정: STT/GPT 호출 시 401 발생 가능');
}

const oa = axios.create({
  baseURL: OA_BASE,
  headers: { Authorization: `Bearer ${OA_KEY}` },
  timeout: 120000,
  httpAgent:  new http.Agent({ keepAlive: false }),
  httpsAgent: new https.Agent({ keepAlive: false }),
  maxBodyLength: 1024 * 1024 * 50
});

/* =========================================================
 * A. (취준생 전용) 프롬프트/스타터/평가 규칙 — 이 파일에 내장
 * ========================================================= */

// 공통 운영 기준
const COMMON_RULES = `
[운영 기준 - 모든 대화 유형에 공통 적용]
- 사용자의 문장에 어휘 오류, 문법 오류, 문맥상 부적절한 표현이 있는 경우 → 간결한 설명과 함께 자연스러운 표현으로 수정 제안.
- 사적인 정보 요구 금지 (예: 이름, 주소, 연락처, 민감한 개인 정보 등)
- 지나치게 장황한 설명은 피하고 명확하고 간결한 응답 유지
- 항상 학습 목적(어휘·문해력 강화)을 중심에 두고 대화 유도
`;

// 출력 스키마(모델이 반드시 JSON만 반환하도록 강제)
const OUTPUT_SCHEMA = `
[출력 형식(JSON만 반환)]
{
  "reply": string,          // 화면에 표시할 봇 말풍선(필요 시 "다시 한 번 해볼까요?" 포함)
  "tip": string | null,     // TIP: ... (없으면 null)
  "needRetry": boolean,     // 재시도 필요(프론트: 직전 사용자 말풍선 빨간 테두리)
  "critique": string | null // 문제 요약(간결)
}
반드시 유효한 JSON만 반환. 다른 텍스트/코드블록/설명 금지.
`;

// 취업준비 가이드 + 평가 기준(오답 판별)
const JOB_GUIDE = `
[취업준비]
너는 지금 취업을 준비 중인 청년을 대상으로, 실전처럼 연습할 수 있는 대화 시나리오를 제공하는 AI야.
1) 상황을 먼저 제시한 뒤, 그 상황 속에서 사용자가 할 말을 유도하는 질문을 던져줘.
2) 사용자 답변이 짧거나 막막하면 간단한 피드백/팁을 제공해줘.
3) 면접 외에도 자기소개서 작성, 기업 전화 응대, 불합격 통보 후 대응 등 실전 상황을 포함해줘.
4) 친구처럼 부담 없지만, 취업 준비에 도움이 되도록 신중하게 말해줘.
5) 사용자의 단어 선택이 올바르지 않다면, "다시 말해보세요."라는 말과 함께 TIP을 제공해줘.
`;

const JOB_EVAL_RUBRIC = `
[평가 기준(필수)]
다음 중 하나라도 해당하면 needRetry=true로 평가하고, reply는 "다시 한 번 해볼까요?"로 시작:
- 답변이 과도하게 짧거나 막연함
- 장점/단점에 동일 단어를 반복하여 의도가 모호함 (예: "장점은 솔직함, 단점도 솔직함")
- 연결어·접속사 사용이 부자연스러움(대조/나열이 불명확)
- 문법/어휘 오류가 의미 이해를 방해
- 면접/문서 상황에 맞지 않는 비격식·부적절한 어투
- 개인정보 공유 요청/제공 시도

needRetry=true일 때 tip에는 "어떻게 고치면 되는지"를 1~2문장으로 간결하게 제시.
critique에는 무엇이 문제였는지 한 줄로 요약.
`;

// (취준생 전용) 스타터(상황+질문)
const JOB_STARTERS = [
  { situation: '면접 상황', question: '본인의 장단점이 무엇인가요?' },
  { situation: '면접 상황', question: '우리 회사에 지원한 이유는 무엇인가요?' },
  { situation: '면접 상황', question: '최근에 가장 성취감을 느꼈던 경험에 대해 말씀해보세요.' },
  { situation: '면접 상황', question: '직장에서 동료와 의견이 충돌했을 때, 어떻게 해결했는지 말씀해보세요.' },
  { situation: '면접 상황', question: '업무 중 어려운 상황을 극복했던 경험이 있다면 말씀해보세요.' },
  { situation: '자기소개서', question: '우리 회사 지원 동기를 3~4문장으로 말씀해보세요.' },
  { situation: '전화 응대', question: '면접 일정 조율 전화를 받았을 때, 첫 인사와 핵심 질문을 말로 해보세요.' }
];
// const JOB_STARTERS = [
//   { situation: '면접 상황',   question: '본인의 장단점이 무엇인가요?' },
//   { situation: '자기소개서', question: '우리 회사 지원 동기를 3~4문장으로 말씀해보세요.' },
//   { situation: '전화 응대',   question: '면접 일정 조율 전화를 받았을 때, 첫 인사와 핵심 질문을 말씀해보세요.' },
//   //{ situation: '불합격 대응', question: '불합격 메일을 받았을 때, 스스로를 다독이는 2문장 메시지를 작성해보세요.' },
// ];

function pickJobStarter() {
  return JOB_STARTERS[Math.floor(Math.random() * JOB_STARTERS.length)];
}

// 모드(항상 job) 시스템 프롬프트
function getJobPrompt() {
  return `
${COMMON_RULES}

${JOB_GUIDE}

${JOB_EVAL_RUBRIC}

${OUTPUT_SCHEMA}
`.trim();
}

/* =========================================================
 * B. 로깅 유틸
 * ========================================================= */
function logTtsError(tag, err) {
  const msg = err?.message || err;
  const code = err?.code;
  const details = err?.details || err?.response?.data;
  console.error(`[${tag}] TTS error:`, { msg, code, details, ttsProject: ttsMeta?.projectId, ttsEmail: ttsMeta?.clientEmailMasked });
}
function logOpenAiError(tag, err) {
  const msg = err?.message || err;
  const status = err?.response?.status;
  const data = err?.response?.data;
  console.error(`[${tag}] OpenAI error:`, { msg, status, data });
}

/* =========================================================
 * C. 노트패드용 프롬프트 원문 (취준생 전용)
 * GET /api/voice/prompts
 * ========================================================= */
exports.getVoicePrompt = async (_req, res) => {
  try {
    const mode = 'job';
    const title = '취업준비';
    const text  = getJobPrompt();
    return res.json({ success: true, mode, title, prompt: text });
  } catch (e) {
    console.error('getVoicePrompt error:', e?.message || e);
    return res.status(500).json({ success:false, message:'프롬프트 조회 실패' });
  }
};

/* =========================================================
 * D. 서버가 먼저 상황+질문 제공 (텍스트+TTS) — 취준생 전용
 * GET /api/voice/hello?as=stream
 * ========================================================= */
exports.voiceHello = async (req, res) => {
  try {
    const mode = 'job';

    // 🔒 발표용 고정 질문
    // const starter = pickJobStarter(); // ← 랜덤 호출 주석처리
    const starter = {
      situation: '면접 상황',
      question: '직장에서 동료와 의견이 충돌했을 때, 어떻게 해결했는지 말씀해보세요.'
    };

    // 화면표시용 전체 문장(=TTS용)
    const fullText = `[${starter.situation}]\n: ${starter.question}`;

    // TTS
    const [ttsResp] = await ttsClient.synthesizeSpeech({
      input: { text: fullText },
      voice: { languageCode: 'ko-KR', ssmlGender: 'NEUTRAL' },
      audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0 }
    });
    const mp3Buffer = Buffer.from(ttsResp.audioContent);

    // JSON으로 돌려줄 때: 상황/질문/전체문장/오디오 모두 포함
    if (!(req.query.as === 'stream' || (req.get('accept') || '').includes('audio/mpeg'))) {
      return res.json({
        success: true,
        mode,
        situation: starter.situation,     // ✅ 프론트: 태그(칩/작은 말풍선)
        question:  starter.question,      // ✅ 프론트: 큰 말풍선(회색)
        text:      fullText,              // (필요하면 사용)
        audioBase64: mp3Buffer.toString('base64'),
        mimeType: 'audio/mpeg'
      });
    }

    // 스트리밍으로 달라고 하면 오디오만
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', mp3Buffer.length);
    return res.end(mp3Buffer);

  } catch (err) {
    logTtsError('voiceHello', err);
    return res.status(500).json({ success:false, message:'voiceHello 실패', hint: err?.message });
  }
}; //여기 추후 밑에 주석 부분으로 변경하기!

// /* =========================================================
//  * D. 서버가 먼저 상황+질문 제공 (텍스트+TTS) — 취준생 전용
//  * GET /api/voice/hello?as=stream
//  * ========================================================= */
// exports.voiceHello = async (req, res) => {
//   try {
//     const mode = 'job';
//     const starter = pickJobStarter(); // { situation, question }

//     // 화면표시용 전체 문장(=TTS용)
//     const fullText = `[${starter.situation}]\n: ${starter.question}`;

//     // TTS
//     const [ttsResp] = await ttsClient.synthesizeSpeech({
//       input: { text: fullText },
//       voice: { languageCode: 'ko-KR', ssmlGender: 'NEUTRAL' },
//       audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0 }
//     });
//     const mp3Buffer = Buffer.from(ttsResp.audioContent);

//     // JSON으로 돌려줄 때: 상황/질문/전체문장/오디오 모두 포함
//     if (!(req.query.as === 'stream' || (req.get('accept') || '').includes('audio/mpeg'))) {
//       return res.json({
//         success: true,
//         mode,
//         situation: starter.situation,     // ✅ 프론트: 태그(칩/작은 말풍선)
//         question:  starter.question,      // ✅ 프론트: 큰 말풍선(회색)
//         text:      fullText,              // (필요하면 사용)
//         audioBase64: mp3Buffer.toString('base64'),
//         mimeType: 'audio/mpeg'
//       });
//     }

//     // 스트리밍으로 달라고 하면 오디오만
//     res.setHeader('Content-Type', 'audio/mpeg');
//     res.setHeader('Content-Length', mp3Buffer.length);
//     return res.end(mp3Buffer);

//   } catch (err) {
//     logTtsError('voiceHello', err);
//     return res.status(500).json({ success:false, message:'voiceHello 실패', hint: err?.message });
//   }
// };

/* =========================================================
 * E. STT → GPT(JSON) → TTS — 취준생 전용
 * POST /api/voice/chat  (multipart: audio, systemPrompt?, temperature?)
 * ========================================================= */
exports.voiceChat = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success:false, message:'audio 파일이 필요합니다.(form-data: audio)' });
    }

    // 1) STT
    let sttText = '';
    try {
      const fd = new FormData();
      fd.append('file', req.file.buffer, { filename: req.file.originalname || 'audio.m4a' });
      fd.append('model', STT_MODEL);
      const sttResp = await oa.post('/audio/transcriptions', fd, { headers: fd.getHeaders() });
      sttText = (sttResp.data?.text || '').trim();
    } catch (e1) {
      logOpenAiError('STT-primary', e1);
      try {
        const fd2 = new FormData();
        fd2.append('file', req.file.buffer, { filename: req.file.originalname || 'audio.m4a' });
        fd2.append('model', 'whisper-1');
        const sttResp2 = await oa.post('/audio/transcriptions', fd2, { headers: fd2.getHeaders() });
        sttText = (sttResp2.data?.text || '').trim();
      } catch (e2) {
        logOpenAiError('STT-fallback', e2);
        return res.status(502).json({ success:false, message:'STT 실패', hint: e2?.message });
      }
    }
    if (!sttText) return res.status(400).json({ success:false, message:'음성에서 텍스트를 추출하지 못했습니다.' });

    // 2) GPT — (취준생 전용) JSON 스키마 강제
    const mode = 'job'; // 🔒 강제
    const baseSystem = getJobPrompt();
    const systemOverride = req.body?.systemPrompt ? String(req.body.systemPrompt) : '';
    const systemPrompt = systemOverride ? `${baseSystem}\n\n---\n(override)\n${systemOverride}` : baseSystem;
    const temperature  = Number(req.body?.temperature ?? 0.6);

    let gptJson; // { reply, tip, needRetry, critique }
    try {
      const gpt = await oa.post('/chat/completions', {
        model: GPT_MODEL,
        messages: [
          { role:'system', content: systemPrompt },
          { role:'user',   content: sttText }
        ],
        temperature,
        max_tokens: 600
      });

      const raw = (gpt.data?.choices?.[0]?.message?.content || '').trim();
      try {
        gptJson = JSON.parse(raw);
      } catch (e) {
        const m = raw.match(/\{[\s\S]*\}$/); // 마지막 JSON 블록만 추출
        gptJson = m ? JSON.parse(m[0]) : null;
      }
      if (!gptJson || typeof gptJson.reply !== 'string') throw new Error('Invalid JSON reply from GPT');

      gptJson.reply     = gptJson.reply.trim();
      gptJson.tip       = gptJson.tip ? String(gptJson.tip).trim() : null;
      gptJson.needRetry = Boolean(gptJson.needRetry);
      gptJson.critique  = gptJson.critique ? String(gptJson.critique).trim() : null;

    } catch (gptErr) {
      logOpenAiError('GPT', gptErr);
      return res.status(502).json({ success:false, message:'GPT 호출 실패', hint: gptErr?.message });
    }

    // 3) TTS — reply만 읽음
    let mp3Buffer;
    try {
      const [ttsResp] = await ttsClient.synthesizeSpeech({
        input: { text: gptJson.reply },
        voice: { languageCode: 'ko-KR', ssmlGender: 'NEUTRAL' },
        audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0 }
      });
      mp3Buffer = Buffer.from(ttsResp.audioContent);
    } catch (ttsErr) {
      logTtsError('voiceChat', ttsErr);
      return res.status(502).json({ success:false, message:'TTS 실패', hint: ttsErr?.message });
    }

    // 4) 응답
    if (req.query.as === 'stream' || (req.get('accept') || '').includes('audio/mpeg')) {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', mp3Buffer.length);
      return res.end(mp3Buffer);
    }
    return res.json({
      success: true,
      mode,
      userText: sttText,                 // 사용자가 실제 말한 문장
      text: gptJson.reply,               // 봇 본문 (파란 테두리)
      audioBase64: mp3Buffer.toString('base64'),
      mimeType: 'audio/mpeg',
      hint: gptJson.tip,                 // TIP (프론트에서 "TIP:" 접두)
      needRetry: gptJson.needRetry,      // ✅ 사용자 말풍선 빨간 테두리 여부
      critique: gptJson.critique         // 간단 피드백(옵션 표시)
    });

  } catch (err) {
    console.error('voiceChat error (top):', err?.message || err);
    return res.status(500).json({ success:false, message:'voiceChat 실패', hint: err?.message });
  }
};

/* =========================================================
 * (일상 대화) 프롬프트/스타터/평가 규칙
 * ========================================================= */

// 출력 스키마는 기존 OUTPUT_SCHEMA 재사용

// 공통 운영 기준(COMMON_RULES)도 그대로 재사용

// 일상 대화 가이드
const DAILY_GUIDE = `
[일상대화]
너는 사회초년생을 위한 일상 대화 파트너야.
사용자가 하루의 일과를 나누거나, 스트레스, 고민, 루틴, 인간관계, 감정 등을 편하게 털어놓을 수 있도록 대화를 이끌어줘.

조건:
1. 대화는 친구처럼 다정하고 편안한 톤으로 시작해줘.
2. 먼저 자연스럽게 말을 걸고, 사용자의 오늘 하루나 요즘 상태에 관심을 가져줘.
3. 사용자가 털어놓는 이야기에 공감하고, 부드럽게 질문을 이어가거나 대답해줘.
4. 필요할 땐 팁이나 추천(예: 루틴, 스트레스 해소법 등)을 제시해도 좋아.
5. 과도하게 상담하지 않고, 가벼운 대화부터 깊이 있는 고민까지 자연스럽게 받아줘.
6. 사용자의 단어 선택이 올바르지 않다면, ‘다시 말해보세요.’라는 말과 함께 팁을 제공해줘.
7. **항상 TIP은 최소 1문장 이상 포함해. needRetry=false여도 TIP은 반드시 채워.**
`;

// 평가 기준(needRetry 판정) — 기존과 유사하되 일상 톤/맥락 반영
const DAILY_EVAL_RUBRIC = `
[평가 기준(필수)]
다음 중 하나라도 해당하면 needRetry=true로 평가하고, reply는 "다시 한 번 해볼까요?"로 시작:
- **답변 글자 수가 15자 미만**이거나 **구체 정보(숫자/장소/사람/이유)가 없음**
- 문맥과 맞지 않는 단어 선택/비속어 등으로 톤이 부적절함
- 문법/어휘 오류가 의미 이해를 방해
- 개인정보를 과도하게 요구/제공하려는 시도
- 모호해서 추가 정보 없이는 이어가기 어려운 경우

needRetry=true일 때 tip에는 "어떻게 말하면 되는지"를 1~2문장으로 간결히 제시.
critique에는 무엇이 문제였는지 한 줄로 요약.
`;

// 일상 대화 스타터 (인사+라이트 톤)
const DAILY_STARTERS = [
  { situation: '일상 대화', question: '오늘 하루는 어땠나요? 편하게 이야기 나눠봐요 :)' },
  { situation: '일상 대화', question: '요즘 잠은 잘 오세요? 퇴근 후 루틴이 궁금해요.' },
  { situation: '일상 대화', question: '최근에 기뻤던 일 하나만 꼽는다면 뭐가 있을까요?' },
  { situation: '일상 대화', question: '스트레스 풀 때 주로 뭐 하세요? 같이 루틴을 잡아봐도 좋아요.' },
];

function pickDailyStarter() {
  return DAILY_STARTERS[Math.floor(Math.random() * DAILY_STARTERS.length)];
}

// 모드별 시스템 프롬프트 구성
function getDailyPrompt() {
  return `
${COMMON_RULES}

${DAILY_GUIDE}

${DAILY_EVAL_RUBRIC}

${OUTPUT_SCHEMA}
`.trim();
}

/* =========================================================
 * (일상 대화) 노트패드용 프롬프트 — GET /api/voice/daily/prompts
 * ========================================================= */
exports.getDailyVoicePrompt = async (_req, res) => {
  try {
    const mode = 'daily';
    const title = '일상 대화';
    const text  = getDailyPrompt();
    return res.json({ success: true, mode, title, prompt: text });
  } catch (e) {
    console.error('getDailyVoicePrompt error:', e?.message || e);
    return res.status(500).json({ success:false, message:'프롬프트 조회 실패' });
  }
};

/* =========================================================
 * (일상 대화) 서버가 먼저 인사/질문(TTS) — GET /api/voice/daily/hello?as=stream
 * ========================================================= */
exports.dailyVoiceHello = async (req, res) => {
  try {
    const mode = 'daily';
    const starter = pickDailyStarter(); // { situation, question }
    const fullText = `[${starter.situation}]\n: ${starter.question}`;

    // TTS
    const [ttsResp] = await ttsClient.synthesizeSpeech({
      input: { text: fullText },
      voice: { languageCode: 'ko-KR', ssmlGender: 'NEUTRAL' },
      audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0 }
    });
    const mp3Buffer = Buffer.from(ttsResp.audioContent);

    if (!(req.query.as === 'stream' || (req.get('accept') || '').includes('audio/mpeg'))) {
      return res.json({
        success: true,
        mode,
        situation: starter.situation,
        question:  starter.question,
        text:      fullText,
        audioBase64: mp3Buffer.toString('base64'),
        mimeType: 'audio/mpeg'
      });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', mp3Buffer.length);
    return res.end(mp3Buffer);

  } catch (err) {
    logTtsError('dailyVoiceHello', err);
    return res.status(500).json({ success:false, message:'dailyVoiceHello 실패', hint: err?.message });
  }
};

/* =========================================================
 * (일상 대화) STT → GPT(JSON) → TTS — POST /api/voice/daily/chat
 * multipart: audio, systemPrompt?, temperature?
 * ========================================================= */
exports.dailyVoiceChat = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success:false, message:'audio 파일이 필요합니다.(form-data: audio)' });
    }

    // 1) STT
    let sttText = '';
    try {
      const fd = new FormData();
      fd.append('file', req.file.buffer, { filename: req.file.originalname || 'audio.m4a' });
      fd.append('model', STT_MODEL);
      const sttResp = await oa.post('/audio/transcriptions', fd, { headers: fd.getHeaders() });
      sttText = (sttResp.data?.text || '').trim();
    } catch (e1) {
      logOpenAiError('DAILY-STT-primary', e1);
      try {
        const fd2 = new FormData();
        fd2.append('file', req.file.buffer, { filename: req.file.originalname || 'audio.m4a' });
        fd2.append('model', 'whisper-1');
        const sttResp2 = await oa.post('/audio/transcriptions', fd2, { headers: fd2.getHeaders() });
        sttText = (sttResp2.data?.text || '').trim();
      } catch (e2) {
        logOpenAiError('DAILY-STT-fallback', e2);
        return res.status(502).json({ success:false, message:'STT 실패', hint: e2?.message });
      }
    }
    if (!sttText) return res.status(400).json({ success:false, message:'음성에서 텍스트를 추출하지 못했습니다.' });

    // 2) GPT — (일상 대화) JSON 스키마 강제
    const mode = 'daily'; // 🔒 강제
    const baseSystem = getDailyPrompt();
    const systemOverride = req.body?.systemPrompt ? String(req.body.systemPrompt) : '';
    const systemPrompt = systemOverride ? `${baseSystem}\n\n---\n(override)\n${systemOverride}` : baseSystem;
    const temperature  = Number(req.body?.temperature ?? 0.7); // 일상 대화는 살짝 더 자유롭게

    let gptJson; // { reply, tip, needRetry, critique }
    try {
      const gpt = await oa.post('/chat/completions', {
        model: GPT_MODEL,
        messages: [
          { role:'system', content: systemPrompt },
          { role:'user',   content: sttText }
        ],
        temperature,
        max_tokens: 600
      });

      const raw = (gpt.data?.choices?.[0]?.message?.content || '').trim();
      try {
        gptJson = JSON.parse(raw);
      } catch (e) {
        const m = raw.match(/\{[\s\S]*\}$/);
        gptJson = m ? JSON.parse(m[0]) : null;
      }
      if (!gptJson || typeof gptJson.reply !== 'string') throw new Error('Invalid JSON reply from GPT');

      gptJson.reply     = gptJson.reply.trim();
      gptJson.tip       = gptJson.tip ? String(gptJson.tip).trim() : null;
      gptJson.needRetry = Boolean(gptJson.needRetry);
      gptJson.critique  = gptJson.critique ? String(gptJson.critique).trim() : null;

    } catch (gptErr) {
      logOpenAiError('DAILY-GPT', gptErr);
      return res.status(502).json({ success:false, message:'GPT 호출 실패', hint: gptErr?.message });
    }

    // === (A) 파싱 직후 보정 로직 추가 — 자유 대화 UX 보장 ===
    {
      const u = (sttText || '').trim();
      const plain = u.replace(/\s/g, ''); // 공백 제외

      // "짧음/모호함" 휴리스틱
      const tooShort  = plain.length < 15;
      const looksVague = /그냥|그럭저럭|그랬어|보냈어|지냈어|했어[.!?]?$|괜찮았|좋았|나쁘지|편했어/.test(u);

      // TIP 누락 시 기본 TIP 채움 (이미 반영됨)
      if (!gptJson.tip || gptJson.tip.trim().length < 4) {
        gptJson.tip = '무엇(사실)·어디(장소)·누구와·얼마나(수치)·왜(이유) 중 2가지를 1~2문장으로 덧붙여 주세요.';
      }

      // 짧거나 모호하면 needRetry 강제
      if (tooShort || looksVague) {
        gptJson.needRetry = true;
        if (!gptJson.reply || !gptJson.reply.includes('다시 한 번 해볼까요?')) {
          gptJson.reply = `다시 한 번 해볼까요? ${gptJson.reply || ''}`.trim();
        }
        if (!gptJson.critique) {
          gptJson.critique = '서술이 짧고 구체성이 낮음';
        }
      }
    }
    // === 보정 로직 끝 ===

    // 3) TTS — reply만 읽음
    let mp3Buffer;
    try {
      const [ttsResp] = await ttsClient.synthesizeSpeech({
        input: { text: gptJson.reply },
        voice: { languageCode: 'ko-KR', ssmlGender: 'NEUTRAL' },
        audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0 }
      });
      mp3Buffer = Buffer.from(ttsResp.audioContent);
    } catch (ttsErr) {
      logTtsError('dailyVoiceChat', ttsErr);
      return res.status(502).json({ success:false, message:'TTS 실패', hint: ttsErr?.message });
    }

    // 4) 응답 (job과 동일한 형태)
    if (req.query.as === 'stream' || (req.get('accept') || '').includes('audio/mpeg')) {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', mp3Buffer.length);
      return res.end(mp3Buffer);
    }
    return res.json({
      success: true,
      mode,
      userText: sttText,
      text: gptJson.reply,
      audioBase64: mp3Buffer.toString('base64'),
      mimeType: 'audio/mpeg',
      hint: gptJson.tip,            // 프론트: "TIP:" 접두
      needRetry: gptJson.needRetry, // 사용자 말풍선 빨간 테두리 여부
      critique: gptJson.critique
    });

  } catch (err) {
    console.error('dailyVoiceChat error (top):', err?.message || err);
    return res.status(500).json({ success:false, message:'dailyVoiceChat 실패', hint: err?.message });
  }
};
