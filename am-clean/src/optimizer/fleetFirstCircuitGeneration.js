import { makeDemandBands } from "./demandBands";
import { beamPackCircuitsMultiAnchor } from "./beamCircuitSearch";
import { routesEcoDemandCompatible } from "../utils/paxResultUtils";
import { POOLS, poolBlockForCategory } from "../data/pools";
import {
  buildEvaluatedCircuit,
  enrichRouteEconomics,
  findFullAircraft,
} from "./economics/circuitEconomics";

export function buildCircuitFromRoutes(aircraft, routes, windowH, rotations = 1, extra = {}) {
  const { useAuxRevenue = true, allAircrafts = [], pool = "profit" } = extra;

  return buildEvaluatedCircuit(routes, allAircrafts.length ? allAircrafts : [aircraft], {
    windowH,
    useAuxRevenue,
    defaultRotations: rotations,
    pool,
    forcedAircraft: aircraft,
    typeLabel: `${routes.length} route(s)${rotations > 1 ? ` ×${rotations}` : ""} [profit]`,
    _sourceWindow: extra._sourceWindow,
  });
}

// Regroupe les routes par bloc de pool (basé sur leur propre catégorie),
// pour ne tester en primaire que les avions pertinents pour ce bloc.
export function groupRoutesByPoolBlock(routes) {
  const groups = new Map();

  for (const route of routes) {
    const block = poolBlockForCategory(route.category);
    if (!groups.has(block.label)) {
      groups.set(block.label, { block, routes: [] });
    }
    groups.get(block.label).routes.push(route);
  }

  return [...groups.values()];
}

// Filtre les avions éligibles en PRIMAIRE pour un bloc donné.
// N'affecte QUE la boucle de génération de circuits ici — la cascade de
// flotte (buildMultiFleetCascade) continue d'utiliser AIRCRAFTS_RAW complet,
// sans restriction, comme dans l'ancien mécanisme validé par Thibault.
export function aircraftsForPoolBlock(aircrafts, block) {
  return aircrafts.filter((aircraft) => {
    const ac = findFullAircraft(aircraft);
    return Number(ac?.cat || 0) >= block.testCatMin;
  });
}

function isDeadlineExceeded(deadline) {
  return Boolean(deadline && Date.now() >= deadline);
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
    anchorCount = 4,
    timeoutMs = null,
  } = options;

  const deadline = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Date.now() + timeoutMs
    : null;

  const circuits168 = [];
  const circuits84 = [];
  const circuits24 = [];
  const routeSetSeen = new Set();
  let timedOut = false;

  const registerCircuit = (list, circuit) => {
    if (!circuit || circuit.totalProfit <= 0) return;

    const routeKey = [...(circuit.routeIds || [])].sort().join("|");
    const fleetKey = `${circuit.aircraft?.brand}|${circuit.aircraft?.model}|${circuit.windowH}|${routeKey}`;

    if (routeSetSeen.has(fleetKey)) return;
    routeSetSeen.add(fleetKey);
    list.push(circuit);
  };

  const bands = bandSize ? makeDemandBands(bandSize) : [null];

  // ── Génération 168h / 84h, restreinte par bloc de pool ────────────────────
  const routeGroups168 = groupRoutesByPoolBlock(routes);

  outerGroups: for (const { block, routes: blockRoutes } of routeGroups168) {
    const blockAircrafts = aircraftsForPoolBlock(aircrafts, block);

    for (const aircraft of blockAircrafts) {
      if (isDeadlineExceeded(deadline)) {
        timedOut = true;
        break outerGroups;
      }

      const ac = findFullAircraft(aircraft);
      const eligible168 = blockRoutes
        .map((route) => enrichRouteEconomics(ac, route, { useAuxRevenue, maxH: 168 }))
        .filter(Boolean);

      if (eligible168.length >= 2) {
        for (const band of bands) {
          if (isDeadlineExceeded(deadline)) {
            timedOut = true;
            break outerGroups;
          }

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
          }).filter(
            (state) =>
              !strictEcoDemandIsolation ||
              routesEcoDemandCompatible(state.routes, {
                highEcoThreshold: ecoDemandHighThreshold,
                exhaustedEcoThreshold: ecoDemandExhaustedThreshold,
              })
          );

          for (const state of found168) {
            const circuit = buildEvaluatedCircuit(state.routes, aircrafts, {
              windowH: 168,
              useAuxRevenue,
              defaultRotations: 1,
              pool: "profit-beam",
              typeLabel: `${state.routes.length} route(s) [168h profit]`,
              _sourceWindow: "circuits168",
            });
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
            });

            for (const state of found84) {
              const circuit = buildEvaluatedCircuit(state.routes, aircrafts, {
                windowH: 84,
                useAuxRevenue,
                defaultRotations: 2,
                pool: "profit-beam",
                typeLabel: `${state.routes.length} route(s) ×2 [84h profit]`,
                _sourceWindow: "circuits84",
              });
              registerCircuit(circuits84, circuit);
            }
          }
        }
      }
    }
  }

  // ── Génération 24h — pas de restriction pool (jamais fait avant, on garde
  // le comportement d'origine ; ce n'est pas la boucle coûteuse). ──────────
  outer24: for (const aircraft of aircrafts) {
    if (isDeadlineExceeded(deadline)) {
      timedOut = true;
      break outer24;
    }

    const ac = findFullAircraft(aircraft);
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
      });

      for (const state of found24) {
        if (state.routes.length < 2) continue;
        const circuit = buildEvaluatedCircuit(state.routes, aircrafts, {
          windowH: 24,
          useAuxRevenue,
          defaultRotations: 1,
          pool: "profit-beam",
          typeLabel: `${state.routes.length} route(s) [24h profit]`,
          _sourceWindow: "circuits24",
        });
        registerCircuit(circuits24, circuit);
      }

      for (const route of eligible24) {
        const rot = Math.floor(24 / route.ft);
        if (rot < 1) continue;

        const circuit = buildEvaluatedCircuit([route], aircrafts, {
          windowH: 24,
          useAuxRevenue,
          defaultRotations: rot,
          pool: "profit-solo",
          typeLabel: `×${rot} [24h solo profit]`,
          _sourceWindow: "circuits24",
        });
        registerCircuit(circuits24, circuit);
      }
    }
  }

  return { circuits168, circuits84, circuits24, timedOut };
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