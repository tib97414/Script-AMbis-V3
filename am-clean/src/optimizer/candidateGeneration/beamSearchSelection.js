import {
  candidatePassesSelectionFilters,
  getCandidateConflictKeys,
  getCandidateDemandLayer,
  prepareCandidatesForSelection,
} from "./candidateSelection";

export const DEFAULT_BEAM_LAYER_ORDER = Object.freeze([
  "sourceCircuitChoice",
  "base24",
  "residualSecondPass",
  "targetCoverage",
]);

export const DEFAULT_BEAM_COMPLETION_LAYER_ORDER = Object.freeze([
  "targetCoverage",
  "residualSecondPass",
  "base24",
  "sourceCircuitChoice",
]);

const DEFAULT_MAX_CANDIDATES_BY_LAYER = Object.freeze({
  sourceCircuitChoice: 180,
  base24: 20,
  residualSecondPass: 90,
  targetCoverage: 90,
});

const DEFAULT_BEAM_OBJECTIVE_WEIGHTS = Object.freeze({
  profit: 1,
  profitPerHour: 0,
  score: 0,
  selectedCount: 0,
  layerCount: {},
});

function isFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return false;
  return Number.isFinite(Number(value));
}

function groupCandidatesByDemandLayer(candidates = []) {
  return candidates.reduce((acc, candidate) => {
    const layer = getCandidateDemandLayer(candidate);
    if (!acc[layer]) acc[layer] = [];
    acc[layer].push(candidate);
    return acc;
  }, {});
}

function routeName(route) {
  return route?.name || route?.route || route?.id || "";
}

function routeId(route) {
  return route?.id || route?.routeId || route?.key || routeName(route);
}

function compactFleet(candidate) {
  return (
    candidate?.fleetKeys?.join(" + ") ||
    candidate?.metadata?.currentAircraft ||
    candidate?.aircraftFleet
      ?.map((plane) => plane?.label || `${plane?.brand || ""} ${plane?.model || ""}`.trim())
      .filter(Boolean)
      .join(" + ") ||
    ""
  );
}

function compactSelectedColumns(selected = []) {
  return selected.map((candidate, index) => ({
    index: index + 1,
    id: candidate.id,
    type: candidate.type,
    source: candidate.source,
    layer: getCandidateDemandLayer(candidate),
    sourceVariantKind: candidate.metadata?.sourceVariantKind || "",
    windowH: candidate.windowH,
    routeCount: candidate.routes?.length || candidate.metadata?.routeCount || 0,
    fleet: compactFleet(candidate),
    totalTime: candidate.totalTime || 0,
    totalProfit: candidate.totalProfit || 0,
    profitPerHour: candidate.profitPerHour || 0,
    fillRate: candidate.fillRate || 0,
    score: candidate.score || 0,
    gain: candidate.metadata?.gain || 0,
    currentAircraft: candidate.metadata?.currentAircraft || "",
    routeNames: (candidate.routes || []).map(routeName).join(" | "),
    routeIds: (candidate.routes || []).map(routeId).join(" | "),
    tags: (candidate.tags || []).join(" / "),
  }));
}

function compactSelectedColumnRoutes(selected = []) {
  const rows = [];

  selected.forEach((candidate, columnIndex) => {
    const layer = getCandidateDemandLayer(candidate);
    const fleet = compactFleet(candidate);

    (candidate.routes || []).forEach((route, routeIndex) => {
      rows.push({
        columnIndex: columnIndex + 1,
        columnId: candidate.id,
        layer,
        type: candidate.type,
        source: candidate.source,
        sourceVariantKind: candidate.metadata?.sourceVariantKind || "",
        windowH: candidate.windowH,
        fleet,
        routeIndex: routeIndex + 1,
        route: routeName(route),
        routeId: routeId(route),
        distance: route.distance || 0,
        category: route.category || "",
        flightTime: route.ft || route.time || 0,
        dEco: route.dEco || route.demandEco || 0,
        dBus: route.dBus || route.demandBus || 0,
        dFirst: route.dFirst || route.demandFirst || 0,
        dCargo: route.dCargo || route.demandCargo || 0,
        tax: route.tax || 0,
        revenue: Math.round(route.rev || route.revenue || 0),
        profit: Math.round(route.profit || route.totalProfit || 0),
      });
    });
  });

  return rows;
}

