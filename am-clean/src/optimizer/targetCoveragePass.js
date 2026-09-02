import {
  allPaxCircuits,
  flattenPaxCircuits,
  getRouteBoardedPax,
  mergePaxResults,
  refreshPaxSummary,
  totalProfitOfCircuits,
  totalTimeOfCircuits,
  remainingDemandAfterPassMetrics,
} from "../utils/paxResultUtils";

const TARGET_COVERAGE_ECO = 0.9;
const TARGET_COVERAGE_BUS = 0.85;
const TARGET_COVERAGE_FIRST = 0.85;

const TARGET_COVERAGE_MAX_PASSES = 6;
const TARGET_COVERAGE_MIN_ROUTES = 10;
const TARGET_COVERAGE_MIN_PROFIT = 50_000_000;
const TARGET_COVERAGE_MIN_PROFIT_PER_HOUR = 50_000;

const TARGET_COVERAGE_MIN_ECO = 300;
const TARGET_COVERAGE_MIN_BUS = 40;
const TARGET_COVERAGE_MIN_FIRST = 15;

export function routeTargetCoverageState(result) {
  const demandByRoute = new Map();
  const boardedByRoute = new Map();
  const templateByRoute = new Map();

  for (const circuit of allPaxCircuits(result)) {
    for (const route of circuit.routes || []) {
      const originalId = route.originalId || route.id;
      const routeBoarded = getRouteBoardedPax(route, circuit);

      if (!templateByRoute.has(originalId) || !route.isResidualDemand) {
        templateByRoute.set(originalId, route);
      }

      if (!demandByRoute.has(originalId)) {
        demandByRoute.set(originalId, {
          eco: 0,
          bus: 0,
          first: 0,
        });
      }

      const demand = demandByRoute.get(originalId);

      if (!route.isResidualDemand) {
        demand.eco = Math.max(demand.eco, route.dEco || 0);
        demand.bus = Math.max(demand.bus, route.dBus || 0);
        demand.first = Math.max(demand.first, route.dFirst || 0);
      }

      if (!boardedByRoute.has(originalId)) {
        boardedByRoute.set(originalId, {
          eco: 0,
          bus: 0,
          first: 0,
        });
      }

      const boardedState = boardedByRoute.get(originalId);

      boardedState.eco += routeBoarded.eco;
      boardedState.bus += routeBoarded.bus;
      boardedState.first += routeBoarded.first;
    }
  }

  return [...demandByRoute.entries()]
    .map(([id, demand]) => {
      const rawBoarded = boardedByRoute.get(id) || { eco: 0, bus: 0, first: 0 };
      const boarded = {
        eco: Math.min(demand.eco, rawBoarded.eco),
        bus: Math.min(demand.bus, rawBoarded.bus),
        first: Math.min(demand.first, rawBoarded.first),
      };
      const template = templateByRoute.get(id);

      const targetEco = Math.floor(demand.eco * TARGET_COVERAGE_ECO);
      const targetBus = Math.floor(demand.bus * TARGET_COVERAGE_BUS);
      const targetFirst = Math.floor(demand.first * TARGET_COVERAGE_FIRST);

      return {
        id,
        template,
        demand,
        boarded,
        remainingEco: Math.max(0, targetEco - boarded.eco),
        remainingBus: Math.max(0, targetBus - boarded.bus),
        remainingFirst: Math.max(0, targetFirst - boarded.first),
      };
    })
    .filter((state) => state.template);
}

export function buildTargetCoverageRoutes(result, passIndex) {
  return routeTargetCoverageState(result)
    .filter((state) => {
      const hasEcoResidual = state.remainingEco >= TARGET_COVERAGE_MIN_ECO;
      const hasBusResidual = state.remainingBus >= TARGET_COVERAGE_MIN_BUS;
      const hasFirstResidual = state.remainingFirst >= TARGET_COVERAGE_MIN_FIRST;
      const ecoExhaustedOnly =
        state.remainingEco <= 0 && (hasBusResidual || hasFirstResidual);

      return hasEcoResidual || ecoExhaustedOnly;
    })
    .map((state, index) => ({
      ...state.template,
      _sourceCoverageState: state,
      id: `${state.id}__targetCoverage_${passIndex}_${index + 1}`,
      originalId: state.id,
      isResidualDemand: true,
      residualWave: `targetCoverage${passIndex}`,
      dEco: Math.ceil(state.remainingEco),
      dBus: Math.ceil(state.remainingBus),
      dFirst: Math.ceil(state.remainingFirst),
      demandEco: Math.ceil(state.remainingEco),
      demandBus: Math.ceil(state.remainingBus),
      demandFirst: Math.ceil(state.remainingFirst),
    }));
}

function splitTargetCoveragePools(targetRoutes) {
  const ecoActiveRoutes = targetRoutes.filter(
    (route) => (route.dEco || 0) >= TARGET_COVERAGE_MIN_ECO
  );
  const ecoExhaustedRoutes = targetRoutes.filter(
    (route) => (route.dEco || 0) <= 0
  );

  return { ecoActiveRoutes, ecoExhaustedRoutes };
}

export function markTargetCoverageCircuit(circuit, passIndex) {
  return {
    ...circuit,
    pool: `couverture cible ${passIndex}`,
    isTargetCoveragePass: true,
    targetCoveragePassIndex: passIndex,
    type: `${circuit.type || "circuit"} [couverture cible ${passIndex}]`,
    routes: (circuit.routes || []).map((route) => ({
      ...route,
      isResidualDemand: true,
      residualWave: `targetCoverage${passIndex}`,
    })),
  };
}

