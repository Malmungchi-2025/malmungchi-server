const axios = require('axios');

exports.generateQuote = async (req, res) => {
  try {
    const prompt = `
      20대 사회초년생을 위한 문해력 학습용 글을 작성해줘.
      조건: 쉬운 단어, 480~520자, 직장/일상/친구/습관 주제.
    `;

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
      }
    );

    res.json({ success: true, result: response.data.choices[0].message.content });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ success: false, message: 'GPT API 오류' });
  }
};

//단어 정리
exports.getWordDefinition = async (req, res) => {
  const { word } = req.body;
  if (!word) return res.status(400).json({ success: false, message: '단어 필요' });

  try {
    const prompt = `"${word}"라는 단어의 국립국어원 기준 원형, 정의, 예문을 JSON으로 반환해줘.`;
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
      },
      { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
    );

    res.json({ success: true, result: response.data.choices[0].message.content });
  } catch (err) {
    res.status(500).json({ success: false, message: 'GPT 요청 실패' });
  }
};