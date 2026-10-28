import { useCallback, useEffect, useRef, useState } from "react";
import { getPreferences, savePreferences } from "../api";
import {
  applyTheme,
  cachePreferences,
  cachedPreferences,
  PreferencesContext,
} from "./preferences";

// Holds the user's display settings for the whole app. Changes apply
// immediately and are saved to the server shortly after the last one, so
// dragging the font size slider sends one request, not dozens.
export default function PreferencesProvider({ children }) {
  const [prefs, setPrefs] = useState(cachedPreferences);
  // The Preferences panel: null while closed, otherwise { prefill }, where
  // prefill is a word to fix on the Pronunciations tab, or null. Shared so
  // both the Reader and the player bar can open it.
  const [panel, setPanel] = useState(null);
  const togglePanel = useCallback(
    () => setPanel((p) => (p ? null : { prefill: null })),
    [],
  );
  const prefsRef = useRef(prefs);
  const saveTimerRef = useRef(null);

  useEffect(() => {
    getPreferences()
      .then((saved) => {
        prefsRef.current = saved;
        setPrefs(saved);
        cachePreferences(saved);
      })
      .catch(() => {});
  }, []);

  // Re-applied when the setting changes, and for "auto", whenever the
  // operating system switches between light and dark.
  useEffect(() => {
    applyTheme(prefs.theme);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(prefs.theme);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [prefs.theme]);

  const update = useCallback((changes) => {
    const next = { ...prefsRef.current, ...changes };
    prefsRef.current = next;
    setPrefs(next);
    cachePreferences(next);
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(
      () => savePreferences(next).catch(() => {}),
      500,
    );
  }, []);

  return (
    <PreferencesContext.Provider
      value={{ prefs, update, panel, setPanel, togglePanel }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}
