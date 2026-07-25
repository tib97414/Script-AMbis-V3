export function applyBellyToCircuit(circuit) {
  if (!circuit?.cabin?.bellyRevTotal || circuit.cabin.bellyRevTotal <= 0) {
    return circuit;
  }

  const bellyRev = circuit.cabin.bellyRevTotal * (circuit.routes?.[0]?.rotations || 1);

  return {
    ...circuit,
    totalProfit: circuit.totalProfit + bellyRev,
    bellyCargoRev: bellyRev,
    profitPerHour:
      circuit.totalTime > 0
        ? (circuit.totalProfit + bellyRev) / circuit.totalTime
        : 0,
  };
}