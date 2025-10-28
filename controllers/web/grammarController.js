// const OpenAI = require("../../config/openai_web");
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// import OpenAI from "openai";
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const openai = require("../../config/openai_web");

const checkGrammar = async (req, res) => {
  const { content } = req.body;
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `다음 문장에서 맞춤법, 띄어쓰기, 문법 오류가 있는 '짧은 표현 조각'만 골라 JSON 배열로 반환해주세요.
[
  { "original": "않", "corrected": "안", "type": "맞춤법 오류" }
]
조건:
- 전체 문장 절대 금지
- 틀린 조각만 배열 포함
- JSON만 응답
- type은 "맞춤법 오류", "띄어쓰기 오류", "문법 오류" 중 하나`,
        },
        { role: "user", content },
      ],
    });

    const result = response.choices[0].message.content;
    res.json({ result });
  } catch (error) {
    console.error("❌ GPT 오류:", error);
    res.status(500).json({ error: "맞춤법 검사 중 오류 발생" });
  }
};

module.exports = { checkGrammar };
