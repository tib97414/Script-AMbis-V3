import { useCallback } from "react";
import { CARGO_AIRCRAFTS_RAW } from "../data/cargoAircrafts";

export function useCargoOptimization({
  routes,
  runGlobalOptCargo,
  setCargoRes,
  setRunningC,
  setCalcError,
}) {
  const handleCargo = useCallback(async () => {
    setRunningC(true);
    setCargoRes(null);
    setCalcError(null);

    await new Promise((r) => setTimeout(r, 30));

    try {
      setCargoRes(runGlobalOptCargo(CARGO_AIRCRAFTS_RAW, routes));
    } catch (err) {
      setCalcError(`Erreur optimisation cargo : ${err.message}`);
    }

    setRunningC(false);
  }, [routes, runGlobalOptCargo, setCargoRes, setRunningC, setCalcError]);

  return {
    handleCargo,
  };
}