function stateObjective(state, objectiveWeights = DEFAULT_BEAM_OBJECTIVE_WEIGHTS) {
  const profitPerHour = state.totalTime > 0 ? state.totalProfit / state.totalTime : 0;
  const selectedCountBonus =
    state.selected.length * (objectiveWeights.selectedCount || 0);

  let layerCountBonus = 0;
  const layerWeights = objectiveWeights.layerCount || {};

  for (const [layer, count] of Object.entries(state.selectedByLayer || {})) {
    layerCountBonus += count * (layerWeights[layer] || 0);
  }

  return (
    state.totalProfit * (objectiveWeights.profit ?? 1) +
    profitPerHour * (objectiveWeights.profitPerHour || 0) +
    state.totalScore * (objectiveWeights.score || 0) +
    selectedCountBonus +
    layerCountBonus
  );
}

function finalStateObjective(state) {
  const profitPerHour = state.totalTime > 0 ? state.totalProfit / state.totalTime : 0;
  return state.totalProfit + profitPerHour * 1e-9;
}

function cloneStateWithCandidate(state, candidate, conflictKeys, layer) {
  const usedConflictKeys = new Set(state.usedConflictKeys);
  for (const key of conflictKeys) usedConflictKeys.add(key);

  return {
    selected: [...state.selected, candidate],
    usedConflictKeys,
    selectedByLayer: {
      ...state.selectedByLayer,
      [layer]: (state.selectedByLayer[layer] || 0) + 1,
    },
    totalProfit: state.totalProfit + (candidate.totalProfit || 0),
    totalTime: state.totalTime + (candidate.totalTime || 0),
    totalScore: state.totalScore + (candidate.score || 0),
  };
}

function stateCanTakeCandidate(state, candidate, options, layer) {
  const {
    conflictMode = "routeDemandLayerOrCircuit",
    maxCandidates = null,
    maxCandidatesByLayer = {},
    minScoreByLayer = {},
    minProfitByLayer = {},
    minProfitPerHourByLayer = {},
    minFillRateByLayer = {},
  } = options;

  if (
    isFiniteNumber(maxCandidates) &&
    state.selected.length >= Number(maxCandidates)
  ) {
    return { ok: false, reason: "limit", conflictKeys: [] };
  }

  const layerLimit = maxCandidatesByLayer[layer];
  if (
    isFiniteNumber(layerLimit) &&
    (state.selectedByLayer[layer] || 0) >= Number(layerLimit)
  ) {
    return { ok: false, reason: "layerLimit", conflictKeys: [] };
  }

  const layerFilterOptions = {
    ...options,
    minScore:
      minScoreByLayer[layer] !== undefined
        ? minScoreByLayer[layer]
        : options.minScore,
    minProfit:
      minProfitByLayer[layer] !== undefined
        ? minProfitByLayer[layer]
        : options.minProfit,
    minProfitPerHour:
      minProfitPerHourByLayer[layer] !== undefined
        ? minProfitPerHourByLayer[layer]
        : options.minProfitPerHour,
    minFillRate:
      minFillRateByLayer[layer] !== undefined
        ? minFillRateByLayer[layer]
        : options.minFillRate,
  };

  if (!candidatePassesSelectionFilters(candidate, layerFilterOptions)) {
    return { ok: false, reason: "filters", conflictKeys: [] };
  }

  const conflictKeys = getCandidateConflictKeys(candidate, {
    mode: conflictMode,
  });

  for (const key of conflictKeys) {
    if (state.usedConflictKeys.has(key)) {
      return { ok: false, reason: "conflict", conflictKeys };
    }
  }

  return { ok: true, reason: null, conflictKeys };
}

