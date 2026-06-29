/**
 * 画像前処理モジュール
 * OCR精度向上のための画像処理パイプライン
 */

class ImagePreprocessor {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  /**
   * メイン処理パイプライン
   * @param {HTMLImageElement|HTMLCanvasElement} image - 入力画像
   * @param {Object} options - 処理オプション
   * @returns {Promise<HTMLCanvasElement>} 処理済み画像
   */
  async process(image, options = {}) {
    const {
      grayscale = true,
      denoise = true,
      contrast = true,
      deskew = true,
      binarize = true,
      upscale = false,
      targetDPI = 300
    } = options;

    let processedImage = await this.loadImage(image);

    // アップスケーリング（解像度向上）
    if (upscale) {
      processedImage = this.upscaleImage(processedImage, targetDPI);
    }

    // グレースケール変換
    if (grayscale) {
      processedImage = this.toGrayscale(processedImage);
    }

    // ノイズ除去
    if (denoise) {
      processedImage = this.denoise(processedImage);
    }

    // コントラスト調整
    if (contrast) {
      processedImage = this.enhanceContrast(processedImage);
    }

    // 傾き補正
    if (deskew) {
      processedImage = await this.deskew(processedImage);
    }

    // 二値化
    if (binarize) {
      processedImage = this.binarize(processedImage);
    }

    return processedImage;
  }

  /**
   * 画像をCanvasに読み込み
   */
  async loadImage(image) {
    const img = image instanceof HTMLImageElement ? image : await this.canvasToImage(image);
    
    this.canvas.width = img.width;
    this.canvas.height = img.height;
    this.ctx.drawImage(img, 0, 0);
    
    return this.canvas;
  }

