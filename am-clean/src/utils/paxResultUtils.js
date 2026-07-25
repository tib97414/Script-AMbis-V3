export function flattenPaxCircuits(result) {
  const byAircraft = result?.byAircraft || [];

  return {
    all168: byAircraft.flatMap((item) => item.circuits168 || []),
    all84: byAircraft.flatMap((item) => item.circuits84 || []),
    all24: byAircraft.flatMap((item) => item.circuits24 || []),
  };
}

export function allPaxCircuits(result) {
  const { all168, all84, all24 } = flattenPaxCircuits(result);
  return [...all168, ...all84, ...all24];
}

export function totalProfitOfCircuits(circuits) {
  return circuits.reduce((sum, circuit) => sum + (circuit.totalProfit || 0), 0);
}

export function totalTimeOfCircuits(circuits) {
  return circuits.reduce((sum, circuit) => sum + (circuit.totalTime || 0), 0);
}

export function getCircuitBoardedPax(circuit) {
  const fleet = circuit?.cabin?.fleet || [];

  if (fleet.length) {
    return fleet.reduce(
      (sum, plane) => ({
        eco: sum.eco + (plane.paxEco || 0),
        bus: sum.bus + (plane.paxBus || 0),
        first: sum.first + (plane.paxFirst || 0),
      }),
      { eco: 0, bus: 0, first: 0 }
    );
  }

  return {
    eco: circuit?.pax?.eco || 0,
    bus: circuit?.pax?.bus || 0,
    first: circuit?.pax?.first || 0,
  };
}

export function getRouteBoardedPax(route, circuit) {
  const boarded = getCircuitBoardedPax(circuit);

  return {
    eco: Math.min(boarded.eco || 0, route.dEco || 0),
    bus: Math.min(boarded.bus || 0, route.dBus || 0),
    first: Math.min(boarded.first || 0, route.dFirst || 0),
  };
}

export function routesEcoDemandCompatible(
  routes,
  { highEcoThreshold = 300, exhaustedEcoThreshold = 5 } = {}
) {
  if (!routes || routes.length < 2) return true;

  const ecoValues = routes.map((route) => route.dEco || 0);
  const hasExhaustedEco = ecoValues.some(
    (demand) => demand <= exhaustedEcoThreshold
  );
  const hasHighEco = ecoValues.some((demand) => demand >= highEcoThreshold);
  const hasMidEco = ecoValues.some(
    (demand) =>
      demand > exhaustedEcoThreshold && demand < highEcoThreshold
  );

  if (hasExhaustedEco && (hasHighEco || hasMidEco)) return false;
  if (hasHighEco && hasMidEco) return false;

  return true;
}

export function refreshPaxSummary(result, byAircraft, extra = {}) {
  const all168 = byAircraft.flatMap((item) => item.circuits168 || []);
  const all84 = byAircraft.flatMap((item) => item.circuits84 || []);
  const all24 = byAircraft.flatMap((item) => item.circuits24 || []);
  
  const allCircuits = [...all168, ...all84, ...all24];

const fleetChoiceAtCreationCircuits = allCircuits.filter(
  (circuit) => circuit.isFleetChoiceAtCreation
).length;

const fleetChoiceAtCreationGain = allCircuits.reduce(
  (sum, circuit) => sum + (circuit.fleetChoiceAtCreation?.gain || 0),
  0
);

  return {
    ...result,
    ...extra,
    byAircraft,
    aircraftCount: byAircraft.length,
    circuits168: all168.length,
    circuits84: all84.length,
    circuits24: all24.length,
    total168: totalProfitOfCircuits(all168),
    total84: totalProfitOfCircuits(all84),
    total24: totalProfitOfCircuits(all24),
    all168,
    all84,
    all24,
    fleetChoiceAtCreationCircuits,
    fleetChoiceAtCreationGain,
  };
}

