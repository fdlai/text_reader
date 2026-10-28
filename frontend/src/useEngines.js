import { useEffect, useState } from "react";
import { getEngines } from "./api";

// Which engines can generate right now: { engine: { available, reason } },
// or null until loaded. recheck() asks again, e.g. after starting Docker.
export function useEngines() {
  const [engines, setEngines] = useState(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    getEngines()
      .then(setEngines)
      .catch(() => {});
  }, []);

  async function recheck() {
    setChecking(true);
    try {
      setEngines(await getEngines());
    } catch {
      // keep the last known status
    } finally {
      setChecking(false);
    }
  }

  return { engines, checking, recheck };
}
