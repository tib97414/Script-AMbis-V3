import { exportGlobal } from "./export/exportExcel.js";
import { runProfitMaxPaxOptimizer } from "./optimizer/profitMaxPaxOptimizer.js";
import { runGlobalOptCargo } from "./optimizer/cargoOptimizer.js";
import { ROUTES_27 } from "./data/routes27.js";
import { AIRCRAFTS_RAW } from "./data/aircrafts.js";
import { CARGO_AIRCRAFTS_RAW } from "./data/cargoAircrafts.js";

console.log("=== TEST exportGlobal ===");
const gRes = runProfitMaxPaxOptimizer(AIRCRAFTS_RAW, ROUTES_27, 1000, { useTrue84: false, useAuxRevenue: false });
const cargoRes = runGlobalOptCargo(CARGO_AIRCRAFTS_RAW, ROUTES_27);

console.log("Clique le bouton ci-dessous pour déclencher l'export réel :");
window.__testExport = () => exportGlobal(gRes, cargoRes);