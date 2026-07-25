export const CANDIDATE_TYPES = Object.freeze({
  CIRCUIT: "circuit",
  FLEET_REPLACEMENT: "fleetReplacement",
  TARGET_COVERAGE: "targetCoverage",
  RESIDUAL_PASS: "residualPass",
  BEAM_PARTIAL: "beamPartial",
  COLUMN: "column",
});

export const CANDIDATE_SOURCES = Object.freeze({
  BASE_168: "base168",
  BASE_84: "base84",
  BASE_24: "base24",
  TARGET_COVERAGE: "targetCoverage",
  FLEET_ALTERNATIVE: "fleetAlternative",
  BEAM_SEARCH: "beamSearch",
  COLUMN_GENERATION: "columnGeneration",
  DIAGNOSTIC: "diagnostic",
});

export function routeCandidateKey(route) {
  return route?.originalId || route?.id || route?.name || route?.route || "";
}

export function aircraftCandidateKey(aircraft) {
  return `${aircraft?.brand || ""} ${aircraft?.model || ""}`.trim();
}

export function getCandidateRouteKeys(candidate) {
  return (candidate?.routes || [])
    .map(routeCandidateKey)
    .filter(Boolean);
}

export function getCandidateFleetKeys(candidate) {
  return (candidate?.aircraftFleet || [])
    .map(aircraftCandidateKey)
    .filter(Boolean);
}

export function summarizeCandidateDemand(routes = []) {
  return routes.reduce(
    (acc, route) => {
      const rotations = route.rotations || 1;

      acc.eco += (route.dEco || route.demandEco || 0) * rotations;
      acc.bus += (route.dBus || route.demandBus || 0) * rotations;
      acc.first += (route.dFirst || route.demandFirst || 0) * rotations;
      acc.cargo += (route.dCargo || route.demandCargo || 0) * rotations;

      return acc;
    },
    {
      eco: 0,
      bus: 0,
      first: 0,
      cargo: 0,
    }
  );
}

export function summarizeCandidateCoverage(candidate) {
  const coveredDemand = candidate?.coveredDemand || {};
  const demand = candidate?.demand || summarizeCandidateDemand(candidate?.routes || []);

  return {
    eco: coveredDemand.eco || 0,
    bus: coveredDemand.bus || 0,
    first: coveredDemand.first || 0,
    cargo: coveredDemand.cargo || 0,

    demandEco: demand.eco || 0,
    demandBus: demand.bus || 0,
    demandFirst: demand.first || 0,
    demandCargo: demand.cargo || 0,
  };
}

export function createCandidate({
  id,
  type = CANDIDATE_TYPES.CIRCUIT,
  source = CANDIDATE_SOURCES.DIAGNOSTIC,

  routes = [],
  aircraft = null,
  aircraftFleet = [],

  windowH = 168,
  totalTime = 0,
  totalProfit = 0,
  totalRevenue = 0,
  totalCost = 0,
  profitPerHour = null,
  fillRate = null,

  demand = null,
  coveredDemand = null,

  score = null,
  scoreDetails = null,

  constraints = {},
  metadata = {},
  tags = [],
}) {
  const safeTotalTime = Number(totalTime || 0);
  const safeTotalProfit = Number(totalProfit || 0);
  const safeWindowH = Number(windowH || 0);

  const finalProfitPerHour =
    profitPerHour ?? (safeTotalTime > 0 ? safeTotalProfit / safeTotalTime : 0);

  const finalFillRate =
    fillRate ?? (safeWindowH > 0 ? (safeTotalTime / safeWindowH) * 100 : 0);

  const finalDemand = demand || summarizeCandidateDemand(routes);

  const finalAircraftFleet =
    aircraftFleet.length > 0
      ? aircraftFleet
      : aircraft
      ? [aircraft]
      : [];

  const routeKeys = routes.map(routeCandidateKey).filter(Boolean);
  const fleetKeys = finalAircraftFleet.map(aircraftCandidateKey).filter(Boolean);

  return {
    id:
      id ||
      [
        type,
        source,
        safeWindowH,
        routeKeys.join("_"),
        fleetKeys.join("_"),
      ]
        .filter(Boolean)
        .join("__"),

    type,
    source,

    routes,
    routeKeys,

    aircraft,
    aircraftFleet: finalAircraftFleet,
    fleetKeys,

    windowH: safeWindowH,
    totalTime: safeTotalTime,
    totalProfit: safeTotalProfit,
    totalRevenue: Number(totalRevenue || 0),
    totalCost: Number(totalCost || 0),
    profitPerHour: finalProfitPerHour,
    fillRate: finalFillRate,

    demand: finalDemand,
    coveredDemand: coveredDemand || {},

    score,
    scoreDetails,

    constraints,
    metadata,
    tags,
  };
}

export function candidateFromCircuit(circuit, extra = {}) {
  const fleet = circuit?.cabin?.fleet || [];
  const aircraftFleet = fleet.length ? fleet : circuit?.aircraft ? [circuit.aircraft] : [];

  return createCandidate({
    type: CANDIDATE_TYPES.CIRCUIT,
    source: extra.source || CANDIDATE_SOURCES.DIAGNOSTIC,

    routes: circuit?.routes || [],
    aircraft: circuit?.aircraft || null,
    aircraftFleet,

    windowH: circuit?.windowH || extra.windowH || 168,
    totalTime: circuit?.totalTime || 0,
    totalProfit: circuit?.totalProfit || 0,
    totalRevenue: circuit?.totalRev || 0,
    profitPerHour: circuit?.profitPerHour ?? null,
    fillRate: Number(circuit?.fillRate || 0),

    metadata: {
      circuitType: circuit?.type,
      pool: circuit?.pool,
      routeCount: circuit?.routeCount || (circuit?.routes || []).length,
      ...extra.metadata,
    },

    tags: [
      ...(circuit?.isTargetCoveragePass ? ["targetCoverage"] : []),
      ...(circuit?.isResidualSecondPass ? ["residualSecondPass"] : []),
      ...(extra.tags || []),
    ],
  });
}