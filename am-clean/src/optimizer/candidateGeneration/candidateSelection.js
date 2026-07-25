import { rankCandidates, scoreCandidates } from "./candidateScoring";

const candidateLayerCache = new WeakMap();
const candidateConflictKeyCache = new WeakMap();
const candidateIdentityCache = new WeakMap();
let candidateIdentitySeq = 0;

function isFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return false;
  return Number.isFinite(Number(value));
}

function getCandidateIdentityKey(candidate) {
  if (!candidate || typeof candidate !== "object") return "candidateIdentity:unknown";

  const cached = candidateIdentityCache.get(candidate);
  if (cached) return cached;

  candidateIdentitySeq += 1;
  const key = `candidateIdentity:${candidateIdentitySeq}`;
  candidateIdentityCache.set(candidate, key);
  return key;
}

function getCachedConflictKeys(candidate, mode) {
  if (!candidate || typeof candidate !== "object") return null;

  const byMode = candidateConflictKeyCache.get(candidate);
  if (!byMode) return null;

  return byMode.get(mode) || null;
}

function setCachedConflictKeys(candidate, mode, keys) {
  if (!candidate || typeof candidate !== "object") return keys;

  let byMode = candidateConflictKeyCache.get(candidate);
  if (!byMode) {
    byMode = new Map();
    candidateConflictKeyCache.set(candidate, byMode);
  }

  byMode.set(mode, keys);
  return keys;
}

export function getCandidateDemandLayer(candidate) {
  if (!candidate) return "base";

  if (typeof candidate === "object") {
    const cached = candidateLayerCache.get(candidate);
    if (cached) return cached;
  }

  const tags = candidate?.tags || [];
  let layer = "base";

  if (
    candidate?.source === "sourceCircuitChoice" ||
    tags.includes("sourceCircuitChoice")
  ) {
    layer = "sourceCircuitChoice";
  } else if (
    candidate?.source === "targetCoverage" ||
    tags.includes("targetCoverage")
  ) {
    layer = "targetCoverage";
  } else if (
    candidate?.source === "residualPass" ||
    tags.includes("residualSecondPass") ||
    tags.includes("residualPass")
  ) {
    layer = "residualSecondPass";
  } else if (candidate?.type === "fleetReplacement") {
    layer = "fleetReplacement";
  } else if (candidate?.source === "base24") {
    layer = "base24";
  } else if (candidate?.source === "base84") {
    layer = "base84";
  } else if (candidate?.source === "base168") {
    layer = "base168";
  }

  if (typeof candidate === "object") {
    candidateLayerCache.set(candidate, layer);
  }

  return layer;
}

function getCandidateCircuitKey(candidate) {
  return (
    candidate?.metadata?.circuitKey ||
    candidate?.metadata?.circuitLabel ||
    candidate?.id ||
    ""
  );
}

function getSourceCircuitConflictKeys(candidate) {
  const circuitKey = candidate?.metadata?.circuitKey;

  return circuitKey ? [`sourceCircuit:${circuitKey}`] : [];
}

