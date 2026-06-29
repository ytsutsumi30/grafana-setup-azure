/**
 * OCR AI補正APIルート
 * 
 * LLM (OpenAI/Claude/Gemini) を使用してOCR結果を文脈的に補正
 */

const express = require('express');
const router = express.Router();

/**
 * POST /api/ocr-ai/correct
 * 
 * OCR結果をAIで補正
 * 
 * Body:
 * {
 *   "text": "OCRで抽出されたテキスト",
 *   "context": "invoice|receipt|form|shipping",
 *   "expectedFields": ["商品名", "数量", "金額"],
 *   "language": "ja|en"
 * }
 */
router.post('/correct', async (req, res) => {
  try {
    const { text, context = 'default', expectedFields = [], language = 'ja' } = req.body;
    
    if (!text) {
      return res.status(400).json({
        success: false,
        error: 'テキストが必要です'
      });
    }
    
    console.log(`[OCR AI] 補正開始: context=${context}, language=${language}`);
    
    // AI補正（現時点ではルールベース、後でLLM統合）
    const corrected = await correctWithRules(text, context, expectedFields, language);
    
    res.json({
      success: true,
      original: text,
      corrected: corrected.text,
      changes: corrected.changes,
      confidence: corrected.confidence
    });
    
  } catch (error) {
    console.error('[OCR AI] エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'AI補正中にエラーが発生しました'
    });
  }
});

/**
 * POST /api/ocr-ai/extract
 * 
 * OCRテキストから構造化データを抽出
 * 
 * Body:
 * {
 *   "text": "OCRテキスト",
 *   "schema": {
 *     "商品名": "string",
 *     "数量": "number",
 *     "金額": "number"
 *   }
 * }
 */
router.post('/extract', async (req, res) => {
  try {
    const { text, schema } = req.body;
    
    if (!text || !schema) {
      return res.status(400).json({
        success: false,
        error: 'テキストとスキーマが必要です'
      });
    }
    
    console.log('[OCR AI] データ抽出開始');
    
    const extracted = await extractStructuredData(text, schema);
    
    res.json({
      success: true,
      data: extracted.data,
      confidence: extracted.confidence
    });
    
  } catch (error) {
    console.error('[OCR AI] 抽出エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'データ抽出中にエラーが発生しました'
    });
  }
});

/**
 * ルールベース補正
 */
async function correctWithRules(text, context, expectedFields, language) {
  let correctedText = text;
  const changes = [];
  
  // 日本語の一般的な誤認識パターン
  const jaPatterns = {
    // 数字の誤認識
    'O': '0',
    'o': '0',
    'l': '1',
    'I': '1',
    'S': '5',
    'Z': '2',
    'B': '8',
    
    // カタカナの誤認識
    '力': 'カ',
    '夕': 'タ',
    '卜': 'ト',
    '二': 'ニ',
    '工': 'エ',
    '口': 'ロ',
    
    // よくある文字列
    '株式会祉': '株式会社',
    '電話番號': '電話番号',
    '住所': '住所'
  };
  
  // 英語の一般的な誤認識パターン
  const enPatterns = {
    'rn': 'm',
    'vv': 'w',
    '0O': '00',
    '1l': '11'
  };
  
  const patterns = language === 'ja' ? jaPatterns : enPatterns;
  
  // パターン適用
  Object.entries(patterns).forEach(([wrong, correct]) => {
    if (correctedText.includes(wrong)) {
      correctedText = correctedText.replace(new RegExp(wrong, 'g'), correct);
      changes.push({ from: wrong, to: correct });
    }
  });
  
  // コンテキスト固有の補正
  if (context === 'invoice') {
    correctedText = correctInvoice(correctedText, changes);
  } else if (context === 'shipping') {
    correctedText = correctShipping(correctedText, changes);
  }
  
  // 信頼度計算（変更数から推定）
  const confidence = Math.max(70, 100 - changes.length * 5);
  
  return {
    text: correctedText,
    changes,
    confidence
  };
}

/**
 * 請求書固有の補正
 */
function correctInvoice(text, changes) {
  let corrected = text;
  
  // 金額フォーマット修正
  corrected = corrected.replace(/(\d+),(\d{3})/g, '$1$2');
  corrected = corrected.replace(/[円¥]/g, '円');
  
  // 日付フォーマット修正
  corrected = corrected.replace(/(\d{4})[年/](\d{1,2})[月/](\d{1,2})/g, '$1/$2/$3');
  
  return corrected;
}

/**
 * 出荷伝票固有の補正
 */
function correctShipping(text, changes) {
  let corrected = text;
  
  // 数量の修正
  corrected = corrected.replace(/個数:|個数/g, '数量:');
  
  // 郵便番号フォーマット
  corrected = corrected.replace(/〒?(\d{3})[-−]?(\d{4})/g, '〒$1-$2');
  
  return corrected;
}

/**
 * 構造化データ抽出
 */
async function extractStructuredData(text, schema) {
  const data = {};
  const lines = text.split('\n').filter(line => line.trim());
  
  // スキーマの各フィールドを抽出
  Object.entries(schema).forEach(([fieldName, fieldType]) => {
    // フィールド名を含む行を検索
    const line = lines.find(l => l.includes(fieldName));
    
    if (line) {
      // フィールド値を抽出
      const value = extractValue(line, fieldName, fieldType);
      if (value !== null) {
        data[fieldName] = value;
      }
    }
  });
  
  // 信頼度: 抽出できたフィールド数 / 期待フィールド数
  const confidence = (Object.keys(data).length / Object.keys(schema).length) * 100;
  
  return {
    data,
    confidence
  };
}

/**
 * 値の抽出
 */
function extractValue(line, fieldName, fieldType) {
  // フィールド名以降のテキストを取得
  const parts = line.split(fieldName);
  if (parts.length < 2) return null;
  
  let valueText = parts[1].trim();
  
  // 区切り文字を削除
  valueText = valueText.replace(/^[:：]\s*/, '');
  
  // 型に応じて変換
  switch (fieldType) {
    case 'number':
      const num = valueText.match(/[\d,]+/);
      return num ? parseInt(num[0].replace(/,/g, '')) : null;
      
    case 'currency':
      const currency = valueText.match(/[\d,]+/);
      return currency ? parseInt(currency[0].replace(/,/g, '')) : null;
      
    case 'date':
      const date = valueText.match(/\d{4}[/-]\d{1,2}[/-]\d{1,2}/);
      return date ? date[0] : null;
      
    case 'string':
    default:
      // 次の区切りまで、または行末まで
      return valueText.split(/\s{2,}|[,，、]/)[0].trim();
  }
}

/**
 * LLM統合（未実装 - 将来拡張用）
 */
async function correctWithLLM(text, context, expectedFields) {
  // OpenAI/Claude/Gemini APIを使用してOCR結果を補正
  // 環境変数でAPIキーを設定
  
  throw new Error('LLM統合は未実装です。ルールベース補正を使用してください。');
}

module.exports = router;
