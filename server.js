const dotenv = require('dotenv');
dotenv.config(); // ✅ 최상단에서 가장 먼저 실행
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const cors = require('cors');

const { swaggerUi, specs } = require('./config/swagger');
const pool = require('./config/db');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

app.get('/', (req, res) => res.send('🚀 Malmungchi Server is running...'));

const authDevRoutes = require('./routes/authDevRoutes');
app.use('/api/auth', authDevRoutes);

const authRoutes = require('./routes/authRoutes');
app.use('/api/auth', authRoutes);

const gptRoutes = require('./routes/gptRoutes');
app.use('/api/gpt', gptRoutes);

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