export function getCandidateConflictKeys(candidate, options = {}) {
  const { mode = "routeOrCircuit" } = options;

  if (!candidate) return [];

  const cached = getCachedConflictKeys(candidate, mode);
  if (cached) return cached;

  if (mode === "none") return setCachedConflictKeys(candidate, mode, []);

  if (mode === "candidateIdentity") {
    return setCachedConflictKeys(candidate, mode, [getCandidateIdentityKey(candidate)]);
  }

  if (mode === "candidateId") {
    return setCachedConflictKeys(
      candidate,
      mode,
      candidate.id ? [`candidate:${candidate.id}`] : []
    );
  }

  if (mode === "circuit") {
    const circuitKey = getCandidateCircuitKey(candidate);

    return setCachedConflictKeys(
      candidate,
      mode,
      circuitKey ? [`circuit:${circuitKey}`] : []
    );
  }

  if (mode === "routeDemandLayer") {
    const layer = getCandidateDemandLayer(candidate);

    return setCachedConflictKeys(
      candidate,
      mode,
      (candidate.routeKeys || []).map((key) => `route:${key}:${layer}`)
    );
  }

  if (mode === "routeDemandLayerOrCircuit") {
    const layer = getCandidateDemandLayer(candidate);
    const sourceCircuitKeys = getSourceCircuitConflictKeys(candidate);

    // Les circuits source viennent déjà du plan PAX construit. Une même route peut
    // apparaître dans plusieurs circuits/vagues pour couvrir une grosse demande.
    // On évite donc de bloquer deux circuits source uniquement parce qu'ils
    // partagent une route ; on garde seulement le verrou du circuit source pour
    // choisir entre circuit original / flotte remplacée / futur reroute.
    if (layer === "sourceCircuitChoice") {
      const fallbackCircuitKey = getCandidateCircuitKey(candidate);

      return setCachedConflictKeys(candidate, mode, [
        ...sourceCircuitKeys,
        ...(!sourceCircuitKeys.length && fallbackCircuitKey
          ? [`circuit:${fallbackCircuitKey}:${layer}`]
          : []),
      ]);
    }

    if ((candidate.routeKeys || []).length > 0) {
      return setCachedConflictKeys(candidate, mode, [
        ...candidate.routeKeys.map((key) => `route:${key}:${layer}`),
        ...sourceCircuitKeys,
      ]);
    }

    const fallbackCircuitKey = getCandidateCircuitKey(candidate);

    return setCachedConflictKeys(candidate, mode, [
      ...sourceCircuitKeys,
      ...(fallbackCircuitKey ? [`circuit:${fallbackCircuitKey}:${layer}`] : []),
    ]);
  }

  if (mode === "route") {
    return setCachedConflictKeys(
      candidate,
      mode,
      (candidate.routeKeys || []).map((key) => `route:${key}`)
    );
  }

  if ((candidate.routeKeys || []).length > 0) {
    return setCachedConflictKeys(
      candidate,
      mode,
      candidate.routeKeys.map((key) => `route:${key}`)
    );
  }

  const fallbackCircuitKey = getCandidateCircuitKey(candidate);

  return setCachedConflictKeys(
    candidate,
    mode,
    fallbackCircuitKey ? [`circuit:${fallbackCircuitKey}`] : []
  );
}

export function candidatePassesSelectionFilters(candidate, options = {}) {
  const {
    minScore = null,
    minProfit = null,
    minProfitPerHour = null,
    minFillRate = null,
    allowedTypes = null,
    allowedSources = null,
    requiredTags = [],
    excludedTags = [],
  } = options;

  if (!candidate) return false;

  if (allowedTypes?.length && !allowedTypes.includes(candidate.type)) {
    return false;
  }

  if (allowedSources?.length && !allowedSources.includes(candidate.source)) {
    return false;
  }

  if (
    isFiniteNumber(minScore) &&
    (candidate.score || 0) < Number(minScore)
  ) {
    return false;
  }

  if (
    isFiniteNumber(minProfit) &&
    (candidate.totalProfit || 0) < Number(minProfit)
  ) {
    return false;
  }

  if (
    isFiniteNumber(minProfitPerHour) &&
    (candidate.profitPerHour || 0) < Number(minProfitPerHour)
  ) {
    return false;
  }

  if (
    isFiniteNumber(minFillRate) &&
    (candidate.fillRate || 0) < Number(minFillRate)
  ) {
    return false;
  }

  const tags = candidate.tags || [];

  if (requiredTags.length > 0) {
    for (const tag of requiredTags) {
      if (!tags.includes(tag)) return false;
    }
  }

  if (excludedTags.length > 0) {
    for (const tag of excludedTags) {
      if (tags.includes(tag)) return false;
    }
  }

  return true;
}

export function prepareCandidatesForSelection(candidates = [], options = {}) {
  const {
    rank = true,
    scoreIfMissing = true,
    weights = undefined,
  } = options;

  const needsScoring =
    scoreIfMissing && candidates.some((candidate) => candidate.score == null);

  if (rank) {
    return rankCandidates(candidates, weights);
  }

  if (needsScoring) {
    return scoreCandidates(candidates, weights);
  }

  return [...candidates];
}

