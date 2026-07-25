import auxCoefficients from "./auxCoefficients.json";

const AUX_KEY_ALIASES = {
  "LLYUSHIN II-114": "ILYUSHIN IL-114",
  "LLYUSHIN II-96-300": "ILYUSHIN IL-96-300",
  "LLYUSHIN II-96M": "ILYUSHIN IL-96M",
  "BAE SYSTEMS JETSTREAM 41": "BAE SYSTEMS JETSTREAM41",
};

export const AUX_COEFS = auxCoefficients;

export function getAuxFactor(distance, speed) {
  return 2 * (8 + Math.ceil(distance / (speed / 8)));
}

export function getAircraftAuxKey(aircraft) {
  const raw = `${aircraft?.brand || ""} ${aircraft?.model || ""}`
    .trim()
    .toUpperCase();

  return AUX_KEY_ALIASES[raw] || raw;
}

export function hasAuxRevenueData(aircraft) {
  return Boolean(AUX_COEFS[getAircraftAuxKey(aircraft)]);
}

export function pickAuxCalibration(aircraftData, distance) {
  const calibrations = aircraftData.calibrations || [];

  const exact = calibrations.find(
    (calibration) =>
      distance >= calibration.minKm && distance <= calibration.maxKm
  );

  return exact || null;
}

export function getAuxCoef(aircraftData, calibration, key, distance) {
  if (calibration[key] !== null && calibration[key] !== undefined) {
    return calibration[key];
  }

  const candidates = (aircraftData.calibrations || [])
    .filter((c) => c[key] !== null && c[key] !== undefined)
    .sort((a, b) => {
      const ca = (a.minKm + a.maxKm) / 2;
      const cb = (b.minKm + b.maxKm) / 2;

      return Math.abs(ca - distance) - Math.abs(cb - distance);
    });

  return candidates[0]?.[key] || 0;
}

export function estimateAuxRevenue({
  aircraft,
  route,
  ecoSeats = 0,
  busSeats = 0,
  firstSeats = 0,
  cargoTons = 0,
}) {
  const aircraftKey = getAircraftAuxKey(aircraft);
  const aircraftData = AUX_COEFS[aircraftKey];

  if (!aircraftData) return 0;

  const distance = route.distance || route.distanceKm || 0;
  const speed = aircraft.speed || aircraftData.speed;

  if (!distance || !speed) return 0;

  const calibration = pickAuxCalibration(aircraftData, distance);
  if (!calibration) return 0;

  const factor = getAuxFactor(distance, speed);

  // Valeurs aller-retour affichées par le jeu
  const ecoPax = ecoSeats * 2;
  const busPax = busSeats * 2;
  const firstPax = firstSeats * 2;
  const cargoDisplayed = cargoTons * 2;

  const baseX = getAuxCoef(aircraftData, calibration, "baseX", distance);
  const ecoX = getAuxCoef(aircraftData, calibration, "ecoX", distance);
  const busX = getAuxCoef(aircraftData, calibration, "busX", distance);
  const firstX = getAuxCoef(aircraftData, calibration, "firstX", distance);

  const cargoFixedX = getAuxCoef(
    aircraftData,
    calibration,
    "cargoFixedX",
    distance
  );

  const cargoPerTonX = getAuxCoef(
    aircraftData,
    calibration,
    "cargoPerTonX",
    distance
  );

  const paxX = ecoPax * ecoX + busPax * busX + firstPax * firstX;

  const cargoX =
    cargoDisplayed > 0 ? cargoFixedX + cargoDisplayed * cargoPerTonX : 0;

  const totalX = baseX + paxX + cargoX;

  return Math.round(factor * totalX);
}

export function getAuxRevenueCoverageInfo({ aircraft, route }) {
  const aircraftKey = getAircraftAuxKey(aircraft);
  const aircraftData = AUX_COEFS[aircraftKey];

  if (!aircraftData) {
    return {
      status: "missing_aircraft",
      aircraftKey,
      calibrationName: null,
    };
  }

  const distance = route.distance || route.distanceKm || 0;

  if (!distance) {
    return {
      status: "missing_distance",
      aircraftKey,
      calibrationName: null,
    };
  }

  const calibration = pickAuxCalibration(aircraftData, distance);

  if (!calibration) {
    return {
      status: "missing_distance_calibration",
      aircraftKey,
      calibrationName: null,
    };
  }

  return {
    status: "exact",
    aircraftKey,
    calibrationName: calibration.name,
  };
}