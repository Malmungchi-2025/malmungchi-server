const express = require('express');
const http = require('http');
const cors = require('cors');
const dotenv = require('dotenv');
const { swaggerUi, specs } = require('./config/swagger');
const pool = require('./config/db');
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

app.get('/', (req, res) => res.send('🚀 Malmungchi Server is running...'));

const authRoutes = require('./routes/authRoutes');
app.use('/api/auth', authRoutes);

const gptRoutes = require('./routes/gptRoutes');
app.use('/api/gpt', gptRoutes);

const PORT = process.env.PORT || 3443;
http.createServer(app).listen(PORT, () => {
  console.log(`✅ HTTP 서버 실행 중: http://localhost:${PORT}`);
  console.log(`📄 Swagger UI: http://localhost:${PORT}/api-docs`);
});