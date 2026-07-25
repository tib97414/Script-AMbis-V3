import { PRICE, TURNAROUND, ROUND_STEP } from "../data/constants";
import { flightTime } from "../math/flightTime";
import { computeFuelCost } from "../math/fuelCost";
import { CARGO_AIRCRAFTS_RAW} from "../data/cargoAircrafts"
import { avgTaxForRoutes} from "../cabin/fleetBasic"

export function buildCargoFleetCascade(primaryAc, allCargoAc, circuitRoutes) {
  // Demande cargo consolidée du circuit = min(dCargo) sur toutes les routes
  const demands = circuitRoutes.map((r) => r.dCargo || 0).filter((d) => d > 0);
  if (!demands.length) return { planes: [], unsatisfied: 0 };
  let remDemand = Math.min(...demands);

  const planes = [];

  for (let i = 0; i < 30; i++) {
    if (remDemand <= 0) break;
    const candidates =
      i === 0 ? [primaryAc] : allCargoAc || CARGO_AIRCRAFTS_RAW;
    let bestEntry = null;

    for (const ac of candidates) {
      // Éligibilité : doit pouvoir desservir toutes les routes du circuit
      if (
        circuitRoutes.some((r) => r.distance > ac.range || r.category < ac.cat)
      )
        continue;
      // Vérification temps total circuit (comme pax)
      if (i > 0 && ac.speed) {
        const STEP = 0.25;
        const totalFtCandidate = circuitRoutes.reduce((s, r) => {
          return (
            s +
            Math.ceil(((2 * r.distance) / ac.speed + TURNAROUND) / STEP) * STEP
          );
        }, 0);

        if (totalFtCandidate > 168) continue; // avion trop lent
      }
      const loaded = Math.min(ac.payload, remDemand);
      const grossRev = loaded * PRICE.CARGO * 2;
      const tax = circuitRoutes.reduce(
        (sum, route) => sum + ((route.tax || 0) * ac.cat) / 2,
        0
      );
      const fuelCost = ac.conso
        ? computeFuelCost(
            circuitRoutes[0].distance, // ou moyenne des routes
            ac.conso,
            loaded
          ) * 2
        : 0;

      const profit = grossRev - tax - fuelCost;
      // Avion 1 toujours inclus, suivants seulement si rentables
      if (i > 0 && profit <= 0) continue;
      if (!bestEntry || profit > bestEntry.profit)
        bestEntry = { ac, loaded, grossRev, tax, profit };
    }

    if (!bestEntry) break;
    const isSame =
      bestEntry.ac.brand === primaryAc.brand &&
      bestEntry.ac.model === primaryAc.model;
    planes.push({
      planeNum: i + 1,
      brand: bestEntry.ac.brand,
      model: bestEntry.ac.model,
      payload: bestEntry.ac.payload,
      isSameType: isSame,
      demandBefore: remDemand,
      loaded: bestEntry.loaded,
      remaining: (remDemand = Math.max(0, remDemand - bestEntry.loaded * 2)),
      grossRev: bestEntry.grossRev,
      tax: bestEntry.tax,
      profit: bestEntry.profit,
      isProfitable: bestEntry.profit > 0,
    });
  }
  return { planes, unsatisfied: remDemand };
}

export function cargoGrossRev(route, payload) {
  const cargoPrice = route.priceCargo || PRICE.CARGO;
  return Math.min(payload, route.dCargo || 0) * cargoPrice * 2;
}

export function enrichRoutesCargo(aircraft, routes, maxH) {
  return routes
    .filter(
      (r) =>
        r.distance <= aircraft.range &&
        r.category >= aircraft.cat &&
        (r.dCargo || 0) > 0
    )
    .map((r) => {
      const grossRev = cargoGrossRev(r, aircraft.payload);
      // Pour cargo : MASS_UNIT = payload de l'avion cargo (tonnes chargées)
      const cargoMASS_UNIT = Math.min(
        aircraft.payload || 10,
        r.dCargo || aircraft.payload || 10
      );
      const fuelCostC = aircraft.conso
        ? computeFuelCost(r.distance, aircraft.conso, cargoMASS_UNIT)
        : 0;
      const rev = grossRev - r.tax * aircraft.cat - fuelCostC;
      return {
        ...r,
        ft: flightTime(r.distance, aircraft.speed),
        grossRev,
        fuelCost: fuelCostC,
        rev,
        profit: rev,
        cargoFleet: buildCargoFleetCascade(
          {
            brand: aircraft.brand,
            model: aircraft.model,
            payload: aircraft.payload,
            range: aircraft.range,
            cat: aircraft.cat,
          },
          CARGO_AIRCRAFTS_RAW,
          [r]
        ),
      };
    })
    .filter((r) => r.ft > 0 && r.ft <= maxH);
}