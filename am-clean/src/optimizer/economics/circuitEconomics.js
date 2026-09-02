import { AIRCRAFTS_RAW } from "../../data/aircrafts";
import { MASS_UNIT } from "../../data/constants";
import { cabinConfig } from "../../cabin/cabinConfig";
import { circuitCabinConfig } from "../../cabin/circuitCabin";
import { flightTime } from "../../math/flightTime";
import { computeFuelCost } from "../../math/fuelCost";
import { estimateAuxRevenue } from "../../revenue/auxRevenue";
import { allocateDemand } from "../../core/allocateDemand";
import { applyBellyToCircuit } from "../../cargo/bellyCargo";
import { applyCargoSubstitution } from "../../cargo/cargoSubstitution";

const PROFIT_EPSILON = 1;

export function aircraftKey(ac) {
  return `${ac?.brand || ""} ${ac?.model || ""}`.trim();
}

export function findFullAircraft(aircraft) {
  return (
    AIRCRAFTS_RAW.find(
      (ac) => ac.brand === aircraft?.brand && ac.model === aircraft?.model
    ) || aircraft
  );
}

function getRoutePrices(route) {
  return {
    eco: route.priceEco || null,
    bus: route.priceBus || null,
    first: route.priceFirst || null,
  };
}

export function evaluatePlaneOnRoute({
  aircraft,
  route,
  demandEco,
  demandBus,
  demandFirst,
  useAuxRevenue = true,
}) {
  const ac = findFullAircraft(aircraft);

  if (!ac?.seats || !ac?.speed) return null;
  if (route.distance > ac.range || route.category < ac.cat) return null;

  const ft = flightTime(route.distance, ac.speed);
  if (!Number.isFinite(ft) || ft <= 0) return null;

  const cfg = cabinConfig(
    ac.seats,
    demandEco,
    demandBus,
    demandFirst,
    getRoutePrices(route)
  );

  const capEco = cfg.sE * 2;
  const capBus = cfg.sB * 2;
  const capFirst = cfg.sF * 2;

  const paxEco = allocateDemand(capEco, demandEco);
  const paxBus = allocateDemand(capBus, demandBus);
  const paxFirst = allocateDemand(capFirst, demandFirst);

  const ticketRevenue =
    paxEco * (route.priceEco || 0) +
    paxBus * (route.priceBus || 0) +
    paxFirst * (route.priceFirst || 0);

  const auxRevenue = useAuxRevenue
    ? estimateAuxRevenue({
        aircraft: ac,
        route,
        ecoSeats: cfg.sE || 0,
        busSeats: cfg.sB || 0,
        firstSeats: cfg.sF || 0,
        cargoTons: 0,
      })
    : 0;

  const massUnitPax =
    (cfg.sE || 0) * MASS_UNIT.ECO +
    (cfg.sB || 0) * MASS_UNIT.BUS +
    (cfg.sF || 0) * MASS_UNIT.FIRST;

  const fuelCost = ac.conso
    ? computeFuelCost(route.distance, ac.conso, massUnitPax || 0.1)
    : 0;

  const tax = ((route.tax || 0) * ac.cat) / 2;
  const profit = ticketRevenue + auxRevenue - tax - fuelCost;

  return {
    aircraft: ac,
    aircraftKey: aircraftKey(ac),
    ft,
    label: cfg.label,
    sE: cfg.sE,
    sB: cfg.sB,
    sF: cfg.sF,
    paxEco,
    paxBus,
    paxFirst,
    ticketRevenue,
    auxRevenue,
    fuelCost,
    tax,
    profit,
  };
}

