export const CURRENT_BONUS = {
  distraction: 821,
  price: 669,
  ponctualite: 780,
  securite: 537,
  confort: 570,
  revenue: 1000,
  frais: -485,
};

export const TARGET_BONUS = {
  distraction: 100,
  price: 100,
  ponctualite: 100,
  securite: 100,
  confort: 100,
  revenue: 0,
  frais: 0,
};

const DIST_SEG = { SHORT: 3700, LONG: 7550 };
const CONFORT_FLAT = 0.1;

const BONUS_COEFS = {
  confort: [0.02, 0.025, 0.03],
  distraction: [0.0, 0.05, 0.1],
  price: [0.1, 0.05, 0.0],
  ponctualite: [0.03, 0.03, 0.03],
  securite: [0.03, 0.03, 0.03],
};

const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));

export function getBonusCoef(key, distanceKm) {
  const [cShort, cMed, cLong] = BONUS_COEFS[key];
  const d = distanceKm;
  let pct;

  if (d <= DIST_SEG.SHORT) {
    pct = cShort;
  } else if (d <= DIST_SEG.LONG) {
    const midDist = (DIST_SEG.SHORT + DIST_SEG.LONG) / 2;
    if (d <= midDist) {
      const t = (d - DIST_SEG.SHORT) / (midDist - DIST_SEG.SHORT);
      pct = lerp(cShort, cMed, t);
    } else {
      const t = (d - midDist) / (DIST_SEG.LONG - midDist);
      pct = lerp(cMed, cLong, t);
    }
  } else {
    pct = cLong;
  }

  return pct / 100;
}

export function applyDemandBonus(dEcoBase, dBusBase, dFirstBase, distance, bonus = CURRENT_BONUS) {
  const cDistraction = getBonusCoef("distraction", distance);
  const cPrice = getBonusCoef("price", distance);
  const cPonct = getBonusCoef("ponctualite", distance);
  const cSecurite = getBonusCoef("securite", distance);

  const fConfortPax = 1 + bonus.confort * (CONFORT_FLAT / 100);
  const fDistraction = 1 + bonus.distraction * cDistraction;
  const fPrice = 1 + bonus.price * cPrice;
  const fPonct = 1 + bonus.ponctualite * cPonct;
  const fSecurite = 1 + bonus.securite * cSecurite;

  const factorEco = fConfortPax * fDistraction * fPrice * fPonct;
  const factorBus = fConfortPax * fDistraction * fPrice * fPonct * fSecurite;
  const factorFirst = fConfortPax * fDistraction * fPrice * fSecurite;

  return {
    dEco: Math.round(dEcoBase * factorEco),
    dBus: Math.round(dBusBase * factorBus),
    dFirst: Math.round(dFirstBase * factorFirst),
    factors: { eco: factorEco, bus: factorBus, first: factorFirst },
    appliedBonus: bonus,
  };
}

export function projectRoutesForSimulation(routes, currentBonus, targetBonus) {
  return routes.map((r) => {
    if ((r.dEco || 0) + (r.dBus || 0) + (r.dFirst || 0) === 0) return r;

    const cur = applyDemandBonus(r.dEco, r.dBus, r.dFirst, r.distance, currentBonus);
    const tgt = applyDemandBonus(r.dEco, r.dBus, r.dFirst, r.distance, targetBonus);

    const scaleEco = cur.factors.eco > 0 ? tgt.factors.eco / cur.factors.eco : 1;
    const scaleBus = cur.factors.bus > 0 ? tgt.factors.bus / cur.factors.bus : 1;
    const scaleFirst = cur.factors.first > 0 ? tgt.factors.first / cur.factors.first : 1;

    return {
      ...r,
      dEco: Math.round((r.dEco || 0) * scaleEco),
      dBus: Math.round((r.dBus || 0) * scaleBus),
      dFirst: Math.round((r.dFirst || 0) * scaleFirst),
      dEcoBase: r.dEcoBase,
      dBusBase: r.dBusBase,
      dFirstBase: r.dFirstBase,
    };
  });
}