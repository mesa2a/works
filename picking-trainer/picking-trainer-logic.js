// =============================================
// ピッキング練習トレーナー ビジネスロジック
// テスト可能な純粋関数群
// =============================================

(function (global) {
  'use strict';

  // =============================================
  // スコア計算
  // =============================================

  /**
   * モード別の自己ベストを取得
   * @param {Array} history - 練習履歴
   * @param {string} userId - ユーザーID
   * @param {string} mode - モード名
   * @param {object} [options] - 追加フィルタ条件 (例: { timeLimit: 60 })
   * @returns {number|null} 最高スコア（タイムアタックの場合は totalAnswered）
   */
  function getBestScore(history, userId, mode, options) {
    let filtered = history.filter(h => h.userId === userId && h.mode === mode);

    if (mode === 'timeAttack' && options && options.timeLimit) {
      filtered = filtered.filter(h => h.timeLimit === options.timeLimit);
      if (filtered.length === 0) return null;
      return Math.max(...filtered.map(h => h.totalAnswered));
    }

    if (filtered.length === 0) return null;
    return Math.max(...filtered.map(h => h.score));
  }

  // =============================================
  // データ管理
  // =============================================

  /**
   * 履歴データのマイグレーション（後方互換）
   */
  function migrateHistory(history) {
    return history.map(h => ({
      ...h,
      mode: h.mode || 'normal'
    }));
  }

  /**
   * 商品データのマイグレーション（後方互換: stockフィールド追加）
   */
  function migrateProducts(products) {
    return products.map(p => ({
      ...p,
      stock: p.stock ?? 99
    }));
  }

  /**
   * 履歴データの上限管理（最新500件）
   */
  function trimHistory(history) {
    if (history.length <= 500) return history;
    return history.slice(-500);
  }

  // =============================================
  // タスク生成
  // =============================================

  /**
   * ランダムな1タスクを生成（在庫0の商品は除外、数量は在庫以下）
   */
  function generateRandomTask(products) {
    const available = products.filter(p => (p.stock ?? 99) > 0);
    if (available.length === 0) return null;

    const product = available[Math.floor(Math.random() * available.length)];
    const stock = product.stock ?? 99;
    const quantity = Math.min(Math.floor(Math.random() * 3) + 1, stock);
    return {
      product: product,
      quantity: quantity,
      completed: false,
      found: null
    };
  }

  /**
   * 指定数のランダムタスクを生成（在庫なしの場合はnullを除外）
   */
  function generateRandomTasks(products, count) {
    const tasks = [];
    for (let i = 0; i < count; i++) {
      const task = generateRandomTask(products);
      if (task) {
        tasks.push(task);
      }
    }
    return tasks;
  }

  // =============================================
  // 伝票生成
  // =============================================

  /**
   * 数量レベルごとの範囲定義
   */
  var QUANTITY_RANGES = {
    low:  { min: 1, max: 3 },
    mid:  { min: 3, max: 8 },
    high: { min: 5, max: 15 }
  };

  /**
   * 残在庫を考慮して1タスクを生成する
   * @param {Array} products - 商品マスタ
   * @param {Object} remainingStock - { code: 残在庫数 } の辞書（破壊的に更新される）
   * @param {Set} [usedCodes] - 同一伝票内で既に使用した商品コードのSet
   * @param {string} [quantityLevel] - 数量レベル ('low' | 'mid' | 'high')
   * @returns {Object|null} タスク or null（在庫切れ）
   */
  function generateTaskWithStock(products, remainingStock, usedCodes, quantityLevel) {
    let available = products.filter(p => (remainingStock[p.code] ?? (p.stock ?? 99)) > 0);
    if (usedCodes) {
      available = available.filter(p => !usedCodes.has(p.code));
    }
    if (available.length === 0) return null;

    const product = available[Math.floor(Math.random() * available.length)];
    const stock = remainingStock[product.code] ?? (product.stock ?? 99);
    var range = QUANTITY_RANGES[quantityLevel] || QUANTITY_RANGES.low;
    var min = Math.min(range.min, stock);
    var max = Math.min(range.max, stock);
    if (min < 1) min = 1;
    if (max < min) max = min;
    const quantity = Math.floor(Math.random() * (max - min + 1)) + min;
    remainingStock[product.code] = stock - quantity;

    return {
      product: product,
      quantity: quantity,
      completed: false,
      found: null
    };
  }

  /**
   * 指定された伝票数・商品数で伝票群を生成する（在庫累積チェック付き）
   */
  function generateSlips(products, slipCount, itemsPerSlip, quantityLevel) {
    const remainingStock = {};
    products.forEach(p => {
      remainingStock[p.code] = p.stock ?? 99;
    });

    const slips = [];
    for (let i = 0; i < slipCount; i++) {
      const tasks = [];
      const usedCodes = new Set();
      for (let j = 0; j < itemsPerSlip; j++) {
        const task = generateTaskWithStock(products, remainingStock, usedCodes, quantityLevel);
        if (task) {
          usedCodes.add(task.product.code);
          tasks.push(task);
        }
      }
      slips.push({
        slipId: 'slip-' + i,
        slipNumber: i + 1,
        tasks: tasks,
        completed: false,
        verifiedCount: null
      });
    }
    return slips;
  }

  /**
   * 伝票生成前の在庫チェック
   * @param {Array} products - 商品マスタ
   * @param {number} slipCount - 伝票数
   * @param {number} itemsPerSlip - 1伝票あたりの商品数
   * @param {string} [quantityLevel] - 数量レベル
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  function validateSlipGeneration(products, slipCount, itemsPerSlip, quantityLevel) {
    var errors = [];
    var range = QUANTITY_RANGES[quantityLevel] || QUANTITY_RANGES.low;

    // 在庫のある商品のみ
    var available = products.filter(function (p) { return (p.stock ?? 99) > 0; });

    if (available.length === 0) {
      errors.push('在庫のある商品がありません。');
      return { valid: false, errors: errors };
    }

    // 商品種類チェック: 1伝票内で同一商品は使えないため
    if (available.length < itemsPerSlip) {
      errors.push(
        '1伝票あたり' + itemsPerSlip + '品必要ですが、在庫のある商品が' + available.length + '種類しかありません。'
      );
    }

    // 在庫合計 vs 必要最小数量
    var totalStock = available.reduce(function (sum, p) { return sum + (p.stock ?? 99); }, 0);
    var minRequired = slipCount * itemsPerSlip * range.min;

    if (totalStock < minRequired) {
      errors.push(
        '在庫合計（' + totalStock + '個）が必要最小数量（' + minRequired + '個）に足りません。' +
        '伝票数や数量レベルを調整してください。'
      );
    }

    return { valid: errors.length === 0, errors: errors };
  }

  /**
   * 全伝票が完了しているか判定する
   */
  function isAllSlipsCompleted(slips) {
    if (!slips || slips.length === 0) return false;
    return slips.every(slip => slip.completed);
  }

  /**
   * 伝票全体の集計情報を返す
   */
  function getSlipsSummary(slips) {
    const allTasks = slips.flatMap(slip => slip.tasks);
    return {
      totalTasks: allTasks.length,
      completedTasks: allTasks.filter(t => t.completed).length,
      correctCount: allTasks.filter(t => t.found === true).length,
      allTasks: allTasks
    };
  }

  /**
   * 伝票ごとの検品サマリーを返す
   * @param {Array} slips - 伝票配列
   * @returns {Object} 検品サマリー
   */
  function getSlipVerificationSummary(slips) {
    if (!slips || slips.length === 0) {
      return {
        totalVerified: 0,
        totalTasks: 0,
        slipsVerified: 0,
        slipsSkipped: 0,
        slipsTotal: 0,
        slipDetails: []
      };
    }

    const slipDetails = slips.map(slip => {
      const totalTasks = slip.tasks.length;
      const verifiedCount = slip.tasks.filter(t => t.verified).length;
      const isSkipped = slip.verifiedCount === null;
      return {
        slipNumber: slip.slipNumber,
        verifiedCount: verifiedCount,
        totalTasks: totalTasks,
        percent: totalTasks > 0 ? Math.round((verifiedCount / totalTasks) * 100) : 0,
        status: isSkipped ? 'skipped' : 'verified'
      };
    });

    const totalVerified = slips.flatMap(s => s.tasks).filter(t => t.verified).length;
    const totalTasks = slips.flatMap(s => s.tasks).length;
    const slipsVerified = slips.filter(s => s.verifiedCount !== null).length;
    const slipsSkipped = slips.filter(s => s.verifiedCount === null).length;

    return {
      totalVerified,
      totalTasks,
      slipsVerified,
      slipsSkipped,
      slipsTotal: slips.length,
      slipDetails
    };
  }

  // =============================================
  // 商品編集バリデーション
  // =============================================

  /**
   * 商品編集のバリデーション
   * @param {Object} original - 編集前の商品 { code, ... }
   * @param {Object} updated - 編集後の値 { code, name, stock }
   * @param {Array} allProducts - 全商品リスト
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  function validateProductEdit(original, updated, allProducts) {
    const errors = [];

    if (!updated.name || updated.name.trim() === '') {
      errors.push('商品名を入力してください。');
    }

    if (!updated.code || updated.code.trim() === '') {
      errors.push('商品コードを入力してください。');
    } else if (updated.code !== original.code) {
      if (allProducts.find(p => p.code === updated.code)) {
        errors.push('同じ商品コードが既に登録されています。');
      }
    }

    if (updated.stock === null || updated.stock === undefined || updated.stock === '') {
      errors.push('在庫数を入力してください。');
    } else {
      const stockNum = Number(updated.stock);
      if (!Number.isInteger(stockNum) || stockNum < 0) {
        errors.push('在庫数は0以上の整数を入力してください。');
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // =============================================
  // 伝票エラー記録（slipErrors 操作）
  // =============================================

  /**
   * エラータグのON/OFF切り替え（イミュータブル）
   * @param {Array} slipErrors - 既存のエラー配列 [{ tag, count, memo }]
   * @param {string} tag - 切り替えるタグ名
   * @returns {Array} 新しいエラー配列
   */
  function toggleSlipError(slipErrors, tag) {
    const exists = slipErrors.find(e => e.tag === tag);
    if (exists) {
      return slipErrors.filter(e => e.tag !== tag);
    }
    return [...slipErrors, { tag, count: 1, memo: '' }];
  }

  /**
   * エラータグの回数を更新（イミュータブル）
   * @param {Array} slipErrors - 既存のエラー配列
   * @param {string} tag - 対象タグ名
   * @param {number} count - 新しい回数（1未満は1にクランプ）
   * @returns {Array} 新しいエラー配列
   */
  function updateSlipErrorCount(slipErrors, tag, count) {
    return slipErrors.map(e => {
      if (e.tag !== tag) return { ...e };
      return { ...e, count: Math.max(1, count) };
    });
  }

  /**
   * エラータグのメモを更新（イミュータブル）
   * @param {Array} slipErrors - 既存のエラー配列
   * @param {string} tag - 対象タグ名
   * @param {string} memo - 新しいメモ
   * @returns {Array} 新しいエラー配列
   */
  function updateSlipErrorMemo(slipErrors, tag, memo) {
    return slipErrors.map(e => {
      if (e.tag !== tag) return { ...e };
      return { ...e, memo };
    });
  }

  /**
   * 特定タグのエラー情報を取得
   * @param {Array} slipErrors - エラー配列
   * @param {string} tag - タグ名
   * @returns {Object|null} エラー情報 or null
   */
  function getSlipError(slipErrors, tag) {
    const found = slipErrors.find(e => e.tag === tag);
    return found || null;
  }

  // =============================================
  // ユーティリティ
  // =============================================

  function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes > 0) {
      return `${minutes}分${remainingSeconds}秒`;
    }
    return `${seconds}秒`;
  }

  function formatDate(isoString) {
    const date = new Date(isoString);
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // =============================================
  // エクスポート
  // =============================================

  global.PickingTrainer = {
    getBestScore,
    migrateHistory,
    migrateProducts,
    trimHistory,
    generateRandomTask,
    generateRandomTasks,
    generateTaskWithStock,
    generateSlips,
    validateSlipGeneration,
    isAllSlipsCompleted,
    getSlipsSummary,
    getSlipVerificationSummary,
    validateProductEdit,
    toggleSlipError,
    updateSlipErrorCount,
    updateSlipErrorMemo,
    getSlipError,
    formatDuration,
    formatDate,
    escapeHtml
  };

})(typeof window !== 'undefined' ? window : globalThis);
