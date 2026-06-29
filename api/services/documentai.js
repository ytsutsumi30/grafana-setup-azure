/**
 * Google Cloud Document AI サービス
 * 
 * Document AI APIを使用したOCR処理
 * AWS Textractの代替・補完として使用
 */

const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;

class DocumentAIService {
  constructor() {
    this.client = null;
    this.projectId = process.env.GCP_PROJECT_ID || '';
    this.location = process.env.GCP_REGION || 'us';
    this.processorId = process.env.DOCUMENTAI_PROCESSOR_ID || '';
    
    // クライアント初期化
    if (this.projectId && this.processorId) {
      this.initializeClient();
    }
  }

  /**
   * Document AIクライアント初期化
   */
  initializeClient() {
    try {
      const options = {};
      
      // 環境変数でクレデンシャルファイルが指定されている場合
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        options.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      }
      
      this.client = new DocumentProcessorServiceClient(options);
      console.log('[Document AI] クライアント初期化完了');
    } catch (error) {
      console.error('[Document AI] 初期化エラー:', error.message);
      this.client = null;
    }
  }

  /**
   * Base64文字列をBufferに変換
   */
  base64ToBuffer(base64String) {
    // data:image/xxx;base64, のプレフィックスを除去
    const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
    return Buffer.from(base64Data, 'base64');
  }

  /**
   * ドキュメント処理（基本OCR）
   * 
   * @param {Buffer} imageBuffer - 画像データ
   * @param {string} mimeType - MIMEタイプ（image/png, image/jpeg等）
   * @returns {Promise<Object>} OCR結果
   */
  async processDocument(imageBuffer, mimeType = 'image/png') {
    const startTime = Date.now();

    try {
      if (!this.client) {
        throw new Error('Document AIクライアントが初期化されていません');
      }

      // プロセッサー名を構築
      const name = `projects/${this.projectId}/locations/${this.location}/processors/${this.processorId}`;

      // リクエスト構築
      const request = {
        name,
        rawDocument: {
          content: imageBuffer,
          mimeType: mimeType,
        },
      };

      console.log(`[Document AI] 処理開始: processor=${this.processorId}`);

      // Document AI実行
      const [result] = await this.client.processDocument(request);
      const document = result.document;

      // テキスト抽出
      const text = document.text || '';
      
      // ページごとの詳細情報
      const pages = [];
      let totalConfidence = 0;
      let confidenceCount = 0;

      if (document.pages) {
        for (const page of document.pages) {
          const pageInfo = {
            pageNumber: page.pageNumber || 1,
            width: page.dimension?.width || 0,
            height: page.dimension?.height || 0,
            lines: [],
            blocks: [],
          };

          // トークン（単語）の処理
          if (page.tokens) {
            for (const token of page.tokens) {
              const tokenText = this.extractText(token.layout.textAnchor, text);
              const confidence = token.layout.confidence || 0;
              
              totalConfidence += confidence;
              confidenceCount++;

              pageInfo.lines.push({
                text: tokenText,
                confidence: Math.round(confidence * 100),
                boundingBox: this.extractBoundingBox(token.layout.boundingPoly),
              });
            }
          }

          // パラグラフの処理
          if (page.paragraphs) {
            for (const paragraph of page.paragraphs) {
              const paragraphText = this.extractText(paragraph.layout.textAnchor, text);
              
              pageInfo.blocks.push({
                text: paragraphText,
                confidence: Math.round((paragraph.layout.confidence || 0) * 100),
                boundingBox: this.extractBoundingBox(paragraph.layout.boundingPoly),
              });
            }
          }

          pages.push(pageInfo);
        }
      }

      // 平均信頼度計算
      const avgConfidence = confidenceCount > 0 
        ? Math.round((totalConfidence / confidenceCount) * 100) 
        : 0;

      const processingTime = Date.now() - startTime;

      console.log(`[Document AI] 処理成功: 信頼度=${avgConfidence}%, 処理時間=${processingTime}ms`);

      return {
        success: true,
        text,
        pages,
        confidence: avgConfidence,
        processingTime,
        pageCount: pages.length,
      };

    } catch (error) {
      console.error('[Document AI] エラー:', error);
      throw this.handleError(error);
    }
  }

  /**
   * 高度なドキュメント分析（テーブル・フォーム抽出）
   * 
   * @param {Buffer} imageBuffer - 画像データ
   * @param {string} mimeType - MIMEタイプ
   * @returns {Promise<Object>} 分析結果
   */
  async analyzeDocument(imageBuffer, mimeType = 'image/png') {
    const startTime = Date.now();

    try {
      if (!this.client) {
        throw new Error('Document AIクライアントが初期化されていません');
      }

      const name = `projects/${this.projectId}/locations/${this.location}/processors/${this.processorId}`;

      const request = {
        name,
        rawDocument: {
          content: imageBuffer,
          mimeType: mimeType,
        },
      };

      console.log(`[Document AI] 高度分析開始`);

      const [result] = await this.client.processDocument(request);
      const document = result.document;

      const text = document.text || '';
      
      // テーブル抽出
      const tables = this.extractTables(document, text);
      
      // フォームフィールド抽出
      const formFields = this.extractFormFields(document, text);

      const processingTime = Date.now() - startTime;

      console.log(`[Document AI] 分析成功: テーブル=${tables.length}個, フォーム=${formFields.length}個`);

      return {
        success: true,
        text,
        tables,
        formFields,
        processingTime,
      };

    } catch (error) {
      console.error('[Document AI] 分析エラー:', error);
      throw this.handleError(error);
    }
  }

  /**
   * テキストアンカーからテキストを抽出
   */
  extractText(textAnchor, fullText) {
    if (!textAnchor || !textAnchor.textSegments) {
      return '';
    }

    let extractedText = '';
    for (const segment of textAnchor.textSegments) {
      const startIndex = segment.startIndex || 0;
      const endIndex = segment.endIndex || fullText.length;
      extractedText += fullText.substring(startIndex, endIndex);
    }

    return extractedText;
  }

  /**
   * バウンディングボックスを抽出
   */
  extractBoundingBox(boundingPoly) {
    if (!boundingPoly || !boundingPoly.normalizedVertices) {
      return null;
    }

    const vertices = boundingPoly.normalizedVertices;
    if (vertices.length < 4) {
      return null;
    }

    return {
      topLeft: { x: vertices[0].x || 0, y: vertices[0].y || 0 },
      topRight: { x: vertices[1].x || 0, y: vertices[1].y || 0 },
      bottomRight: { x: vertices[2].x || 0, y: vertices[2].y || 0 },
      bottomLeft: { x: vertices[3].x || 0, y: vertices[3].y || 0 },
    };
  }

  /**
   * テーブルを抽出
   */
  extractTables(document, fullText) {
    const tables = [];

    if (!document.pages) {
      return tables;
    }

    for (const page of document.pages) {
      if (!page.tables) {
        continue;
      }

      for (const table of page.tables) {
        const tableData = {
          rowCount: table.bodyRows?.length || 0,
          columnCount: table.headerRows?.[0]?.cells?.length || 0,
          headers: [],
          rows: [],
        };

        // ヘッダー行
        if (table.headerRows) {
          for (const headerRow of table.headerRows) {
            const headerCells = [];
            for (const cell of headerRow.cells) {
              headerCells.push(this.extractText(cell.layout.textAnchor, fullText));
            }
            tableData.headers.push(headerCells);
          }
        }

        // データ行
        if (table.bodyRows) {
          for (const bodyRow of table.bodyRows) {
            const rowCells = [];
            for (const cell of bodyRow.cells) {
              rowCells.push(this.extractText(cell.layout.textAnchor, fullText));
            }
            tableData.rows.push(rowCells);
          }
        }

        tables.push(tableData);
      }
    }

    return tables;
  }

  /**
   * フォームフィールドを抽出
   */
  extractFormFields(document, fullText) {
    const formFields = [];

    if (!document.pages) {
      return formFields;
    }

    for (const page of document.pages) {
      if (!page.formFields) {
        continue;
      }

      for (const field of page.formFields) {
        const fieldName = this.extractText(field.fieldName?.textAnchor, fullText);
        const fieldValue = this.extractText(field.fieldValue?.textAnchor, fullText);
        const confidence = Math.round((field.fieldName?.confidence || 0) * 100);

        formFields.push({
          name: fieldName.trim(),
          value: fieldValue.trim(),
          confidence,
        });
      }
    }

    return formFields;
  }

  /**
   * エラーハンドリング
   */
  handleError(error) {
    const errorMap = {
      'INVALID_ARGUMENT': 'リクエストパラメータが無効です',
      'NOT_FOUND': 'プロセッサーが見つかりません',
      'PERMISSION_DENIED': '権限がありません。認証情報を確認してください',
      'RESOURCE_EXHAUSTED': 'API制限に達しました',
      'UNAVAILABLE': 'Document AIサービスが一時的に利用できません',
    };

    const errorCode = error.code || 'UNKNOWN';
    const message = errorMap[errorCode] || error.message || 'Document AI処理中にエラーが発生しました';

    const customError = new Error(message);
    customError.name = 'DocumentAIError';
    customError.code = errorCode;
    customError.originalError = error;

    return customError;
  }

  /**
   * サービスが利用可能かチェック
   */
  isAvailable() {
    return !!(this.client && this.projectId && this.processorId);
  }
}

// シングルトンインスタンス
const documentAIService = new DocumentAIService();

module.exports = documentAIService;
