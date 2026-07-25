import { PRICE, MASS_UNIT } from "../data/constants";
import { allocateDemand } from "../core/allocateDemand";

function formatPaxCargoLabel(sE, sB, sF, cargoTons = 0) {
  const cargo = Math.floor(cargoTons || 0);
  return cargo > 0 ? `${sE}é/${sB}b/${sF}f/${cargo}t` : `${sE}é/${sB}b/${sF}f`;
}

function clampPaxToCapacity(plane, capEco, capBus, capFirst) {
  const oldPaxEco = plane.paxEco || 0;
  const oldPaxBus = plane.paxBus || 0;
  const oldPaxFirst = plane.paxFirst || 0;

  const paxEco = allocateDemand(oldPaxEco, capEco || 0);
  const paxBus = allocateDemand(oldPaxBus, capBus || 0);
  const paxFirst = allocateDemand(oldPaxFirst, capFirst || 0);

  const lostPaxRevenue =
    Math.max(0, oldPaxEco - paxEco) * PRICE.ECO +
    Math.max(0, oldPaxBus - paxBus) * PRICE.BUS +
    Math.max(0, oldPaxFirst - paxFirst) * PRICE.FIRST;

  return {
    paxEco,
    paxBus,
    paxFirst,
    lostPaxRevenue,
  };
}

