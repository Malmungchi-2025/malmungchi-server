// services/ttsClient.js
const textToSpeech = require("@google-cloud/text-to-speech");

function maskEmail(email = "") {
  const [id = "", dom = ""] = String(email).split("@");
  return `${id.slice(0, 2)}***@${dom}`;
}

function short(str = "", n = 8) {
  return String(str).slice(0, n);
}

function getServiceAccount() {
  const b64 = process.env.GOOGLE_TTS_JSON_BASE64;
  if (!b64) {
    console.error("[TTS] 환경변수 GOOGLE_TTS_JSON_BASE64 없음");
    throw new Error("환경변수 GOOGLE_TTS_JSON_BASE64 없음");
  }

  let json;
  try {
    json = Buffer.from(b64, "base64").toString("utf8");
  } catch (e) {
    console.error("[TTS] BASE64 디코딩 실패:", e.message);
    throw new Error("TTS 키 BASE64 디코딩 실패");
  }

  let sa;
  try {
    sa = JSON.parse(json);
  } catch (e) {
    console.error("[TTS] JSON 파싱 실패:", e.message);
    throw new Error("TTS 키 JSON 파싱 실패");
  }

  // 필수 필드 확인
  const required = ["project_id", "client_email", "private_key"];
  for (const k of required) {
    if (!sa[k]) {
      console.error(`[TTS] 서비스계정 키에 ${k} 누락`);
      throw new Error(`TTS 서비스계정에 ${k} 누락`);
    }
  }

  // 일부 환경에서 \n 이 이스케이프된 채 들어오는 경우 복원
  if (typeof sa.private_key === "string" && sa.private_key.includes("\\n")) {
    sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  }

  console.log(
    "[TTS] SA 로드 성공",
    `project=${sa.project_id}`,
    `email=${maskEmail(sa.client_email)}`,
    `keyId=${short(sa.private_key.match(/PRIVATE KEY/g) ? "ok" : "bad")}`
  );

  return sa;
}

// 이것도 임시로 추가할게요 -웹 -
//미안해요. 이것 때문에.. ai 대화가 깨져버려서 이건 다시 주석 칠게요 -앱-
//
// const sa = {
//   project_id: "disabled",
//   client_email: "disabled@example.com",
//   private_key: "disabled",
// };

const sa = getServiceAccount();

const ttsClient = new textToSpeech.TextToSpeechClient({
  projectId: sa.project_id,
  credentials: {
    client_email: sa.client_email,
    private_key: sa.private_key,
  },
});

module.exports = {
  ttsClient,
  meta: {
    projectId: sa.project_id,
    clientEmailMasked: maskEmail(sa.client_email),
  },
};
