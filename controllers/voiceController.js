controllers/voiceController.js

// controllers/voiceController.js
const axios = require('axios');
const FormData = require('form-data');
const textToSpeech = require('@google-cloud/text-to-speech');
const http  = require('http');
const https = require('https');
const { getPrompt, COMMON, JOB, WORK, DAILY } = require('../prompts');

const OA_BASE = 'https://api.openai.com/v1';
const OA_KEY  = process.env.OPENAI_API_KEY;
const STT_MODEL = process.env.STT_MODEL || 'gpt-4o-mini-transcribe'; // 실패 시 whisper-1 폴백
const GPT_MODEL = process.env.GPT_MODEL || 'gpt-4o-mini';

// 안정성: 재사용 소켓 끄기(간단 모드)
const oa = axios.create({
    baseURL: OA_BASE,
    headers: { Authorization: `Bearer ${OA_KEY}` },
    timeout: 120000,                         // ← 120s
    httpAgent: new http.Agent({ keepAlive: false }),
    httpsAgent: new https.Agent({ keepAlive: false }),
    maxBodyLength: 1024 * 1024 * 50          // 여유 50MB
  });

const gttsClient = new textToSpeech.TextToSpeechClient();

/**
 * GET /api/voice/prompts?mode=job|work|daily
 * 앱의 '노트패드'에 내려줄 프롬프트 원문
 */
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

/**
 * POST /api/voice/chat
 * form-data: audio=<file> (m4a/mp3/wav), mode=job|work|daily, (opt) systemPrompt, temperature
 * 응답: { success, mode, text, audioBase64, mimeType, hint }
 */
exports.voiceChat = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success:false, message:'audio 파일이 필요합니다.(form-data: audio)' });
    }

    // 1) STT
    const fd = new FormData();
    fd.append('file', req.file.buffer, { filename: req.file.originalname || 'audio.m4a' });
    fd.append('model', STT_MODEL);

    let sttResp;
    try {
      sttResp = await oa.post('/audio/transcriptions', fd, { headers: fd.getHeaders() });
    } catch (e) {
      // gpt-4o-mini-transcribe 미지원/실패 시 whisper-1 폴백
      const fd2 = new FormData();
      fd2.append('file', req.file.buffer, { filename: req.file.originalname || 'audio.m4a' });
      fd2.append('model', 'whisper-1');
      sttResp = await oa.post('/audio/transcriptions', fd2, { headers: fd2.getHeaders() });
    }
    const userText = (sttResp.data?.text || '').trim();
    if (!userText) return res.status(400).json({ success:false, message:'음성에서 텍스트를 추출하지 못했습니다.' });

    // 2) GPT (mode별 시스템 프롬프트)
    const mode = String(req.body?.mode || 'job').toLowerCase();
    const baseSystem = getPrompt(mode);
    const systemOverride = req.body?.systemPrompt ? String(req.body.systemPrompt) : '';
    const systemPrompt = systemOverride ? `${baseSystem}\n\n---\n(override)\n${systemOverride}` : baseSystem;

    const temperature  = Number(req.body?.temperature ?? 0.6);
    const gpt = await oa.post('/chat/completions', {
      model: GPT_MODEL,
      messages: [
        { role:'system', content: systemPrompt },
        { role:'user',   content: userText }
      ],
      temperature,
      max_tokens: 400
    });

    const botText = (gpt.data?.choices?.[0]?.message?.content || '').trim();
    if (!botText) return res.status(500).json({ success:false, message:'GPT 응답이 비었습니다.' });

    // 3) TTS (Google Cloud → MP3)
    const [ttsResp] = await gttsClient.synthesizeSpeech({
        input: { text: botText },
        voice: { languageCode: 'ko-KR', ssmlGender: 'NEUTRAL' },
        audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0 }
    });
    
    // 🔻 공통 버퍼
    const mp3Buffer = Buffer.from(ttsResp.audioContent);
    
    // ✅ (A) 바이너리 스트리밍 응답: Accept: audio/mpeg 이거나 ?as=stream 인 경우
    if (req.query.as === 'stream' || (req.get('accept') || '').includes('audio/mpeg')) {
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', mp3Buffer.length);
        return res.end(mp3Buffer);
    }
    
    // ✅ (B) 기존 방식(JSON + base64) - 모바일/디버깅에 편함
    const audioBase64 = mp3Buffer.toString('base64');
    return res.json({
        success: true,
        mode,
        userText,
        text: botText,
        audioBase64,
        mimeType: 'audio/mpeg',
        hint: '다시 한 번 해볼까요?'
    });
  } catch (err) {
    console.error('voiceChat error:', err?.response?.data || err.message);
    // OpenAI/네트워크 오류 구분 없이 단순화
    return res.status(500).json({ success:false, message:'voiceChat 실패' });
  }
};