export function toNum(v) {
  if (v == null) return 0;
  const n = Number(String(v).replace(/[\s,]/g, ""));
  return isFinite(n) ? n : 0;
}