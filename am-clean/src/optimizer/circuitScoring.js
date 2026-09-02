import { fillExact } from "./fillExact";
import { routesEcoDemandCompatible } from "../utils/paxResultUtils";

export function demandSpread(chosen) {
  if (!chosen || chosen.length < 2) return Infinity;

  const vals = (key) => chosen.map((r) => r[key] || 0).filter((v) => v > 0);

  const spread = (arr) => {
    if (!arr.length) return 0;
    return Math.max(...arr) - Math.min(...arr);
  };

  return (
    spread(vals("dEco")) * 1 +
    spread(vals("dBus")) * 0.35 +
    spread(vals("dFirst")) * 0.25
  );
}

export function circuitFitScore(chosen, targetH = 168) {
  if (!chosen || chosen.length < 2) return Infinity;

  const totalTime = chosen.reduce((s, r) => s + (r.ft || 0), 0);
  const timeGap = Math.abs(targetH - totalTime);
  const fillRatio = targetH > 0 ? totalTime / targetH : 0;
  const paxSpread = demandSpread(chosen);

  const under95Penalty = fillRatio < 0.95 ? (0.95 - fillRatio) * 20000 : 0;
  const under90Penalty = fillRatio < 0.9 ? (0.9 - fillRatio) * 50000 : 0;

  // Score bas = meilleur.
  // Priorité : rester proche de 168h, puis rapprocher surtout l'éco.
  return timeGap * 250 + paxSpread + under95Penalty + under90Penalty;
}

function routeDemandDistance(a, b) {
  return (
    Math.abs((a.dEco || 0) - (b.dEco || 0)) * 1 +
    Math.abs((a.dBus || 0) - (b.dBus || 0)) * 0.35 +
    Math.abs((a.dFirst || 0) - (b.dFirst || 0)) * 0.25
  );
}

function routeDemandSignature(route) {
  return (
    (route.dEco || 0) +
    (route.dBus || 0) * 0.35 +
    (route.dFirst || 0) * 0.25
  );
}

function circuitRoutesScore(routes, targetH = 168) {
  if (!routes || routes.length < 2) return Infinity;

  const totalTime = routes.reduce((s, r) => s + (r.ft || 0), 0);
  if (totalTime > targetH + 0.01) return Infinity;

  return circuitFitScore(routes, targetH);
}

function rebuildCircuitWithRoutes(circuit, routes, targetH = 168) {
  const totalTime = routes.reduce((s, r) => s + (r.ft || 0), 0);
  const totalProfit = routes.reduce((s, r) => s + (r.profit || 0), 0);
  const totalRev = routes.reduce((s, r) => s + Math.max(0, r.grossPaxRev || 0), 0);

  return {
    ...circuit,
    routes: routes.map((r) => ({ ...r, rotations: r.rotations || 1 })),
    routeIds: routes.map((r) => r.id),
    totalTime,
    totalProfit,
    totalRev,
    profitPerHour: totalTime > 0 ? totalProfit / totalTime : 0,
    routeCount: routes.length,
    fillRate: ((totalTime / targetH) * 100).toFixed(1),
  };
}