export function mergePaxResults(baseResult, extraResult) {
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

  for (const item of extraResult.byAircraft || []) {
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

  return [...mergedByAircraft.values()].map((item) => ({
    ...item,
    best168: item.circuits168[0] || null,
    best84: item.circuits84[0] || null,
    best24: item.circuits24[0] || null,
    totalProfit168: totalProfitOfCircuits(item.circuits168),
    totalProfit84: totalProfitOfCircuits(item.circuits84),
    totalProfit24: totalProfitOfCircuits(item.circuits24),
  }));
}

function categoryPoolKey(cat) {
  const category = Number(cat || 0);

  if (category >= 1 && category <= 3) return "cat13";
  if (category === 4) return "cat4";
  if (category >= 5 && category <= 6) return "cat56";
  if (category >= 7 && category <= 10) return "cat710";

  return "unknown";
}

function emptyCategoryPoolCounters() {
  return {
    cat13: { gt1500: 0, gt1000: 0, gt500: 0 },
    cat4: { gt1500: 0, gt1000: 0, gt500: 0 },
    cat56: { gt1500: 0, gt1000: 0, gt500: 0 },
    cat710: { gt1500: 0, gt1000: 0, gt500: 0 },
    unknown: { gt1500: 0, gt1000: 0, gt500: 0 },
  };
}

export function remainingDemandAfterPassMetrics(result) {
  const allCircuits = [
    ...flattenPaxCircuits(result).all168,
    ...flattenPaxCircuits(result).all84,
    ...flattenPaxCircuits(result).all24,
  ];
  const demandByRoute = new Map();
  const boardedByRoute = new Map();
  const categoryByRoute = new Map();

  for (const circuit of allCircuits) {
    for (const route of circuit.routes || []) {
      const originalId = route.originalId || route.id;
      const routeDemand = route.dEco || 0;
      const previousDemand = demandByRoute.get(originalId) || 0;
      const routeBoarded = getRouteBoardedPax(route, circuit);

      categoryByRoute.set(
        originalId,
        route.category ?? route.cat ?? route.airportCategory ?? 0
      );

      if (!route.isResidualDemand) {
        demandByRoute.set(originalId, Math.max(previousDemand, routeDemand));
      } else if (!previousDemand) {
        demandByRoute.set(originalId, routeDemand);
      }

      const demandCap = demandByRoute.get(originalId) || routeDemand;
      boardedByRoute.set(
        originalId,
        Math.min(
          demandCap,
          (boardedByRoute.get(originalId) || 0) + routeBoarded.eco
        )
      );
    }
  }

const byCategoryPool = emptyCategoryPoolCounters();

const remainingValues = [...demandByRoute.entries()].map(([id, demand]) => {
  const remaining = Math.max(0, demand - (boardedByRoute.get(id) || 0));
  const pool = categoryPoolKey(categoryByRoute.get(id));

  if (remaining >= 1500) byCategoryPool[pool].gt1500 += 1;
  if (remaining >= 1000) byCategoryPool[pool].gt1000 += 1;
  if (remaining >= 500) byCategoryPool[pool].gt500 += 1;

  return remaining;
});

return {
  residualRemainingGt2000: remainingValues.filter((v) => v >= 2000).length,
  residualRemainingGt1500: remainingValues.filter((v) => v >= 1500).length,
  residualRemainingGt1000: remainingValues.filter((v) => v >= 1000).length,
  residualRemainingGt500: remainingValues.filter((v) => v >= 500).length,
  residualRemainingMaxEco: Math.max(0, ...remainingValues),

  residualCat13Gt1500: byCategoryPool.cat13.gt1500,
  residualCat4Gt1500: byCategoryPool.cat4.gt1500,
  residualCat56Gt1500: byCategoryPool.cat56.gt1500,
  residualCat710Gt1500: byCategoryPool.cat710.gt1500,

  residualCat13Gt1000: byCategoryPool.cat13.gt1000,
  residualCat4Gt1000: byCategoryPool.cat4.gt1000,
  residualCat56Gt1000: byCategoryPool.cat56.gt1000,
  residualCat710Gt1000: byCategoryPool.cat710.gt1000,

  residualCat13Gt500: byCategoryPool.cat13.gt500,
  residualCat4Gt500: byCategoryPool.cat4.gt500,
  residualCat56Gt500: byCategoryPool.cat56.gt500,
  residualCat710Gt500: byCategoryPool.cat710.gt500,
};
}
