import { useCallback, useState } from "react";
import * as XLSX from "xlsx";

import { parseRoutes } from "../utils/parseRoutes";
import { clearSeatConfigCache } from "../cabin/seatConfigs";
import { clearCabinConfigCache } from "../cabin/cabinConfig";
import { clearMultiFleetCascadeCache } from "../cabin/fleetMulti";

export function useRouteImport({
  activeBonus,
  setC24,
  setC168,
  setGRes,
  setCargoRes,
  setCalcError,
}) {
  const [rawRouteData, setRawRouteData] = useState([]);
  const [routes, setRoutes] = useState([]);

  const handleFile = useCallback(
    (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();

      reader.onload = (ev) => {
        try {
          const wb = XLSX.read(ev.target.result, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const raw = XLSX.utils.sheet_to_json(ws);

          clearSeatConfigCache();
          clearCabinConfigCache();
          clearMultiFleetCascadeCache();

          setRawRouteData(raw);

          const parsedRoutes = parseRoutes(raw, activeBonus);

          setRoutes(parsedRoutes);
          // setC24(null);
          // setC168(null);
          setGRes(null);
          setCargoRes(null);

          if (parsedRoutes.length === 0) {
            setCalcError(
              "Fichier chargé, mais aucune route valide n’a été trouvée. Vérifiez les colonnes DISTANCE, CATÉGORIE, DEMANDE ÉCONOMIE, DEMANDE AFFAIRES et DEMANDE PREMIÈRE."
            );
          } else {
            setCalcError(null);
          }
        } catch (err) {
          setCalcError(`Erreur lecture fichier : ${err.message}`);
          setRoutes([]);
          setRawRouteData([]);
        }
      };

      reader.readAsArrayBuffer(file);
    },
    [activeBonus, setGRes, setCargoRes, setCalcError]
  );

  return {
    routes,
    setRoutes,
    rawRouteData,
    setRawRouteData,
    handleFile,
  };
}