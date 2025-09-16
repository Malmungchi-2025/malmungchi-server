// server/prompts/index.js
const fs   = require('fs');
const path = require('path');

const PROMPT_PATH = path.join(__dirname, 'voice_prompts.txt');
const RAW = fs.readFileSync(PROMPT_PATH, 'utf8');

// [섹션] 블록을 통째로 추출
function extract(sectionTitle) {
  const re = new RegExp(`\\[${sectionTitle}\\][\\s\\S]*?(?=\\n\\n\\[|$)`, 'm');
  const m = RAW.match(re);
  return (m ? m[0] : '').trim();
}

// 섹션 결합
const COMMON = extract('운영 기준 - 모든 대화 유형에 공통 적용');
const JOB    = extract('취업준비');
const WORK   = extract('업무');
const DAILY  = extract('일상대화');

const MAP = {
  job:   `${COMMON}\n\n${JOB}`,
  work:  `${COMMON}\n\n${WORK}`,
  daily: `${COMMON}\n\n${DAILY}`,
};

function getPrompt(mode = 'job') {
  return MAP[mode] || MAP.job;
}

module.exports = { getPrompt, COMMON, JOB, WORK, DAILY };