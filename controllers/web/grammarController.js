const openai = require("../../config/openai_web");

const checkGrammar = async (req, res) => {
  const { content } = req.body;
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo", // gpt-4 대신 turbo 모델 추천 (JSON 일관성 ↑)
      response_format: { type: "json_object" }, // 🚀 JSON 강제 (중요)
      messages: [
        {
          role: "system",
          content: `
너는 한국어 문법 교정 전문가입니다. 
다음 문장에서 맞춤법, 띄어쓰기, 문법 오류가 있는 '짧은 표현 조각'만 찾아 아래 JSON 배열로 **정확히** 출력하세요.

출력 형식 예시:
[
  { 
    "original": "않", 
    "corrected": "안", 
    "type": "맞춤법 오류",
    "explanation": "‘않’은 부정의 뜻을 나타내는 보조 용언으로, 이 문맥에서는 ‘안’이 맞습니다."
  }
]

규칙:
1. 전체 문장 금지 — 오직 오류 조각만.
2. 각 오류마다 반드시 explanation 포함 (이유를 한 문장으로 명확히 설명).
3. JSON 배열 외의 문자는 절대 포함하지 말 것.
4. type은 "맞춤법 오류", "띄어쓰기 오류", "문법 오류" 중 하나.`,
        },
        { role: "user", content },
      ],
    });

    const result = response.choices[0].message.content;
    res.json({ result }); // 기존 명세 유지
  } catch (error) {
    console.error("❌ GPT 오류:", error);
    res.status(500).json({ error: "맞춤법 검사 중 오류 발생" });
  }
};

module.exports = { checkGrammar };


// // const OpenAI = require("../../config/openai_web");
// // const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// // import OpenAI from "openai";
// // const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// const openai = require("../../config/openai_web");

// const checkGrammar = async (req, res) => {
//   const { content } = req.body;
//   try {
//     const response = await openai.chat.completions.create({
//       model: "gpt-4",
//       messages: [
//         {
//           role: "system",
//           content: `다음 문장에서 맞춤법, 띄어쓰기, 문법 오류가 있는 '짧은 표현 조각'만 골라 JSON 배열로 반환해주세요.
// [
//   { "original": "않", "corrected": "안", "type": "맞춤법 오류" }
// ]
// 조건:
// - 전체 문장 절대 금지
// - 틀린 조각만 배열 포함
// - JSON만 응답
// - type은 "맞춤법 오류", "띄어쓰기 오류", "문법 오류" 중 하나`,
//         },
//         { role: "user", content },
//       ],
//     });

//     const result = response.choices[0].message.content;
//     res.json({ result });
//   } catch (error) {
//     console.error("❌ GPT 오류:", error);
//     res.status(500).json({ error: "맞춤법 검사 중 오류 발생" });
//   }
// };

// module.exports = { checkGrammar };


