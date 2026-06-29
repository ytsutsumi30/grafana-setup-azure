/**
 * OCRフィードバックAPIルート
 * 
 * ユーザー修正を学習データとして蓄積
 */

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

// PostgreSQL接続プール
const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'admin',
  password: process.env.DB_PASSWORD || 'admin123',
  database: process.env.DB_NAME || 'shipping_db'
});

/**
 * POST /api/ocr-feedback/submit
 * 
 * フィードバックを送信
 * 
 * Body:
 * {
 *   "engine": "tesseract-enhanced",
 *   "originalText": "OCRで抽出されたテキスト",
 *   "correctedText": "ユーザーが修正したテキスト",
 *   "confidence": 85.5,
 *   "imageHash": "abc123...",
 *   "documentType": "invoice"
 * }
 */
router.post('/submit', async (req, res) => {
  try {
    const {
      engine,
      originalText,
      correctedText,
      confidence,
      imageHash,
      documentType = 'unknown'
    } = req.body;
    
    if (!engine || !originalText || !correctedText) {
      return res.status(400).json({
        success: false,
        error: '必須パラメータが不足しています'
      });
    }
    
    // 精度計算
    const accuracy = calculateAccuracy(originalText, correctedText);
    
    // DBに保存
    const query = `
      INSERT INTO ocr_feedbacks (
        engine, original_text, corrected_text, confidence, accuracy,
        image_hash, document_type, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING id
    `;
    
    const values = [
      engine,
      originalText,
      correctedText,
      confidence,
      accuracy,
      imageHash,
      documentType
    ];
    
    const result = await pool.query(query, values);
    
    console.log(`[OCR Feedback] 保存完了: ID=${result.rows[0].id}, accuracy=${accuracy.toFixed(2)}%`);
    
    res.json({
      success: true,
      feedbackId: result.rows[0].id,
      accuracy
    });
    
  } catch (error) {
    console.error('[OCR Feedback] エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'フィードバック送信中にエラーが発生しました'
    });
  }
});

/**
 * GET /api/ocr-feedback/stats
 * 
 * フィードバック統計を取得
 */
router.get('/stats', async (req, res) => {
  try {
    const { engine, documentType, days = 30 } = req.query;
    
    let query = `
      SELECT
        engine,
        document_type,
        COUNT(*) as total_feedbacks,
        AVG(accuracy) as avg_accuracy,
        AVG(confidence) as avg_confidence,
        MIN(created_at) as first_feedback,
        MAX(created_at) as last_feedback
      FROM ocr_feedbacks
      WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
    `;
    
    const conditions = [];
    const values = [];
    
    if (engine) {
      conditions.push(`engine = $${values.length + 1}`);
      values.push(engine);
    }
    
    if (documentType) {
      conditions.push(`document_type = $${values.length + 1}`);
      values.push(documentType);
    }
    
    if (conditions.length > 0) {
      query += ' AND ' + conditions.join(' AND ');
    }
    
    query += ' GROUP BY engine, document_type ORDER BY avg_accuracy DESC';
    
    const result = await pool.query(query, values);
    
    res.json({
      success: true,
      stats: result.rows.map(row => ({
        engine: row.engine,
        documentType: row.document_type,
        totalFeedbacks: parseInt(row.total_feedbacks),
        avgAccuracy: parseFloat(row.avg_accuracy).toFixed(2),
        avgConfidence: parseFloat(row.avg_confidence).toFixed(2),
        firstFeedback: row.first_feedback,
        lastFeedback: row.last_feedback
      }))
    });
    
  } catch (error) {
    console.error('[OCR Feedback] 統計取得エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message || '統計取得中にエラーが発生しました'
    });
  }
});

/**
 * GET /api/ocr-feedback/improvements
 * 
 * よくある修正パターンを取得
 */
router.get('/improvements', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    
    // よくある誤認識パターンを抽出
    const query = `
      WITH corrections AS (
        SELECT
          original_text,
          corrected_text,
          COUNT(*) as frequency
        FROM ocr_feedbacks
        WHERE original_text != corrected_text
        GROUP BY original_text, corrected_text
        HAVING COUNT(*) >= 2
      )
      SELECT *
      FROM corrections
      ORDER BY frequency DESC
      LIMIT $1
    `;
    
    const result = await pool.query(query, [parseInt(limit)]);
    
    res.json({
      success: true,
      patterns: result.rows.map(row => ({
        from: row.original_text,
        to: row.corrected_text,
        frequency: parseInt(row.frequency)
      }))
    });
    
  } catch (error) {
    console.error('[OCR Feedback] パターン取得エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'パターン取得中にエラーが発生しました'
    });
  }
});

/**
 * GET /api/ocr-feedback/training-data
 * 
 * 学習データとして使用可能なフィードバックを取得
 */
router.get('/training-data', async (req, res) => {
  try {
    const { minAccuracy = 90, limit = 100 } = req.query;
    
    const query = `
      SELECT
        id,
        engine,
        original_text,
        corrected_text,
        confidence,
        accuracy,
        image_hash,
        document_type,
        created_at
      FROM ocr_feedbacks
      WHERE accuracy >= $1
      ORDER BY created_at DESC
      LIMIT $2
    `;
    
    const result = await pool.query(query, [parseFloat(minAccuracy), parseInt(limit)]);
    
    res.json({
      success: true,
      count: result.rows.length,
      trainingData: result.rows
    });
    
  } catch (error) {
    console.error('[OCR Feedback] 学習データ取得エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message || '学習データ取得中にエラーが発生しました'
    });
  }
});

/**
 * 精度計算 (文字レベル)
 */
function calculateAccuracy(original, corrected) {
  const distance = levenshteinDistance(original, corrected);
  const maxLen = Math.max(original.length, corrected.length);
  
  if (maxLen === 0) return 100;
  
  return ((maxLen - distance) / maxLen) * 100;
}

/**
 * Levenshtein距離
 */
function levenshteinDistance(str1, str2) {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

/**
 * テーブル初期化SQL
 */
const initTableSQL = `
CREATE TABLE IF NOT EXISTS ocr_feedbacks (
  id SERIAL PRIMARY KEY,
  engine VARCHAR(50) NOT NULL,
  original_text TEXT NOT NULL,
  corrected_text TEXT NOT NULL,
  confidence FLOAT,
  accuracy FLOAT,
  image_hash VARCHAR(64),
  document_type VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_engine (engine),
  INDEX idx_document_type (document_type),
  INDEX idx_created_at (created_at)
);
`;

// アプリ起動時にテーブルを作成
pool.query(initTableSQL).catch(err => {
  console.warn('[OCR Feedback] テーブル作成警告:', err.message);
});

module.exports = router;
