/**
 * OCRフィードバックAPI。入力検証・共有DBプール・共通ロガーを使用する。
 * フィードバック本文と学習データは業務情報を含み得るため、参照APIは管理者限定。
 */
const express = require('express');
const Joi = require('joi');
const sharedPool = require('../lib/db');
const sharedLogger = require('../lib/logger');

const feedbackSchema = Joi.object({
  engine: Joi.string().trim().max(50).required(),
  originalText: Joi.string().max(20000).required(),
  correctedText: Joi.string().max(20000).required(),
  confidence: Joi.number().min(0).max(100).allow(null),
  imageHash: Joi.string().trim().max(64).pattern(/^[a-fA-F0-9]+$/).allow('', null),
  documentType: Joi.string().trim().max(50).default('unknown')
});

const statsQuerySchema = Joi.object({
  engine: Joi.string().trim().max(50),
  documentType: Joi.string().trim().max(50),
  days: Joi.number().integer().min(1).max(366).default(30)
});

const trainingQuerySchema = Joi.object({
  minAccuracy: Joi.number().min(0).max(100).default(90),
  limit: Joi.number().integer().min(1).max(500).default(100)
});

function invalid(res, details) {
  return res.status(400).json({ success: false, error: 'Invalid request', details: details.map((detail) => detail.message) });
}

function calculateAccuracy(original, corrected) {
  const distance = levenshteinDistance(original, corrected);
  const maxLen = Math.max(original.length, corrected.length);
  return maxLen === 0 ? 100 : ((maxLen - distance) / maxLen) * 100;
}

function levenshteinDistance(str1, str2) {
  let previous = Array.from({ length: str1.length + 1 }, (_, index) => index);
  for (let row = 1; row <= str2.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= str1.length; column += 1) {
      current[column] = str2[row - 1] === str1[column - 1]
        ? previous[column - 1]
        : Math.min(previous[column - 1] + 1, current[column - 1] + 1, previous[column] + 1);
    }
    previous = current;
  }
  return previous[str1.length];
}

module.exports = function createOcrFeedbackRoutes({ pool = sharedPool, logger = sharedLogger, requireAdmin = (_req, _res, next) => next() } = {}) {
  const router = express.Router();

  router.post('/submit', async (req, res) => {
    const { value, error } = feedbackSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) return invalid(res, error.details);

    try {
      const accuracy = calculateAccuracy(value.originalText, value.correctedText);
      const result = await pool.query(
        `INSERT INTO ocr_feedbacks (
          engine, original_text, corrected_text, confidence, accuracy, image_hash, document_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [value.engine, value.originalText, value.correctedText, value.confidence, accuracy, value.imageHash, value.documentType]
      );
      logger.info('OCR feedback saved', { feedbackId: result.rows[0].id, engine: value.engine, accuracy });
      return res.status(201).json({ success: true, feedbackId: result.rows[0].id, accuracy });
    } catch (error) {
      logger.error('OCR feedback save failed', { error: error.message });
      return res.status(500).json({ success: false, error: 'Failed to save OCR feedback' });
    }
  });

  router.get('/stats', requireAdmin, async (req, res) => {
    const { value, error } = statsQuerySchema.validate(req.query, { abortEarly: false, convert: true });
    if (error) return invalid(res, error.details);
    try {
      const values = [value.days];
      const conditions = ["created_at >= NOW() - make_interval(days => $1::int)"];
      if (value.engine) { values.push(value.engine); conditions.push(`engine = $${values.length}`); }
      if (value.documentType) { values.push(value.documentType); conditions.push(`document_type = $${values.length}`); }
      const result = await pool.query(
        `SELECT engine, document_type, COUNT(*)::int AS total_feedbacks,
                AVG(accuracy) AS avg_accuracy, AVG(confidence) AS avg_confidence,
                MIN(created_at) AS first_feedback, MAX(created_at) AS last_feedback
           FROM ocr_feedbacks WHERE ${conditions.join(' AND ')}
          GROUP BY engine, document_type ORDER BY avg_accuracy DESC`,
        values
      );
      return res.json({ success: true, stats: result.rows.map((row) => ({
        engine: row.engine,
        documentType: row.document_type,
        totalFeedbacks: row.total_feedbacks,
        avgAccuracy: Number(row.avg_accuracy).toFixed(2),
        avgConfidence: row.avg_confidence === null ? null : Number(row.avg_confidence).toFixed(2),
        firstFeedback: row.first_feedback,
        lastFeedback: row.last_feedback
      })) });
    } catch (error) {
      logger.error('OCR feedback statistics failed', { error: error.message });
      return res.status(500).json({ success: false, error: 'Failed to load OCR feedback statistics' });
    }
  });

  router.get('/improvements', requireAdmin, async (req, res) => {
    const { value, error } = trainingQuerySchema.validate(req.query, { abortEarly: false, convert: true });
    if (error) return invalid(res, error.details);
    try {
      const result = await pool.query(
        `WITH corrections AS (
           SELECT original_text, corrected_text, COUNT(*)::int AS frequency
             FROM ocr_feedbacks WHERE original_text <> corrected_text
            GROUP BY original_text, corrected_text HAVING COUNT(*) >= 2
         ) SELECT original_text, corrected_text, frequency
             FROM corrections ORDER BY frequency DESC LIMIT $1`,
        [value.limit]
      );
      return res.json({ success: true, patterns: result.rows.map((row) => ({ from: row.original_text, to: row.corrected_text, frequency: row.frequency })) });
    } catch (error) {
      logger.error('OCR feedback improvements failed', { error: error.message });
      return res.status(500).json({ success: false, error: 'Failed to load OCR feedback improvements' });
    }
  });

  router.get('/training-data', requireAdmin, async (req, res) => {
    const { value, error } = trainingQuerySchema.validate(req.query, { abortEarly: false, convert: true });
    if (error) return invalid(res, error.details);
    try {
      const result = await pool.query(
        `SELECT id, engine, original_text, corrected_text, confidence, accuracy, image_hash, document_type, created_at
           FROM ocr_feedbacks WHERE accuracy >= $1 ORDER BY created_at DESC LIMIT $2`,
        [value.minAccuracy, value.limit]
      );
      return res.json({ success: true, count: result.rows.length, trainingData: result.rows });
    } catch (error) {
      logger.error('OCR feedback training data failed', { error: error.message });
      return res.status(500).json({ success: false, error: 'Failed to load OCR training data' });
    }
  });

  return router;
};

module.exports.calculateAccuracy = calculateAccuracy;
