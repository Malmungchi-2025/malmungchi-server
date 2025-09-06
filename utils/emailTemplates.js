// utils/emailTemplates.js
const fs = require('fs');
const path = require('path');

// === 브랜드 설정 ===
const BRAND = {
  name: '말뭉치',
  primary: '#2569ED',     // 메인 브랜드 컬러 (링큐 그라데이션 → 단색)
  text: '#111111',
  subText: '#4B5563',     // 살짝 진하게(가독성↑)
  bg: '#F7F8FB',
  card: '#FFFFFF',
  border: '#D1D5DB',
  heroBg: '#2569ED',      // 히어로 섹션 배경
  appUrl: process.env.APP_BASE_URL || '#',
  // 실제 발송 시 CDN 이미지 URL로 바꿔 쓰세요.
  logoUrl: process.env.MALMUNGCHI_LOGO_URL || null,
};

// === 텍스트 버전 ===
function renderOtpPlain(name, code, minutes = 5) {
  return `[${BRAND.name}] 개발용 OTP 코드

${name ? `${name}님, ` : ''}아래 일회용 코드로 인증을 진행하세요. (유효기간 ${minutes}분)

${code}

만약 본인이 요청한 내용이 아니라면 이 메일을 무시해 주세요.`;
}

// === HTML 버전 ===
// 옵션: { logoDataUri, pretendardSemiBoldDataUri }
function renderOtpHtml(name, code, minutes = 5, opts = {}) {
  const safeCode = String(code).replace(/\s+/g, '');
  const year = new Date().getFullYear();

  // 폰트 임베드 (가능한 메일앱에서만 적용됨)
  // Gmail 등은 무시하므로 시스템 폰트 폴백 포함.
  const fontFace = opts.pretendardSemiBoldDataUri
    ? `
@font-face {
  font-family: 'Pretendard';
  src: url('${opts.pretendardSemiBoldDataUri}') format('truetype');
  font-weight: 600;
  font-style: normal;
}
    `
    : '';

  // 로고 src: 우선순위 dataURI > 환경변수 URL > (없으면 숨김)
  const logoSrc = opts.logoDataUri || BRAND.logoUrl || '';

  // CTA (앱으로 돌아가기) 안전 처리
  const ctaHtml = BRAND.appUrl && BRAND.appUrl !== '#'
    ? `<a href="${BRAND.appUrl}"
          style="display:inline-block; padding:12px 20px; color:#FFFFFF; text-decoration:none; font-weight:700; font-size:14px; border-radius:10px;">
         앱으로 돌아가기
       </a>`
    : `<div role="button"
            style="display:inline-block; padding:12px 20px; color:#FFFFFF; text-decoration:none; font-weight:700; font-size:15px; border-radius:10px; letter-spacing:.2px;">
         앱 내 인증 화면으로 이동해 주세요
       </div>`;

  return `
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>[${BRAND.name}] 개발용 OTP 코드</title>
  <style>
    ${fontFace}
    /* iOS 다크모드 강제색 방지 소량 힌트 */
    @media (prefers-color-scheme: dark) {
      .force-bg { background: ${BRAND.card} !important; }
      .force-text { color: ${BRAND.text} !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background:${BRAND.bg};">
  <!-- Preheader(받은편지함 요약) -->
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
    인증용 일회용 코드가 도착했어요. 유효기간은 ${minutes}분입니다.
  </div>

  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${BRAND.bg}; padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="width:560px; max-width:560px; background:${BRAND.card}; border:1px solid ${BRAND.border}; border-radius:16px; overflow:hidden;">
          
          <!-- Hero/Header -->
          <tr>
            <td style="background:${BRAND.heroBg}; padding:28px 24px 22px 24px;" align="center">
              ${logoSrc ? `
                <img src="${logoSrc}" width="68" height="68" alt="${BRAND.name} 로고"
                     style="display:block; width:56px; height:56px; border:0; margin:0 auto 12px auto;">
              ` : ``}
              <div style="font-family: ${opts.pretendardSemiBoldDataUri ? 'Pretendard, ' : ''}system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, Apple SD Gothic Neo, '맑은 고딕', sans-serif; font-size:18px; font-weight:600; color:#FFFFFF; letter-spacing:.2px;">
                ${BRAND.name}
              </div>
              <div style="height:6px;"></div>
              <div style="font-family: ${opts.pretendardSemiBoldDataUri ? 'Pretendard, ' : ''}system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, Apple SD Gothic Neo, '맑은 고딕', sans-serif; font-size:14px; font-weight:600; color:#F0F6FF; opacity:0.95;">
                20대 사회초년생을 위한 문해력·어휘력 향상 학습 플랫폼
              </div>
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td align="left" style="padding:24px 32px 8px 32px; font-family: system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, Apple SD Gothic Neo, '맑은 고딕', sans-serif; color:${BRAND.text};">
              <div style="font-size:20px; font-weight:800;">
                [${BRAND.name}] 개발용 OTP 코드
              </div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:0 32px 0 32px; font-family: system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, Apple SD Gothic Neo, '맑은 고딕', sans-serif; color:${BRAND.text};">
              <p style="margin:0; font-size:14px; line-height:22px; color:${BRAND.subText};">
                ${name ? `<strong style="color:${BRAND.text};">${name}</strong>님, ` : ''}아래 <strong>일회용 코드</strong>로 인증을 진행해 주세요. (유효기간 ${minutes}분)
              </p>
              <div style="height:16px;"></div>

              <!-- OTP 카드 -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"
                     style="border:1px dashed ${BRAND.border}; border-radius:12px; background:#FAFBFF;">
                <tr>
                  <td align="center" style="padding:24px;">
                    <div style="font-size:32px; line-height:40px; font-weight:800; letter-spacing:6px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;">
                      ${safeCode}
                    </div>
                    <div style="height:8px;"></div>
                    <div style="font-size:12px; color:${BRAND.subText};">
                      만료까지 약 ${minutes}분 남았어요
                    </div>
                  </td>
                </tr>
              </table>

              <div style="height:18px;"></div>

              <!-- CTA -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
                <tr>
                  <td align="center" bgcolor="${BRAND.primary}" style="border-radius:10px;">
                    ${ctaHtml}
                  </td>
                </tr>
              </table>

              <div style="height:24px;"></div>
              <p style="margin:0; font-size:12px; line-height:18px; color:${BRAND.subText};">
                본인이 요청하지 않았다면 이 메일을 무시해 주세요. 보안을 위해 이 코드는 <strong>1회용</strong>입니다.
              </p>

              <div style="height:28px;"></div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:10px 24px 0 24px;">
              <div style="height:1px; background:${BRAND.border}; width:100%;"></div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:16px 24px 8px 24px; font-family: system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, Apple SD Gothic Neo, '맑은 고딕', sans-serif; color:${BRAND.subText}; font-size:12px;">
              © ${year} | ${BRAND.name}
              &nbsp;&nbsp; <a href="#" style="color:${BRAND.subText}; text-decoration:underline;">Unsubscribe</a>
              &nbsp; | &nbsp;
              <a href="#" style="color:${BRAND.subText}; text-decoration:underline;">Preferences</a>
            </td>
          </tr>
        </table>

        <div style="height:12px;"></div>

        <!-- 헬프텍스트 -->
        <div style="width:560px; max-width:560px; font-size:12px; color:${BRAND.subText}; text-align:center; font-family: system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, Apple SD Gothic Neo, '맑은 고딕', sans-serif;">
          메일이 잘 보이지 않으면 브라우저에서 열어보거나, 스팸함을 확인해 주세요.
        </div>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

module.exports = { renderOtpHtml, renderOtpPlain };

/* =========================
   미리보기 전용 실행(안전)
   node utils/emailTemplates.js
   ========================= */
if (require.main === module) {
  // 1) 로고 PNG/WEBP → Base64 data URI (미리보기 편의)
  //    경로를 본인 PC에 맞게 바꾸세요. (없어도 됨)
  //    예: C:\\Users\\office\\Downloads\\전달사항\\malmungchi.png
  const LOCAL_LOGO_PATH = process.env.LOCAL_LOGO_PATH ||
    path.join(__dirname, 'malmungchi.png'); // 레포 안에 두면 자동 사용

  let logoDataUri = null;
  try {
    if (fs.existsSync(LOCAL_LOGO_PATH)) {
      const mime = LOCAL_LOGO_PATH.endsWith('.webp') ? 'image/webp'
                 : LOCAL_LOGO_PATH.endsWith('.jpg') || LOCAL_LOGO_PATH.endsWith('.jpeg') ? 'image/jpeg'
                 : 'image/png';
      const b64 = fs.readFileSync(LOCAL_LOGO_PATH).toString('base64');
      logoDataUri = `data:${mime};base64,${b64}`;
    }
  } catch {}

  // 2) Pretendard-SemiBold.ttf → Base64 data URI (가능한 메일앱에서만 적용)
  //    경로를 본인 PC에 맞게 바꾸세요.
  //    예: C:\\Users\\office\\Downloads\\전달사항\\Pretendard-SemiBold.ttf
  const LOCAL_FONT_PATH = process.env.LOCAL_FONT_PATH ||
    path.join(__dirname, 'Pretendard-SemiBold.ttf');

  let pretendardSemiBoldDataUri = null;
  try {
    if (fs.existsSync(LOCAL_FONT_PATH)) {
      const b64 = fs.readFileSync(LOCAL_FONT_PATH).toString('base64');
      pretendardSemiBoldDataUri = `data:font/ttf;base64,${b64}`;
    }
  } catch {}

  const html = renderOtpHtml('채영', '123456', 5, {
    logoDataUri,
    pretendardSemiBoldDataUri,
  });

  const out = path.join(__dirname, 'otp_preview.html');
  fs.writeFileSync(out, html, 'utf8');

  console.log('✅ otp_preview.html 파일이 생성되었습니다.');
  console.log('👉 파일을 크롬/엣지로 열어 디자인을 확인하세요.');
  console.log('   로고 경로 바꾸기:  LOCAL_LOGO_PATH="C:\\\\Users\\\\office\\\\Downloads\\\\전달사항\\\\malmungchi.png"');
  console.log('   폰트 경로 바꾸기:  LOCAL_FONT_PATH="C:\\\\Users\\\\office\\\\Downloads\\\\전달사항\\\\Pretendard-SemiBold.ttf"');
}
