// // controllers/voiceController.js
// const axios = require('axios');
// const FormData = require('form-data');
// const textToSpeech = require('@google-cloud/text-to-speech');
// const http  = require('http');
// const https = require('https');
// const { getPrompt, COMMON, JOB, WORK, DAILY } = require('../server/prompts');
// //const { getPrompt, COMMON, JOB, WORK, DAILY } = require('../prompts');

// const OA_BASE = 'https://api.openai.com/v1';
// const OA_KEY  = process.env.OPENAI_API_KEY;
// const STT_MODEL = process.env.STT_MODEL || 'gpt-4o-mini-transcribe'; // 실패 시 whisper-1 폴백
// const GPT_MODEL = process.env.GPT_MODEL || 'gpt-4o-mini';

// // 안정성: 재사용 소켓 끄기(간단 모드)
// const oa = axios.create({
//     baseURL: OA_BASE,
//     headers: { Authorization: `Bearer ${OA_KEY}` },
//     timeout: 120000,                         // ← 120s
//     httpAgent: new http.Agent({ keepAlive: false }),
//     httpsAgent: new https.Agent({ keepAlive: false }),
//     maxBodyLength: 1024 * 1024 * 50          // 여유 50MB
//   });

// const gttsClient = new textToSpeech.TextToSpeechClient();

// /**
//  * GET /api/voice/prompts?mode=job|work|daily
//  * 앱의 '노트패드'에 내려줄 프롬프트 원문
//  */
// exports.getVoicePrompt = async (req, res) => {
//   try {
//     const mode = String(req.query?.mode || 'job').toLowerCase();
//     let title = '취업준비', text = `${COMMON}\n\n${JOB}`;
//     if (mode === 'work')  { title = '업무';      text = `${COMMON}\n\n${WORK}`; }
//     if (mode === 'daily') { title = '일상대화';  text = `${COMMON}\n\n${DAILY}`; }
//     return res.json({ success: true, mode, title, prompt: text });
//   } catch (e) {
//     console.error('getVoicePrompt error:', e?.message || e);
//     return res.status(500).json({ success:false, message:'프롬프트 조회 실패' });
//   }
// };

// /**
//  * POST /api/voice/chat
//  * form-data: audio=<file> (m4a/mp3/wav), mode=job|work|daily, (opt) systemPrompt, temperature
//  * 응답: { success, mode, text, audioBase64, mimeType, hint }
//  */
// exports.voiceChat = async (req, res) => {
//   try {
//     if (!req.file) {
//       return res.status(400).json({ success:false, message:'audio 파일이 필요합니다.(form-data: audio)' });
//     }

//     // 1) STT
//     const fd = new FormData();
//     fd.append('file', req.file.buffer, { filename: req.file.originalname || 'audio.m4a' });
//     fd.append('model', STT_MODEL);

//     let sttResp;
//     try {
//       sttResp = await oa.post('/audio/transcriptions', fd, { headers: fd.getHeaders() });
//     } catch (e) {
//       // gpt-4o-mini-transcribe 미지원/실패 시 whisper-1 폴백
//       const fd2 = new FormData();
//       fd2.append('file', req.file.buffer, { filename: req.file.originalname || 'audio.m4a' });
//       fd2.append('model', 'whisper-1');
//       sttResp = await oa.post('/audio/transcriptions', fd2, { headers: fd2.getHeaders() });
//     }
//     const userText = (sttResp.data?.text || '').trim();
//     if (!userText) return res.status(400).json({ success:false, message:'음성에서 텍스트를 추출하지 못했습니다.' });

//     // 2) GPT (mode별 시스템 프롬프트)
//     const mode = String(req.body?.mode || 'job').toLowerCase();
//     const baseSystem = getPrompt(mode);
//     const systemOverride = req.body?.systemPrompt ? String(req.body.systemPrompt) : '';
//     const systemPrompt = systemOverride ? `${baseSystem}\n\n---\n(override)\n${systemOverride}` : baseSystem;

//     const temperature  = Number(req.body?.temperature ?? 0.6);
//     const gpt = await oa.post('/chat/completions', {
//       model: GPT_MODEL,
//       messages: [
//         { role:'system', content: systemPrompt },
//         { role:'user',   content: userText }
//       ],
//       temperature,
//       max_tokens: 400
//     });

