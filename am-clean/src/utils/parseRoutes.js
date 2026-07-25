import { toNum } from "./numberUtils";
import { applyDemandBonus } from "../bonus/demandBonus";

function stripAccents(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function pick(r, ...keys) {
  // 1. Correspondance exacte
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== null && r[k] !== "") {
      return toNum(r[k]);
    }
  }

  // 2. Correspondance insensible aux accents + espaces
  const rKeys = Object.keys(r);
  const rNorms = rKeys.map((rk) => stripAccents(rk));

  for (const k of keys) {
    const norm = stripAccents(k);
    const idx = rNorms.findIndex((rn) => rn.startsWith(norm));

    if (idx >= 0 && r[rKeys[idx]] !== null && r[rKeys[idx]] !== "") {
      return toNum(r[rKeys[idx]]);
    }
  }

  return 0;
}

function pickStr(r, ...keys) {
  for (const k of keys) {
    if (r[k]) return r[k];
  }

  const rKeys = Object.keys(r);

  for (const k of keys) {
    const found = rKeys.find((rk) =>
      rk.toLowerCase().includes(k.toLowerCase())
    );

    if (found && r[found]) return r[found];
  }

  return null;
}

export function parseRoutes(raw, activeBonus) {
  return raw
    .map((r, i) => {
      const name = pickStr(r, "NOM ROUTES") || `Route ${i + 1}`;

      const distance = pick(r, "DISTANCE");
      const category = pick(r, "CATÉGORIE");

      const dEco = pick(r, "DEMANDE ÉCONOMIE");
      const dBus = pick(r, "DEMANDE AFFAIRES");
      const dFirst = pick(r, "DEMANDE PREMIÈRE");
      const dCargo = pick(r, "DEMANDE CARGO");

      const tax = pick(r, "TAXE PAR VOL", "TAXE", "taxe", "tax");

      if (distance <= 0 || category <= 0) return null;

      // Prix par route optionnels
      const priceEco = pick(r, "TARIFS ÉCONOMIE") || null;
      const priceBus = pick(r, "TARIFS AFFAIRES") || null;
      const priceFirst = pick(r, "TARIFS PREMIÈRE") || null;
      const priceCargo = pick(r, "TARIFS CARGO") || null;

      // Facteurs bonus stockés pour l'aperçu simulation
      const bonusFactorsOnly =
        activeBonus && (dEco > 0 || dBus > 0 || dFirst > 0)
          ? applyDemandBonus(dEco, dBus, dFirst, distance, activeBonus)
          : null;

      return {
        id: `r${i}`,
        name,
        distance,
        category,

        dEco,
        dBus,
        dFirst,

        dEcoBase: dEco,
        dBusBase: dBus,
        dFirstBase: dFirst,

        bonusFactors: bonusFactorsOnly ? bonusFactorsOnly.factors : null,

        dCargo,
        tax,

        priceEco,
        priceBus,
        priceFirst,
        priceCargo,
      };
    })
    .filter(Boolean);
}