import { AIRCRAFTS_RAW } from "../data/aircrafts";
import { circuitCabinConfig } from "../cabin/circuitCabin";
import { applyBellyToCircuit } from "../cargo/bellyCargo";
import { applyCargoSubstitution } from "../cargo/cargoSubstitution";

export function rebuildPax168Circuit(circuit, routes, targetH = 168) {
  const totalTime = routes.reduce((s, r) => s + (r.ft || 0), 0);
  const totalProfit = routes.reduce((s, r) => s + (r.profit || 0), 0);
  const totalRev = routes.reduce(
    (s, r) => s + Math.max(0, r.grossPaxRev || 0),
    0
  );

  const aircraft = circuit.aircraft || {};
  const pAc = {
    brand: aircraft.brand || "",
    model: aircraft.model || "",
    seats: aircraft.seats || 0,
    range: aircraft.range || 99999,
    cat: aircraft.cat || 0,
  };

  const rebuilt = {
    ...circuit,
    routes: routes.map((r) => ({ ...r, rotations: r.rotations || 1 })),
    routeIds: routes.map((r) => r.id),
    totalTime,
    totalProfit,
    totalRev,
    cabin: circuitCabinConfig(pAc, AIRCRAFTS_RAW, routes),
    profitPerHour: totalTime > 0 ? totalProfit / totalTime : 0,
    routeCount: routes.length,
    fillRate: ((totalTime / targetH) * 100).toFixed(1),
  };

  return applyCargoSubstitution(applyBellyToCircuit(rebuilt));
}