/**
 * 共有システム設定(POC用の可変状態)
 * require は同一オブジェクト参照を返すため、プロパティ変更は全モジュールで共有される。
 * バインディングの再代入(systemConfig = {...})は行わないこと。
 */
const systemConfig = {
    pocMode: true,               // POCモード: true = DB書き込み抑止, false = 通常動作
    enableQRInspectionDB: false, // QR検品のDB書き込み: false = 抑止, true = 有効
    lastUpdated: new Date().toISOString()
};

module.exports = systemConfig;
