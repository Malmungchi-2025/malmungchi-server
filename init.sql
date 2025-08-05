-- 🎯 Malmungchi DB 초기 스크립트

-- 1. Users 테이블
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'USER',
    status VARCHAR(20) DEFAULT 'ACTIVE',
    inactive_date TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. 오늘의 학습 테이블
CREATE TABLE IF NOT EXISTS today_study (
    study_id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    progress_step1 BOOLEAN DEFAULT FALSE,
    progress_step2 BOOLEAN DEFAULT FALSE,
    progress_step3 BOOLEAN DEFAULT FALSE,
    date DATE DEFAULT CURRENT_DATE
);

-- 3. 단어 테이블
CREATE TABLE IF NOT EXISTS vocabulary (
    id SERIAL PRIMARY KEY,
    study_id INT REFERENCES today_study(study_id) ON DELETE CASCADE,
    word VARCHAR(255) NOT NULL,
    meaning TEXT NOT NULL,
    example TEXT,
    date_saved TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. 퀴즈 테이블
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

-- 5. 관리자 계정 (비밀번호는 bcrypt 해시된 값)
INSERT INTO users (email, password, role)
VALUES (
  'hajin@gmail.com',
  '$2b$10$SCDeWbv1zIQGHQyYRO11d.rD/2qeYsHo84xTytDjsdglw9HvwTEPO',
  'ADMIN'
) ON CONFLICT (email) DO NOTHING;