export function applyCargoSubstitution(circuit) {
  const THRESHOLD = 10;

  const cabin = circuit?.cabin;
  const routes = circuit?.routes;

  if (!cabin || !routes?.length) return circuit;

  const fleet = cabin.fleet || [];
  const pCargo = routes[0]?.priceCargo || PRICE.CARGO;

  // Capacité totale déployée pax A/R
  const totalCapFirst = fleet.length
    ? fleet.reduce((s, p) => s + (p.capFirst || 0), 0)
    : (cabin.sF || 0) * 2;

  const totalCapBus = fleet.length
    ? fleet.reduce((s, p) => s + (p.capBus || 0), 0)
    : (cabin.sB || 0) * 2;

  const totalCapEco = fleet.length
    ? fleet.reduce((s, p) => s + (p.capEco || 0), 0)
    : (cabin.sE || 0) * 2;

  if (totalCapFirst + totalCapBus + totalCapEco === 0) {
    return circuit;
  }

  // Demande moyenne pondérée par les rotations
  const demandsEco = routes.map((r) => r.dEco || 0).filter((d) => d > 0);
  const demandsBus = routes.map((r) => r.dBus || 0).filter((d) => d > 0);
  const demandsFirst = routes.map((r) => r.dFirst || 0).filter((d) => d > 0);

  const minDEco = demandsEco.length > 0 ? Math.min(...demandsEco) : 0;
  const minDBus = demandsBus.length > 0 ? Math.min(...demandsBus) : 0;
  const minDFirst = demandsFirst.length > 0 ? Math.min(...demandsFirst) : 0;

  const deltaFirst = minDFirst - totalCapFirst;
  const deltaBus = minDBus - totalCapBus;
  const deltaEco = minDEco - totalCapEco;

  // Sièges à retirer par classe : 1 siège = 2 pax A/R
  let remFirst = 0;
  let remBus = 0;
  let remEco = 0;

  if (deltaFirst < -THRESHOLD) {
    remFirst = Math.max(1, Math.floor((Math.abs(deltaFirst) - THRESHOLD) / 2));
  }

  if (deltaBus < -THRESHOLD) {
    remBus = Math.max(1, Math.floor((Math.abs(deltaBus) - THRESHOLD) / 2));
  }

  if (deltaEco < -THRESHOLD) {
    remEco = Math.max(1, Math.floor((Math.abs(deltaEco) - THRESHOLD) / 2));
  }

  if (remFirst + remBus + remEco === 0) {
    return circuit;
  }

  const rotations = routes[0]?.rotations || 1;
  let totalCargoAdded = 0;
  let totalLostPaxRevenue = 0;

  let toRemoveFirst = remFirst;
  let toRemoveBus = remBus;
  let toRemoveEco = remEco;

  const newFleet = fleet.length
    ? fleet.map((plane) => {
        const removedF = Math.min(toRemoveFirst, plane.sF || 0);
        const removedB = Math.min(toRemoveBus, plane.sB || 0);
        const removedE = Math.min(toRemoveEco, plane.sE || 0);

        if (removedF + removedB + removedE === 0) return plane;

        toRemoveFirst -= removedF;
        toRemoveBus -= removedB;
        toRemoveEco -= removedE;

        const payload = plane.payload || 0;
        const payloadLimit = Math.floor(payload);

        const newSF = (plane.sF || 0) - removedF;
        const newSB = (plane.sB || 0) - removedB;
        const newSE = (plane.sE || 0) - removedE;

        const newCapFirst = newSF * 2;
        const newCapBus = newSB * 2;
        const newCapEco = newSE * 2;

        const clamped = clampPaxToCapacity(
          plane,
          newCapEco,
          newCapBus,
          newCapFirst
        );

        totalLostPaxRevenue += clamped.lostPaxRevenue;

const massBefore =
  (plane.sE || 0) * MASS_UNIT.ECO +
  (plane.sB || 0) * MASS_UNIT.BUS +
  (plane.sF || 0) * MASS_UNIT.FIRST;

        const massAfter =
  newSE * MASS_UNIT.ECO +
  newSB * MASS_UNIT.BUS +
  newSF * MASS_UNIT.FIRST;

        const freeBefore = Math.max(0, payload - massBefore);
        const freeAfter = Math.max(0, payload - massAfter);

        const cargoSubst = Math.max(
          0,
          Math.floor(freeAfter) - Math.floor(freeBefore)
        );

        const bellyCargo = Math.floor(plane.cargoLoaded || 0);
        const totalCargo = Math.min(
          payloadLimit,
          bellyCargo + cargoSubst
        );
        const adjustedCargoSubst = Math.max(0, totalCargo - bellyCargo);
        const cargoSubstRev = adjustedCargoSubst * pCargo * 2 * rotations;

        totalCargoAdded += adjustedCargoSubst;

        return {
          ...plane,

          sF: newSF,
          sB: newSB,
          sE: newSE,

          capFirst: newCapFirst,
          capBus: newCapBus,
          capEco: newCapEco,

          paxFirst: clamped.paxFirst,
          paxBus: clamped.paxBus,
          paxEco: clamped.paxEco,
          lostPaxRevenueFromCargoSubst: clamped.lostPaxRevenue,

          label: formatPaxCargoLabel(newSE, newSB, newSF, totalCargo),

          freePayload: freeAfter,

          cargoLoaded: totalCargo,
          cargoRev: (plane.cargoRev || 0) + cargoSubstRev,
          cargoSubstTons: adjustedCargoSubst,
          cargoSubstRev,
          cargoSubstRemovedF: removedF,
          cargoSubstRemovedB: removedB,
          cargoSubstRemovedE: removedE,

          rev: (plane.rev || 0) - clamped.lostPaxRevenue + cargoSubstRev,
          profit: (plane.profit || 0) - clamped.lostPaxRevenue + cargoSubstRev,

          origSF: plane.sF || 0,
          origSB: plane.sB || 0,
          origSE: plane.sE || 0,
          origLabel:
            plane.origLabel ||
            formatPaxCargoLabel(
              plane.sE || 0,
              plane.sB || 0,
              plane.sF || 0,
              bellyCargo
            ),
        };
      })
    : fleet;

  const totalBellyCargo = newFleet.reduce((s, p) => s + (p.cargoLoaded || 0), 0);
  const totalBellyRev = newFleet.reduce((s, p) => s + (p.cargoRev || 0), 0);

  const newCabin = fleet.length
    ? {
        ...cabin,
        fleet: newFleet,
        bellyCargoTotal: totalBellyCargo,
        bellyRevTotal: totalBellyRev,
      }
    : {
        ...cabin,
        sF: Math.max(0, (cabin.sF || 0) - remFirst),
        sB: Math.max(0, (cabin.sB || 0) - remBus),
        sE: Math.max(0, (cabin.sE || 0) - remEco),
        label: formatPaxCargoLabel(
          Math.max(0, (cabin.sE || 0) - remEco),
          Math.max(0, (cabin.sB || 0) - remBus),
          Math.max(0, (cabin.sF || 0) - remFirst),
          cabin.bellyCargoTotal || 0
        ),
      };

  const cargoRevPerCircuit = totalCargoAdded * pCargo * 2 * rotations;
  const netDelta = cargoRevPerCircuit - totalLostPaxRevenue;

  return {
    ...circuit,

    totalProfit: circuit.totalProfit + netDelta,

    profitPerHour:
      circuit.totalTime > 0
        ? (circuit.totalProfit + netDelta) / circuit.totalTime
        : 0,

    cargoInPaxRev: cargoRevPerCircuit,
    cargoSubstitutionLostPaxRev: totalLostPaxRevenue,
    cargoSubstitutionNetDelta: netDelta,

    cargoSubstitution: {
      seatsFirst: remFirst,
      seatsBus: remBus,
      seatsEco: remEco,
      totalCargoTons: totalCargoAdded,
      cargoRevPerCircuit,
      lostPaxRevenue: totalLostPaxRevenue,
      netDelta,
      deltaFirst: Math.round(deltaFirst),
      deltaBus: Math.round(deltaBus),
      deltaEco: Math.round(deltaEco),
    },

    cabin: newCabin,
  };
}
