import { PRICE } from "../data/constants";
import { cabinConfig } from "./cabinConfig";
import { allocateDemand } from "../core/allocateDemand";

export function avgTaxForRoutes(routes) {
  if (!routes || !routes.length) return 0;
  return routes.reduce((s, r) => s + (r.tax || 0), 0) / routes.length;
}

// Configuration cabine simple pour 1 avion
export function singleCabinCfg(seats, demEco, demBus, demFirst) {
  const cfg = cabinConfig(seats, demEco, demBus, demFirst);

  cfg.demandEco = demEco;
  cfg.demandBus = demBus;
  cfg.demandFirst = demFirst;

  cfg.capPerAc = {
    eco: cfg.sE * 2,
    bus: cfg.sB * 2,
    first: cfg.sF * 2,
  };

  return cfg;
}

// Cascade simple avec un même type d'avion.
// Utilisée quand on n'a pas les routes complètes du circuit.
export function buildFleetCascade(seats, demEco, demBus, demFirst, avgTax, maxPlanes) {
  const MAX = maxPlanes || 20;
  const planes = [];

  let remEco = demEco;
  let remBus = demBus;
  let remFirst = demFirst;

  for (let i = 0; i < MAX; i++) {
    if (remEco <= 0 && remBus <= 0 && remFirst <= 0) break;

    const cfg = cabinConfig(seats, remEco, remBus, remFirst);

    const capEco = cfg.sE * 2;
    const capBus = cfg.sB * 2;
    const capFirst = cfg.sF * 2;

    const paxEco = allocateDemand(capEco, remEco);
    const paxBus = allocateDemand(capBus, remBus);
    const paxFirst = allocateDemand(capFirst, remFirst);

    const rev =
      paxEco * PRICE.ECO +
      paxBus * PRICE.BUS +
      paxFirst * PRICE.FIRST;

    const tax = avgTax * 2;
    const profit = rev - tax;

    if (i > 0 && profit <= 0) break;

    planes.push({
      planeNum: i + 1,
      label: cfg.label,
      sE: cfg.sE,
      sB: cfg.sB,
      sF: cfg.sF,
      capEco,
      capBus,
      capFirst,
      paxEco,
      paxBus,
      paxFirst,
      demandEco: remEco,
      demandBus: remBus,
      demandFirst: remFirst,
      rev,
      tax,
      profit,
      isProfitable: profit > 0,
      isSameType: true,
      brand: "",
      model: "",
    });

    remEco = Math.max(0, remEco - paxEco);
    remBus = Math.max(0, remBus - paxBus);
    remFirst = Math.max(0, remFirst - paxFirst);
  }

  return {
    planes,
    unsatisfied: {
      eco: remEco,
      bus: remBus,
      first: remFirst,
    },
  };
}