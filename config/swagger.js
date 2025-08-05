const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Malmungchi API',
      version: '1.0.0',
      description: '📚 Malmungchi 프로젝트 API 명세서',
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: '개발 서버',
      },
      {
        url: 'https://malmungchi-server.onrender.com',
        description: 'Render 배포 서버',
      },
    ],
  },
  apis: ['./routes/*.js'], // ✅ 라우트 파일에서 Swagger 주석 읽음
};

const specs = swaggerJsdoc(options);
module.exports = { swaggerUi, specs };