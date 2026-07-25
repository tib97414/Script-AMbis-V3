import {
  CANDIDATE_SOURCES,
  candidateFromCircuit,
} from "./candidateTypes";

import {
  rankCandidates,
  scoreCandidates,
} from "./candidateScoring";

export function sourceFromCircuit(circuit) {
  if (circuit?.isTargetCoveragePass) return CANDIDATE_SOURCES.TARGET_COVERAGE;
  if (circuit?.isResidualSecondPass) return CANDIDATE_SOURCES.RESIDUAL_PASS;

  const windowH = Number(circuit?.windowH || 168);

  if (windowH === 168) return CANDIDATE_SOURCES.BASE_168;
  if (windowH === 84) return CANDIDATE_SOURCES.BASE_84;
  if (windowH === 24) return CANDIDATE_SOURCES.BASE_24;

  return CANDIDATE_SOURCES.DIAGNOSTIC;
}

function sourceWindowFromCircuit(circuit) {
  if (circuit?._sourceWindow) return circuit._sourceWindow;

  const windowH = Number(circuit?.windowH || 168);

  if (windowH === 168) return "circuits168";
  if (windowH === 84) return "circuits84";
  if (windowH === 24) return "circuits24";

  return "circuitsOther";
}

function circuitCandidateKey(circuit, index) {
  return (
    circuit?._diagnosticCircuitKey ||
    `${Number(circuit?.windowH || 168)}|${index}`
  );
}

export function circuitToCandidate(circuit, extra = {}) {
  return candidateFromCircuit(circuit, {
    source: extra.source || sourceFromCircuit(circuit),
    metadata: {
      sourceCircuit: circuit,
      ...extra.metadata,
    },
    tags: extra.tags || [],
  });
}

export function circuitsToCandidates(circuits = [], extra = {}) {
  return circuits.map((circuit, index) => {
    const circuitKey = circuitCandidateKey(circuit, index);
    const sourceWindow = sourceWindowFromCircuit(circuit);

    return circuitToCandidate(circuit, {
      ...extra,
      metadata: {
        candidateIndex: index,
        circuitKey,
        sourceWindow,
        ...extra.metadata,
      },
    });
  });
}

export function resultToCircuitCandidates(result, extra = {}) {
  const byAircraft = result?.byAircraft || [];

  const circuits = byAircraft.flatMap((item) => [
    ...(item.circuits168 || []),
    ...(item.circuits84 || []),
    ...(item.circuits24 || []),
  ]);

  return circuitsToCandidates(circuits, {
    metadata: {
      resultAircraftCount: result?.aircraftCount,
      resultRoutesUsed: result?.routesUsed,
      resultRoutesTotal: result?.routesTotal,
      ...extra.metadata,
    },
    tags: extra.tags || [],
  });
}

export function buildScoredCircuitCandidates(result, options = {}) {
  const {
    limit = null,
    rank = true,
    weights = undefined,
    metadata = {},
    tags = [],
  } = options;

  const candidates = resultToCircuitCandidates(result, {
    metadata,
    tags,
  });

  const scored = rank
    ? rankCandidates(candidates, weights)
    : scoreCandidates(candidates, weights);

  return Number.isFinite(limit) && limit > 0 ? scored.slice(0, limit) : scored;
}

export function summarizeCircuitCandidates(candidates = []) {
  return candidates.reduce(
    (acc, candidate) => {
      acc.count += 1;
      acc.totalProfit += candidate.totalProfit || 0;
      acc.totalTime += candidate.totalTime || 0;

      if (candidate.windowH === 168) acc.window168 += 1;
      else if (candidate.windowH === 84) acc.window84 += 1;
      else if (candidate.windowH === 24) acc.window24 += 1;
      else acc.windowOther += 1;

      if (candidate.tags?.includes("targetCoverage")) acc.targetCoverage += 1;
      if (candidate.tags?.includes("residualSecondPass")) acc.residualSecondPass += 1;

      return acc;
    },
    {
      count: 0,
      totalProfit: 0,
      totalTime: 0,
      profitPerHour: 0,
      window168: 0,
      window84: 0,
      window24: 0,
      windowOther: 0,
      targetCoverage: 0,
      residualSecondPass: 0,
    }
  );
}

export function buildCircuitCandidateDiagnostics(result, options = {}) {
  const candidates = buildScoredCircuitCandidates(result, options);
  const summary = summarizeCircuitCandidates(candidates);

  return {
    ...summary,
    profitPerHour:
      summary.totalTime > 0 ? summary.totalProfit / summary.totalTime : 0,
    topCandidates: candidates.slice(0, options.previewLimit || 10).map((candidate) => ({
      id: candidate.id,
      source: candidate.source,
      windowH: candidate.windowH,
      routeCount: candidate.routes?.length || 0,
      fleet: candidate.fleetKeys?.join(" + "),
      totalTime: candidate.totalTime,
      totalProfit: candidate.totalProfit,
      profitPerHour: candidate.profitPerHour,
      fillRate: candidate.fillRate,
      score: candidate.score,
      tags: candidate.tags,
    })),
  };
}
