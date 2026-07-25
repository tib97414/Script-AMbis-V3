import * as XLSX from "xlsx";

function autosizeColumns(ws, rows) {
  if (!rows?.length) return;
  const keys = Object.keys(rows[0]);
  ws["!cols"] = keys.map((key) => ({
    wch: Math.min(
      Math.max(String(key).length, ...rows.map((r) => String(r[key] ?? "").length)) + 2,
      45
    ),
  }));
}

function addSheet(wb, name, rows) {
  const safeRows = rows?.length ? rows : [{ Info: "Aucune donnée" }];
  const ws = XLSX.utils.json_to_sheet(safeRows);
  autosizeColumns(ws, safeRows);
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
}

function money(value) {
  return Math.round(Number(value || 0));
}

function aircraftName(aircraft) {
  return `${aircraft?.brand || ""} ${aircraft?.model || ""}`.trim();
}

function planeModelName(plane) {
  return plane?.model || aircraftName(plane);
}

function formatPaxCargoConfig(sE, sB, sF, cargoTons = 0) {
  const cargo = Math.floor(cargoTons || 0);
  return cargo > 0
    ? `${sE || 0}é/${sB || 0}b/${sF || 0}f/${cargo}t`
    : `${sE || 0}é/${sB || 0}b/${sF || 0}f`;
}

function getOfficialColumnDiagnostics(gRes) {
  return gRes?.columnGenerationSelectionDiagnostics || null;
}

function getOfficialSelectedColumns(gRes) {
  const d = getOfficialColumnDiagnostics(gRes);
  return d?.selectedColumns || d?.beamSearchDiagnostics?.selectedColumns || [];
}

function getOfficialSelectedColumnRoutes(gRes) {
  const d = getOfficialColumnDiagnostics(gRes);
  return d?.selectedColumnRoutes || d?.beamSearchDiagnostics?.selectedColumnRoutes || [];
}

function flattenColumnSummary(gRes) {
  const d = getOfficialColumnDiagnostics(gRes);
  if (!d) return [];

  const mode = d.selectionModeDiagnostics || {};
  const beam = d.beamSearchDiagnostics || {};
  const paxSafe = d.paxSafe || {};
  const fleetReplacement = d.fleetReplacement || {};
  const postFleetReroute = d.postFleetReroute || beam.postFleetRerouteDiagnostics || {};
  const paxProfit = beam.currentPaxProfit || d.currentPaxProfit || 0;
  const ratioVsPax = paxProfit > 0 ? (Number(d.totalProfit || 0) / paxProfit) * 100 : 0;

  return [{
    "Mode officiel": mode.officialMode || paxSafe.mode || "NA",
    "Mode recommandé": mode.recommendedMode || mode.officialMode || paxSafe.mode || "NA",
    "Profit officiel": money(d.totalProfit),
    "Profit/h officiel": money(d.profitPerHour),
    "Colonnes retenues": d.selectedCount || 0,
    "Ratio officiel / PAX %": Number(ratioVsPax || 0).toFixed(1),
    "Écart officiel vs PAX": money(d.deltaVsCurrentPax),
    "PAX-safe actif": paxSafe.enabled ? "oui" : "non",
    "PAX-safe normalisé": paxSafe.normalized ? "oui" : "non",
    "Facteur circuits168": Number(paxSafe.factorsByWindow?.circuits168?.factor || 0).toFixed(6),
    "Facteur circuits24": Number(paxSafe.factorsByWindow?.circuits24?.factor || 0).toFixed(6),
    "FleetReplacement appliqué": paxSafe.fleetReplacementApplied ? "oui" : "non",
    "Gain FleetReplacement": money(paxSafe.fleetReplacementGain || fleetReplacement.gainVsPaxSafe),
    "Choix FleetReplacement": paxSafe.fleetReplacementSelectedCount || fleetReplacement.selectedReplacementCount || 0,
    "postFleetReroute appliqué": paxSafe.postFleetRerouteApplied || mode.usePostFleetRerouteBeamSelection ? "oui" : "non",
    "Gain postFleetReroute": money(paxSafe.postFleetRerouteGain || postFleetReroute.gainVsBaseline || mode.postFleetRerouteProfitDelta),
    "Choix postFleetReroute": paxSafe.postFleetRerouteSelectedCount || postFleetReroute.selectedPostFleetRerouteChoices || mode.postFleetRerouteChoices || 0,
    "Mode postFleetReroute": postFleetReroute.mode || (paxSafe.postFleetRerouteApplied ? "maxPotential" : "NA"),
    "Baseline postFleetReroute": postFleetReroute.baseline || "NA",
    "Plancher PAX-safe conservé": fleetReplacement.floorGuaranteed === false ? "non" : fleetReplacement.floorGuaranteed === true ? "oui" : "NA",
    "Gain vs greedy": money(mode.gainVsGreedy),
    "Profit greedy": money(mode.greedyProfit),
    "Profit beam": money(mode.beamProfit),
    "Gain beam": money(mode.beamProfitDelta),
  }];
}