export function repackSimilarDemandCircuits168(circuits, options = {}) {
  const {
    maxPasses = 2,
    maxRouteDistance = 260,
    targetH = 168,
    minFillRatio = 0.95,
    rebuildCircuit = rebuildCircuitWithRoutes,
  } = options;

  if (!Array.isArray(circuits) || circuits.length < 2) return circuits || [];

  // Tous les circuits 168h sont éligibles, même les circuits courts à 60h/100h.
  // Les circuits déjà proches de 168h sont seulement protégés contre une dégradation.
  let work = circuits.map((c) => ({
    ...c,
    routes: (c.routes || []).map((r) => ({ ...r, rotations: r.rotations || 1 })),
  }));

  const minTime = targetH * minFillRatio;

  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;

    for (let i = 0; i < work.length; i++) {
      for (let j = i + 1; j < work.length; j++) {
        const circuitA = work[i];
        const circuitB = work[j];
        const routesA = circuitA.routes || [];
        const routesB = circuitB.routes || [];

        if (routesA.length < 2 || routesB.length < 2) continue;

        const baseScore =
          circuitRoutesScore(routesA, targetH) +
          circuitRoutesScore(routesB, targetH);

        let bestSwap = null;
        let bestScore = baseScore;

        for (let ai = 0; ai < routesA.length; ai++) {
          for (let bi = 0; bi < routesB.length; bi++) {
            const routeA = routesA[ai];
            const routeB = routesB[bi];

            // Évite les comparaisons inutiles entre routes trop éloignées en demande.
            if (routeDemandDistance(routeA, routeB) > maxRouteDistance) continue;

            const nextA = [...routesA];
            const nextB = [...routesB];
            nextA[ai] = routeB;
            nextB[bi] = routeA;

            const timeA = nextA.reduce((s, r) => s + (r.ft || 0), 0);
            const timeB = nextB.reduce((s, r) => s + (r.ft || 0), 0);

            // On ne force pas chaque circuit à 95%, mais on évite d'empirer les circuits déjà bons.
            if (circuitA.totalTime >= minTime && timeA < minTime) continue;
            if (circuitB.totalTime >= minTime && timeB < minTime) continue;

            const nextScore =
              circuitRoutesScore(nextA, targetH) +
              circuitRoutesScore(nextB, targetH);

            if (nextScore < bestScore - 0.001) {
              bestScore = nextScore;
              bestSwap = { nextA, nextB };
            }
          }
        }

        if (bestSwap) {
          work[i] = rebuildCircuit(circuitA, bestSwap.nextA, targetH);
          work[j] = rebuildCircuit(circuitB, bestSwap.nextB, targetH);
          changed = true;
        }
      }
    }

    if (!changed) break;

    work = [...work].sort((a, b) => {
      const fillA = Math.abs(targetH - (a.totalTime || 0));
      const fillB = Math.abs(targetH - (b.totalTime || 0));
      if (fillA !== fillB) return fillA - fillB;
      return (
        routeDemandSignature((b.routes || [])[0] || {}) -
        routeDemandSignature((a.routes || [])[0] || {})
      );
    });
  }

  return work;
}

export function fillBestDemandCircuit(
  candidates,
  targetH = 168,
  tolerance = 36,
  options = {}
) {
  if (!candidates || candidates.length < 2) return [];

  const {
    strictEcoDemandIsolation = false,
    ecoDemandHighThreshold = 300,
    ecoDemandExhaustedThreshold = 5,
  } = options;

  const isEcoDemandCompatible = (routes) =>
    !strictEcoDemandIsolation ||
    routesEcoDemandCompatible(routes, {
      highEcoThreshold: ecoDemandHighThreshold,
      exhaustedEcoThreshold: ecoDemandExhaustedThreshold,
    });

  const sorted = [...candidates].sort((a, b) => {
    if ((b.ft || 0) !== (a.ft || 0)) {
      return (b.ft || 0) - (a.ft || 0);
    }

    return (b.dEco || 0) - (a.dEco || 0);
  });

  let best = [];
  let bestScore = Infinity;

  // On teste plusieurs routes de départ pour éviter
  // qu'un seul fillExact choisisse un circuit trop orienté durée.
  const anchors = sorted.slice(0, Math.min(30, sorted.length));

  for (const anchor of anchors) {
    const remaining = sorted.filter((r) => r.id !== anchor.id);

    const rest = fillExact(remaining, targetH - anchor.ft, tolerance);
    const chosen = [anchor, ...rest];

    if (chosen.length < 2) continue;
    if (!isEcoDemandCompatible(chosen)) continue;

    const totalTime = chosen.reduce((s, r) => s + (r.ft || 0), 0);

    if (Math.abs(targetH - totalTime) > tolerance) continue;

    const score = circuitFitScore(chosen, targetH);

    if (score < bestScore) {
      bestScore = score;
      best = chosen;
    }
  }

  // Sécurité : si aucun bon circuit trouvé, on garde l'ancien comportement.
  return best.length >= 2 ? best : fillExact(candidates, targetH, tolerance);
}