function summarizeRejectedByReason(rejected = []) {
  return rejected.reduce((acc, item) => {
    acc[item.reason] = (acc[item.reason] || 0) + 1;
    return acc;
  }, {});
}

function previewCandidate(candidate, layer = null) {
  return {
    id: candidate.id,
    type: candidate.type,
    source: candidate.source,
    layer: layer || getCandidateDemandLayer(candidate),
    windowH: candidate.windowH,
    routeCount: candidate.routes?.length || candidate.metadata?.routeCount || 0,
    fleet: candidate.fleetKeys?.join(" + "),
    totalTime: candidate.totalTime,
    totalProfit: candidate.totalProfit,
    profitPerHour: candidate.profitPerHour,
    fillRate: candidate.fillRate,
    score: candidate.score,
    sourceVariantKind: candidate.metadata?.sourceVariantKind,
    gain: candidate.metadata?.gain || 0,
    currentAircraft: candidate.metadata?.currentAircraft,
    tags: candidate.tags,
  };
}

export function buildCandidateSelectionDiagnostics(candidates = [], options = {}) {
  const {
    conflictMode = "routeDemandLayerOrCircuit",
    keepRejected = true,
    previewLimit = 10,
  } = options;

  const prepared = prepareCandidatesForSelection(candidates, options);
  const selected = [];
  const rejected = [];
  const usedConflictKeys = new Set();
  const selectedByLayer = {};

  for (const candidate of prepared) {
    const layer = getCandidateDemandLayer(candidate);

    if (!candidatePassesSelectionFilters(candidate, options)) {
      if (keepRejected) {
        rejected.push({
          candidate,
          reason: "filters",
          layer,
          conflictKeys: [],
        });
      }
      continue;
    }

    const conflictKeys = getCandidateConflictKeys(candidate, {
      mode: conflictMode,
    });
    const conflictingKeys = conflictKeys.filter((key) =>
      usedConflictKeys.has(key)
    );

    if (conflictingKeys.length > 0) {
      if (keepRejected) {
        rejected.push({
          candidate,
          reason: "conflict",
          layer,
          conflictKeys: conflictingKeys,
        });
      }
      continue;
    }

    selected.push(candidate);
    selectedByLayer[layer] = (selectedByLayer[layer] || 0) + 1;

    for (const key of conflictKeys) usedConflictKeys.add(key);
  }

  const totalProfit = selected.reduce(
    (sum, candidate) => sum + (candidate.totalProfit || 0),
    0
  );
  const totalTime = selected.reduce(
    (sum, candidate) => sum + (candidate.totalTime || 0),
    0
  );
  const totalScore = selected.reduce(
    (sum, candidate) => sum + (candidate.score || 0),
    0
  );
  const rejectedByReason = summarizeRejectedByReason(rejected);

  return {
    selected,
    rejected,
    selectedCount: selected.length,
    rejectedCount: rejected.length,
    selectedByLayer,
    rejectedByReason,
    conflictRejectedCount: rejectedByReason.conflict || 0,
    filterRejectedCount: rejectedByReason.filters || 0,
    limitRejectedCount: rejectedByReason.limit || 0,
    layerLimitRejectedCount: rejectedByReason.layerLimit || 0,
    totalProfit,
    totalTime,
    profitPerHour: totalTime > 0 ? totalProfit / totalTime : 0,
    totalScore,
    averageScore: selected.length > 0 ? totalScore / selected.length : 0,
    usedConflictKeys: [...usedConflictKeys],
    selectedPreview: selected
      .slice(0, previewLimit)
      .map((candidate) => previewCandidate(candidate)),
    rejectedPreview: rejected.slice(0, previewLimit).map((item) => ({
      ...previewCandidate(item.candidate, item.layer),
      reason: item.reason,
      conflictKeys: item.conflictKeys,
    })),
  };
}