function pruneBeam(states, beamWidth, objectiveWeights) {
  const seen = new Set();
  const pruned = [];

  const ranked = states
    .map((state) => ({
      state,
      objective: stateObjective(state, objectiveWeights),
    }))
    .sort((a, b) => b.objective - a.objective);

  for (const item of ranked) {
    const signature = item.state.selected
      .map((candidate) => candidate.id)
      .slice(-12)
      .join("|");

    if (seen.has(signature)) continue;
    seen.add(signature);
    pruned.push(item.state);

    if (pruned.length >= beamWidth) break;
  }

  return pruned;
}

function pickBestFinalState(states = []) {
  return [...states].sort(
    (a, b) => finalStateObjective(b) - finalStateObjective(a)
  )[0];
}

function completeStateGreedy({
  state,
  preparedByLayer,
  options,
  completionLayerOrder,
}) {
  let completedState = state;
  let accepted = 0;
  const selectedIds = new Set(state.selected.map((candidate) => candidate.id));

  for (const layer of completionLayerOrder) {
    const candidates = preparedByLayer[layer] || [];

    for (const candidate of candidates) {
      if (selectedIds.has(candidate.id)) continue;

      const take = stateCanTakeCandidate(completedState, candidate, options, layer);
      if (!take.ok) continue;

      completedState = cloneStateWithCandidate(
        completedState,
        candidate,
        take.conflictKeys,
        layer
      );
      selectedIds.add(candidate.id);
      accepted += 1;
    }
  }

  return { state: completedState, accepted };
}

function summarizeSelection(selected = []) {
  let totalProfit = 0;
  let totalTime = 0;
  let totalScore = 0;
  const selectedByLayer = {};

  for (const candidate of selected) {
    const layer = getCandidateDemandLayer(candidate);
    selectedByLayer[layer] = (selectedByLayer[layer] || 0) + 1;
    totalProfit += candidate.totalProfit || 0;
    totalTime += candidate.totalTime || 0;
    totalScore += candidate.score || 0;
  }

  return {
    selectedCount: selected.length,
    selectedByLayer,
    totalProfit,
    totalTime,
    profitPerHour: totalTime > 0 ? totalProfit / totalTime : 0,
    totalScore,
    averageScore: selected.length > 0 ? totalScore / selected.length : 0,
  };
}

function selectedPreview(selected = [], previewLimit = 10) {
  return selected.slice(0, previewLimit).map((candidate) => ({
    id: candidate.id,
    type: candidate.type,
    source: candidate.source,
    layer: getCandidateDemandLayer(candidate),
    windowH: candidate.windowH,
    routeCount: candidate.routes?.length || candidate.metadata?.routeCount || 0,
    fleet: candidate.fleetKeys?.join(" + "),
    totalTime: candidate.totalTime,
    totalProfit: candidate.totalProfit,
    profitPerHour: candidate.profitPerHour,
    fillRate: candidate.fillRate,
    score: candidate.score,
    sourceVariantKind: candidate.metadata?.sourceVariantKind,
    tags: candidate.tags,
  }));
}

