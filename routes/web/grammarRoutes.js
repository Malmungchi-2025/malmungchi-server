const express = require("express");
const { checkGrammar } = require("../../controllers/web/grammarController");

const router = express.Router();
router.post("/", checkGrammar);

module.exports = router;
