const { Pool } = require("pg");

const pool = new Pool({
  // user: process.env.PGUSER,
  // host: process.env.PGHOST,
  // database: process.env.PGDATABASE,
  // password: process.env.PGPASSWORD,
  // port: process.env.PGPORT,
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  ssl: { rejectUnauthorized: false }, // Render DB 필수!
});

module.exports = pool;
