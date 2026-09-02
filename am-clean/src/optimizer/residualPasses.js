import {
  flattenPaxCircuits,
  getRouteBoardedPax,
  refreshPaxSummary,
  remainingDemandAfterPassMetrics,
  totalProfitOfCircuits,
  totalTimeOfCircuits,
} from "../utils/paxResultUtils";

export const DEFAULT_RESIDUAL_ECO_THRESHOLD = 1500;

const RESIDUAL_THRESHOLD_CANDIDATES = [
  400,
  500,
  750,
  1000,
];

function durationBuckets168(result) {
  const { all168 } = flattenPaxCircuits(result);

  return all168.reduce(
    (acc, circuit) => {
      const totalTime = Number(circuit.totalTime || 0);

      if (totalTime >= 160) acc.near168 += 1;
      else if (totalTime >= 140) acc.mid168 += 1;
      else acc.low168 += 1;

      return acc;
    },
    { near168: 0, mid168: 0, low168: 0 }
  );
}

function buildResidualDemandRoutes(
  result,
  thresholdEco = DEFAULT_RESIDUAL_ECO_THRESHOLD
) {
  const { all168 } = flattenPaxCircuits(result);
  const residualRoutes = [];
  const seen = new Set();

  for (const circuit of all168) {
    for (const route of circuit.routes || []) {
      const routeBoarded = getRouteBoardedPax(route, circuit);
      const remainingEco = Math.max(0, (route.dEco || 0) - routeBoarded.eco);
      if (remainingEco < thresholdEco) continue;

      const remainingBus = Math.max(0, (route.dBus || 0) - routeBoarded.bus);
      const remainingFirst = Math.max(0, (route.dFirst || 0) - routeBoarded.first);
      const originalId = route.originalId || route.id;
      const residualId = `${originalId}__residual_${residualRoutes.length + 1}`;

      if (seen.has(originalId)) continue;
      seen.add(originalId);

      residualRoutes.push({
        ...route,
        id: residualId,
        originalId,
        isResidualDemand: true,
        sourceCircuitType: circuit.type,
        dEco: remainingEco,
        dBus: remainingBus,
        dFirst: remainingFirst,
        demandEco: remainingEco,
        demandBus: remainingBus,
        demandFirst: remainingFirst,
      });
    }
  }

  return residualRoutes;
}

function markResidualCircuit(circuit) {
  return {
    ...circuit,
    pool: "résidu demande",
    isResidualSecondPass: true,
    type: `${circuit.type || "circuit"} [résidu demande]`,
    routes: (circuit.routes || []).map((route) => ({
      ...route,
      isResidualDemand: true,
    })),
  };
}

function markResidualSecondPassResult(result) {
  const byAircraft = (result.byAircraft || []).map((item) => ({
    ...item,
    circuits168: (item.circuits168 || []).map(markResidualCircuit),
    circuits84: (item.circuits84 || []).map(markResidualCircuit),
    circuits24: (item.circuits24 || []).map(markResidualCircuit),
  }));

  return {
    ...result,
    byAircraft,
  };
}

function mergeResidualSecondPassResult(
  baseResult,
  residualResult,
  residualRoutesCount,
  thresholdEco,
  extra = {}
) {
  const { all168, all84, all24 } = flattenPaxCircuits(residualResult);

  const residualSecondPassProfit =
    totalProfitOfCircuits(all168) +
    totalProfitOfCircuits(all84) +
    totalProfitOfCircuits(all24);

  const residualSecondPassTime =
    totalTimeOfCircuits(all168) +
    totalTimeOfCircuits(all84) +
    totalTimeOfCircuits(all24);

  if (!residualResult?.byAircraft?.length) {
    return {
      ...baseResult,
      ...remainingDemandAfterPassMetrics(baseResult),
      ...extra,
      residualSecondPass: true,
      residualSecondPassRoutes: residualRoutesCount,
      residualSecondPassCircuits: 0,
      residualSecondPassProfit: 0,
      residualSecondPassProfitPerHour: 0,
      residualSecondPassThreshold: thresholdEco,
    };
  }

  const mergedByAircraft = new Map();

  for (const item of baseResult.byAircraft || []) {
    const key = `${item.aircraft?.brand || ""}|${item.aircraft?.model || ""}`;

    mergedByAircraft.set(key, {
      ...item,
      circuits168: [...(item.circuits168 || [])],
      circuits84: [...(item.circuits84 || [])],
      circuits24: [...(item.circuits24 || [])],
    });
  }

  for (const item of residualResult.byAircraft || []) {
    const key = `${item.aircraft?.brand || ""}|${item.aircraft?.model || ""}`;

    if (!mergedByAircraft.has(key)) {
      mergedByAircraft.set(key, {
        aircraft: item.aircraft,
        circuits168: [],
        circuits84: [],
        circuits24: [],
      });
    }

    const target = mergedByAircraft.get(key);
    target.circuits168.push(...(item.circuits168 || []));
    target.circuits84.push(...(item.circuits84 || []));
    target.circuits24.push(...(item.circuits24 || []));
  }

  const byAircraft = [...mergedByAircraft.values()].map((item) => ({
    ...item,
    best168: item.circuits168[0] || null,
    best84: item.circuits84[0] || null,
    best24: item.circuits24[0] || null,
    totalProfit168: totalProfitOfCircuits(item.circuits168),
    totalProfit84: totalProfitOfCircuits(item.circuits84),
    totalProfit24: totalProfitOfCircuits(item.circuits24),
  }));

  const mergedResult = refreshPaxSummary(baseResult, byAircraft, {
    ...extra,
    residualSecondPass: true,
    residualSecondPassRoutes: residualRoutesCount,
    residualSecondPassCircuits: all168.length + all84.length + all24.length,
    residualSecondPassProfit,
    residualSecondPassProfitPerHour:
      residualSecondPassTime > 0
        ? residualSecondPassProfit / residualSecondPassTime
        : 0,
    residualSecondPassThreshold: thresholdEco,
  });

  return {
    ...mergedResult,
    ...remainingDemandAfterPassMetrics(mergedResult),
  };
}

