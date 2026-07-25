import { makeDemandBands } from "./demandBands";
import { beamPackCircuitsMultiAnchor } from "./beamCircuitSearch";
import { routesEcoDemandCompatible } from "../utils/paxResultUtils";
import { POOLS } from "../data/pools";
import {
  buildEvaluatedCircuit,
  enrichRouteEconomics,
  findFullAircraft,
} from "./economics/circuitEconomics.js";

function inferCircuitPoolLabel(routes = []) {
  const categories = (routes || [])
    .map((route) => Number(route?.category ?? route?.cat ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!categories.length) return "Cat N/A";

  const topCategory = Math.max(...categories);
  const match = POOLS.find(({ min, max }) => topCategory >= min && topCategory <= max);

  return match?.label || `Cat ${topCategory}`;
}

function attachPoolMetadata(circuit, routes = []) {
  if (!circuit) return circuit;

  const label = inferCircuitPoolLabel(routes);
  return {
    ...circuit,
    poolCategory: label,
    poolLabel: label,
  };
}

export function buildCircuitFromRoutes(aircraft, routes, windowH, rotations = 1, extra = {}) {
  const { useAuxRevenue = true, allAircrafts = [], pool = "profit" } = extra;

  const built = buildEvaluatedCircuit(routes, allAircrafts.length ? allAircrafts : [aircraft], {
    windowH,
    useAuxRevenue,
    defaultRotations: rotations,
    pool,
    forcedAircraft: aircraft,
    typeLabel: `${routes.length} route(s)${rotations > 1 ? ` ×${rotations}` : ""} [profit]`,
    _sourceWindow: extra._sourceWindow,
  });

  return attachPoolMetadata(built, routes);
}

export function generateFleetFirstCircuitPool(aircrafts, routes, options = {}) {
  const {
    bandSize = 1000,
    useTrue84 = false,
    useAuxRevenue = false,
    strictEcoDemandIsolation = false,
    ecoDemandHighThreshold = 300,
    ecoDemandExhaustedThreshold = 5,
    beamWidth = 24,
    maxBranchPerStep = 12,
    maxCandidatesPerAircraftPerBand = 12,
    anchorCount = 8,
    timeoutMs = 15_000,
  } = options;

  const deadline = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Date.now() + timeoutMs
    : null;

  const circuits168 = [];
  const circuits84 = [];
  const circuits24 = [];
  const routeSetSeen = new Set();

  const registerCircuit = (list, circuit) => {
    if (!circuit || circuit.totalProfit <= 0) return;

    const routeKey = [...(circuit.routeIds || [])].sort().join("|");
    const fleetKey = `${circuit.aircraft?.brand}|${circuit.aircraft?.model}|${circuit.windowH}|${routeKey}`;

    if (routeSetSeen.has(fleetKey)) return;
    routeSetSeen.add(fleetKey);
    list.push(circuit);
  };

  const bands = bandSize ? makeDemandBands(bandSize) : [null];

  for (const aircraft of aircrafts) {
    if (deadline && Date.now() >= deadline) break;

    const ac = findFullAircraft(aircraft);
    const eligible168 = routes
      .map((route) => enrichRouteEconomics(ac, route, { useAuxRevenue, maxH: 168 }))
      .filter(Boolean);

    if (eligible168.length >= 2) {
      for (const band of bands) {
        const poolRoutes = band
          ? eligible168.filter((r) => (r.dEco || 0) >= band.min && (r.dEco || 0) < band.max)
          : eligible168;

        if (poolRoutes.length < 2) continue;

        const found168 = beamPackCircuitsMultiAnchor(poolRoutes, {
          targetH: 168,
          beamWidth,
          maxBranchPerStep,
          maxCandidatesOut: maxCandidatesPerAircraftPerBand,
          minFillRatio: 0.45,
          anchorCount,
          deadline,
        }).filter(
          (state) =>
            !strictEcoDemandIsolation ||
            routesEcoDemandCompatible(state.routes, {
              highEcoThreshold: ecoDemandHighThreshold,
              exhaustedEcoThreshold: ecoDemandExhaustedThreshold,
            })
        );

        for (const state of found168) {
          const circuit = attachPoolMetadata(
            buildEvaluatedCircuit(state.routes, aircrafts, {
              windowH: 168,
              useAuxRevenue,
              defaultRotations: 1,
              pool: "profit-beam",
              typeLabel: `${state.routes.length} route(s) [168h profit]`,
              _sourceWindow: "circuits168",
            }),
            state.routes
          );
          registerCircuit(circuits168, circuit);
        }

        if (useTrue84) {
          const found84 = beamPackCircuitsMultiAnchor(poolRoutes, {
            targetH: 84,
            beamWidth,
            maxBranchPerStep,
            maxCandidatesOut: Math.max(4, Math.floor(maxCandidatesPerAircraftPerBand / 2)),
            minFillRatio: 0.45,
            anchorCount,
            deadline,
          });

          for (const state of found84) {
            const circuit = attachPoolMetadata(
              buildEvaluatedCircuit(state.routes, aircrafts, {
                windowH: 84,
                useAuxRevenue,
                defaultRotations: 2,
                pool: "profit-beam",
                typeLabel: `${state.routes.length} route(s) ×2 [84h profit]`,
                _sourceWindow: "circuits84",
              }),
              state.routes
            );
            registerCircuit(circuits84, circuit);
          }
        }
      }
    }

    const eligible24 = routes
      .map((route) => enrichRouteEconomics(ac, route, { useAuxRevenue, maxH: 24 }))
      .filter(Boolean);

    if (eligible24.length) {
      const found24 = beamPackCircuitsMultiAnchor(eligible24, {
        targetH: 24,
        beamWidth: Math.max(12, Math.floor(beamWidth / 2)),
        maxBranchPerStep,
        maxCandidatesOut: maxCandidatesPerAircraftPerBand,
        minFillRatio: 0.25,
        anchorCount,
        deadline,
      });

      for (const state of found24) {
        if (state.routes.length < 2) continue;
        const circuit = attachPoolMetadata(
          buildEvaluatedCircuit(state.routes, aircrafts, {
            windowH: 24,
            useAuxRevenue,
            defaultRotations: 1,
            pool: "profit-beam",
            typeLabel: `${state.routes.length} route(s) [24h profit]`,
            _sourceWindow: "circuits24",
          }),
          state.routes
        );
        registerCircuit(circuits24, circuit);
      }

      for (const route of eligible24) {
        const rot = Math.floor(24 / route.ft);
        if (rot < 1) continue;

        const circuit = attachPoolMetadata(
          buildEvaluatedCircuit([route], aircrafts, {
            windowH: 24,
            useAuxRevenue,
            defaultRotations: rot,
            pool: "profit-solo",
            typeLabel: `×${rot} [24h solo profit]`,
            _sourceWindow: "circuits24",
          }),
          [route]
        );
        registerCircuit(circuits24, circuit);
      }
    }
  }

  return {
    circuits168,
    circuits84,
    circuits24,
    timedOut: Boolean(deadline && Date.now() >= deadline),
    timedOutStage: deadline && Date.now() >= deadline ? "fleetFirstCircuitPool" : null,
  };
}

export function deduplicateCircuitsByRoutes(circuits = []) {
  const bestByRoutes = new Map();

  for (const circuit of circuits) {
    const routeKey = [...(circuit.routeIds || [])].sort().join("|");
    const existing = bestByRoutes.get(routeKey);

    if (!existing || Number(circuit.totalProfit || 0) > Number(existing.totalProfit || 0)) {
      bestByRoutes.set(routeKey, circuit);
    }
  }

  return [...bestByRoutes.values()].sort(
    (a, b) => Number(b.totalProfit || 0) - Number(a.totalProfit || 0)
  );
}
