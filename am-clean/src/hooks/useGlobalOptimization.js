import { useCallback } from "react";
import { AIRCRAFTS_RAW } from "../data/aircrafts";
import { CARGO_AIRCRAFTS_RAW } from "../data/cargoAircrafts";

export function useGlobalOptimization({
  routes,
  runPaxCircuitOptimizer,
  runGlobalOptCargo,
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
      const paxOpt = runPaxCircuitOptimizer(AIRCRAFTS_RAW, routes, 1000, {
        useTrue84: false,
        useAuxRevenue: false,
      });

      const cargoOpt = runGlobalOptCargo(CARGO_AIRCRAFTS_RAW, routes);

      setGRes(paxOpt);
      setCargoRes(cargoOpt);
    } catch (err) {
      setCalcError(`Erreur optimisation globale : ${err.message}`);
    }

    setRunningG(false);
  }, [routes, runPaxCircuitOptimizer, runGlobalOptCargo, setGRes, setCargoRes, setRunningG, setCalcError]);

  return { handleGlobal };
}