import { PRICE } from "../data/constants";
import { getSeatConfigs } from "./seatConfigs";
import { allocateDemand } from "../core/allocateDemand";

export function cabinConfig(seats, dEco, dBus, dFirst, routePrices, options = {}) {
  const { seatTolerance = 1 } = options;

  const pEco = (routePrices && routePrices.eco) || PRICE.ECO;
  const pBus = (routePrices && routePrices.bus) || PRICE.BUS;
  const pFirst = (routePrices && routePrices.first) || PRICE.FIRST;

  // Cap dur : jamais plus de sièges que la demande aller simple ne peut absorber.
  // On calcule d'abord la configuration sur un aller simple, puis on dérive
  // les totals de rotation complète sur la base de ce résultat unique.
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