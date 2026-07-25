export const PAX_OVER_TOLERANCE = 10;

// Score bas = meilleur
export function paxFitPenalty(demand, cap, weight = 1) {
  const delta = demand - cap;

  // Parfait ou acceptable :
  // delta = 0 parfait
  // delta entre -1 et -50 acceptable
  const isFirst = weight >= 4;

if (isFirst) {
  const error = Math.abs(delta);

  // zone idéale
  if (error <= 2) return error;

  // zone acceptable (évite de casser la flotte)
  if (error <= 8) return error * 3;

  // seulement pénalité forte au-delà
  return error * 6;
}

  // Demande restante non servie
  if (delta > 0) {
    return delta * weight * 2;
  }

  // Trop de surcapacité au-delà de -50
  return (Math.abs(delta) - PAX_OVER_TOLERANCE) * weight * 20;
}

export function paxFitScore(dEco, dBus, dFirst, capEco, capBus, capFirst) {
  return (
    paxFitPenalty(dEco, capEco, 1) +
    paxFitPenalty(dBus, capBus, 2) +
    paxFitPenalty(dFirst, capFirst, 4)
  );
}

export function getPaxDeltas(dEco, dBus, dFirst, capEco, capBus, capFirst) {
  return {
    deltaEco: dEco - capEco,
    deltaBus: dBus - capBus,
    deltaFirst: dFirst - capFirst,
  };
}