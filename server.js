//server.js
const dotenv = require('dotenv');
dotenv.config(); // ✅ 최상단에서 가장 먼저 실행
const fs = require('fs');
const path = require('path');

// ✅ Google TTS Base64 → JSON 복원
(function restoreGoogleKeyFromEnv() {
  const b64 = process.env.GOOGLE_TTS_JSON_BASE64;
  if (!b64) {
    console.log('[TTS] GOOGLE_TTS_JSON_BASE64 not set. Skip decode.');
    return;
  }
  const credPath = '/opt/render/project/.data/gcp-tts.json';
  try {
    fs.mkdirSync(path.dirname(credPath), { recursive: true }); // ★ 폴더 보장 (필수)
    const buf = Buffer.from(b64, 'base64');
    fs.writeFileSync(credPath, buf, { mode: 0o600 });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
    console.log('[TTS] Credentials restored at', credPath);
  } catch (e) {
    console.error('[TTS] Decode failed:', e.message);
  }
})();


const express = require('express');
const http = require('http');
const cors = require('cors');

const { swaggerUi, specs } = require('./config/swagger');
const pool = require('./config/db');

const app = express();
app.use(cors());
app.use(express.json());

//요청 타임아웃(여유) -> 챗봇
app.use((req, res, next) => {
  req.setTimeout(120000);  // 120초
  res.setTimeout(120000);
  next();
});
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

const { auth } = require('./middlewares/auth');
app.use(auth); // ← 모든 라우트 전에 토큰 파싱/유저 주입

app.get('/', (req, res) => res.send('🚀 Malmungchi Server is running...'));

const authDevRoutes = require('./routes/authDevRoutes');
app.use('/api/auth', authDevRoutes);



const authRoutes = require('./routes/authRoutes');
app.use('/api/auth', authRoutes);

const friendRoutes = require('./routes/friendRoutes');
app.use('/api/friends', friendRoutes);

const voiceRoutes = require('./routes/voiceRoutes');
app.use('/api/voice', voiceRoutes); // 최소 구성

const gptRoutes = require('./routes/gptRoutes');
app.use('/api/gpt', gptRoutes);

const { verifySmtp } = require('./utils/mailer');
verifySmtp(); // 부팅 시 1회

// ✅ DB 초기화 함수
async function initializeDB() {
  try {
    const initSql = fs.readFileSync(path.join(__dirname, 'init.sql')).toString();
    await pool.query(initSql);
    console.log('✅ Render DB 초기화 완료');
  } catch (err) {
    console.error('❌ DB 초기화 실패:', err.message);
  }
}

// ✅ 먼저 DB 초기화 실행
initializeDB().then(() => {
  const PORT = process.env.PORT || 3443;
  http.createServer(app).listen(PORT, () => {
    console.log(`✅ HTTP 서버 실행 중: http://localhost:${PORT}`);
    console.log(`📄 Swagger UI: http://localhost:${PORT}/api-docs`);
  });
});