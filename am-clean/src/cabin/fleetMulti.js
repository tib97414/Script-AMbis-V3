import { PRICE, MASS_UNIT, TURNAROUND } from "../data/constants";
import { AIRCRAFTS_RAW } from "../data/aircrafts";
import { cabinConfig } from "./cabinConfig";
import { avgTaxForRoutes } from "./fleetBasic";
import { paxFitScore, getPaxDeltas } from "./paxFitScore";
import { allocateDemand } from "../core/allocateDemand";

function formatPaxCargoLabel(sE, sB, sF, cargoTons = 0) {
  const cargo = Math.floor(cargoTons || 0);
  return cargo > 0 ? `${sE}é/${sB}b/${sF}f/${cargo}t` : `${sE}é/${sB}b/${sF}f`;
}

// Demande résiduelle totale pondérée en pax A/R
function totalResidualPax(remEco, remBus, remFirst) {
  return remEco + remBus + remFirst;
}

// Pénalité de sur-dimensionnement : nb de sièges au-delà de la demande résiduelle
function seatOvershootPenalty(seats, remEco, remBus, remFirst) {
  const neededSeats = Math.ceil((remEco + remBus + remFirst) / 2);
  return Math.max(0, seats - neededSeats);
}

function maxSeatsForResidualDemand(remEco, remBus, remFirst) {
  const residualPax = totalResidualPax(remEco, remBus, remFirst);
  return Math.max(50, residualPax * 3);
}

function planePaxMass(plane) {
  return (
    (plane.sE || 0) * MASS_UNIT.ECO +
    (plane.sB || 0) * MASS_UNIT.BUS +
    (plane.sF || 0) * MASS_UNIT.FIRST
  );
}

