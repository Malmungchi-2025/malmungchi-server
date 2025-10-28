const express = require("express");
const {
  getRandomCopyItem,
  getCopyItemById,
} = require("../../controllers/web/copyItemController");
const router = express.Router();

router.get("/recommend", getRandomCopyItem);
router.get("/:id", getCopyItemById);

module.exports = router;
