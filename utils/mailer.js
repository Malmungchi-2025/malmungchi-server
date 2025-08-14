// utils/mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST, // smtp.gmail.com or smtp.naver.com
  port: Number(process.env.SMTP_PORT || 587),
  secure: false, // 465면 true, 587이면 false
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

exports.sendMail = async ({ to, subject, html }) => {
  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    html,
    // 스팸 방지용 헤더
    headers: {
      'X-Mailer': 'Malmungchi-Mailer', // 고유 값
      'Precedence': 'bulk', // 대량메일 아님 표시: 필요시 제거
    },
    replyTo: process.env.MAIL_FROM || process.env.SMTP_USER,
  });
};
