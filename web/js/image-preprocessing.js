/**
 * 画像前処理モジュール - OCR精度向上
 * 
 * ノイズ除去、コントラスト調整、傾き補正、二値化処理
 */

class ImagePreprocessor {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
  }

  /**
   * 画像前処理パイプライン全実行
   * @param {HTMLImageElement|HTMLCanvasElement} image 
   * @param {Object} options - 処理オプション
   * @returns {HTMLCanvasElement}
   */
  async processImage(image, options = {}) {
    const defaultOptions = {
      denoise: true,
      contrast: true,
      deskew: true,
      binarize: true,
      upscale: true,
      sharpening: true
    };
    
    const opts = { ...defaultOptions, ...options };
    
    // キャンバスサイズ設定
    this.canvas.width = image.width;
    this.canvas.height = image.height;
    this.ctx.drawImage(image, 0, 0);
    
    let processedCanvas = this.canvas;
    
    // 1. アップスケーリング (解像度向上)
    if (opts.upscale && image.width < 1200) {
      processedCanvas = this.upscaleImage(processedCanvas, 2.0);
    }
    
    // 2. グレースケール変換
    processedCanvas = this.toGrayscale(processedCanvas);
    
    // 3. ノイズ除去
    if (opts.denoise) {
      processedCanvas = this.denoiseGaussian(processedCanvas);
    }
    
    // 4. コントラスト調整
    if (opts.contrast) {
      processedCanvas = this.enhanceContrast(processedCanvas);
    }
    
    // 5. シャープニング
    if (opts.sharpening) {
      processedCanvas = this.sharpen(processedCanvas);
    }
    
    // 6. 傾き補正
    if (opts.deskew) {
      processedCanvas = await this.deskew(processedCanvas);
    }
    
    // 7. 二値化 (最後に実行)
    if (opts.binarize) {
      processedCanvas = this.binarize(processedCanvas);
    }
    
    return processedCanvas;
  }

  /**
   * グレースケール変換
   */
  toGrayscale(canvas) {
    const imageData = this.getImageData(canvas);
    const data = imageData.data;
    
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      data[i] = data[i + 1] = data[i + 2] = gray;
    }
    
    return this.imageDataToCanvas(imageData);
  }

  /**
   * ガウシアンノイズ除去
   */
  denoiseGaussian(canvas) {
    const imageData = this.getImageData(canvas);
    const kernel = [
      [1, 2, 1],
      [2, 4, 2],
      [1, 2, 1]
    ];
    const kernelWeight = 16;
    
    return this.applyConvolution(imageData, kernel, kernelWeight);
  }

  /**
   * コントラスト強調 (CLAHE: Contrast Limited Adaptive Histogram Equalization)
   */
  enhanceContrast(canvas) {
    const imageData = this.getImageData(canvas);
    const data = imageData.data;
    
    // ヒストグラム計算
    const histogram = new Array(256).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      histogram[data[i]]++;
    }
    
    // 累積分布関数 (CDF)
    const cdf = new Array(256).fill(0);
    cdf[0] = histogram[0];
    for (let i = 1; i < 256; i++) {
      cdf[i] = cdf[i - 1] + histogram[i];
    }
    
    // 正規化
    const cdfMin = cdf.find(v => v > 0);
    const totalPixels = data.length / 4;
    
    for (let i = 0; i < data.length; i += 4) {
      const oldValue = data[i];
      const newValue = Math.round(((cdf[oldValue] - cdfMin) / (totalPixels - cdfMin)) * 255);
      data[i] = data[i + 1] = data[i + 2] = newValue;
    }
    
    return this.imageDataToCanvas(imageData);
  }

  /**
   * シャープニング
   */
  sharpen(canvas) {
    const imageData = this.getImageData(canvas);
    const kernel = [
      [0, -1, 0],
      [-1, 5, -1],
      [0, -1, 0]
    ];
    
    return this.applyConvolution(imageData, kernel, 1);
  }

  /**
   * 二値化 (Otsu's method)
   */
  binarize(canvas) {
    const imageData = this.getImageData(canvas);
    const data = imageData.data;
    
    // ヒストグラム
    const histogram = new Array(256).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      histogram[data[i]]++;
    }
    
    // Otsu's threshold計算
    const threshold = this.calculateOtsuThreshold(histogram, data.length / 4);
    
    // 二値化適用
    for (let i = 0; i < data.length; i += 4) {
      const binary = data[i] > threshold ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = binary;
    }
    
    return this.imageDataToCanvas(imageData);
  }

  /**
   * Otsu's threshold計算
   */
  calculateOtsuThreshold(histogram, totalPixels) {
    let sum = 0;
    for (let i = 0; i < 256; i++) {
      sum += i * histogram[i];
    }
    
    let sumB = 0;
    let wB = 0;
    let wF = 0;
    let maxVariance = 0;
    let threshold = 0;
    
    for (let t = 0; t < 256; t++) {
      wB += histogram[t];
      if (wB === 0) continue;
      
      wF = totalPixels - wB;
      if (wF === 0) break;
      
      sumB += t * histogram[t];
      
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      
      const variance = wB * wF * (mB - mF) * (mB - mF);
      
      if (variance > maxVariance) {
        maxVariance = variance;
        threshold = t;
      }
    }
    
    return threshold;
  }

  /**
   * 画像のアップスケーリング
   */
  upscaleImage(canvas, scale = 2.0) {
    const newCanvas = document.createElement('canvas');
    const ctx = newCanvas.getContext('2d');
    
    newCanvas.width = canvas.width * scale;
    newCanvas.height = canvas.height * scale;
    
    // バイキュービック補間を有効化
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    ctx.drawImage(canvas, 0, 0, newCanvas.width, newCanvas.height);
    
    return newCanvas;
  }

  /**
   * 傾き補正 (簡易版)
   */
  async deskew(canvas) {
    // ハフ変換による角度検出を簡易実装
    const angle = this.detectSkewAngle(canvas);
    
    if (Math.abs(angle) < 0.5) {
      return canvas; // 補正不要
    }
    
    return this.rotateImage(canvas, -angle);
  }

  /**
   * 傾き角度検出 (簡易版)
   */
  detectSkewAngle(canvas) {
    // 実際にはハフ変換を使うべきだが、簡易版として固定値
    // TODO: 本格的なハフ変換実装
    return 0; // 今回は補正なし
  }

  /**
   * 画像回転
   */
  rotateImage(canvas, angle) {
    const newCanvas = document.createElement('canvas');
    const ctx = newCanvas.getContext('2d');
    
    const radian = (angle * Math.PI) / 180;
    const cos = Math.cos(radian);
    const sin = Math.sin(radian);
    
    newCanvas.width = Math.abs(canvas.width * cos) + Math.abs(canvas.height * sin);
    newCanvas.height = Math.abs(canvas.width * sin) + Math.abs(canvas.height * cos);
    
    ctx.translate(newCanvas.width / 2, newCanvas.height / 2);
    ctx.rotate(radian);
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    
    return newCanvas;
  }

  /**
   * 畳み込みフィルタ適用
   */
  applyConvolution(imageData, kernel, weight = 1) {
    const src = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const dst = new Uint8ClampedArray(src.length);
    
    const kSize = kernel.length;
    const kHalf = Math.floor(kSize / 2);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        
        for (let ky = 0; ky < kSize; ky++) {
          for (let kx = 0; kx < kSize; kx++) {
            const px = Math.min(width - 1, Math.max(0, x + kx - kHalf));
            const py = Math.min(height - 1, Math.max(0, y + ky - kHalf));
            const idx = (py * width + px) * 4;
            
            sum += src[idx] * kernel[ky][kx];
          }
        }
        
        const idx = (y * width + x) * 4;
        const value = Math.min(255, Math.max(0, sum / weight));
        dst[idx] = dst[idx + 1] = dst[idx + 2] = value;
        dst[idx + 3] = 255;
      }
    }
    
    const newImageData = new ImageData(dst, width, height);
    return this.imageDataToCanvas(newImageData);
  }

  /**
   * ユーティリティ: ImageData取得
   */
  getImageData(canvas) {
    const ctx = canvas.getContext('2d');
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  /**
   * ユーティリティ: ImageDataをCanvasに変換
   */
  imageDataToCanvas(imageData) {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  /**
   * 画質評価
   */
  assessImageQuality(canvas) {
    const imageData = this.getImageData(canvas);
    const data = imageData.data;
    
    // 明るさ
    let brightness = 0;
    for (let i = 0; i < data.length; i += 4) {
      brightness += data[i];
    }
    brightness = brightness / (data.length / 4);
    
    // コントラスト (標準偏差)
    let variance = 0;
    for (let i = 0; i < data.length; i += 4) {
      variance += Math.pow(data[i] - brightness, 2);
    }
    const stdDev = Math.sqrt(variance / (data.length / 4));
    
    // ブラー検出 (Laplacianの分散)
    const blur = this.detectBlur(imageData);
    
    return {
      resolution: { width: canvas.width, height: canvas.height },
      brightness: Math.round((brightness / 255) * 100),
      contrast: Math.round(stdDev),
      sharpness: Math.round(blur),
      score: this.calculateQualityScore(brightness, stdDev, blur),
      recommendations: this.getQualityRecommendations(brightness, stdDev, blur, canvas.width)
    };
  }

  /**
   * ブラー検出 (Laplacian variance)
   */
  detectBlur(imageData) {
    const laplacianKernel = [
      [0, 1, 0],
      [1, -4, 1],
      [0, 1, 0]
    ];
    
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    let variance = 0;
    let count = 0;
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let sum = 0;
        
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = ((y + ky) * width + (x + kx)) * 4;
            sum += data[idx] * laplacianKernel[ky + 1][kx + 1];
          }
        }
        
        variance += sum * sum;
        count++;
      }
    }
    
    return variance / count;
  }

  /**
   * 品質スコア計算
   */
  calculateQualityScore(brightness, contrast, sharpness) {
    let score = 100;
    
    // 明るさスコア (理想: 100-150)
    if (brightness < 80 || brightness > 180) {
      score -= 20;
    }
    
    // コントラストスコア (理想: > 40)
    if (contrast < 30) {
      score -= 20;
    }
    
    // シャープネススコア (理想: > 100)
    if (sharpness < 50) {
      score -= 30;
    }
    
    return Math.max(0, score);
  }

  /**
   * 品質改善推奨事項
   */
  getQualityRecommendations(brightness, contrast, sharpness, width) {
    const recommendations = [];
    
    if (width < 800) {
      recommendations.push('📷 もう少し近づいて撮影してください');
    }
    
    if (brightness < 80) {
      recommendations.push('💡 照明を明るくしてください');
    } else if (brightness > 180) {
      recommendations.push('☀️ 光が強すぎます。影を避けてください');
    }
    
    if (contrast < 30) {
      recommendations.push('📊 背景と文字のコントラストを高めてください');
    }
    
    if (sharpness < 50) {
      recommendations.push('🎯 手ブレを防ぐため、カメラを安定させてください');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('✅ 画質良好です！');
    }
    
    return recommendations;
  }
}

// グローバルエクスポート
window.ImagePreprocessor = ImagePreprocessor;
