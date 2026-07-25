import { TURNAROUND, ROUND_STEP } from "../data/constants";

export function flightTime(distance, speed) {
  const raw = (2 * distance) / speed + TURNAROUND;
  return Math.ceil(raw / ROUND_STEP) * ROUND_STEP;
}