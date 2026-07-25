import {
  getCandidateDemandLayer,
  prepareCandidatesForSelection,
} from "./candidateSelection";
import { routeCandidateKey } from "./candidateTypes";

const SOURCE_CIRCUIT_BASE_LAYERS = new Set(["base168", "base84"]);
const ROUTE_SIGNATURE_LIMIT = 5;

function uniqueTags(tags = []) {
  return [...new Set(tags.filter(Boolean))];
}

function getCircuitKey(candidate) {
  return candidate?.metadata?.circuitKey || "";
}

function classifySourceCircuitVariant(candidate) {
  const circuitKey = getCircuitKey(candidate);
  if (!circuitKey) return null;

  if (candidate?.metadata?.postFleetReroute) {
    return { circuitKey, variantKind: "postFleetReroute" };
  }

  if (candidate?.metadata?.routeSwap) {
    return { circuitKey, variantKind: "routeSwap" };
  }

  const layer = getCandidateDemandLayer(candidate);

  if (layer === "fleetReplacement") {
    return { circuitKey, variantKind: "fleetReplacement" };
  }

  if (SOURCE_CIRCUIT_BASE_LAYERS.has(layer)) {
    return { circuitKey, variantKind: "originalCircuit" };
  }

  if (layer === "sourceCircuitChoice") {
    return {
      circuitKey,
      variantKind: candidate?.metadata?.sourceVariantKind || "originalCircuit",
    };
  }

  return null;
}

function routeName(route) {
  return route?.name || route?.route || route?.id || route?.originalId || "";
}

function normalizeRouteName(name = "") {
  return String(name).trim().toUpperCase();
}

function routeNamesFromCandidate(candidate) {
  if (candidate?.metadata?.routeNames?.length) {
    return candidate.metadata.routeNames;
  }

  return (candidate?.routes || []).map(routeName).filter(Boolean);
}

function routeSignatureFromNames(routeNames = []) {
  const normalized = routeNames
    .slice(0, ROUTE_SIGNATURE_LIMIT)
    .map(normalizeRouteName)
    .filter(Boolean);

  return normalized.length ? normalized.join("|") : "";
}

function routeSignatureFromCandidate(candidate) {
  return routeSignatureFromNames(routeNamesFromCandidate(candidate));
}

function buildRouteCarrierIndex(candidates = []) {
  const index = new Map();

  for (const candidate of candidates) {
    if (!(candidate.routes || []).length) continue;

    const signature = routeSignatureFromCandidate(candidate);
    if (!signature || index.has(signature)) continue;

    index.set(signature, candidate);
  }

  return index;
}

function findRouteCarrierBySignature(candidate, routeCarrierIndex) {
  if (!routeCarrierIndex) return null;

  const signature = routeSignatureFromCandidate(candidate);
  if (!signature) return null;

  return routeCarrierIndex.get(signature) || null;
}

function findRouteCarrierVariant(variants = []) {
  return (
    variants.find((variant) => {
      const kind = classifySourceCircuitVariant(variant)?.variantKind;
      return kind === "originalCircuit" && (variant.routes || []).length > 0;
    }) || variants.find((variant) => (variant.routes || []).length > 0)
  );
}

function routeKeysFromRoutes(routes = []) {
  return routes.map(routeCandidateKey).filter(Boolean);
}

function countVariantKinds(variants = []) {
  return variants.reduce(
    (acc, variant) => {
      const kind = classifySourceCircuitVariant(variant)?.variantKind || "originalCircuit";

      acc.total += 1;
      if (kind === "fleetReplacement") acc.fleetReplacement += 1;
      else if (kind === "routeSwap") acc.routeSwap += 1;
      else if (kind === "postFleetReroute") acc.postFleetReroute += 1;
      else acc.original += 1;

      return acc;
    },
    {
      total: 0,
      original: 0,
      fleetReplacement: 0,
      routeSwap: 0,
      postFleetReroute: 0,
    }
  );
}

function variantKindForCandidate(candidate, variantItems = []) {
  return (
    variantItems.find((item) => item.candidate === candidate)?.variantKind ||
    classifySourceCircuitVariant(candidate)?.variantKind ||
    "originalCircuit"
  );
}

