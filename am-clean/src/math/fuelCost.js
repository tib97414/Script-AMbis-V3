import { FUEL_FACTOR } from "../data/constants";

export function computeFuelCost(distance, conso, payload) {
  return FUEL_FACTOR * distance * conso * payload;
}