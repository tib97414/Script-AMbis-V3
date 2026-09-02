export const POOLS = [
  { label: "Cat 1-3", min: 1, max: 3, testCatMin: 1 },
  { label: "Cat 4",    min: 4, max: 4, testCatMin: 1 },
  { label: "Cat 5-6",  min: 5, max: 6, testCatMin: 3 },
  { label: "Cat 7-10", min: 7, max: 10, testCatMin: 5 },
];

export function poolBlockForCategory(category) {
  const cat = Number(category || 0);
  return (
    POOLS.find((pool) => cat >= pool.min && cat <= pool.max) ||
    POOLS[POOLS.length - 1]
  );
}