import { compareByNetProfit } from "../economics/circuitEconomics";
import { summarizeCandidateCoverage } from "./candidateTypes";

export const DEFAULT_CANDIDATE_SCORE_WEIGHTS = Object.freeze({
  profit: 1,
  profitPerHour: 0,
  fillRate: 0,
  demandCoverage: 0,
  fleetEfficiency: 0,
});

const coverageWeightCache = new WeakMap();

function getWeightedCoveredDemand(candidate) {
  if (!candidate || typeof candidate !== "object") return 0;

  const cached = coverageWeightCache.get(candidate);
  if (cached !== undefined) return cached;

  const coverage = summarizeCandidateCoverage(candidate);
  const weightedCoveredDemand =
    (coverage.eco || 0) +
    (coverage.bus || 0) * 1.8 +
    (coverage.first || 0) * 4.2 +
    (coverage.cargo || 0) * 0.25;

  coverageWeightCache.set(candidate, weightedCoveredDemand);
  return weightedCoveredDemand;
}

export function buildCandidateScoringContext(candidates = []) {
  let maxProfit = 1;

  for (const candidate of candidates) {
    maxProfit = Math.max(maxProfit, candidate.totalProfit || 0);
  }

  return { maxProfit };
}

export function scoreCandidate(
  candidate,
  context = {},
  weights = DEFAULT_CANDIDATE_SCORE_WEIGHTS,
  options = {}
) {
  const { includeScoreDetails = false } = options;
  const profit = Number(candidate.totalProfit || 0);
  const maxProfit = Number(context.maxProfit || 1);
  const profitScore = maxProfit > 0 ? profit / maxProfit : 0;

  const score = profitScore * (weights.profit ?? 1);

  if (!includeScoreDetails) {
    return { score, scoreDetails: candidate.scoreDetails || null };
  }

  return {
    score,
    scoreDetails: {
      profitScore,
      profit,
      maxProfit,
      profitPerHour: candidate.profitPerHour || 0,
      fillRate: candidate.fillRate || 0,
      weightedCoveredDemand: getWeightedCoveredDemand(candidate),
      fleetCount: candidate.aircraftFleet?.length || 1,
      weights,
    },
  };
}

export function scoreCandidates(
  candidates = [],
  weights = DEFAULT_CANDIDATE_SCORE_WEIGHTS,
  options = {}
) {
  const context = buildCandidateScoringContext(candidates);

  return candidates.map((candidate) => {
    const { score, scoreDetails } = scoreCandidate(
      candidate,
      context,
      weights,
      options
    );

    if (candidate.score === score && candidate.scoreDetails === scoreDetails) {
      return candidate;
    }

    return {
      ...candidate,
      score,
      scoreDetails,
    };
  });
}

export function rankCandidates(
  candidates = [],
  weights = DEFAULT_CANDIDATE_SCORE_WEIGHTS,
  options = {}
) {
  return scoreCandidates(candidates, weights, options).sort((a, b) =>
    compareByNetProfit(a, b)
  );
}

export function takeTopCandidates(candidates = [], limit = 20, weights) {
  return rankCandidates(candidates, weights).slice(0, limit);
}
