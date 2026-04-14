// routes/pdfRoutes.js
'use strict';

const express = require('express');
const multer = require('multer');
const pdfIngestionService = require('../services/pdfIngestionService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * POST /api/pdf/upload
 * Accepts multipart/form-data with field "file" (PDF).
 * Returns { success, docUuid, chunkCount, pageCount }
 */
router.post('/pdf/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    const { docUuid, chunkCount, pageCount } = await pdfIngestionService.ingest(
      req.file.buffer,
      req.file.originalname
    );
    return res.json({ success: true, docUuid, chunkCount, pageCount });
  } catch (err) {
    console.error('[pdfRoutes] upload error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/pdf/:docUuid/summary
 * Returns { success, summary }
 */
router.get('/pdf/:docUuid/summary', async (req, res) => {
  try {
    const { docUuid } = req.params;
    const summary = await pdfIngestionService.getSummary(docUuid);
    return res.json({ success: true, summary });
  } catch (err) {
    console.error('[pdfRoutes] summary error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
