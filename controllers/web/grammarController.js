const openai = require("../../config/openai_web");

const checkGrammar = async (req, res) => {
  const { content } = req.body;
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `
너는 GPT 맞춤법 검사기야.
사용자의 철자 실수나 자주 발생하는 오타를 중심으로, 단어를 가능한 의미 변화 없이 교정해야 해.
중요한 기준은 아래와 같아:

- 문장 전체는 재작성하지 말 것
- 사용자가 쓴 어휘의 맥락과 의미는 바꾸지 말 것
- 자주 쓰는 단어임에도 철자 오류가 있는 경우(예: '만다' → '많다')는 적극적으로 교정할 것
- 철자만 틀린 단어, 띄어쓰기 오류 등을 위주로 수정
- 문법 오류는 자연스러운 형태로 고쳐줄 것

단, 아래와 같은 경우는 고치지 마:
- '만다' → '만든다' ❌ (뜻이 달라짐)
- '볼께' → '볼게' ✅ (철자만 틀림)

검사 결과는 JSON 배열 형식으로만 제공하고, 형식은 반드시 아래와 같아야 해:

[
  {
    "original": "만다",
    "corrected": "많다",
    "type": "맞춤법 오류",
    "explanation": "‘만다’는 ‘많다’의 철자 오류로 보입니다."
  }
]

틀린 부분이 없다면 [] (빈 배열) 로 응답해.
  `,
        },
        { role: "user", content },
      ],
    });

    const result = response.choices[0].message.content;
    res.json({ result }); // ⚠️ 기존 명세 유지
  } catch (error) {
    console.error("❌ GPT 오류:", error);
    res.status(500).json({ error: "맞춤법 검사 중 오류 발생" });
  }
};

module.exports = { checkGrammar };
