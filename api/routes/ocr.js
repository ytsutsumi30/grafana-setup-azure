/**
 * OCR APIルート
 * 
 * AWS Textract & GCP Document AIを使用したテキスト抽出エンドポイント
 */

const express = require('express');
const router = express.Router();
const textractService = require('../services/textract');
const documentaiService = require('../services/documentai');

/**
 * POST /api/ocr/textract
 * 
 * AWS Textractで基本的なテキスト抽出
 * 
 * Body:
 * {
 *   "image": "base64エンコードされた画像データ",
 *   "documentType": "invoice|receipt|form|default"  // オプション
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "text": "抽出されたテキスト",
 *   "lines": [...],
 *   "confidence": 95.5,
 *   "processingTime": 1234
 * }
 */
router.post('/textract', async (req, res) => {
  try {
    const { image, documentType = 'default' } = req.body;
    
    // バリデーション
    if (!image) {
      return res.status(400).json({
        success: false,
        error: '画像データが必要です'
      });
    }
    
    console.log(`[OCR API] Textract処理開始: documentType=${documentType}`);
    
    // Base64 → Buffer変換
    const imageBuffer = textractService.base64ToBuffer(image);
    
    // 画像サイズチェック（10MB制限）
    if (imageBuffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        error: '画像サイズが大きすぎます（最大10MB）'
      });
    }
    
    // Textract実行
    const result = await textractService.detectText(imageBuffer);
    
    console.log(`[OCR API] 処理成功: 信頼度=${result.confidence.toFixed(2)}%, 処理時間=${result.processingTime}ms`);
    
    // 信頼度が低い場合は警告
    if (result.confidence < 80) {
      result.warning = '読み取り精度が低い可能性があります。画像の品質を改善してください。';
    }
    
    res.json({
      success: true,
      text: result.text,
      lines: result.lines,
      confidence: result.confidence,
      processingTime: result.processingTime,
      warning: result.warning
    });
    
  } catch (error) {
    console.error('[OCR API] エラー:', error);
    
    res.status(500).json({
      success: false,
      error: error.message || 'Textract処理中にエラーが発生しました',
      errorName: error.name
    });
  }
});

/**
 * POST /api/ocr/textract/analyze
 * 
 * AWS Textractで高度な文書分析（表・フォーム認識）
 * 
 * Body:
 * {
 *   "image": "base64エンコードされた画像データ",
 *   "features": ["TABLES", "FORMS"]  // オプション
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "text": "抽出されたテキスト",
 *   "tables": [...],
 *   "forms": { "住所": "東京都...", ... },
 *   "confidence": 95.5
 * }
 */
router.post('/textract/analyze', async (req, res) => {
  try {
    const { image, features = ['TABLES', 'FORMS'] } = req.body;
    
    // バリデーション
    if (!image) {
      return res.status(400).json({
        success: false,
        error: '画像データが必要です'
      });
    }
    
    // 機能タイプのバリデーション
    const validFeatures = ['TABLES', 'FORMS'];
    const invalidFeatures = features.filter(f => !validFeatures.includes(f));
    if (invalidFeatures.length > 0) {
      return res.status(400).json({
        success: false,
        error: `無効な機能タイプ: ${invalidFeatures.join(', ')}`,
        validFeatures: validFeatures
      });
    }
    
    console.log(`[OCR API] Textract分析開始: features=${features.join(', ')}`);
    
    // Base64 → Buffer変換
    const imageBuffer = textractService.base64ToBuffer(image);
    
    // 画像サイズチェック
    if (imageBuffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        error: '画像サイズが大きすぎます（最大10MB）'
      });
    }
    
    // Textract分析実行
    const result = await textractService.analyzeDocument(imageBuffer, features);
    
    console.log(`[OCR API] 分析成功: 表=${result.tables.length}個, フォーム=${Object.keys(result.forms).length}個`);
    
    res.json({
      success: true,
      text: result.text,
      lines: result.lines,
      tables: result.tables,
      forms: result.forms,
      confidence: result.confidence,
      processingTime: result.processingTime
    });
    
  } catch (error) {
    console.error('[OCR API] 分析エラー:', error);
    
    res.status(500).json({
      success: false,
      error: error.message || 'Textract分析中にエラーが発生しました',
      errorName: error.name
    });
  }
});

