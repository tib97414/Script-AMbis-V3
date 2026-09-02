import { useState } from "react";
import { AIRCRAFTS_RAW } from "./data/aircrafts";
import { runProfitMaxPaxOptimizer as runPaxCircuitOptimizer } from "./optimizer/profitMaxPaxOptimizer";
import { runGlobalOptCargo } from "./optimizer/cargoOptimizer";
import { exportGlobal } from "./export/exportExcel";

import { useRouteImport } from "./hooks/useRouteImport";
import { useGlobalOptimization } from "./hooks/useGlobalOptimization";
import { useCargoOptimization } from "./hooks/useCargoOptimization";

export default function App() {
  const [gRes, setGRes] = useState(null);
  const [cargoRes, setCargoRes] = useState(null);
  const [runningG, setRunningG] = useState(false);
  const [runningC, setRunningC] = useState(false);
  const [calcError, setCalcError] = useState(null);
  const [useDemandRepack, setUseDemandRepack] = useState(false);
  const [useResidualSecondPass, setUseResidualSecondPass] = useState(false);
  const [residualThreshold, setResidualThreshold] = useState(1500);

  const { routes, rawRouteData, handleFile } = useRouteImport({
    activeBonus: null,
    setGRes,
    setCargoRes,
    setCalcError,
  });

  const { handleGlobal } = useGlobalOptimization({
    routes,
    runPaxCircuitOptimizer,
    runGlobalOptCargo,
    useDemandRepack,
    useResidualSecondPass,
    residualThreshold,
    setGRes,
    setCargoRes,
    setRunningG,
    setCalcError,
  });

  const { handleCargo } = useCargoOptimization({
    routes,
    runGlobalOptCargo,
    setCargoRes,
    setRunningC,
    setCalcError,
  });
  
  return (
    <div style={{ fontFamily: "Arial, sans-serif", maxWidth: 900, margin: "0 auto", padding: 20 }}>
      <h2>✈️ AM-clean — Jalon 3 minimal</h2>

      <div style={{ marginBottom: 16 }}>
        <input type="file" accept=".xlsx" onChange={handleFile} />
        {routes.length > 0 && <span style={{ marginLeft: 10, color: "green" }}>✅ {routes.length} routes chargées</span>}
      </div>

      {calcError && (
        <div style={{ background: "#fee", border: "1px solid red", padding: 10, marginBottom: 16 }}>
          ⚠️ {calcError}
        </div>
      )}

      <div style={{ display: "flex", gap: 14, marginBottom: 12, flexWrap: "wrap", fontSize: 13 }}>
  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
    <input type="checkbox" checked={useDemandRepack} onChange={(e) => setUseDemandRepack(e.target.checked)} />
    Repack demandes
  </label>

  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
    <input type="checkbox" checked={useResidualSecondPass} onChange={(e) => setUseResidualSecondPass(e.target.checked)} />
    Seconde passe résidus + couverture cible
  </label>

  {useResidualSecondPass && (
    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
      Seuil résidu :
      <input
        type="number" min={50} max={3000} step={50}
        value={residualThreshold}
        onChange={(e) => setResidualThreshold(Math.max(50, Math.min(3000, +e.target.value || 1500)))}
        style={{ width: 70 }}
      />
    </label>
  )}
</div>

      <button onClick={handleGlobal} disabled={!routes.length || runningG} style={{ marginRight: 10, padding: "10px 16px" }}>
        {runningG ? "⏳ Calcul PAX..." : "🚀 Lancer l'optimisation PAX"}
      </button>

      <button onClick={handleCargo} disabled={!routes.length || runningC} style={{ padding: "10px 16px" }}>
        {runningC ? "⏳ Calcul cargo..." : "📦 Lancer l'optimisation cargo"}
      </button>

      {gRes && (
        <div style={{ marginTop: 20 }}>
          <h3>Résultat PAX</h3>
          <pre style={{ background: "#f5f5f5", padding: 12, borderRadius: 6, overflow: "auto" }}>
{JSON.stringify({
  total168: gRes.total168,
  total84: gRes.total84,
  total24: gRes.total24,
  routesUsed: gRes.routesUsed,
  routesTotal: gRes.routesTotal,
  aircraftCount: gRes.aircraftCount,
  circuits168: gRes.circuits168,
  circuits24: gRes.circuits24,
}, null, 2)}
          </pre>
        </div>
      )}

      {cargoRes && (
        <div style={{ marginTop: 20 }}>
          <h3>Résultat Cargo</h3>
          <pre style={{ background: "#f5f5f5", padding: 12, borderRadius: 6, overflow: "auto" }}>
{JSON.stringify({
  total168: cargoRes.total168,
  total24: cargoRes.total24,
  routesUsed: cargoRes.routesUsed,
  routesTotal: cargoRes.routesTotal,
}, null, 2)}
          </pre>
        </div>
      )}

      {gRes && (
        <button onClick={() => exportGlobal(gRes, cargoRes)} style={{ marginTop: 20, padding: "10px 16px" }}>
          📥 Exporter XLSX
        </button>
      )}
    </div>
  );
}