// Beam search de remplissage de circuit — objectif : bénéfice net total.
// RÈGLE DURE : totalTime ne dépasse JAMAIS targetH.

const EPS = 1e-6;

function stateSignature(ids) {
  return [...ids].sort().join("|");
}

function stateScore(state) {
  return state.totalProfit;
}

function compareStates(a, b, targetH) {
  const profitDelta = stateScore(b) - stateScore(a);
  if (Math.abs(profitDelta) > 1) return profitDelta;

  const gapA = Math.abs(targetH - a.totalTime);
  const gapB = Math.abs(targetH - b.totalTime);
  if (gapA !== gapB) return gapA - gapB;

  return (b.routes?.length || 0) - (a.routes?.length || 0);
}

export function beamPackCircuits(eligibleRoutes, options = {}) {
  const {
    targetH = 168,
    beamWidth = 16,
    maxBranchPerStep = 8,
    maxCandidatesOut = 6,
    minFillRatio = 0.5,
    forcedAnchor = null,
    maxSteps = 60,
    deadline = null,
  } = options;

  const safePool = eligibleRoutes.filter((r) => (r.ft || 0) <= targetH + EPS);
  if (!safePool.length && !forcedAnchor) return [];
  if (forcedAnchor && (forcedAnchor.ft || 0) > targetH + EPS) return [];

  const sortedPool = [...safePool].sort(
    (a, b) => (b.profit || 0) - (a.profit || 0) || (b.ft || 0) - (a.ft || 0)
  );

  const initial = forcedAnchor
    ? {
        routes: [forcedAnchor],
        ids: new Set([forcedAnchor.id]),
        totalTime: forcedAnchor.ft,
        totalProfit: forcedAnchor.profit || 0,
      }
    : { routes: [], ids: new Set(), totalTime: 0, totalProfit: 0 };

  let beam = [initial];
  const finished = [];
  const seenSignatures = new Set();

  const registerIfFinished = (state) => {
    if (state.routes.length >= 2 && state.totalTime >= targetH * minFillRatio - EPS) {
      finished.push(state);
    }
  };

  for (let step = 0; step < maxSteps; step++) {
    if (!beam.length) break;
    if (deadline && Date.now() >= deadline) break;
    const nextBeam = [];

    for (const state of beam) {
      const remaining = targetH - state.totalTime;

      if (remaining < 0.25) {
        registerIfFinished(state);
        continue;
      }

      const candidates = sortedPool
        .filter((r) => !state.ids.has(r.id) && r.ft <= remaining + EPS)
        .sort((a, b) => {
          const profitDelta = (b.profit || 0) - (a.profit || 0);
          if (Math.abs(profitDelta) > 1) return profitDelta;
          return Math.abs(remaining - a.ft) - Math.abs(remaining - b.ft);
        })
        .slice(0, maxBranchPerStep);

      if (!candidates.length) {
        registerIfFinished(state);
        continue;
      }

      for (const route of candidates) {
        const newTime = state.totalTime + route.ft;
        if (newTime > targetH + EPS) continue;

        const newIds = new Set(state.ids);
        newIds.add(route.id);

        nextBeam.push({
          routes: [...state.routes, route],
          ids: newIds,
          totalTime: newTime,
          totalProfit: state.totalProfit + (route.profit || 0),
        });
      }
    }

    const ranked = nextBeam.sort((a, b) => compareStates(a, b, targetH));

    const pruned = [];
    for (const state of ranked) {
      const sig = stateSignature(state.ids);
      if (seenSignatures.has(sig)) continue;
      seenSignatures.add(sig);
      pruned.push(state);
      registerIfFinished(state);
      if (pruned.length >= beamWidth) break;
    }

    beam = pruned;
  }

  const rankedFinished = finished.sort((a, b) => compareStates(a, b, targetH));

  const out = [];
  const used = new Set();
  for (const state of rankedFinished) {
    const sig = stateSignature(state.ids);
    if (used.has(sig)) continue;
    used.add(sig);
    out.push(state);
    if (out.length >= maxCandidatesOut) break;
  }

  return out;
}

export function beamPackCircuitsMultiAnchor(pool, options = {}) {
  const { maxCandidatesOut = 6, anchorCount = 4, deadline = null } = options;
  if (pool.length < 2) return [];

  const seen = new Set();
  const merged = [];

  const collect = (states) => {
    for (const state of states) {
      const sig = stateSignature(state.ids);
      if (seen.has(sig)) continue;
      seen.add(sig);
      merged.push(state);
    }
  };

  collect(beamPackCircuits(pool, options));

  const anchors = [...pool]
    .sort((a, b) => (b.profit || 0) - (a.profit || 0))
    .slice(0, anchorCount);

  for (const anchor of anchors) {
    if (deadline && Date.now() >= deadline) break;
    const rest = pool.filter((r) => r.id !== anchor.id);
    collect(beamPackCircuits(rest, { ...options, forcedAnchor: anchor }));
  }

  merged.sort((a, b) => (b.totalProfit || 0) - (a.totalProfit || 0));
  return merged.slice(0, maxCandidatesOut);
}