export function markTargetCoverageResult(result, passIndex) {
  const byAircraft = (result.byAircraft || []).map((item) => ({
    ...item,
    circuits168: (item.circuits168 || []).map((c) =>
      markTargetCoverageCircuit(c, passIndex)
    ),
    circuits84: (item.circuits84 || []).map((c) =>
      markTargetCoverageCircuit(c, passIndex)
    ),
    circuits24: (item.circuits24 || []).map((c) =>
      markTargetCoverageCircuit(c, passIndex)
    ),
  }));

  return {
    ...result,
    byAircraft,
  };
}

export function applyTargetCoveragePassToPaxResult({
  result,
  effectiveFilteredAc,
  bandSize,
  runPaxCircuitOptimizer,
  useAuxRevenue = false,
  useFleetChoiceAtCreation = false,
}) {
  if (!Array.isArray(result?.byAircraft)) return result;

  let currentResult = result;

  let totalTargetRoutes = 0;
  let totalTargetCircuits = 0;
  let totalTargetProfit = 0;
  let totalTargetTime = 0;
  let acceptedPasses = 0;

  for (let passIndex = 1; passIndex <= TARGET_COVERAGE_MAX_PASSES; passIndex++) {
    const targetRoutes = buildTargetCoverageRoutes(currentResult, passIndex);

    if (targetRoutes.length < TARGET_COVERAGE_MIN_ROUTES) {
      break;
    }

    const { ecoActiveRoutes, ecoExhaustedRoutes } =
      splitTargetCoveragePools(targetRoutes);
    const targetPools = [ecoActiveRoutes, ecoExhaustedRoutes].filter(
      (pool) => pool.length >= 2
    );

    if (!targetPools.length) {
      break;
    }

    const optimizerOptions = {
      useTrue84: false,
      useAuxRevenue,
      useFleetChoiceAtCreation: false,
      strictEcoDemandIsolation: true,
      preferCompactAircraft: true,
      isTargetCoveragePass: true,
      ecoDemandHighThreshold: TARGET_COVERAGE_MIN_ECO,
      ecoDemandExhaustedThreshold: 0,
    };

    let passByAircraft = [];

    for (const poolRoutes of targetPools) {
      const poolRaw = runPaxCircuitOptimizer(
        effectiveFilteredAc,
        poolRoutes,
        bandSize,
        optimizerOptions
      );

      if (!poolRaw?.byAircraft?.length) continue;

      const poolMarked = markTargetCoverageResult(poolRaw, passIndex);
      passByAircraft = mergePaxResults(
        { byAircraft: passByAircraft },
        poolMarked
      );
    }

    if (!passByAircraft.length) {
      break;
    }

    const passResult = { byAircraft: passByAircraft };
    const { all168, all84, all24 } = flattenPaxCircuits(passResult);
    const passCircuits = [...all168, ...all84, ...all24];

    const passProfit = totalProfitOfCircuits(passCircuits);
    const passTime = totalTimeOfCircuits(passCircuits);
    const passProfitPerHour = passTime > 0 ? passProfit / passTime : 0;

    const accepted =
      passCircuits.length > 0 &&
      passProfit >= TARGET_COVERAGE_MIN_PROFIT &&
      passProfitPerHour >= TARGET_COVERAGE_MIN_PROFIT_PER_HOUR;

    if (!accepted) {
      break;
    }

    const byAircraft = mergePaxResults(currentResult, passResult);

    currentResult = refreshPaxSummary(currentResult, byAircraft, {
      targetCoveragePass: true,
    });

    currentResult = {
      ...currentResult,
      ...remainingDemandAfterPassMetrics(currentResult),
    };

    totalTargetRoutes += targetRoutes.length;
    totalTargetCircuits += passCircuits.length;
    totalTargetProfit += passProfit;
    totalTargetTime += passTime;
    acceptedPasses += 1;
  }

  const finalCoverageStates = routeTargetCoverageState(currentResult);

  const targetCoverageTotalEcoDemand = finalCoverageStates.reduce(
    (sum, state) => sum + (state.demand.eco || 0),
    0
  );

  const targetCoverageTotalEcoBoarded = finalCoverageStates.reduce(
    (sum, state) =>
      sum + Math.min(state.demand.eco || 0, state.boarded.eco || 0),
    0
  );

  const targetCoverageEcoCoverage =
    targetCoverageTotalEcoDemand > 0
      ? (targetCoverageTotalEcoBoarded / targetCoverageTotalEcoDemand) * 100
      : 0;

  const targetCoverageRemainingEcoToTarget = finalCoverageStates.reduce(
    (sum, state) => sum + (state.remainingEco || 0),
    0
  );

  return {
    ...currentResult,
    targetCoveragePass: acceptedPasses > 0,
    targetCoveragePasses: acceptedPasses,
    targetCoverageRoutes: totalTargetRoutes,
    targetCoverageCircuits: totalTargetCircuits,
    targetCoverageProfit: totalTargetProfit,
    targetCoverageProfitPerHour:
      totalTargetTime > 0 ? totalTargetProfit / totalTargetTime : 0,
    targetCoverageEcoTarget: TARGET_COVERAGE_ECO,
    targetCoverageBusTarget: TARGET_COVERAGE_BUS,
    targetCoverageFirstTarget: TARGET_COVERAGE_FIRST,
    targetCoverageTotalEcoDemand,
    targetCoverageTotalEcoBoarded,
    targetCoverageEcoCoverage,
    targetCoverageRemainingEcoToTarget,
    ...remainingDemandAfterPassMetrics(currentResult),
  };
}