export function evaluateFleetOnRoute({
  fleet = [],
  primaryAircraft,
  route,
  useAuxRevenue = true,
}) {
  const planesToUse =
    fleet.length > 0
      ? fleet
      : primaryAircraft
      ? [{ brand: primaryAircraft.brand, model: primaryAircraft.model }]
      : [];

  let remEco = route.dEco || 0;
  let remBus = route.dBus || 0;
  let remFirst = route.dFirst || 0;

  let ticketRevenue = 0;
  let auxRevenue = 0;
  let fuelCost = 0;
  let tax = 0;
  let paxEco = 0;
  let paxBus = 0;
  let paxFirst = 0;

  for (const planeRef of planesToUse) {
    if (remEco <= 0 && remBus <= 0 && remFirst <= 0) break;

    const planeAircraft = findFullAircraft({
      brand: planeRef.brand || primaryAircraft?.brand,
      model: planeRef.model || primaryAircraft?.model,
    });

    const plane = evaluatePlaneOnRoute({
      aircraft: planeAircraft,
      route,
      demandEco: remEco,
      demandBus: remBus,
      demandFirst: remFirst,
      useAuxRevenue,
    });

    if (!plane) continue;

    ticketRevenue += plane.ticketRevenue;
    auxRevenue += plane.auxRevenue;
    fuelCost += plane.fuelCost;
    tax += plane.tax;
    paxEco += plane.paxEco;
    paxBus += plane.paxBus;
    paxFirst += plane.paxFirst;

    remEco = Math.max(0, remEco - plane.sE * 2);
    remBus = Math.max(0, remBus - plane.sB * 2);
    remFirst = Math.max(0, remFirst - plane.sF * 2);
  }

  return {
    ticketRevenue,
    auxRevenue,
    fuelCost,
    tax,
    profit: ticketRevenue + auxRevenue - tax - fuelCost,
    paxEco,
    paxBus,
    paxFirst,
  };
}

export function evaluateCircuitEconomics({
  primaryAircraft,
  routes = [],
  allAircrafts = AIRCRAFTS_RAW,
  windowH = 168,
  useAuxRevenue = true,
  defaultRotations = 1,
}) {
  const ac = findFullAircraft(primaryAircraft);
  if (!ac || !routes.length) {
    return {
      netProfit: 0,
      totalRevenue: 0,
      totalCost: 0,
      ticketRevenue: 0,
      auxRevenue: 0,
      fuelCost: 0,
      tax: 0,
      bellyRevenue: 0,
      totalTime: 0,
      cabin: null,
      pax: { eco: 0, bus: 0, first: 0 },
    };
  }

  const eligibleRoutes = routes.filter(
    (route) => route.distance <= ac.range && route.category >= ac.cat
  );

  if (!eligibleRoutes.length) {
    return {
      netProfit: 0,
      totalRevenue: 0,
      totalCost: 0,
      ticketRevenue: 0,
      auxRevenue: 0,
      fuelCost: 0,
      tax: 0,
      bellyRevenue: 0,
      totalTime: 0,
      cabin: null,
      pax: { eco: 0, bus: 0, first: 0 },
    };
  }

  const pAc = {
    brand: ac.brand || "",
    model: ac.model || "",
    seats: ac.seats ?? 0,
    range: ac.range || 99999,
    cat: ac.cat || 0,
  };

  const cabin = circuitCabinConfig(pAc, allAircrafts, eligibleRoutes);
  const fleet = cabin.fleet?.length ? cabin.fleet : [{ brand: ac.brand, model: ac.model }];

  let ticketRevenue = 0;
  let auxRevenue = 0;
  let fuelCost = 0;
  let tax = 0;
  let paxEco = 0;
  let paxBus = 0;
  let paxFirst = 0;
  let totalTime = 0;

  for (const route of eligibleRoutes) {
    const rotations = route.rotations || defaultRotations || 1;
    const ft = route.ft || flightTime(route.distance, ac.speed);
    totalTime += ft * rotations;

    const routeEval = evaluateFleetOnRoute({
      fleet,
      primaryAircraft: ac,
      route,
      useAuxRevenue,
    });

    ticketRevenue += routeEval.ticketRevenue * rotations;
    auxRevenue += routeEval.auxRevenue * rotations;
    fuelCost += routeEval.fuelCost * rotations;
    tax += routeEval.tax * rotations;
    paxEco += routeEval.paxEco * rotations;
    paxBus += routeEval.paxBus * rotations;
    paxFirst += routeEval.paxFirst * rotations;
  }

  const bellyRevenue = (cabin.bellyRevTotal || 0) * (defaultRotations || 1);
  const totalRevenue = ticketRevenue + auxRevenue;
  const totalCost = fuelCost + tax;
  const netProfit = totalRevenue - totalCost;

  return {
    netProfit,
    totalRevenue,
    totalCost,
    ticketRevenue,
    auxRevenue,
    fuelCost,
    tax,
    bellyRevenue,
    totalTime,
    cabin,
    pax: { eco: paxEco, bus: paxBus, first: paxFirst },
    windowH,
  };
}

