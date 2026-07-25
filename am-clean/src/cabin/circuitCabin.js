import { cabinConfig } from "./cabinConfig";
import { avgTaxForRoutes, buildFleetCascade } from "./fleetBasic";
import { buildMultiFleetCascade } from "./fleetMulti";

function completePrimaryAircraft(primaryAc, allAircrafts) {
  if (!primaryAc || !allAircrafts?.length) return primaryAc;

  const fullAc = allAircrafts.find(
    (ac) => ac.brand === primaryAc.brand && ac.model === primaryAc.model
  );

  return fullAc ? { ...fullAc, ...primaryAc } : primaryAc;
}

export function circuitCabinConfig(
  primaryAcOrSeats,
  allAircraftsOrRoutes,
  routesOrUndef
) {
  // Surcharge :
  // ancienne signature : (seats, routes)
  // nouvelle signature : (primaryAc, allAircrafts, routes)
  let primaryAc;
  let allAircrafts;
  let routes;

  if (routesOrUndef !== undefined) {
    // Nouvelle signature : (primaryAc, allAircrafts, routes)
    primaryAc = primaryAcOrSeats;
    allAircrafts = allAircraftsOrRoutes;
    routes = routesOrUndef;
    primaryAc = completePrimaryAircraft(primaryAc, allAircrafts);
  } else {
    // Ancienne signature : (seats, routes)
    const seats = primaryAcOrSeats;
    routes = allAircraftsOrRoutes;
    primaryAc = {
      brand: "",
      model: "",
      seats,
      range: 99999,
      cat: 0,
    };
    allAircrafts = null;
  }

  const { planes, unsatisfied } = allAircrafts
    ? buildMultiFleetCascade(primaryAc, allAircrafts, routes)
    : buildFleetCascade(
        primaryAc.seats,
        routes
          .map((r) => r.dEco || 0)
          .filter((d) => d > 0)
          .reduce((mn, d) => Math.min(mn, d), Infinity) || 0,
        routes
          .map((r) => r.dBus || 0)
          .filter((d) => d > 0)
          .reduce((mn, d) => Math.min(mn, d), Infinity) || 0,
        routes
          .map((r) => r.dFirst || 0)
          .filter((d) => d > 0)
          .reduce((mn, d) => Math.min(mn, d), Infinity) || 0,
        avgTaxForRoutes(routes)
      );

  const first = planes[0] || cabinConfig(primaryAc.seats, 0, 0, 0);

  const demandsEco = routes.map((r) => r.dEco || 0).filter((d) => d > 0);
  const demandsBus = routes.map((r) => r.dBus || 0).filter((d) => d > 0);
  const demandsFirst = routes.map((r) => r.dFirst || 0).filter((d) => d > 0);

  const minEco = demandsEco.length > 0 ? Math.min(...demandsEco) : 0;
  const minBus = demandsBus.length > 0 ? Math.min(...demandsBus) : 0;
  const minFirst = demandsFirst.length > 0 ? Math.min(...demandsFirst) : 0;

  return {
    sE: first.sE,
    sB: first.sB,
    sF: first.sF,
    rev: first.rev,
    label: first.label,

    demandEco: minEco,
    demandBus: minBus,
    demandFirst: minFirst,

    capPerAc: {
      eco: first.capEco || first.sE * 2,
      bus: first.capBus || first.sB * 2,
      first: first.capFirst || first.sF * 2,
    },

    nbAvions: planes.length,
    fleet: planes,
    unsatisfied,

    // Résumé cargo ventre sur l'ensemble de la flotte
    bellyCargoTotal: planes.reduce((s, p) => s + (p.cargoLoaded || 0), 0),
    bellyRevTotal: planes.reduce((s, p) => s + (p.cargoRev || 0), 0),
  };
}
