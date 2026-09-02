import { PRICE } from "../data/constants";
import { getSeatConfigs } from "./seatConfigs";
import { allocateDemand } from "../core/allocateDemand";

const cabinConfigCache = new Map();

export function clearCabinConfigCache() {
  cabinConfigCache.clear();
}

export function cabinConfig(seats, dEco, dBus, dFirst, routePrices, options = {}) {
  const { seatTolerance = 1 } = options;
  const priceKey = routePrices
    ? `${routePrices.eco || 0}|${routePrices.bus || 0}|${routePrices.first || 0}`
    : 0;
  const finalKey = `${priceKey}|${seatTolerance}`;

  let bySeat = cabinConfigCache.get(seats);
  if (!bySeat) { bySeat = new Map(); cabinConfigCache.set(seats, bySeat); }

  let byEco = bySeat.get(dEco);
  if (!byEco) { byEco = new Map(); bySeat.set(dEco, byEco); }

  let byBus = byEco.get(dBus);
  if (!byBus) { byBus = new Map(); byEco.set(dBus, byBus); }

  let byFirst = byBus.get(dFirst);
  if (!byFirst) { byFirst = new Map(); byBus.set(dFirst, byFirst); }

  const cached = byFirst.get(finalKey);
  if (cached !== undefined) return cached;

  const result = computeCabinConfig(seats, dEco, dBus, dFirst, routePrices, options);
  byFirst.set(finalKey, result);
  return result;
}

function computeCabinConfig(seats, dEco, dBus, dFirst, routePrices, options = {}) {
  const { seatTolerance = 1 } = options;

  const pEco = (routePrices && routePrices.eco) || PRICE.ECO;
  const pBus = (routePrices && routePrices.bus) || PRICE.BUS;
  const pFirst = (routePrices && routePrices.first) || PRICE.FIRST;

  const oneWayEco = (dEco || 0) / 2;
  const oneWayBus = (dBus || 0) / 2;
  const oneWayFirst = (dFirst || 0) / 2;

  const maxSeatEco = oneWayEco > 0 ? Math.ceil(oneWayEco) : 0;
  const maxSeatBus = oneWayBus > 0 ? Math.ceil(oneWayBus) : 0;
  const maxSeatFirst = oneWayFirst > 0 ? Math.ceil(oneWayFirst) : 0;

  const cfgs = getSeatConfigs(seats);

  const eligible = cfgs.filter(
    ({ sE, sB, sF }) =>
      sE <= maxSeatEco + seatTolerance &&
      sB <= maxSeatBus + seatTolerance &&
      sF <= maxSeatFirst + seatTolerance
  );

  const pool = eligible.length > 0 ? eligible : cfgs;

  let best = null;
  let bestRev = -Infinity;
  let bestWaste = Infinity;

  for (const { sE, sB, sF, label } of pool) {
    const filledEco = allocateDemand(sE, oneWayEco);
    const filledBus = allocateDemand(sB, oneWayBus);
    const filledFirst = allocateDemand(sF, oneWayFirst);

    const rev =
      (filledEco * pEco + filledBus * pBus + filledFirst * pFirst) * 2;

    const waste =
      Math.max(0, sE - oneWayEco) * pEco * 2 +
      Math.max(0, sB - oneWayBus) * pBus * 2 +
      Math.max(0, sF - oneWayFirst) * pFirst * 2;

    if (
      rev > bestRev + 0.01 ||
      (Math.abs(rev - bestRev) < 0.01 && waste < bestWaste)
    ) {
      bestRev = rev;
      bestWaste = waste;
      best = { sE, sB, sF, rev, label };
    }
  }

  return (
    best || {
      sE: Math.min(seats, maxSeatEco || seats),
      sB: 0,
      sF: 0,
      rev: 0,
      label: `${seats}é/0b/0f`,
    }
  );
}