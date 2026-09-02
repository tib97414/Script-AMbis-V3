import { useCallback } from "react";
import { AIRCRAFTS_RAW } from "../data/aircrafts";
import { CARGO_AIRCRAFTS_RAW } from "../data/cargoAircrafts";
import { applyDemandRepackToPaxResult } from "../optimizer/demandRepackPass";
import {
  DEFAULT_RESIDUAL_ECO_THRESHOLD,
  applyResidualSecondPassToPaxResult,
} from "../optimizer/residualPasses";
import { applyTargetCoveragePassToPaxResult } from "../optimizer/targetCoveragePass";

export function useGlobalOptimization({
  routes,
  runPaxCircuitOptimizer,
  runGlobalOptCargo,

  useDemandRepack = false,
  useResidualSecondPass = false,
  residualThreshold = DEFAULT_RESIDUAL_ECO_THRESHOLD,

  setGRes,
  setCargoRes,
  setRunningG,
  setCalcError,
}) {
  const handleGlobal = useCallback(async () => {
    setRunningG(true);
    setGRes(null);
    setCargoRes(null);
    setCalcError(null);

    await new Promise((r) => setTimeout(r, 30));

    try {
      const rawPaxOpt = runPaxCircuitOptimizer(AIRCRAFTS_RAW, routes, 1000, {
        useTrue84: false,
        useAuxRevenue: false,
        timeoutMs: 120_000,
        anchorCount: 3,
      });

      const repackedPaxOpt = useDemandRepack
        ? applyDemandRepackToPaxResult(rawPaxOpt)
        : rawPaxOpt;

      const residualPaxOpt = useResidualSecondPass
        ? applyResidualSecondPassToPaxResult({
            result: repackedPaxOpt,
            residualSourceResult: repackedPaxOpt,
            effectiveFilteredAc: AIRCRAFTS_RAW,
            bandSize: repackedPaxOpt.selectedBandSize || 1000,
            thresholdEco: residualThreshold,
            runPaxCircuitOptimizer,
            useAuxRevenue: false,
            useFleetChoiceAtCreation: false,
          })
        : repackedPaxOpt;

      const finalPaxOpt = useResidualSecondPass
        ? applyTargetCoveragePassToPaxResult({
            result: residualPaxOpt,
            effectiveFilteredAc: AIRCRAFTS_RAW,
            bandSize: residualPaxOpt.selectedBandSize || 1000,
            runPaxCircuitOptimizer,
            useAuxRevenue: false,
            useFleetChoiceAtCreation: false,
          })
        : residualPaxOpt;

      const cargoOpt = runGlobalOptCargo(CARGO_AIRCRAFTS_RAW, routes);

      setGRes(finalPaxOpt);
      setCargoRes(cargoOpt);
    } catch (err) {
      setCalcError(`Erreur optimisation globale : ${err.message}`);
    }

    setRunningG(false);
  }, [
    routes,
    runPaxCircuitOptimizer,
    runGlobalOptCargo,
    useDemandRepack,
    useResidualSecondPass,
    residualThreshold,
    setGRes,
    setCargoRes,
    setRunningG,
    setCalcError,
  ]);

  return { handleGlobal };
}