function flattenPaxCircuits(gRes) {
  const rows = [];
  for (const item of gRes?.byAircraft || []) {
    const aircraft = aircraftName(item.aircraft);
    for (const [windowH, circuits] of [["168h", item.circuits168 || []], ["84h", item.circuits84 || []], ["24h", item.circuits24 || []]]) {
      for (const circuit of circuits) {
        rows.push({
          Avion: aircraft,
          Fenêtre: windowH,
          Type: circuit.type || "",
          Pool: circuit.pool || "",
          "Nb routes": circuit.routeCount || circuit.routes?.length || 0,
          "Temps total": circuit.totalTime || 0,
          "Remplissage %": circuit.fillRate || "",
          "Profit total": money(circuit.totalProfit),
          "Profit / h": money(circuit.profitPerHour),
          "Revenu cargo ventre": money(circuit.bellyCargoRev),
          "Revenu cargo substitution": money(circuit.cargoInPaxRev),
          Routes: (circuit.routes || []).map((r) => r.name).join(" | "),
          "IDs routes": (circuit.routes || []).map((r) => r.id).join(" | "),
        });
      }
    }
  }
  return rows;
}

function flattenPaxRoutes(gRes) {
  const rows = [];
  for (const item of gRes?.byAircraft || []) {
    const aircraft = aircraftName(item.aircraft);
    for (const [windowH, circuits] of [["168h", item.circuits168 || []], ["84h", item.circuits84 || []], ["24h", item.circuits24 || []]]) {
      circuits.forEach((circuit, ci) => {
        (circuit.routes || []).forEach((route, ri) => rows.push({
          Avion: aircraft,
          Fenêtre: windowH,
          "Circuit N°": ci + 1,
          "Route N°": ri + 1,
          Route: route.name || "",
          Distance: route.distance || 0,
          Catégorie: route.category || "",
          "Temps vol": route.ft || 0,
          "Demande éco": route.dEco || 0,
          "Demande affaires": route.dBus || 0,
          "Demande première": route.dFirst || 0,
          "Demande cargo": route.dCargo || 0,
          Taxe: route.tax || 0,
          Profit: money(route.profit),
          Revenu: money(route.rev),
        }));
      });
    }
  }
  return rows;
}

function flattenPaxFleet(gRes) {
  const rows = [];
  for (const item of gRes?.byAircraft || []) {
    const mainAircraft = aircraftName(item.aircraft);
    for (const [windowH, circuits] of [["168h", item.circuits168 || []], ["84h", item.circuits84 || []], ["24h", item.circuits24 || []]]) {
      circuits.forEach((circuit, ci) => {
        (circuit.cabin?.fleet || []).forEach((plane, pi) => {
          const cargoTotal = plane.cargoLoaded || 0;
          rows.push({
            "Avion principal": mainAircraft,
            Fenêtre: windowH,
            "Circuit N°": ci + 1,
            "Avion N°": pi + 1,
            Modèle: planeModelName(plane),
            Config: plane.label || "",
            "Config A/R": formatPaxCargoConfig(plane.capEco || 0, plane.capBus || 0, plane.capFirst || 0, cargoTotal * 2),
            Éco: plane.sE || 0,
            Affaires: plane.sB || 0,
            Première: plane.sF || 0,
            Cargo: cargoTotal,
            "Cap éco": plane.capEco || 0,
            "Cap affaires": plane.capBus || 0,
            "Cap première": plane.capFirst || 0,
            "Cargo A/R": cargoTotal * 2,
            "Delta éco": plane.deltaEco ?? "",
            "Delta affaires": plane.deltaBus ?? "",
            "Delta première": plane.deltaFirst ?? "",
            "Score pax": plane.fitScore ?? "",
            Profit: money(plane.profit),
            "Cargo ventre t": plane.cargoLoaded || 0,
            "Cargo substitution t": plane.cargoSubstTons || 0,
          });
        });
      });
    }
  }
  return rows;
}

function flattenSelectedColumns(gRes) {
  return getOfficialSelectedColumns(gRes).map((column) => ({
    "Colonne N°": column.index,
    ID: column.id,
    Couche: column.layer,
    Type: column.type,
    Source: column.source,
    Variante: column.sourceVariantKind,
    Fenêtre: column.windowH,
    "Nb routes": column.routeCount,
    Flotte: column.fleet,
    "Temps total": column.totalTime,
    "Remplissage %": column.fillRate,
    "Profit total": money(column.totalProfit),
    "Profit / h": money(column.profitPerHour),
    Score: Number(column.score || 0).toFixed(4),
    Gain: money(column.gain),
    "Flotte actuelle": column.currentAircraft,
    Routes: column.routeNames,
    "IDs routes": column.routeIds,
    Tags: column.tags,
  }));
}

