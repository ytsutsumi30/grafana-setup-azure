/**
 * OCR後処理 - LLM統合用モジュール
 * 
 * OpenAI/Claude APIを使用してOCR結果を文脈から補正
 */

const express = require('express');
const router = express.Router();

/**
 * POST /api/ocr/enhance
 * 
 * LLMを使用してOCR結果を補正
 * 
 * Body:
 * {
 *   "text": "OCRで抽出されたテキスト",
 *   "context": "伝票|請求書|領収書|住所",
 *   "llm": "openai|claude" (オプション)
 * }
 */
router.post('/enhance', async (req, res) => {
  try {
    const { text, context = '一般文書', llm = 'simple' } = req.body;
    
    if (!text) {
      return res.status(400).json({
        success: false,
        error: 'テキストが必要です'
      });
    }
    
    console.log(`[OCR Enhance] 補正開始: context=${context}, llm=${llm}`);
    
    let enhancedText = text;
    
    // シンプルな補正ロジック (LLM APIなし)
    if (llm === 'simple') {
      enhancedText = simpleCorrection(text, context);
    }
    // OpenAI API (未実装 - APIキー必要)
    else if (llm === 'openai') {
      // TODO: OpenAI API統合
      enhancedText = text + '\n[OpenAI補正は未実装]';
    }
    // Claude API (未実装 - APIキー必要)
    else if (llm === 'claude') {
      // TODO: Claude API統合
      enhancedText = text + '\n[Claude補正は未実装]';
    }
    
    res.json({
      success: true,
      originalText: text,
      enhancedText: enhancedText,
      corrections: findCorrections(text, enhancedText),
      context: context,
      llm: llm
    });
    
  } catch (error) {
    console.error('[OCR Enhance] エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * シンプルな補正ロジック (ルールベース)
 */
function simpleCorrection(text, context) {
  let corrected = text;
  
  // 文脈別の補正ルール
  const rules = {
    '伝票': [
      // 数字の誤認識
      { pattern: /O(?=\d)/g, replacement: '0' },
      { pattern: /l(?=\d)/g, replacement: '1' },
      { pattern: /I(?=\d)/g, replacement: '1' },
      { pattern: /S(?=\d)/g, replacement: '5' },
      { pattern: /Z(?=\d)/g, replacement: '2' },
      
      // 金額フォーマット
      { pattern: /¥\s+/g, replacement: '¥' },
      { pattern: /(\d),(\d)/g, replacement: '$1$2' }  // カンマ除去
    ],
    
    '請求書': [
      // 日付フォーマット
      { pattern: /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g, replacement: '$1年$2月$3日' },
      { pattern: /(\d{4})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})/g, replacement: '$1/$2/$3' }
    ],
    
    '住所': [
      // 都道府県
      { pattern: /東京都/g, replacement: '東京都' },
      { pattern: /大阪府/g, replacement: '大阪府' },
      
      // 番地
      { pattern: /(\d+)\s*-\s*(\d+)\s*-\s*(\d+)/g, replacement: '$1-$2-$3' }
    ]
  };
  
  // 共通補正
  const commonRules = [
    // 全角→半角数字
    { pattern: /[０-９]/g, replacement: (match) => String.fromCharCode(match.charCodeAt(0) - 0xFEE0) },
    
    // スペースの統一
    { pattern: /\s+/g, replacement: ' ' },
    
    // カタカナの統一 (ひらがな→カタカナ)
    // 必要に応じて追加
  ];
  
  // 文脈別ルール適用
  const contextRules = rules[context] || [];
  [...commonRules, ...contextRules].forEach(rule => {
    corrected = corrected.replace(rule.pattern, rule.replacement);
  });
  
  return corrected;
}

/**
 * 補正箇所を検出
 */
function findCorrections(original, corrected) {
  const corrections = [];
  
  if (original === corrected) {
    return corrections;
  }
  
  // 簡易的な差分検出
  const originalLines = original.split('\n');
  const correctedLines = corrected.split('\n');
  
  for (let i = 0; i < Math.max(originalLines.length, correctedLines.length); i++) {
    const origLine = originalLines[i] || '';
    const corrLine = correctedLines[i] || '';
    
    if (origLine !== corrLine) {
      corrections.push({
        line: i + 1,
        original: origLine,
        corrected: corrLine
      });
    }
  }
  
  return corrections;
}

module.exports = router;
