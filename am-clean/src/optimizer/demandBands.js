export function makeDemandBands(bandSize) {
  const sz = Math.max(50, Math.round(bandSize || 1000));
  const bands = [];

  // Commencer à 0 pour couvrir toutes les demandes
  for (let start = 0; start < 20000; start += sz) {
    const end = start + sz;

    bands.push({
      label: `${start.toLocaleString()}-${(end - 1).toLocaleString()}`,
      min: start,
      max: end,
    });
  }

  bands.push({
    label: "20 000+",
    min: 20000,
    max: Infinity,
  });

  return bands;
}