//     const botText = (gpt.data?.choices?.[0]?.message?.content || '').trim();
//     if (!botText) return res.status(500).json({ success:false, message:'GPT 응답이 비었습니다.' });

//     // 3) TTS (Google Cloud → MP3)
//     const [ttsResp] = await gttsClient.synthesizeSpeech({
//         input: { text: botText },
//         voice: { languageCode: 'ko-KR', ssmlGender: 'NEUTRAL' },
//         audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0 }
//     });
    
//     // 🔻 공통 버퍼
//     const mp3Buffer = Buffer.from(ttsResp.audioContent);
    
//     // ✅ (A) 바이너리 스트리밍 응답: Accept: audio/mpeg 이거나 ?as=stream 인 경우
//     if (req.query.as === 'stream' || (req.get('accept') || '').includes('audio/mpeg')) {
//         res.setHeader('Content-Type', 'audio/mpeg');
//         res.setHeader('Content-Length', mp3Buffer.length);
//         return res.end(mp3Buffer);
//     }
    
//     // ✅ (B) 기존 방식(JSON + base64) - 모바일/디버깅에 편함
//     const audioBase64 = mp3Buffer.toString('base64');
//     return res.json({
//         success: true,
//         mode,
//         userText,
//         text: botText,
//         audioBase64,
//         mimeType: 'audio/mpeg',
//         hint: '다시 한 번 해볼까요?'
//     });
//   } catch (err) {
//     console.error('voiceChat error:', err?.response?.data || err.message);
//     // OpenAI/네트워크 오류 구분 없이 단순화
//     return res.status(500).json({ success:false, message:'voiceChat 실패' });
//   }
// };

// controllers/voiceController.js
const axios = require('axios');
const FormData = require('form-data');
const http  = require('http');
const https = require('https');
const { getPrompt, COMMON, JOB, WORK, DAILY } = require('../server/prompts');
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

// ─────────────────────────────────────────────────────────
// GET /api/voice/prompts?mode=job|work|daily
// 노트패드용 원문 프롬프트
// ─────────────────────────────────────────────────────────
exports.getVoicePrompt = async (req, res) => {
  try {
    const mode = String(req.query?.mode || 'job').toLowerCase();
    let title = '취업준비', text = `${COMMON}\n\n${JOB}`;
    if (mode === 'work')  { title = '업무';      text = `${COMMON}\n\n${WORK}`; }
    if (mode === 'daily') { title = '일상대화';  text = `${COMMON}\n\n${DAILY}`; }
    return res.json({ success: true, mode, title, prompt: text });
  } catch (e) {
    console.error('getVoicePrompt error:', e?.message || e);
    return res.status(500).json({ success:false, message:'프롬프트 조회 실패' });
  }
};

// 공통: 에러 디버깅 헬퍼(민감정보 제외)
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

// ─────────────────────────────────────────────────────────
// GET /api/voice/hello?mode=job|work|daily&as=stream
// 서버가 먼저 상황+질문을 음성(TTS)+텍스트로 제공
// ─────────────────────────────────────────────────────────
exports.voiceHello = async (req, res) => {
  try {
    const mode = String(req.query?.mode || 'job').toLowerCase();

    // 모드별 스타터 메시지(친구처럼, 짧고 명확하게)
    let text = '';
    if (mode === 'work') {
      text = `[업무 상황 시뮬레이션]\n상황: 팀장님께 회의 일정을 변경 요청해야 해요.\nQ. 내일 오후 2시로 변경을 정중하고 간결하게 요청해보세요. 사유도 한 문장으로 덧붙여주세요.`;
    } else if (mode === 'daily') {
      text = `오늘 하루 어땠나요? 편하게 이야기해봐요 :) 기뻤던 일이나 스트레스 받았던 일, 뭐든 좋아요.`;
    } else {
      // job (취업)
      text = `면접 연습을 시작해볼까요?\nQ. 자기소개를 1분 이내로 말해보세요. 핵심 강점 2가지를 꼭 넣어주세요.`;
    }

    // TTS (Google Cloud → MP3)
    const [ttsResp] = await ttsClient.synthesizeSpeech({
      input: { text },
      voice: { languageCode: 'ko-KR', ssmlGender: 'NEUTRAL' },
      audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0 }
    });
    const mp3Buffer = Buffer.from(ttsResp.audioContent);

    // 바이너리 스트리밍 또는 JSON(+base64)
    if (req.query.as === 'stream' || (req.get('accept') || '').includes('audio/mpeg')) {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', mp3Buffer.length);
      return res.end(mp3Buffer);
    }
    return res.json({
      success: true,
      mode,
      text,
      audioBase64: mp3Buffer.toString('base64'),
      mimeType: 'audio/mpeg'
    });
  } catch (err) {
    logTtsError('voiceHello', err);
    return res.status(500).json({ success:false, message:'voiceHello 실패', hint: err?.message });
  }
};

