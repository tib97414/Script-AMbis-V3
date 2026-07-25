import {
  generateFleetFirstCircuitPool,
  deduplicateCircuitsByRoutes,
} from "./fleetFirstCircuitGeneration";
import { circuitsToCandidates } from "./candidateGeneration/circuitCandidateFactory";
import { selectCandidateColumnsBeam } from "./candidateGeneration/beamSearchSelection";
import {
  buildEvaluatedCircuit,
  enrichRouteEconomics,
} from "./economics/circuitEconomics";
import { POOLS } from "../data/pools";

const DEFAULT_LAYER_ORDER = Object.freeze([
  "base168",
  "base84",
  "base24",
]);

const GLOBAL_SELECTION_OPTIONS = Object.freeze({
  conflictMode: "route",
  layerOrder: DEFAULT_LAYER_ORDER,
  completionLayerOrder: [...DEFAULT_LAYER_ORDER].reverse(),
  minScore: null,
  minProfit: null,
  minProfitPerHour: null,
  minFillRate: null,
  beamWidth: 16,
  maxBeamCandidatesByLayer: {
    default: 100000,
    base168: 100000,
    base84: 100000,
    base24: 100000,
  },
  objectiveWeights: {
    profit: 1,
    profitPerHour: 0,
    score: 0,
    selectedCount: 0,
    layerCount: {},
  },
});

function assignSourceLayers(circuits168, circuits84, circuits24) {
  return [
    ...circuits168.map((circuit) => ({ ...circuit, _layer: "base168" })),
    ...circuits84.map((circuit) => ({ ...circuit, _layer: "base84" })),
    ...circuits24.map((circuit) => ({ ...circuit, _layer: "base24" })),
  ];
}

function buildSoloRescueCircuits(unassignedRoutes, aircrafts, options = {}) {
  const { useAuxRevenue = false, timeoutMs = 10_000 } = options;
  const deadline = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Date.now() + timeoutMs
    : null;
  const solos = [];

  for (const route of unassignedRoutes) {
    if (deadline && Date.now() >= deadline) break;
    for (const windowH of [168, 24]) {
      if (deadline && Date.now() >= deadline) break;
      const maxH = windowH;
      const enrichedCandidates = aircrafts
        .map((aircraft) => enrichRouteEconomics(aircraft, route, { useAuxRevenue, maxH }))
        .filter(Boolean);

      if (!enrichedCandidates.length) continue;

      const bestRoute = enrichedCandidates.sort(
        (a, b) => (b.profit || 0) - (a.profit || 0)
      )[0];

      const rotations =
        windowH === 24 && bestRoute.ft <= 24
          ? Math.max(1, Math.floor(24 / bestRoute.ft))
          : 1;

      const circuit = buildEvaluatedCircuit([bestRoute], aircrafts, {
        windowH,
        useAuxRevenue,
        defaultRotations: rotations,
        pool: "profit-solo-rescue",
        typeLabel:
          windowH === 24
            ? `×${rotations} [24h solo profit]`
            : `×${rotations} [168h solo profit]`,
        _sourceWindow: windowH === 168 ? "circuits168" : "circuits24",
      });

      if (circuit && circuit.totalProfit > 0) {
        solos.push(circuit);
        break;
      }
    }
  }

  return solos;
}

