export function fillExact(candidates, targetH, tolerance) {
  if (!candidates.length) return [];

  const STEP = 0.25;
  const CAP = Math.round(targetH / STEP);
  const TOL = Math.round((tolerance || 0.5) / STEP);

  const sorted = [...candidates].sort((a, b) => {
    const ftA = Math.round(a.ft / 0.25) * 0.25;
    const ftB = Math.round(b.ft / 0.25) * 0.25;

    if (ftA !== ftB) return ftB - ftA;

    const dA = a.dEco || a.demand || 0;
    const dB = b.dEco || b.demand || 0;

    return dB - dA;
  });

  const items = sorted
    .map((r) => ({
      ...r,
      slots: Math.round(r.ft / STEP),
    }))
    .filter((r) => r.slots > 0 && r.slots <= CAP);

  if (!items.length) return [];

  const dp = new Uint8Array(CAP + 1);
  const from = new Int16Array(CAP + 1).fill(-1);
  const prev = new Int32Array(CAP + 1).fill(-1);

  dp[0] = 1;

  for (let i = 0; i < items.length; i++) {
    const s = items[i].slots;

    for (let cap = CAP; cap >= s; cap--) {
      if (dp[cap - s] && !dp[cap]) {
        dp[cap] = 1;
        from[cap] = i;
        prev[cap] = cap - s;
      }
    }
  }

  let best = -1;

  for (let d = 0; d <= TOL; d++) {
    if (CAP - d >= 0 && dp[CAP - d]) {
      best = CAP - d;
      break;
    }

    if (CAP + d < dp.length && dp[CAP + d]) {
      best = CAP + d;
      break;
    }
  }

  if (best < 0) return ffd(candidates, targetH);

  const chosen = [];
  let cur = best;

  while (cur > 0 && from[cur] >= 0) {
    chosen.push(items[from[cur]]);
    cur = prev[cur];
  }

  return chosen;
}

export function ffd(candidates, targetH) {
  const sorted = [...candidates].sort((a, b) => {
    const ftA = Math.round(a.ft / 0.25) * 0.25,
      ftB = Math.round(b.ft / 0.25) * 0.25;
    if (ftA !== ftB) return ftB - ftA;
    return (b.dEco || b.demand || 0) - (a.dEco || a.demand || 0);
  });
  const circuit = [];
  let left = targetH;
  for (const r of sorted) {
    if (r.ft <= left + 0.001) {
      circuit.push(r);
      left -= r.ft;
    }
    if (left < 0.25) break;
  }
  return circuit;
}