  /**
   * CanvasをImageに変換
   */
  canvasToImage(canvas) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = canvas.toDataURL();
    });
  }

  /**
   * グレースケール変換
   */
  toGrayscale(canvas) {
    const imageData = this.ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      data[i] = data[i + 1] = data[i + 2] = gray;
    }

    this.ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  /**
   * ノイズ除去（メディアンフィルター）
   */
  denoise(canvas) {
    const imageData = this.ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const width = canvas.width;
    const height = canvas.height;
    const output = new Uint8ClampedArray(data);

    // 3x3メディアンフィルター
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const pixels = [];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const idx = ((y + dy) * width + (x + dx)) * 4;
            pixels.push(data[idx]);
          }
        }
        pixels.sort((a, b) => a - b);
        const median = pixels[4]; // 中央値
        const idx = (y * width + x) * 4;
        output[idx] = output[idx + 1] = output[idx + 2] = median;
      }
    }

    const newImageData = new ImageData(output, width, height);
    this.ctx.putImageData(newImageData, 0, 0);
    return canvas;
  }

  /**
   * コントラスト強調
   */
  enhanceContrast(canvas) {
    const imageData = this.ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // ヒストグラム計算
    const histogram = new Array(256).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      histogram[data[i]]++;
    }

    // 累積分布関数
    const cdf = new Array(256);
    cdf[0] = histogram[0];
    for (let i = 1; i < 256; i++) {
      cdf[i] = cdf[i - 1] + histogram[i];
    }

    // 正規化
    const totalPixels = canvas.width * canvas.height;
    const cdfMin = cdf.find(v => v > 0);
    const lookup = cdf.map(v => 
      Math.round(((v - cdfMin) / (totalPixels - cdfMin)) * 255)
    );

    // 適用
    for (let i = 0; i < data.length; i += 4) {
      const newValue = lookup[data[i]];
      data[i] = data[i + 1] = data[i + 2] = newValue;
    }

    this.ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  /**
   * 傾き補正（簡易版）
   */
  async deskew(canvas) {
    // 簡易的な傾き検出と補正
    const angle = this.detectSkewAngle(canvas);
    
    if (Math.abs(angle) > 0.1) { // 0.1度以上の傾きがある場合
      return this.rotateCanvas(canvas, -angle);
    }
    
    return canvas;
  }

  /**
   * 傾き角度検出（Hough変換の簡易版）
   */
  detectSkewAngle(canvas) {
    // 実装簡略化: エッジ検出とライン検出
    // 実際のプロダクションではより高度なアルゴリズムが必要
    const imageData = this.ctx.getImageData(0, 0, canvas.width, canvas.height);
    const edges = this.detectEdges(imageData);
    
    // ここでは仮の角度を返す（実装を簡略化）
    return 0; // 実際は計算された角度
  }

  /**
   * エッジ検出（Sobel）
   */
  detectEdges(imageData) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const edges = new Uint8ClampedArray(data.length);

    const sobelX = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
    const sobelY = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let gx = 0, gy = 0;
        
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const idx = ((y + dy) * width + (x + dx)) * 4;
            const pixel = data[idx];
            gx += pixel * sobelX[dy + 1][dx + 1];
            gy += pixel * sobelY[dy + 1][dx + 1];
          }
        }
        
        const magnitude = Math.sqrt(gx * gx + gy * gy);
        const idx = (y * width + x) * 4;
        edges[idx] = edges[idx + 1] = edges[idx + 2] = magnitude;
        edges[idx + 3] = 255;
      }
    }

    return new ImageData(edges, width, height);
  }

  /**
   * Canvas回転
   */
  rotateCanvas(canvas, angle) {
    const radians = (angle * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    
    const newWidth = Math.abs(canvas.width * cos) + Math.abs(canvas.height * sin);
    const newHeight = Math.abs(canvas.width * sin) + Math.abs(canvas.height * cos);
    
    const rotatedCanvas = document.createElement('canvas');
    rotatedCanvas.width = newWidth;
    rotatedCanvas.height = newHeight;
    const rotatedCtx = rotatedCanvas.getContext('2d');
    
    rotatedCtx.translate(newWidth / 2, newHeight / 2);
    rotatedCtx.rotate(radians);
    rotatedCtx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    
    return rotatedCanvas;
  }

  /**
   * 二値化（Otsu's method）
   */
  binarize(canvas) {
    const imageData = this.ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Otsuの二値化閾値計算
    const threshold = this.calculateOtsuThreshold(data);

    // 二値化適用
    for (let i = 0; i < data.length; i += 4) {
      const value = data[i] > threshold ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = value;
    }

    this.ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  /**
   * Otsu閾値計算
   */
  calculateOtsuThreshold(data) {
    // ヒストグラム作成
    const histogram = new Array(256).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      histogram[data[i]]++;
    }

    const total = data.length / 4;
    let sum = 0;
    for (let i = 0; i < 256; i++) {
      sum += i * histogram[i];
    }

    let sumB = 0;
    let wB = 0;
    let wF = 0;
    let maxVariance = 0;
    let threshold = 0;

    for (let i = 0; i < 256; i++) {
      wB += histogram[i];
      if (wB === 0) continue;
      
      wF = total - wB;
      if (wF === 0) break;

      sumB += i * histogram[i];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const variance = wB * wF * (mB - mF) * (mB - mF);

      if (variance > maxVariance) {
        maxVariance = variance;
        threshold = i;
      }
    }

    return threshold;
  }

  /**
   * アップスケーリング（バイキュービック補間）
   */
  upscaleImage(canvas, targetDPI) {
    const currentDPI = 72; // Web標準DPI
    const scale = targetDPI / currentDPI;
    
    if (scale <= 1) return canvas;

    const newWidth = Math.round(canvas.width * scale);
    const newHeight = Math.round(canvas.height * scale);

    const upscaled = document.createElement('canvas');
    upscaled.width = newWidth;
    upscaled.height = newHeight;
    const upscaledCtx = upscaled.getContext('2d');

    // 高品質スケーリング
    upscaledCtx.imageSmoothingEnabled = true;
    upscaledCtx.imageSmoothingQuality = 'high';
    upscaledCtx.drawImage(canvas, 0, 0, newWidth, newHeight);

    this.canvas = upscaled;
    this.ctx = upscaledCtx;

    return upscaled;
  }

  /**
   * 画質評価
   */
  assessQuality(canvas) {
    const imageData = this.ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // 解像度チェック
    const resolution = Math.max(canvas.width, canvas.height);
    const resolutionScore = Math.min(resolution / 1000, 1);

    // 明るさチェック
    let totalBrightness = 0;
    for (let i = 0; i < data.length; i += 4) {
      totalBrightness += data[i];
    }
    const avgBrightness = totalBrightness / (data.length / 4);
    const brightnessScore = 1 - Math.abs(avgBrightness - 128) / 128;

    // コントラストチェック
    let min = 255, max = 0;
    for (let i = 0; i < data.length; i += 4) {
      min = Math.min(min, data[i]);
      max = Math.max(max, data[i]);
    }
    const contrastScore = (max - min) / 255;

    // ぼけ検出（Laplacian variance）
    const blurScore = this.detectBlur(imageData);

    const overallScore = (
      resolutionScore * 0.25 +
      brightnessScore * 0.25 +
      contrastScore * 0.25 +
      blurScore * 0.25
    );

    return {
      overall: overallScore,
      resolution: resolutionScore,
      brightness: brightnessScore,
      contrast: contrastScore,
      blur: blurScore,
      recommendations: this.getRecommendations({
        resolution: resolutionScore,
        brightness: brightnessScore,
        contrast: contrastScore,
        blur: blurScore
      })
    };
  }

  /**
   * ぼけ検出
   */
  detectBlur(imageData) {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;

    // Laplacianフィルター
    const laplacian = [[0, 1, 0], [1, -4, 1], [0, 1, 0]];
    let variance = 0;
    let count = 0;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const idx = ((y + dy) * width + (x + dx)) * 4;
            sum += data[idx] * laplacian[dy + 1][dx + 1];
          }
        }
        variance += sum * sum;
        count++;
      }
    }

    const laplacianVariance = variance / count;
    // 正規化（経験的な値）
    return Math.min(laplacianVariance / 1000, 1);
  }

  /**
   * 改善提案
   */
  getRecommendations(scores) {
    const recommendations = [];

    if (scores.resolution < 0.5) {
      recommendations.push('画像を高解像度で撮影してください（推奨: 1000px以上）');
    }
    if (scores.brightness < 0.5) {
      recommendations.push('もう少し明るい場所で撮影してください');
    }
    if (scores.contrast < 0.5) {
      recommendations.push('文字と背景のコントラストを高めてください');
    }
    if (scores.blur < 0.3) {
      recommendations.push('カメラを固定してブレを防いでください');
    }

    return recommendations;
  }
}

// モジュールエクスポート
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ImagePreprocessor;
}
