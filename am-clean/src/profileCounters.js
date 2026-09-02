export const callCounts = {};
export const callTotalTime = {};

export function trackCall(fnName, durationMs) {
  callCounts[fnName] = (callCounts[fnName] || 0) + 1;
  callTotalTime[fnName] = (callTotalTime[fnName] || 0) + durationMs;
}

export function printProfileSummary() {
  console.log("=== RÉCAPITULATIF DES APPELS ===");
  Object.keys(callCounts)
    .sort((a, b) => callTotalTime[b] - callTotalTime[a])
    .forEach((fnName) => {
      console.log(
        `${fnName} : ${callCounts[fnName]} appels, ${callTotalTime[fnName].toFixed(0)}ms cumulé, ${(callTotalTime[fnName] / callCounts[fnName]).toFixed(3)}ms/appel`
      );
    });
}

export function resetProfile() {
  Object.keys(callCounts).forEach((k) => delete callCounts[k]);
  Object.keys(callTotalTime).forEach((k) => delete callTotalTime[k]);
}