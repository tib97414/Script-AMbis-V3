export function allocateDemand(capacity, demand) {
  return Math.min(capacity || 0, demand || 0);
}