export function findBestAircraftForRoutes(routes, aircrafts = AIRCRAFTS_RAW, options = {}) {
  const {
    windowH = 168,
    useAuxRevenue = true,
    defaultRotations = 1,
    minProfit = Number.NEGATIVE_INFINITY,
  } = options;

  let best = null;

  for (const candidate of aircrafts) {
    const economics = evaluateCircuitEconomics({
      primaryAircraft: candidate,
      routes,
      allAircrafts: aircrafts,
      windowH,
      useAuxRevenue,
      defaultRotations,
    });

    if (economics.netProfit < minProfit) continue;

    if (
      !best ||
      economics.netProfit > best.economics.netProfit + PROFIT_EPSILON ||
      (Math.abs(economics.netProfit - best.economics.netProfit) <= PROFIT_EPSILON &&
        economics.totalTime > 0 &&
        best.economics.totalTime > 0 &&
        economics.netProfit / economics.totalTime >
          best.economics.netProfit / best.economics.totalTime + 1e-9)
    ) {
      best = {
        aircraft: findFullAircraft(candidate),
        economics,
      };
    }
  }

  return best;
}

export function buildEvaluatedCircuit(
  routes,
  aircrafts = AIRCRAFTS_RAW,
  options = {}
) {
  const {
    windowH = 168,
    useAuxRevenue = true,
    defaultRotations = 1,
    pool = "profit",
    typeLabel = null,
    forcedAircraft = null,
  } = options;

  if (!routes?.length) return null;

  const best = forcedAircraft
    ? {
        aircraft: findFullAircraft(forcedAircraft),
        economics: evaluateCircuitEconomics({
          primaryAircraft: forcedAircraft,
          routes,
          allAircrafts: aircrafts,
          windowH,
          useAuxRevenue,
          defaultRotations,
        }),
      }
    : findBestAircraftForRoutes(routes, aircrafts, {
        windowH,
        useAuxRevenue,
        defaultRotations,
      });

  if (!best || (best.economics.netProfit <= 0 && routes.length > 1)) {
    if (routes.length === 1) {
      const soloBest = findBestAircraftForRoutes(routes, aircrafts, {
        windowH,
        useAuxRevenue,
        defaultRotations,
      });
      if (!soloBest || soloBest.economics.netProfit <= 0) return null;
      return finalizeCircuitObject(soloBest, routes, options);
    }
    return null;
  }

  return finalizeCircuitObject(best, routes, {
    ...options,
    windowH,
    useAuxRevenue,
    defaultRotations,
    pool,
    typeLabel,
  });
}

