-- 🎯 Malmungchi DB 초기 스크립트 (최신 스키마 반영)

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    nickname VARCHAR(50),
    role VARCHAR(50) DEFAULT 'USER',
    status VARCHAR(20) DEFAULT 'ACTIVE',
    is_verified BOOLEAN DEFAULT FALSE,
    inactive_date TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- 레벨/포인트
    level INT DEFAULT 0,
    point INT DEFAULT 0,

    -- 별명 테스트 스코어 및 티어
    vocab_tier VARCHAR(10),
    reading_tier VARCHAR(10),
    vocab_correct INT,
    reading_correct INT,
    nickname_title VARCHAR(50),
    nickname_updated_at TIMESTAMP,

    -- 아바타 및 프로필 이미지
    avatar_name VARCHAR(50) DEFAULT 'img_malchi',
    profile_image TEXT,

    -- 친구코드
    friend_code VARCHAR(20),

    -- 배지 JSON
    badges JSONB DEFAULT '{}'::jsonb,

    -- 랭킹 관련
    first_rank_date DATE,
    rank_streak INT DEFAULT 0,

    -- 소셜로그인
    kakao_id VARCHAR(50)
);

-- 오늘의 학습
CREATE TABLE IF NOT EXISTS today_study (
    study_id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    progress_step1 BOOLEAN DEFAULT FALSE,
    progress_step2 BOOLEAN DEFAULT FALSE,
    progress_step3 BOOLEAN DEFAULT FALSE,
    date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 단어 테이블
CREATE TABLE IF NOT EXISTS vocabulary (
    id SERIAL PRIMARY KEY,
    study_id INT REFERENCES today_study(study_id) ON DELETE CASCADE,
    word VARCHAR(255) NOT NULL,
    meaning TEXT NOT NULL,
    example TEXT,
    is_liked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 퀴즈 테이블
CREATE TABLE IF NOT EXISTS quiz_set (
    id SERIAL PRIMARY KEY,
    study_id INT REFERENCES today_study(study_id) ON DELETE CASCADE,
    question_index INT NOT NULL,
    question TEXT NOT NULL,
    options JSONB NOT NULL,
    answer VARCHAR(255) NOT NULL,
    explanation TEXT,
    user_choice VARCHAR(255),
    is_correct BOOLEAN,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 관리자 기본 계정
INSERT INTO users (email, password, name, role, is_verified)
VALUES (
  'hajin@gmail.com',
  '$2b$10$SCDeWbv1zIQGHQyYRO11d.rD/2qeYsHo84xTytDjsdglw9HvwTEPO',
  'Hajin',
  'ADMIN',
  TRUE
) ON CONFLICT (email) DO NOTHING;