// ─────────────────────────────────────────────────────────
// POST /api/voice/chat  (multipart: audio, mode, …)
// STT → GPT → TTS
// ─────────────────────────────────────────────────────────
exports.voiceChat = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success:false, message:'audio 파일이 필요합니다.(form-data: audio)' });
    }

    // 1) STT (우선 gpt-4o-mini-transcribe, 실패 시 whisper-1)
    let sttText = '';
    try {
      const fd = new FormData();
      fd.append('file', req.file.buffer, { filename: req.file.originalname || 'audio.m4a' });
      fd.append('model', STT_MODEL);
      const sttResp = await oa.post('/audio/transcriptions', fd, { headers: fd.getHeaders() });
      sttText = (sttResp.data?.text || '').trim();
    } catch (sttErr) {
      logOpenAiError('STT-primary', sttErr);
      try {
        const fd2 = new FormData();
        fd2.append('file', req.file.buffer, { filename: req.file.originalname || 'audio.m4a' });
        fd2.append('model', 'whisper-1');
        const sttResp2 = await oa.post('/audio/transcriptions', fd2, { headers: fd2.getHeaders() });
        sttText = (sttResp2.data?.text || '').trim();
      } catch (sttErr2) {
        logOpenAiError('STT-fallback', sttErr2);
        return res.status(502).json({ success:false, message:'STT 실패', hint: sttErr2?.message });
      }
    }

    if (!sttText) {
      return res.status(400).json({ success:false, message:'음성에서 텍스트를 추출하지 못했습니다.' });
    }

    // 2) GPT (모드별 시스템 프롬프트)
    const mode = String(req.body?.mode || 'job').toLowerCase();
    const baseSystem = getPrompt(mode);
    const systemOverride = req.body?.systemPrompt ? String(req.body.systemPrompt) : '';
    const systemPrompt = systemOverride ? `${baseSystem}\n\n---\n(override)\n${systemOverride}` : baseSystem;

    const temperature  = Number(req.body?.temperature ?? 0.6);

    let botText = '';
    try {
      const gpt = await oa.post('/chat/completions', {
        model: GPT_MODEL,
        messages: [
          { role:'system', content: systemPrompt },
          { role:'user',   content: sttText }
        ],
        temperature,
        max_tokens: 400
      });
      botText = (gpt.data?.choices?.[0]?.message?.content || '').trim();
    } catch (gptErr) {
      logOpenAiError('GPT', gptErr);
      return res.status(502).json({ success:false, message:'GPT 호출 실패', hint: gptErr?.message });
    }

    if (!botText) {
      return res.status(500).json({ success:false, message:'GPT 응답이 비었습니다.' });
    }

    // 3) TTS (Google → MP3)
    let mp3Buffer;
    try {
      const [ttsResp] = await ttsClient.synthesizeSpeech({
        input: { text: botText },
        voice: { languageCode: 'ko-KR', ssmlGender: 'NEUTRAL' },
        audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0 }
      });
      mp3Buffer = Buffer.from(ttsResp.audioContent);
    } catch (ttsErr) {
      logTtsError('voiceChat', ttsErr);
      return res.status(502).json({ success:false, message:'TTS 실패', hint: ttsErr?.message });
    }

    // 바이너리 스트리밍 or JSON(+base64)
    if (req.query.as === 'stream' || (req.get('accept') || '').includes('audio/mpeg')) {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', mp3Buffer.length);
      return res.end(mp3Buffer);
    }

    return res.json({
      success: true,
      mode,
      userText: sttText,
      text: botText,
      audioBase64: mp3Buffer.toString('base64'),
      mimeType: 'audio/mpeg',
      hint: '다시 한 번 해볼까요?'
    });
  } catch (err) {
    console.error('voiceChat error (top):', err?.message || err);
    return res.status(500).json({ success:false, message:'voiceChat 실패', hint: err?.message });
  }
};