function finalizeCircuitObject(best, routes, options) {
  const {
    windowH = 168,
    useAuxRevenue = true,
    defaultRotations = 1,
    pool = "profit",
    typeLabel = null,
  } = options;

  const ac = best.aircraft;
  const economics = best.economics;
  const ai = {
    brand: ac.brand,
    model: ac.model,
    seats: ac.seats,
    cat: ac.cat,
  };

  // CORRECTIF : recalcule TOUS les champs économiques par route avec le vrai
  // avion final (ac), pas seulement ft. Avant, profit/rev/tax/cabin/auxRevenue/
  // fuelCost restaient figés avec les valeurs de l'avion-sonde utilisé pendant
  // la génération du pool, même quand l'avion réellement retenu était différent
  // — ce qui donnait des chiffres par route incohérents avec le totalProfit
  // du circuit (lui, correctement recalculé).
  const routeRotations = routes.map((route) => {
    const rotations = route.rotations || defaultRotations || 1;
    const reEvaluated = evaluatePlaneOnRoute({
      aircraft: ac,
      route,
      demandEco: route.dEco || 0,
      demandBus: route.dBus || 0,
      demandFirst: route.dFirst || 0,
      useAuxRevenue,
    });

    if (!reEvaluated) {
      // Filet de sécurité : l'avion final devrait toujours être éligible
      // (déjà vérifié en amont), mais si jamais ce n'est pas le cas, on
      // garde l'ancien comportement plutôt que de planter.
      return {
        ...route,
        ft: flightTime(route.distance, ac.speed),
        rotations,
      };
    }

    return {
      ...route,
      ft: reEvaluated.ft,
      rev: reEvaluated.ticketRevenue + reEvaluated.auxRevenue,
      profit: reEvaluated.profit,
      auxRevenue: reEvaluated.auxRevenue,
      fuelCost: reEvaluated.fuelCost,
      tax: reEvaluated.tax,
      cabin: {
        sE: reEvaluated.sE,
        sB: reEvaluated.sB,
        sF: reEvaluated.sF,
        rev: reEvaluated.ticketRevenue,
        label: reEvaluated.label,
      },
      rotations,
    };
  });

  const circuit = {
    aircraft: ai,
    windowH,
    pool,
    type:
      typeLabel ||
      `${routeRotations.length} route(s)${defaultRotations > 1 ? ` ×${defaultRotations}` : ""} [profit]`,
    routes: routeRotations,
    routeIds: routeRotations.map((route) => route.id),
    totalTime: economics.totalTime,
    totalProfit: economics.netProfit,
    totalRev: economics.totalRevenue,
    cabin: economics.cabin,
    profitPerHour: economics.totalTime > 0 ? economics.netProfit / economics.totalTime : 0,
    routeCount: routeRotations.length,
    fillRate: windowH > 0 ? ((economics.totalTime / windowH) * 100).toFixed(1) : "0.0",
    pax: economics.pax,
    _sourceWindow: options._sourceWindow,
    economics: {
      ticketRevenue: economics.ticketRevenue,
      auxRevenue: economics.auxRevenue,
      fuelCost: economics.fuelCost,
      tax: economics.tax,
      bellyRevenue: economics.bellyRevenue,
      useAuxRevenue,
    },
  };

  return applyCargoSubstitution(applyBellyToCircuit(circuit));
}

export function enrichRouteEconomics(aircraft, route, options = {}) {

const { useAuxRevenue = true, maxH = 168 } = options;

  const ac = findFullAircraft(aircraft);

if (route.distance > ac.range || route.category < ac.cat) {

    return null;
}

  const plane = evaluatePlaneOnRoute({
    aircraft: ac,
    route,
    demandEco: route.dEco || 0,
    demandBus: route.dBus || 0,
    demandFirst: route.dFirst || 0,
    useAuxRevenue,
  });

if (!plane || plane.ft <= 0 || plane.ft > maxH) {

    return null;
}

  return {
    ...route,
    ft: plane.ft,
    rev: plane.ticketRevenue + plane.auxRevenue,
    profit: plane.profit,
    auxRevenue: plane.auxRevenue,
    fuelCost: plane.fuelCost,
    // tax: plane.tax,
    cabin: {
      sE: plane.sE,
      sB: plane.sB,
      sF: plane.sF,
      rev: plane.ticketRevenue,
      label: plane.label,
    },
  };
}

export function compareByNetProfit(a, b, epsilon = PROFIT_EPSILON) {
  const profitA = Number(a?.totalProfit ?? a?.netProfit ?? 0);
  const profitB = Number(b?.totalProfit ?? b?.netProfit ?? 0);

  if (profitB > profitA + epsilon) return 1;
  if (profitA > profitB + epsilon) return -1;

  const pphA =
    (a?.totalTime || 0) > 0 ? profitA / (a.totalTime || 1) : a?.profitPerHour || 0;
  const pphB =
    (b?.totalTime || 0) > 0 ? profitB / (b.totalTime || 1) : b?.profitPerHour || 0;

  if (pphB > pphA + 1e-6) return 1;
  if (pphA > pphB + 1e-6) return -1;

  const fillA = Number(a?.fillRate || 0);
  const fillB = Number(b?.fillRate || 0);
  if (fillB > fillA) return 1;
  if (fillA > fillB) return -1;

  return 0;
}