function formatResult(selectedCircuits, routes, options = {}) {
  const { useAuxRevenue = false } = options;

  const all168 = selectedCircuits.filter((c) => c.windowH === 168);
  const all84 = selectedCircuits.filter((c) => c.windowH === 84);
  const all24 = selectedCircuits.filter((c) => c.windowH === 24);

  const used = new Set(
    selectedCircuits.flatMap((circuit) => circuit.routeIds || [])
  );

  const byAcMap = new Map();
  for (const c of selectedCircuits) {
    const k = `${c.aircraft.brand}|${c.aircraft.model}`;
    if (!byAcMap.has(k)) {
      byAcMap.set(k, {
        aircraft: c.aircraft,
        circuits168: [],
        circuits84: [],
        circuits24: [],
      });
    }
    if (c.windowH === 168) byAcMap.get(k).circuits168.push(c);
    else if (c.windowH === 84) byAcMap.get(k).circuits84.push(c);
    else byAcMap.get(k).circuits24.push(c);
  }

  const byAircraft = [...byAcMap.values()].map((item) => ({
    ...item,
    best168: item.circuits168[0] || null,
    best84: item.circuits84[0] || null,
    best24: item.circuits24[0] || null,
    totalProfit168: item.circuits168.reduce((s, c) => s + c.totalProfit, 0),
    totalProfit84: item.circuits84.reduce((s, c) => s + c.totalProfit, 0),
    totalProfit24: item.circuits24.reduce((s, c) => s + c.totalProfit, 0),
  }));

  return {
    byAircraft,
    mode: "pax",
    optimizer: "profitMax",
    useAuxRevenue,
    aircraftCount: byAircraft.length,
    circuits168: all168.length,
    circuits84: all84.length,
    circuits24: all24.length,
    total168: all168.reduce((s, c) => s + c.totalProfit, 0),
    total84: all84.reduce((s, c) => s + c.totalProfit, 0),
    total24: all24.reduce((s, c) => s + c.totalProfit, 0),
    routesUsed: used.size,
    routesTotal: routes.length,
    routesImpossible: Math.max(0, routes.length - used.size),
    all168,
    all84,
    all24,
    fleetChoiceAtCreationCircuits: 0,
    fleetChoiceAtCreationGain: 0,
  };
}

export function runProfitMaxPaxOptimizer(aircrafts, routes, bandSize, options = {}) {
  const {
    useTrue84 = false,
    useAuxRevenue = false,
    strictEcoDemandIsolation = false,
    ecoDemandHighThreshold = 300,
    ecoDemandExhaustedThreshold = 5,
    timeoutMs = 15_000,
  } = options;

  const deadline = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Date.now() + timeoutMs
    : null;

  const pool = generateFleetFirstCircuitPool(aircrafts, routes, {
    bandSize,
    useTrue84,
    useAuxRevenue,
    strictEcoDemandIsolation,
    ecoDemandHighThreshold,
    ecoDemandExhaustedThreshold,
    beamWidth: 24,
    maxBranchPerStep: 12,
    maxCandidatesPerAircraftPerBand: 12,
    anchorCount: 8,
    timeoutMs,
  });

  const mergedCircuits = assignSourceLayers(
    deduplicateCircuitsByRoutes(pool.circuits168),
    deduplicateCircuitsByRoutes(pool.circuits84),
    deduplicateCircuitsByRoutes(pool.circuits24)
  );

  const candidates = circuitsToCandidates(mergedCircuits, {
    metadata: {
      optimizer: "profitMax",
    },
  });

  const selection = deadline && Date.now() >= deadline
    ? { selected: [] }
    : selectCandidateColumnsBeam(candidates, GLOBAL_SELECTION_OPTIONS);
  let selectedCircuits = (selection.selected || [])
    .map((candidate) => candidate.metadata?.sourceCircuit || null)
    .filter(Boolean);

  const usedRouteIds = new Set(
    selectedCircuits.flatMap((circuit) => circuit.routeIds || [])
  );

  const unassignedRoutes = routes.filter((route) => !usedRouteIds.has(route.id));
  const rescueSolos = buildSoloRescueCircuits(unassignedRoutes, aircrafts, {
    useAuxRevenue,
    timeoutMs: Math.max(1, Math.floor((timeoutMs || 15_000) / 2)),
  });

  for (const solo of rescueSolos) {
    const overlaps = (solo.routeIds || []).some((id) => usedRouteIds.has(id));
    if (overlaps) continue;
    selectedCircuits.push(solo);
    for (const id of solo.routeIds || []) usedRouteIds.add(id);
  }

  return {
    ...formatResult(selectedCircuits, routes, { useAuxRevenue }),
    pools: POOLS,
    timedOut: Boolean(deadline && Date.now() >= deadline),
    timedOutStage: deadline && Date.now() >= deadline ? "profitMaxPaxOptimizer" : null,
  };
}

export function runPaxCircuitOptimizer(aircrafts, routes, bandSize, options = {}) {
  return runProfitMaxPaxOptimizer(aircrafts, routes, bandSize, options);
}