function selectBestSourceCircuitVariant(variantItems = [], options = {}) {
  const variants = variantItems.map((item) => item.candidate);
  const ranked = prepareCandidatesForSelection(variants, options);
  const scoreBest = ranked[0];

  if (!scoreBest) {
    return {
      rankedVariants: [],
      bestVariant: null,
      bestVariantKind: "originalCircuit",
      profitOverride: false,
    };
  }

  const bestPostFleetByProfit = ranked
    .filter(
      (variant) =>
        variantKindForCandidate(variant, variantItems) === "postFleetReroute" &&
        Number(variant.metadata?.profitDelta || 0) > 0
    )
    .sort((a, b) => {
      const profitDelta = Number(b.totalProfit || 0) - Number(a.totalProfit || 0);
      if (profitDelta !== 0) return profitDelta;
      return Number(b.profitPerHour || 0) - Number(a.profitPerHour || 0);
    })[0];

  const profitOverride =
    bestPostFleetByProfit &&
    Number(bestPostFleetByProfit.totalProfit || 0) > Number(scoreBest.totalProfit || 0);

  if (!profitOverride) {
    return {
      rankedVariants: ranked,
      bestVariant: scoreBest,
      bestVariantKind: variantKindForCandidate(scoreBest, variantItems),
      profitOverride: false,
    };
  }

  return {
    rankedVariants: [
      bestPostFleetByProfit,
      ...ranked.filter((variant) => variant !== bestPostFleetByProfit),
    ],
    bestVariant: bestPostFleetByProfit,
    bestVariantKind: "postFleetReroute",
    profitOverride: true,
  };
}

function markAsSourceCircuitChoice(
  candidate,
  variants = [],
  bestVariantKind = null,
  routeCarrierIndex = null
) {
  const variantKind = bestVariantKind || "originalCircuit";
  const groupRouteCarrier = findRouteCarrierVariant(variants);
  const signatureRouteCarrier =
    groupRouteCarrier || findRouteCarrierBySignature(candidate, routeCarrierIndex);
  const routeCarrier = groupRouteCarrier || signatureRouteCarrier;
  const inheritedRoutes =
    (candidate.routes || []).length > 0
      ? candidate.routes
      : routeCarrier?.routes || [];
  const inheritedRouteKeys =
    (candidate.routeKeys || []).length > 0
      ? candidate.routeKeys
      : routeKeysFromRoutes(inheritedRoutes);
  const inheritedDemand = candidate.demand || routeCarrier?.demand || undefined;
  const inheritedRouteCount =
    candidate.metadata?.routeCount ||
    inheritedRoutes.length ||
    routeCarrier?.metadata?.routeCount ||
    0;
  const inheritedRouteNames = candidate.metadata?.routeNames?.length
    ? candidate.metadata.routeNames
    : routeCarrier?.metadata?.routeNames ||
      inheritedRoutes.map(routeName).filter(Boolean);
  const didInheritRoutes =
    (candidate.routes || []).length === 0 && inheritedRoutes.length > 0;
  const inheritedBySignature = didInheritRoutes && !groupRouteCarrier && !!signatureRouteCarrier;
  const variantCounts = countVariantKinds(variants);

  return {
    ...candidate,
    source: "sourceCircuitChoice",
    routes: inheritedRoutes,
    routeKeys: inheritedRouteKeys,
    demand: inheritedDemand,
    tags: uniqueTags([
      ...(candidate.tags || []),
      "sourceCircuitChoice",
      variantKind === "fleetReplacement" ? "chosenFleetReplacement" : null,
      variantKind === "routeSwap" ? "chosenRouteSwap" : null,
      variantKind === "postFleetReroute" ? "chosenPostFleetReroute" : null,
      variantKind === "originalCircuit" ? "chosenOriginalCircuit" : null,
    ]),
    metadata: {
      ...(candidate.metadata || {}),
      sourceVariantKind: variantKind,
      sourceVariantCount: variants.length,
      originalVariantCount: variantCounts.original,
      replacementVariantCount: variantCounts.fleetReplacement,
      routeSwapVariantCount: variantCounts.routeSwap,
      postFleetRerouteVariantCount: variantCounts.postFleetReroute,
      routeCount: inheritedRouteCount,
      routeNames: inheritedRouteNames,
      inheritedRoutesFromSourceCircuit: didInheritRoutes,
      inheritedRoutesBySignature: inheritedBySignature,
      inheritedRoutesSourceVariant: didInheritRoutes
        ? classifySourceCircuitVariant(routeCarrier)?.variantKind || "unknown"
        : null,
    },
  };
}

