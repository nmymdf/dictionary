// 複習排程：FSRS(Anki 目前使用的演算法）的簡化實作
// 每張卡記「穩定度 s」（天）與「難度 d」（1–10）。評分 1 忘了 / 2 困難 / 3 記得 / 4 簡單。
// 下次間隔 = 讓記住機率剛好掉到目標保留率（預設 90%）的天數。
(function () {
  'use strict';
  const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925,
    1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
  const DECAY = -0.5;
  const FACTOR = Math.pow(0.9, 1 / DECAY) - 1; // 19/81
  const DAY = 86400000;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  const retrievability = (elapsedDays, s) => Math.pow(1 + FACTOR * elapsedDays / s, DECAY);
  const initS = (g) => Math.max(W[g - 1], 0.1);
  const initD = (g) => clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, 1, 10);

  function nextD(d, g) {
    const delta = -W[6] * (g - 3);
    const d1 = d + delta * (10 - d) / 9;
    return clamp(W[7] * initD(4) + (1 - W[7]) * d1, 1, 10);
  }
  function recallS(d, s, r, g) {
    const hard = g === 2 ? W[15] : 1;
    const easy = g === 4 ? W[16] : 1;
    return s * (Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * hard * easy + 1);
  }
  function forgetS(d, s, r) {
    return Math.min(s, W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r)));
  }
  function intervalDays(s, retention) {
    const days = s / FACTOR * (Math.pow(retention, 1 / DECAY) - 1);
    return clamp(Math.round(days), 1, 36500);
  }

  // 算出評分後的新狀態（不改原物件）
  function schedule(rv, g, retention = 0.9, now = Date.now()) {
    const out = { ...rv };
    if (!rv.reps || !rv.s) {
      out.s = initS(g);
      out.d = initD(g);
    } else {
      const elapsed = Math.max(0, (now - (rv.last || now)) / DAY);
      const r = retrievability(elapsed, rv.s);
      if (elapsed < 0.5) {
        // 同一天再複習：只做小幅調整
        out.s = Math.max(0.1, rv.s * Math.exp(W[17] * (g - 3 + W[18])));
      } else {
        out.s = g === 1 ? forgetS(rv.d, rv.s, r) : recallS(rv.d, rv.s, r, g);
      }
      out.d = nextD(rv.d, g);
    }
    const days = g === 1 ? 1 : intervalDays(out.s, retention);
    out.reps = (rv.reps || 0) + 1;
    if (g === 1 && rv.reps) out.lapses = (rv.lapses || 0) + 1;
    if (g === 1) out.wrong = (rv.wrong || 0) + 1; else out.right = (rv.right || 0) + 1;
    out.last = now;
    out.due = now + days * DAY;
    out.status = 'review';
    out.days = days;
    return out;
  }

  // 按鈕上顯示「下次間隔」
  function preview(rv, retention) {
    return [1, 2, 3, 4].map((g) => schedule(rv, g, retention).days);
  }
  // 讓「下次間隔 = days 天」需要的穩定度（用來指定第一次的間隔）
  function withFirstInterval(out, days, retention, now = Date.now()) {
    const s = days * FACTOR / (Math.pow(retention, 1 / DECAY) - 1);
    return { ...out, s: Math.max(out.s, s), days, due: now + days * DAY };
  }
  const fmtDays = (d) => (d < 30 ? `${d} 天` : d < 365 ? `${Math.round(d / 30)} 個月` : `${(d / 365).toFixed(1)} 年`);

  window.SRS = { schedule, preview, fmtDays, retrievability, withFirstInterval };
})();