/**
 * GET /api/ocr/health
 * 
 * ヘルスチェックエンドポイント
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'OCR API',
    textractAvailable: true,
    documentaiAvailable: documentaiService.isAvailable(),
    region: process.env.AWS_REGION,
    gcpRegion: process.env.GCP_REGION,
    timestamp: new Date().toISOString()
  });
});

/**
 * POST /api/ocr/documentai
 * 
 * GCP Document AIで基本的なテキスト抽出
 * 
 * Body:
 * {
 *   "image": "base64エンコードされた画像データ",
 *   "mimeType": "image/png|image/jpeg"  // オプション
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "text": "抽出されたテキスト",
 *   "pages": [...],
 *   "confidence": 95.5,
 *   "processingTime": 1234
 * }
 */
router.post('/documentai', async (req, res) => {
  try {
    // Document AIの利用可能性チェック
    if (!documentaiService.isAvailable()) {
      return res.status(503).json({
        success: false,
        error: 'Document AIが設定されていません。環境変数を確認してください。',
        requiredEnvVars: ['GCP_PROJECT_ID', 'DOCUMENTAI_PROCESSOR_ID']
      });
    }

    const { image, mimeType = 'image/png' } = req.body;
    
    // バリデーション
    if (!image) {
      return res.status(400).json({
        success: false,
        error: '画像データが必要です'
      });
    }
    
    console.log(`[OCR API] Document AI処理開始: mimeType=${mimeType}`);
    
    // Base64 → Buffer変換
    const imageBuffer = documentaiService.base64ToBuffer(image);
    
    // 画像サイズチェック（20MB制限）
    if (imageBuffer.length > 20 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        error: '画像サイズが大きすぎます（最大20MB）'
      });
    }
    
    // Document AI実行
    const result = await documentaiService.processDocument(imageBuffer, mimeType);
    
    console.log(`[OCR API] 処理成功: 信頼度=${result.confidence}%, 処理時間=${result.processingTime}ms`);
    
    // 信頼度が低い場合は警告
    if (result.confidence < 80) {
      result.warning = '読み取り精度が低い可能性があります。画像の品質を改善してください。';
    }
    
    res.json(result);
    
  } catch (error) {
    console.error('[OCR API] Document AIエラー:', error);
    
    res.status(500).json({
      success: false,
      error: error.message || 'Document AI処理中にエラーが発生しました',
      errorName: error.name
    });
  }
});

/**
 * POST /api/ocr/documentai/analyze
 * 
 * GCP Document AIで高度な文書分析（表・フォーム認識）
 * 
 * Body:
 * {
 *   "image": "base64エンコードされた画像データ",
 *   "mimeType": "image/png|image/jpeg"  // オプション
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "text": "抽出されたテキスト",
 *   "tables": [...],
 *   "formFields": [...],
 *   "processingTime": 1234
 * }
 */
router.post('/documentai/analyze', async (req, res) => {
  try {
    // Document AIの利用可能性チェック
    if (!documentaiService.isAvailable()) {
      return res.status(503).json({
        success: false,
        error: 'Document AIが設定されていません',
        requiredEnvVars: ['GCP_PROJECT_ID', 'DOCUMENTAI_PROCESSOR_ID']
      });
    }

    const { image, mimeType = 'image/png' } = req.body;
    
    // バリデーション
    if (!image) {
      return res.status(400).json({
        success: false,
        error: '画像データが必要です'
      });
    }
    
    console.log(`[OCR API] Document AI分析開始`);
    
    // Base64 → Buffer変換
    const imageBuffer = documentaiService.base64ToBuffer(image);
    
    // 画像サイズチェック
    if (imageBuffer.length > 20 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        error: '画像サイズが大きすぎます（最大20MB）'
      });
    }
    
    // Document AI分析実行
    const result = await documentaiService.analyzeDocument(imageBuffer, mimeType);
    
    console.log(`[OCR API] 分析成功: 表=${result.tables.length}個, フォーム=${result.formFields.length}個`);
    
    res.json(result);
    
  } catch (error) {
    console.error('[OCR API] Document AI分析エラー:', error);
    
    res.status(500).json({
      success: false,
      error: error.message || 'Document AI分析中にエラーが発生しました',
      errorName: error.name
    });
  }
});

