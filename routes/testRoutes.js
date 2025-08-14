const express = require('express');
const { sendMail } = require('../utils/mailer');
const router = express.Router();

router.get('/test-mail', async (req, res) => {
  try {
    await sendMail({
      to: process.env.SMTP_USER,
      subject: '메일러 테스트',
      html: `<p>테스트 메일입니다.</p>`
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

module.exports = router; 
//메일 테스트용.

const testRoutes = require('./routes/testRoutes');
app.use('/test', testRoutes);