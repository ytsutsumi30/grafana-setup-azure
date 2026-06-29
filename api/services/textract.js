/**
 * AWS Textract サービスモジュール
 * 
 * AI-OCR機能でAWS Textractを使用してテキスト抽出を行う
 * 伝票・請求書・フォームなどの文書認識に対応
 */

const { TextractClient, DetectDocumentTextCommand, AnalyzeDocumentCommand } = require("@aws-sdk/client-textract");

class TextractService {
  constructor() {
    // AWS Textract クライアント初期化
    this.client = new TextractClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });
    
    console.log(`[Textract] Initialized with region: ${process.env.AWS_REGION || 'us-east-1'}`);
  }
  
  /**
   * 基本的なテキスト抽出
   * DetectDocumentText APIを使用
   * 
   * @param {Buffer} imageBuffer - 画像データ（Buffer形式）
   * @returns {Object} { text, lines, confidence, blocks }
   */
  async detectText(imageBuffer) {
    try {
      console.log('[Textract] DetectDocumentText API呼び出し開始');
      const startTime = Date.now();
      
      const command = new DetectDocumentTextCommand({
        Document: { Bytes: imageBuffer }
      });
      
      const response = await this.client.send(command);
      const processingTime = Date.now() - startTime;
      
      console.log(`[Textract] 処理完了: ${processingTime}ms, ブロック数: ${response.Blocks.length}`);
      
      // LINEブロックのみ抽出（行単位のテキスト）
      const lines = response.Blocks
        .filter(block => block.BlockType === 'LINE')
        .map(block => ({
          text: block.Text,
          confidence: block.Confidence,
          boundingBox: block.Geometry.BoundingBox
        }));
      
      // 全テキストを結合
      const fullText = lines.map(line => line.text).join('\n');
      
      // 平均信頼度スコア計算
      const avgConfidence = lines.length > 0 
        ? lines.reduce((sum, line) => sum + line.confidence, 0) / lines.length 
        : 0;
      
      return {
        text: fullText,
        lines: lines,
        confidence: avgConfidence,
        blocks: response.Blocks,
        processingTime: processingTime
      };
      
    } catch (error) {
      console.error('[Textract] エラー:', error);
      throw this.handleError(error);
    }
  }
  
  /**
   * 高度な文書分析（表・フォーム認識）
   * AnalyzeDocument APIを使用
   * 
   * @param {Buffer} imageBuffer - 画像データ
   * @param {Array} featureTypes - ['TABLES', 'FORMS'] などの機能
   * @returns {Object} { text, tables, forms, confidence }
   */
  async analyzeDocument(imageBuffer, featureTypes = ['TABLES', 'FORMS']) {
    try {
      console.log(`[Textract] AnalyzeDocument API呼び出し開始: ${featureTypes.join(', ')}`);
      const startTime = Date.now();
      
      const command = new AnalyzeDocumentCommand({
        Document: { Bytes: imageBuffer },
        FeatureTypes: featureTypes
      });
      
      const response = await this.client.send(command);
      const processingTime = Date.now() - startTime;
      
      console.log(`[Textract] 分析完了: ${processingTime}ms`);
      
      // LINEブロック抽出
      const lines = response.Blocks
        .filter(block => block.BlockType === 'LINE')
        .map(block => block.Text);
      
      const fullText = lines.join('\n');
      
      // 表データ抽出
      const tables = this.extractTables(response.Blocks);
      
      // フォームデータ抽出（Key-Valueペア）
      const forms = this.extractForms(response.Blocks);
      
      // 平均信頼度
      const confidenceScores = response.Blocks
        .filter(block => block.Confidence)
        .map(block => block.Confidence);
      
      const avgConfidence = confidenceScores.length > 0
        ? confidenceScores.reduce((sum, c) => sum + c, 0) / confidenceScores.length
        : 0;
      
      return {
        text: fullText,
        lines: lines,
        tables: tables,
        forms: forms,
        confidence: avgConfidence,
        processingTime: processingTime
      };
      
    } catch (error) {
      console.error('[Textract] 分析エラー:', error);
      throw this.handleError(error);
    }
  }
  
  /**
   * 表データを2次元配列に変換
   * 
   * @param {Array} blocks - Textractのブロック配列
   * @returns {Array} 表データの配列
   */
  extractTables(blocks) {
    const tables = [];
    const tableBlocks = blocks.filter(block => block.BlockType === 'TABLE');
    
    tableBlocks.forEach(tableBlock => {
      const table = {
        rowCount: 0,
        columnCount: 0,
        cells: []
      };
      
      // CELLブロックを収集
      if (tableBlock.Relationships) {
        const cellRelationship = tableBlock.Relationships.find(r => r.Type === 'CHILD');
        if (cellRelationship) {
          cellRelationship.Ids.forEach(cellId => {
            const cellBlock = blocks.find(b => b.Id === cellId && b.BlockType === 'CELL');
            if (cellBlock) {
              const rowIndex = cellBlock.RowIndex - 1;
              const colIndex = cellBlock.ColumnIndex - 1;
              
              // セル内のテキスト取得
              let cellText = '';
              if (cellBlock.Relationships) {
                const wordRelationship = cellBlock.Relationships.find(r => r.Type === 'CHILD');
                if (wordRelationship) {
                  const words = wordRelationship.Ids
                    .map(wordId => blocks.find(b => b.Id === wordId))
                    .filter(b => b && b.Text)
                    .map(b => b.Text);
                  cellText = words.join(' ');
                }
              }
              
              table.cells.push({
                row: rowIndex,
                column: colIndex,
                text: cellText,
                confidence: cellBlock.Confidence
              });
              
              table.rowCount = Math.max(table.rowCount, rowIndex + 1);
              table.columnCount = Math.max(table.columnCount, colIndex + 1);
            }
          });
        }
      }
      
      // 2次元配列に変換
      const grid = Array(table.rowCount).fill(null).map(() => Array(table.columnCount).fill(''));
      table.cells.forEach(cell => {
        grid[cell.row][cell.column] = cell.text;
      });
      
      table.grid = grid;
      tables.push(table);
    });
    
    return tables;
  }
  
  /**
   * フォームデータ（Key-Valueペア）を抽出
   * 
   * @param {Array} blocks - Textractのブロック配列
   * @returns {Object} { key: value } の形式
   */
  extractForms(blocks) {
    const forms = {};
    const kvBlocks = blocks.filter(block => block.BlockType === 'KEY_VALUE_SET');
    
    kvBlocks.forEach(kvBlock => {
      if (kvBlock.EntityTypes && kvBlock.EntityTypes.includes('KEY')) {
        // KEYのテキスト取得
        let keyText = '';
        if (kvBlock.Relationships) {
          const childRelationship = kvBlock.Relationships.find(r => r.Type === 'CHILD');
          if (childRelationship) {
            const words = childRelationship.Ids
              .map(id => blocks.find(b => b.Id === id))
              .filter(b => b && b.Text)
              .map(b => b.Text);
            keyText = words.join(' ');
          }
          
          // 対応するVALUEを取得
          const valueRelationship = kvBlock.Relationships.find(r => r.Type === 'VALUE');
          if (valueRelationship && valueRelationship.Ids.length > 0) {
            const valueBlock = blocks.find(b => b.Id === valueRelationship.Ids[0]);
            if (valueBlock && valueBlock.Relationships) {
              const valueChildRelationship = valueBlock.Relationships.find(r => r.Type === 'CHILD');
              if (valueChildRelationship) {
                const valueWords = valueChildRelationship.Ids
                  .map(id => blocks.find(b => b.Id === id))
                  .filter(b => b && b.Text)
                  .map(b => b.Text);
                const valueText = valueWords.join(' ');
                
                if (keyText && valueText) {
                  forms[keyText] = valueText;
                }
              }
            }
          }
        }
      }
    });
    
    return forms;
  }
  
  /**
   * Base64画像をBufferに変換
   * 
   * @param {String} base64String - Base64エンコードされた画像データ
   * @returns {Buffer}
   */
  base64ToBuffer(base64String) {
    // Data URLの場合はプレフィックスを削除
    const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
    return Buffer.from(base64Data, 'base64');
  }
  
  /**
   * エラーハンドリング
   * 
   * @param {Error} error - AWS SDKエラー
   * @returns {Error} 整形されたエラー
   */
  handleError(error) {
    const errorMap = {
      'InvalidParameterException': '画像形式が不正です。JPEG、PNG形式を使用してください。',
      'InvalidS3ObjectException': 'S3オブジェクトへのアクセスに失敗しました。',
      'UnsupportedDocumentException': 'サポートされていない文書形式です。',
      'DocumentTooLargeException': '画像サイズが大きすぎます（最大10MB）。',
      'BadDocumentException': '画像が破損しているか、読み取れません。',
      'AccessDeniedException': 'AWS認証エラー: アクセス権限を確認してください。',
      'ProvisionedThroughputExceededException': 'リクエスト上限を超えました。しばらく待ってから再試行してください。',
      'InternalServerError': 'AWS内部エラー。しばらく待ってから再試行してください。',
      'ThrottlingException': 'リクエストレート制限に達しました。しばらく待ってください。'
    };
    
    const errorMessage = errorMap[error.name] || error.message || 'Textract APIエラーが発生しました';
    
    const customError = new Error(errorMessage);
    customError.name = error.name;
    customError.originalError = error;
    
    return customError;
  }
}

module.exports = new TextractService();