/**
 * POST /api/ocr/hybrid
 * 
 * ハイブリッドOCR（Textract + Document AI）
 * プライマリエンジンで処理し、信頼度が低い場合はフォールバック
 * 
 * Body:
 * {
 *   "image": "base64エンコードされた画像データ",
 *   "primaryEngine": "textract|documentai",  // オプション（デフォルト: textract）
 *   "confidenceThreshold": 85  // オプション（デフォルト: 85）
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "text": "抽出されたテキスト",
 *   "confidence": 95.5,
 *   "engine": "textract",
 *   "fallbackUsed": false,
 *   "processingTime": 1234
 * }
 */
router.post('/hybrid', async (req, res) => {
  try {
    const { 
      image, 
      primaryEngine = process.env.OCR_DEFAULT_ENGINE || 'textract',
      confidenceThreshold = parseInt(process.env.OCR_CONFIDENCE_THRESHOLD || '85')
    } = req.body;
    
    // バリデーション
    if (!image) {
      return res.status(400).json({
        success: false,
        error: '画像データが必要です'
      });
    }

    if (!['textract', 'documentai'].includes(primaryEngine)) {
      return res.status(400).json({
        success: false,
        error: '無効なエンジン指定',
        validEngines: ['textract', 'documentai']
      });
    }

    console.log(`[OCR API] ハイブリッドOCR開始: primary=${primaryEngine}, threshold=${confidenceThreshold}`);

    let result;
    let usedEngine = primaryEngine;
    let fallbackUsed = false;

    // プライマリエンジンで処理
    if (primaryEngine === 'textract') {
      const imageBuffer = textractService.base64ToBuffer(image);
      result = await textractService.detectText(imageBuffer);
    } else {
      // Document AIチェック
      if (!documentaiService.isAvailable()) {
        return res.status(503).json({
          success: false,
          error: 'Document AIが設定されていません'
        });
      }
      const imageBuffer = documentaiService.base64ToBuffer(image);
      result = await documentaiService.processDocument(imageBuffer);
    }

    // 信頼度が閾値未満の場合、代替エンジンにフォールバック
    if (result.confidence < confidenceThreshold) {
      console.log(`[OCR API] 信頼度${result.confidence}%が閾値${confidenceThreshold}%未満、フォールバック実行`);
      
      const fallbackEngine = primaryEngine === 'textract' ? 'documentai' : 'textract';
      
      try {
        let fallbackResult;
        
        if (fallbackEngine === 'textract') {
          const imageBuffer = textractService.base64ToBuffer(image);
          fallbackResult = await textractService.detectText(imageBuffer);
        } else {
          if (!documentaiService.isAvailable()) {
            console.log('[OCR API] Document AI利用不可、プライマリ結果を返却');
          } else {
            const imageBuffer = documentaiService.base64ToBuffer(image);
            fallbackResult = await documentaiService.processDocument(imageBuffer);
          }
        }

        // より高い信頼度の結果を採用
        if (fallbackResult && fallbackResult.confidence > result.confidence) {
          console.log(`[OCR API] フォールバック成功: ${fallbackEngine}の信頼度${fallbackResult.confidence}%を採用`);
          result = fallbackResult;
          usedEngine = fallbackEngine;
          fallbackUsed = true;
        }
      } catch (fallbackError) {
        console.error('[OCR API] フォールバックエラー、プライマリ結果を返却:', fallbackError.message);
      }
    }

    res.json({
      ...result,
      engine: usedEngine,
      fallbackUsed,
      primaryEngine,
      confidenceThreshold
    });

  } catch (error) {
    console.error('[OCR API] ハイブリッドOCRエラー:', error);
    
    res.status(500).json({
      success: false,
      error: error.message || 'ハイブリッドOCR処理中にエラーが発生しました',
      errorName: error.name
    });
  }
});

module.exports = router;
