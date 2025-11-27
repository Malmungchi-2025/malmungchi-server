//카카오톡 로그인 api 구현
import express from "express";
import axios from "axios";
import jwt from "jsonwebtoken";
import db from "../db.js"; // pg Pool

const router = express.Router();

// 1) 카카오 로그인 시작
router.get("/kakao", (req, res) => {
  const kakaoURL = `https://kauth.kakao.com/oauth/authorize?response_type=code&client_id=${process.env.KAKAO_REST_API_KEY}&redirect_uri=${process.env.KAKAO_REDIRECT_URI}`;
  res.redirect(kakaoURL);
});

// 2) 카카오 callback
router.get("/kakao/callback", async (req, res) => {
  const { code } = req.query;

  try {
    // 1. access_token 요청
    const tokenResp = await axios.post(
      "https://kauth.kakao.com/oauth/token",
      null,
      {
        params: {
          grant_type: "authorization_code",
          client_id: process.env.KAKAO_REST_API_KEY,
          redirect_uri: process.env.KAKAO_REDIRECT_URI,
          code,
        },
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
        },
      }
    );

    const accessToken = tokenResp.data.access_token;

    // 2. 사용자 정보 요청
    const userResp = await axios.get(
      "https://kapi.kakao.com/v2/user/me",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    const kakao = userResp.data;
    const kakaoId = String(kakao.id);
    const email = kakao.kakao_account?.email ?? null;
    const nickname = kakao.properties?.nickname ?? "카카오사용자";
    const profileImage = kakao.properties?.profile_image ?? null;

    // email/password/name 은 NULL 허용 안됨
    const finalEmail = email || `kakao_${kakaoId}@social.com`;
    const finalPassword = "SOCIAL_LOGIN";
    const finalName = nickname;

    // 3. DB에서 이미 있는지 확인
    const findUserQuery = `
      SELECT * FROM users WHERE kakao_id = $1 LIMIT 1
    `;
    const { rows } = await db.query(findUserQuery, [kakaoId]);
    let user = rows[0];

    // 4. 없으면 새로 생성
    if (!user) {
      const insertQuery = `
        INSERT INTO users (email, password, name, kakao_id, profile_image)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `;
      const insertValues = [
        finalEmail,
        finalPassword,
        finalName,
        kakaoId,
        profileImage,
      ];
      const result = await db.query(insertQuery, insertValues);
      user = result.rows[0];
    }

    // 5. JWT 생성
    const jwtToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({
      success: true,
      message: "카카오 로그인 성공",
      token: jwtToken,
      user,
    });
  } catch (err) {
    console.error("카카오 로그인 에러:", err);
    return res.status(500).json({
      success: false,
      message: "카카오 로그인 처리 중 오류 발생",
    });
  }
});

export default router;
