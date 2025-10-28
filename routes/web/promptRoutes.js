const express = require("express");
const { getPrompts } = require("../../controllers/web/promptController");
const router = express.Router();

router.get("/", getPrompts);

module.exports = router;
