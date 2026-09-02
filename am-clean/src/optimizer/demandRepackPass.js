import { repackSimilarDemandCircuits168 } from "./circuitScoring";
import { rebuildPax168Circuit } from "./rebuildPaxCircuit";
import {
  refreshPaxSummary,
  totalProfitOfCircuits,
} from "../utils/paxResultUtils";

export function applyDemandRepackToPaxResult(result) {
  if (!Array.isArray(result?.byAircraft)) return result;

  const repackedByAircraft = result.byAircraft.map((item) => {
    const circuits168 = repackSimilarDemandCircuits168(item.circuits168 || [], {
      maxPasses: 2,
      maxRouteDistance: 260,
      targetH: 168,
      minFillRatio: 0.95,
      rebuildCircuit: rebuildPax168Circuit,
    });

    return {
      ...item,
      circuits168,
      best168: circuits168[0] || null,
      totalProfit168: totalProfitOfCircuits(circuits168),
    };
  });

  return refreshPaxSummary(result, repackedByAircraft, {
    demandRepack: true,
  });
}