export function buildSourceCircuitCompetitionPool(candidates = [], options = {}) {
  const groups = new Map();
  const passthroughCandidates = [];
  const routeCarrierIndex = buildRouteCarrierIndex(candidates);

  for (const candidate of candidates) {
    const classified = classifySourceCircuitVariant(candidate);

    if (!classified) {
      passthroughCandidates.push(candidate);
      continue;
    }

    if (!groups.has(classified.circuitKey)) groups.set(classified.circuitKey, []);
    groups.get(classified.circuitKey).push({
      candidate,
      variantKind: classified.variantKind,
    });
  }

  const sourceCircuitChoices = [];
  const rejectedVariants = [];

  let originalChoices = 0;
  let replacementChoices = 0;
  let routeSwapChoices = 0;
  let postFleetRerouteChoices = 0;
  let postFleetRerouteProfitOverrides = 0;
  let sourceCircuitVariants = 0;
  let originalVariants = 0;
  let replacementVariants = 0;
  let routeSwapVariants = 0;
  let postFleetRerouteVariants = 0;
  let inheritedRouteChoices = 0;
  let inheritedRouteChoicesBySignature = 0;

  for (const [circuitKey, variantItems] of groups.entries()) {
    const variants = variantItems.map((item) => item.candidate);
    const variantCounts = countVariantKinds(variants);
    sourceCircuitVariants += variants.length;
    originalVariants += variantCounts.original;
    replacementVariants += variantCounts.fleetReplacement;
    routeSwapVariants += variantCounts.routeSwap;
    postFleetRerouteVariants += variantCounts.postFleetReroute;

    const {
      rankedVariants,
      bestVariant,
      bestVariantKind,
      profitOverride,
    } = selectBestSourceCircuitVariant(variantItems, options);

    if (!bestVariant) continue;

    if (profitOverride) postFleetRerouteProfitOverrides += 1;

    if (bestVariantKind === "fleetReplacement") replacementChoices += 1;
    else if (bestVariantKind === "routeSwap") routeSwapChoices += 1;
    else if (bestVariantKind === "postFleetReroute") postFleetRerouteChoices += 1;
    else originalChoices += 1;

    const sourceChoice = markAsSourceCircuitChoice(
      bestVariant,
      variants,
      bestVariantKind,
      routeCarrierIndex
    );

    if (sourceChoice.metadata?.inheritedRoutesFromSourceCircuit) {
      inheritedRouteChoices += 1;
    }

    if (sourceChoice.metadata?.inheritedRoutesBySignature) {
      inheritedRouteChoicesBySignature += 1;
    }

    sourceCircuitChoices.push(sourceChoice);

    for (const variant of rankedVariants.slice(1)) {
      rejectedVariants.push({
        candidate: variant,
        circuitKey,
        reason: "sourceCircuitCompetition",
      });
    }
  }

  const outputCandidates = [...sourceCircuitChoices, ...passthroughCandidates];

  return {
    candidates: outputCandidates,
    rejectedVariants,
    diagnostics: {
      rawCandidates: candidates.length,
      effectiveCandidates: outputCandidates.length,
      passthroughCandidates: passthroughCandidates.length,
      sourceCircuitGroups: groups.size,
      sourceCircuitVariants,
      originalVariants,
      replacementVariants,
      routeSwapVariants,
      postFleetRerouteVariants,
      rejectedSourceVariants: rejectedVariants.length,
      choiceCount: sourceCircuitChoices.length,
      originalChoices,
      replacementChoices,
      routeSwapChoices,
      postFleetRerouteChoices,
      postFleetRerouteProfitOverrides,
      inheritedRouteChoices,
      inheritedRouteChoicesBySignature,
      routeCarrierIndexSize: routeCarrierIndex.size,
    },
  };
}