export function applyResidualSecondPassToPaxResult({
  result,
  residualSourceResult,
  effectiveFilteredAc,
  bandSize,
  thresholdEco = DEFAULT_RESIDUAL_ECO_THRESHOLD,
  runPaxCircuitOptimizer,
  useAuxRevenue = false,
  useFleetChoiceAtCreation = false,
  extra = {},
}) {
  if (!Array.isArray(result?.byAircraft)) return result;

  const sourceResult = residualSourceResult || result;
  const residualRoutes = buildResidualDemandRoutes(sourceResult, thresholdEco);

  if (!residualRoutes.length) {
    return {
      ...result,
      ...remainingDemandAfterPassMetrics(result),
      ...extra,
      residualSecondPass: true,
      residualSecondPassRoutes: 0,
      residualSecondPassCircuits: 0,
      residualSecondPassProfit: 0,
      residualSecondPassProfitPerHour: 0,
      residualSecondPassThreshold: thresholdEco,
      residualSecondPassSource: residualSourceResult
        ? "avant repack"
        : "résultat courant",
    };
  }

  const residualResultRaw = runPaxCircuitOptimizer(
    effectiveFilteredAc,
    residualRoutes,
    bandSize,
    {
      useTrue84: false,
      useAuxRevenue,
      useFleetChoiceAtCreation,
      strictEcoDemandIsolation: true,
      ecoDemandHighThreshold: thresholdEco,
      ecoDemandExhaustedThreshold: Math.max(5, thresholdEco - 1),
    }
  );

  const residualResult = markResidualSecondPassResult(residualResultRaw);

  return mergeResidualSecondPassResult(
    result,
    residualResult,
    residualRoutes.length,
    thresholdEco,
    extra
  );
}

function uniqueSortedThresholds(values) {
  return [...new Set(values.filter((v) => Number.isFinite(v) && v > 0))].sort(
    (a, b) => a - b
  );
}

function scoreResidualThresholdResult(result) {
  const profit = result.residualSecondPassProfit || 0;
  const profitPerHour = result.residualSecondPassProfitPerHour || 0;
  const circuits = result.residualSecondPassCircuits || 0;
  const buckets = durationBuckets168(result);

  return (
    profit +
    profitPerHour * 1500 +
    circuits * 250000 +
    buckets.near168 * 650000 +
    buckets.mid168 * 120000 -
    buckets.low168 * 500000
  );
}

export function applyAdaptiveResidualSecondPassToPaxResult({
  result,
  residualSourceResult,
  effectiveFilteredAc,
  bandSize,
  baseThreshold,
  runPaxCircuitOptimizer,
  useAuxRevenue = false,
  useFleetChoiceAtCreation = false,
}) {
  const thresholds = uniqueSortedThresholds([
    ...RESIDUAL_THRESHOLD_CANDIDATES,
    baseThreshold,
  ]);

  const evaluations = thresholds.map((thresholdEco) => {
    const candidate = applyResidualSecondPassToPaxResult({
      result,
      residualSourceResult,
      effectiveFilteredAc,
      bandSize,
      thresholdEco,
      runPaxCircuitOptimizer,
      useAuxRevenue,
      useFleetChoiceAtCreation,
      extra: { autoResidualThreshold: true },
    });

    const buckets = durationBuckets168(candidate);

    return {
      thresholdEco,
      score: scoreResidualThresholdResult(candidate),
      result: candidate,
      buckets,
    };
  });

  const best = evaluations.reduce((bestEval, evaluation) => {
    if (!bestEval || evaluation.score > bestEval.score) return evaluation;
    return bestEval;
  }, null);

  return {
    ...best.result,
    autoResidualThreshold: true,
    selectedResidualThreshold: best.thresholdEco,
    testedResidualThresholds: evaluations.map(
      ({ thresholdEco, score, result, buckets }) => ({
        thresholdEco,
        score,
        routes: result.residualSecondPassRoutes || 0,
        circuits: result.residualSecondPassCircuits || 0,
        profit: result.residualSecondPassProfit || 0,
        profitPerHour: result.residualSecondPassProfitPerHour || 0,
        near168: buckets.near168,
        mid168: buckets.mid168,
        low168: buckets.low168,
      })
    ),
  };
}