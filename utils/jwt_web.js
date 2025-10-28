const jwt = require("jsonwebtoken");

exports.sign = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "30d",
  });

exports.verify = (token) => jwt.verify(token, process.env.JWT_SECRET);