function flattenSelectedColumnRoutes(gRes) {
  return getOfficialSelectedColumnRoutes(gRes).map((route) => ({
    "Colonne N°": route.columnIndex,
    "ID colonne": route.columnId,
    Couche: route.layer,
    Type: route.type,
    Source: route.source,
    Variante: route.sourceVariantKind,
    Fenêtre: route.windowH,
    Flotte: route.fleet,
    "Route N°": route.routeIndex,
    Route: route.route,
    "ID route": route.routeId,
    Distance: route.distance,
    Catégorie: route.category,
    "Temps vol": route.flightTime,
    "Demande éco": route.dEco,
    "Demande affaires": route.dBus,
    "Demande première": route.dFirst,
    "Demande cargo": route.dCargo,
    Taxe: route.tax,
    Revenu: route.revenue,
    Profit: route.profit,
  }));
}

function flattenCargoCircuits(cargoRes) {
  const rows = [];
  for (const item of cargoRes?.byAircraft || []) {
    const aircraft = aircraftName(item.aircraft);
    for (const [windowH, circuits] of [["168h", item.circuits168 || []], ["24h", item.circuits24 || []]]) {
      for (const circuit of circuits) {
        rows.push({
          Avion: aircraft,
          Fenêtre: windowH,
          Type: circuit.type || "",
          "Nb routes": circuit.routeCount || circuit.routes?.length || 0,
          "Temps total": circuit.totalTime || 0,
          "Remplissage %": circuit.fillRate || "",
          "Profit total": money(circuit.totalProfit),
          "Profit / h": money(circuit.profitPerHour),
          Routes: (circuit.routes || []).map((r) => r.name).join(" | "),
        });
      }
    }
  }
  return rows;
}

function flattenCargoRoutes(cargoRes) {
  const rows = [];
  for (const item of cargoRes?.byAircraft || []) {
    const aircraft = aircraftName(item.aircraft);
    for (const [windowH, circuits] of [["168h", item.circuits168 || []], ["24h", item.circuits24 || []]]) {
      circuits.forEach((circuit, ci) => {
        (circuit.routes || []).forEach((route, ri) => rows.push({
          Avion: aircraft,
          Fenêtre: windowH,
          "Circuit N°": ci + 1,
          "Route N°": ri + 1,
          Route: route.name || "",
          Distance: route.distance || 0,
          Catégorie: route.category || "",
          "Temps vol": route.ft || 0,
          "Demande cargo": route.dCargo || 0,
          Taxe: route.tax || 0,
          Profit: money(route.profit),
          Revenu: money(route.rev),
        }));
      });
    }
  }
  return rows;
}

function flattenCargoFleet(cargoRes) {
  const rows = [];
  for (const item of cargoRes?.byAircraft || []) {
    const mainAircraft = aircraftName(item.aircraft);
    for (const [windowH, circuits] of [["168h", item.circuits168 || []], ["24h", item.circuits24 || []]]) {
      circuits.forEach((circuit, ci) => {
        (circuit.cargoFleet?.planes || []).forEach((plane, pi) => rows.push({
          "Avion principal": mainAircraft,
          Fenêtre: windowH,
          "Circuit N°": ci + 1,
          "Avion N°": pi + 1,
          Modèle: planeModelName(plane),
          Payload: plane.payload || 0,
          "Payload A/R": (plane.payload || 0) * 2,
          Profit: money(plane.profit),
        }));
      });
    }
  }
  return rows;
}

export function exportGlobal(gRes, cargoRes = null) {
  if (!gRes) {
    alert("Aucun résultat global à exporter.");
    return;
  }

  const wb = XLSX.utils.book_new();
  addSheet(wb, "Résumé colonnes", flattenColumnSummary(gRes));
  addSheet(wb, "Circuits PAX", flattenPaxCircuits(gRes));
  addSheet(wb, "Routes PAX", flattenPaxRoutes(gRes));
  addSheet(wb, "Flotte PAX", flattenPaxFleet(gRes));
  addSheet(wb, "Colonnes sélection", flattenSelectedColumns(gRes));
  addSheet(wb, "Routes colonnes", flattenSelectedColumnRoutes(gRes));

  if (cargoRes) {
    addSheet(wb, "Circuits Cargo", flattenCargoCircuits(cargoRes));
    addSheet(wb, "Routes Cargo", flattenCargoRoutes(cargoRes));
    addSheet(wb, "Flotte Cargo", flattenCargoFleet(cargoRes));
  }

  XLSX.writeFile(wb, "resultats_AM_global.xlsx");
}

export function exportCargo(cargoRes) {
  if (!cargoRes) {
    alert("Aucun résultat cargo à exporter.");
    return;
  }

  const wb = XLSX.utils.book_new();
  addSheet(wb, "Circuits Cargo", flattenCargoCircuits(cargoRes));
  addSheet(wb, "Routes Cargo", flattenCargoRoutes(cargoRes));
  addSheet(wb, "Flotte Cargo", flattenCargoFleet(cargoRes));
  XLSX.writeFile(wb, "resultats_AM_cargo.xlsx");
}