export function selectCandidateColumnsBeam(candidates = [], options = {}) {
  const {
    beamWidth = 8,
    layerOrder = DEFAULT_BEAM_LAYER_ORDER,
    completionLayerOrder = DEFAULT_BEAM_COMPLETION_LAYER_ORDER,
    enableGreedyCompletion = true,
    maxBeamCandidatesByLayer = DEFAULT_MAX_CANDIDATES_BY_LAYER,
    objectiveWeights = DEFAULT_BEAM_OBJECTIVE_WEIGHTS,
    previewLimit = 10,
  } = options;

  const grouped = groupCandidatesByDemandLayer(candidates);
  const orderedLayers = [
    ...layerOrder,
    ...Object.keys(grouped).filter((layer) => !layerOrder.includes(layer)),
  ];

  let states = [
    {
      selected: [],
      usedConflictKeys: new Set(),
      selectedByLayer: {},
      totalProfit: 0,
      totalTime: 0,
      totalScore: 0,
    },
  ];

  const preparedByLayer = {};

  let candidatesVisited = 0;
  let transitionsTried = 0;
  let acceptedTransitions = 0;
  let filterRejectedCount = 0;
  let conflictRejectedCount = 0;
  let limitRejectedCount = 0;
  let layerLimitRejectedCount = 0;
  let completionAccepted = 0;

  for (const layer of orderedLayers) {
    const rawLayerCandidates = grouped[layer] || [];
    if (!rawLayerCandidates.length) continue;

    const layerLimit =
      maxBeamCandidatesByLayer[layer] ?? maxBeamCandidatesByLayer.default ?? 120;

    const prepared = prepareCandidatesForSelection(rawLayerCandidates, options).slice(
      0,
      layerLimit
    );

    preparedByLayer[layer] = prepared;
    candidatesVisited += prepared.length;

    for (const candidate of prepared) {
      const nextStates = [...states];

      for (const state of states) {
        transitionsTried += 1;
        const take = stateCanTakeCandidate(state, candidate, options, layer);

        if (!take.ok) {
          if (take.reason === "filters") filterRejectedCount += 1;
          else if (take.reason === "conflict") conflictRejectedCount += 1;
          else if (take.reason === "limit") limitRejectedCount += 1;
          else if (take.reason === "layerLimit") layerLimitRejectedCount += 1;
          continue;
        }

        acceptedTransitions += 1;
        nextStates.push(
          cloneStateWithCandidate(state, candidate, take.conflictKeys, layer)
        );
      }

      states = pruneBeam(nextStates, beamWidth, objectiveWeights);
    }
  }

  let finalStates = states;

  if (enableGreedyCompletion) {
    finalStates = states.map((state) => {
      const completed = completeStateGreedy({
        state,
        preparedByLayer,
        options,
        completionLayerOrder,
      });

      completionAccepted += completed.accepted;
      return completed.state;
    });
  }

  const bestState = pickBestFinalState(finalStates) || finalStates[0] || states[0];
  const summary = summarizeSelection(bestState.selected);

  return {
    selected: bestState.selected,
    ...summary,
    beamWidth,
    candidatesVisited,
    statesKept: states.length,
    transitionsTried,
    acceptedTransitions,
    enableGreedyCompletion,
    completionAccepted,
    rejectedCount:
      filterRejectedCount +
      conflictRejectedCount +
      limitRejectedCount +
      layerLimitRejectedCount,
    filterRejectedCount,
    conflictRejectedCount,
    limitRejectedCount,
    layerLimitRejectedCount,
    selectedPreview: selectedPreview(bestState.selected, previewLimit),
    selectedColumns: compactSelectedColumns(bestState.selected),
    selectedColumnRoutes: compactSelectedColumnRoutes(bestState.selected),
  };
}

export function buildBeamSearchDiagnostics({
  candidates = [],
  greedySelection,
  options = {},
}) {
  const beam = selectCandidateColumnsBeam(candidates, options);
  const greedyProfit = greedySelection?.totalProfit || 0;
  const greedyProfitPerHour = greedySelection?.profitPerHour || 0;
  const greedySelectedCount = greedySelection?.selectedCount || 0;

  return {
    enabled: true,
    selectedCount: beam.selectedCount,
    selectedByLayer: beam.selectedByLayer,
    totalProfit: beam.totalProfit,
    totalTime: beam.totalTime,
    profitPerHour: beam.profitPerHour,
    averageScore: beam.averageScore,
    profitDelta: beam.totalProfit - greedyProfit,
    profitPerHourDelta: beam.profitPerHour - greedyProfitPerHour,
    selectedCountDelta: beam.selectedCount - greedySelectedCount,
    beamWidth: beam.beamWidth,
    candidatesVisited: beam.candidatesVisited,
    statesKept: beam.statesKept,
    transitionsTried: beam.transitionsTried,
    acceptedTransitions: beam.acceptedTransitions,
    enableGreedyCompletion: beam.enableGreedyCompletion,
    completionAccepted: beam.completionAccepted,
    rejectedCount: beam.rejectedCount,
    conflictRejectedCount: beam.conflictRejectedCount,
    filterRejectedCount: beam.filterRejectedCount,
    limitRejectedCount: beam.limitRejectedCount,
    layerLimitRejectedCount: beam.layerLimitRejectedCount,
    selectedPreview: beam.selectedPreview,
    selectedColumns: beam.selectedColumns,
    selectedColumnRoutes: beam.selectedColumnRoutes,
  };
}
