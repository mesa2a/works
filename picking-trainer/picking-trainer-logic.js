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
   * 残在庫を考慮して1タスクを生成する
   * @param {Array} products - 商品マスタ
   * @param {Object} remainingStock - { code: 残在庫数 } の辞書（破壊的に更新される）
   * @param {Set} [usedCodes] - 同一伝票内で既に使用した商品コードのSet
   * @returns {Object|null} タスク or null（在庫切れ）
   */
  function generateTaskWithStock(products, remainingStock, usedCodes) {
    let available = products.filter(p => (remainingStock[p.code] ?? (p.stock ?? 99)) > 0);
    if (usedCodes) {
      available = available.filter(p => !usedCodes.has(p.code));
    }
    if (available.length === 0) return null;

    const product = available[Math.floor(Math.random() * available.length)];
    const stock = remainingStock[product.code] ?? (product.stock ?? 99);
    const quantity = Math.min(Math.floor(Math.random() * 3) + 1, stock);
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
  function generateSlips(products, slipCount, itemsPerSlip) {
    const remainingStock = {};
    products.forEach(p => {
      remainingStock[p.code] = p.stock ?? 99;
    });

    const slips = [];
    for (let i = 0; i < slipCount; i++) {
      const tasks = [];
      const usedCodes = new Set();
      for (let j = 0; j < itemsPerSlip; j++) {
        const task = generateTaskWithStock(products, remainingStock, usedCodes);
        if (task) {
          usedCodes.add(task.product.code);
          tasks.push(task);
        }
      }
      slips.push({
        slipId: 'slip-' + i,
        slipNumber: i + 1,
        tasks: tasks,
        completed: false
      });
    }
    return slips;
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
    generateSlips,
    isAllSlipsCompleted,
    getSlipsSummary,
    formatDuration,
    formatDate,
    escapeHtml
  };

})(typeof window !== 'undefined' ? window : globalThis);
