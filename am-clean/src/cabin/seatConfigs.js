const configCache = new Map();

export function getSeatConfigs(seats) {
  if (!configCache.has(seats)) {
    configCache.set(seats, generateSeatConfigs(seats));
  }
  return configCache.get(seats);
}

export function clearSeatConfigCache() {
  configCache.clear();
}

export function generateSeatConfigs(seats) {
  const configs = [];

  // Pas adaptatif : granularité plus grossière sur les grands avions
  // pour garder un nombre de configs raisonnable.
  // Petits (<150) : pas 2/4 — Moyens (150-299) : 4/8 — Grands (≥300) : 6/12
  const stepF = seats < 150 ? 2 : seats < 300 ? 4 : 6;
  const stepB = seats < 150 ? 4 : seats < 300 ? 8 : 12;

  for (let sF = 0; sF <= seats * 0.2; sF += stepF) {
    for (let sB = 0; sB <= seats * 0.4; sB += stepB) {
      const used = sF * 4.2 + sB * 1.8;
      if (used > seats) break;

      const sE = Math.floor(seats - used);
      configs.push({
        sE,
        sB,
        sF,
        label: `${sE}é/${sB}b/${sF}f`,
      });
    }
  }

  return configs;
}