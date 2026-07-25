import { allocateDemand } from "./allocateDemand";

export function allocateCabin({
  capEco,
  capBus,
  capFirst,
  demandEco,
  demandBus,
  demandFirst,
}) {
  return {
    paxEco: allocateDemand(capEco, demandEco),
    paxBus: allocateDemand(capBus, demandBus),
    paxFirst: allocateDemand(capFirst, demandFirst),
  };
}