export function buildMultiFleetCascade(primaryAc, allAircrafts, circuitRoutes) {
  const minPositiveDemand = (values) => {
    const positives = values.filter((value) => value > 0);
    return positives.length ? Math.min(...positives) : 0;
  };

  const demandsEco = circuitRoutes.map((r) => r.dEco || 0);
  const demandsBus = circuitRoutes.map((r) => r.dBus || 0);
  const demandsFirst = circuitRoutes.map((r) => r.dFirst || 0);

  let remEco = minPositiveDemand(demandsEco);
  let remBus = minPositiveDemand(demandsBus);
  let remFirst = minPositiveDemand(demandsFirst);

  const planes = [];
  const allAc = allAircrafts || AIRCRAFTS_RAW;

  for (let i = 0; i < 100; i++) {
    if (remEco <= 0 && remBus <= 0 && remFirst <= 0) break;

    const candidates = i === 0 ? [primaryAc] : allAc;
    const maxAllowedSeats = maxSeatsForResidualDemand(remEco, remBus, remFirst);

    let bestEntry = null;

    for (const ac of candidates) {
      if (ac.seats > maxAllowedSeats) continue;

      // Éligibilité distance/catégorie
      if (circuitRoutes.some((r) => r.distance > ac.range || r.category < ac.cat)) {
        continue;
      }

      // Vitesse différente → recalcul ft total
      if (i > 0 && ac.speed) {
        const STEP = 0.25;
        const totalFtCandidate = circuitRoutes.reduce((s, r) => {
          return (
            s +
            Math.ceil(((2 * r.distance) / ac.speed + TURNAROUND) / STEP) * STEP
          );
        }, 0);
        if (totalFtCandidate > 168) continue;
      }

      // seatTolerance = 0 pour avions suivants (évite sur-configuration)
      const cfg = cabinConfig(ac.seats, remEco, remBus, remFirst, null, {
        seatTolerance: i === 0 ? 1 : 0,
      });

      // Cap dur : jamais plus de ceil(demande / 2) sièges par classe pour i > 0
      let sE = cfg.sE;
      let sB = cfg.sB;
      let sF = cfg.sF;

      if (i > 0) {
        const maxE = remEco > 0 ? Math.ceil(remEco / 2) : 0;
        const maxB = remBus > 0 ? Math.ceil(remBus / 2) : 0;
        const maxF = remFirst > 0 ? Math.ceil(remFirst / 2) : 0;
        sE = Math.min(sE, maxE);
        sB = Math.min(sB, maxB);
        sF = Math.min(sF, maxF);
      }

      const capEco = sE * 2;
      const capBus = sB * 2;
      const capFirst = sF * 2;

      const paxEco = allocateDemand(capEco, remEco);
      const paxBus = allocateDemand(capBus, remBus);
      const paxFirst = allocateDemand(capFirst, remFirst);

      // Revenu PAX pur — sans cargo ventre dans le critère de sélection.
      // Le cargo ventre est calculé après et ne doit pas influencer le choix
      // du type d'avion (sinon un A380 gagne sur sa soute).
      const paxRevOnly =
        paxEco * PRICE.ECO +
        paxBus * PRICE.BUS +
        paxFirst * PRICE.FIRST;

      const tax = circuitRoutes.reduce(
        (sum, route) => sum + ((route.tax || 0) * ac.cat) / 2,
        0
      );

      const profit = paxRevOnly - tax;

      if (i > 0 && profit <= 0) continue;

      const fitScore = paxFitScore(remEco, remBus, remFirst, capEco, capBus, capFirst);
      const overshoot = i > 0 ? seatOvershootPenalty(ac.seats, remEco, remBus, remFirst) : 0;

      const entry = {
        ac, sE, sB, sF,
        label: formatPaxCargoLabel(sE, sB, sF),
        capEco, capBus, capFirst,
        paxEco, paxBus, paxFirst,
        rev: paxRevOnly, tax, profit,
        fitScore, paxRevOnly, overshoot,
      };

      if (!bestEntry) {
        bestEntry = entry;
        continue;
      }

      // Critères de sélection pour i > 0 :
      // 1. Meilleur revenu PAX pur
      // 2. À revenu égal → meilleur fitScore
      // 3. À fitScore égal → avion le plus petit (overshoot minimal)
      if (i > 0) {
        const better =
          paxRevOnly > bestEntry.paxRevOnly + 0.01 ||
          (Math.abs(paxRevOnly - bestEntry.paxRevOnly) <= 0.01 &&
            fitScore < bestEntry.fitScore - 0.01) ||
          (Math.abs(paxRevOnly - bestEntry.paxRevOnly) <= 0.01 &&
            Math.abs(fitScore - bestEntry.fitScore) <= 0.01 &&
            overshoot < bestEntry.overshoot);

        if (better) bestEntry = entry;
      } else {
        // Avion principal (i === 0) : comportement original
        if (
          fitScore < bestEntry.fitScore ||
          (fitScore === bestEntry.fitScore && profit > bestEntry.profit)
        ) {
          bestEntry = entry;
        }
      }
    }

    if (!bestEntry) break;

    const {
      ac, sE, sB, sF, label,
      capEco, capBus, capFirst,
      paxEco, paxBus, paxFirst,
      rev, tax, profit, fitScore,
    } = bestEntry;

    const isSame = ac.brand === primaryAc.brand && ac.model === primaryAc.model;
    const deltas = getPaxDeltas(remEco, remBus, remFirst, capEco, capBus, capFirst);

    planes.push({
      planeNum: i + 1,
      brand: ac.brand,
      model: ac.model,
      isSameType: isSame,
      label,
      sE, sB, sF,
      capEco, capBus, capFirst,
      paxEco, paxBus, paxFirst,
      demandEco: remEco,
      demandBus: remBus,
      demandFirst: remFirst,
      deltaEco: deltas.deltaEco,
      deltaBus: deltas.deltaBus,
      deltaFirst: deltas.deltaFirst,
      fitScore,
      rev, tax, profit,
      isProfitable: profit > 0,
      payload: ac.payload || 0,
    });

    remEco = Math.max(0, remEco - paxEco);
    remBus = Math.max(0, remBus - paxBus);
    remFirst = Math.max(0, remFirst - paxFirst);
  }

  // Cargo ventre — calculé après sélection des avions, ne doit pas influencer
  // le choix du type d'avion.
  const dCargoMin = (() => {
    const vals = circuitRoutes.map((r) => r.dCargo || 0).filter((d) => d > 0);
    return vals.length > 0 ? Math.floor(Math.min(...vals)) : 0;
  })();

  const pCargo = circuitRoutes[0]?.priceCargo || PRICE.CARGO;
  let remCargo = dCargoMin;

  if (remCargo > 0) {
    for (const plane of planes) {
      if (remCargo <= 0) break;

      const massPax = planePaxMass(plane);
      const payloadLimit = Math.floor(plane.payload || 0);
      const freePayload = Math.max(0, payloadLimit - massPax);
      const cargoLoaded = Math.min(Math.floor(freePayload), remCargo, payloadLimit);

      plane.freePayload = freePayload;
      plane.dCargoMin = dCargoMin;

      if (cargoLoaded <= 0) continue;

      const cargoRev = cargoLoaded * pCargo * 2;
      plane.cargoLoaded = cargoLoaded;
      plane.cargoRev = cargoRev;
      plane.cargoRemainingAfterLoad = remCargo - cargoLoaded;
      plane.label = formatPaxCargoLabel(plane.sE, plane.sB, plane.sF, cargoLoaded);

      remCargo -= cargoLoaded;
    }
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