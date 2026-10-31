import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  getGeneration,
  moveQueued,
  pauseGeneration,
  resumeGeneration,
} from "../api";
import { useConfirm } from "./confirm";
import { GenerationContext } from "./generation";
import { usePreferences } from "./preferences";

// How often the queue is checked: often while the queue panel is open, so
// progress bars move; now and then while something is generating, so the
// header's count stays about right; and not at all otherwise (nothing
// changes then except through this app, which refreshes after each change).
const OPEN_POLL_MS = 2000;
const CLOSED_POLL_MS = 10000;

export default function GenerationProvider({ children }) {
  const [state, setState] = useState({
    paused: false,
    items: [],
    qwen_running: false,
  });
  const [queueOpen, setQueueOpen] = useState(false);
  // The queue panel's selected article (see queueKey), kept here so opening
  // the panel can select one, e.g. from the Reader.
  const [selectedKey, setSelectedKey] = useState(null);
  const { pathname } = useLocation();
  const { panel, setPanel } = usePreferences();
  const confirm = useConfirm();

  // Returns the latest state too, for callers that need it right away.
  const refresh = useCallback(async () => {
    try {
      const s = await getGeneration();
      setState(s);
      return s;
    } catch {
      return null; // the backend isn't reachable; keep what we had
    }
  }, []);

  // Checked on every page change too, e.g. after deleting an article.
  useEffect(() => {
    refresh();
  }, [pathname, refresh]);

  const active = state.items.length > 0 && !state.paused;
  useEffect(() => {
    if (!queueOpen && !active) return;
    const timer = setInterval(
      refresh,
      queueOpen ? OPEN_POLL_MS : CLOSED_POLL_MS,
    );
    return () => clearInterval(timer);
  }, [queueOpen, active, refresh]);

  // The queue panel and Preferences share the right side, so opening one
  // closes the other.
  useEffect(() => {
    if (panel) {
      setQueueOpen(false);
      setSelectedKey(null);
    }
  }, [panel]);
  const toggleQueue = useCallback(() => {
    if (!queueOpen) {
      setPanel(null);
      refresh();
    }
    setQueueOpen(!queueOpen);
    setSelectedKey(null);
  }, [queueOpen, setPanel, refresh]);
  // Opens the panel (or keeps it open) with that article selected.
  const openQueue = useCallback(
    (key = null) => {
      setPanel(null);
      setQueueOpen(true);
      setSelectedKey(key);
      refresh();
    },
    [setPanel, refresh],
  );
  const closeQueue = useCallback(() => {
    setQueueOpen(false);
    setSelectedKey(null);
  }, []);

  // Pauses all generation, after explaining what that does. Resolves to
  // true if it was paused.
  const confirmPause = useCallback(async () => {
    const latest = await refresh();
    const n = latest?.items.length ?? 0;
    const confirmed = await confirm({
      title: "Pause audio generation?",
      message:
        (n > 1
          ? `Audio generation stops right away for all ${n} queued articles.`
          : "Audio generation stops right away.") +
        " Sections already made are kept" +
        (latest?.qwen_running
          ? ", and Qwen shuts down to free up the GPU"
          : "") +
        ". Resume continues where it left off; only the section in progress starts over.",
      confirmLabel: "Pause generating",
      cancelLabel: "Keep generating",
      danger: false,
    });
    if (!confirmed) return false;
    setState(await pauseGeneration());
    return true;
  }, [refresh, confirm]);

  const resume = useCallback(
    async () => setState(await resumeGeneration()),
    [],
  );

  const move = useCallback(
    async (documentId, presetId, to) =>
      setState(await moveQueued(documentId, presetId, to)),
    [],
  );

  const value = useMemo(
    () => ({
      paused: state.paused,
      items: state.items,
      queued: state.items.length,
      refresh,
      confirmPause,
      resume,
      move,
      queueOpen,
      toggleQueue,
      openQueue,
      closeQueue,
      selectedKey,
      setSelectedKey,
    }),
    [
      state,
      refresh,
      confirmPause,
      resume,
      move,
      queueOpen,
      toggleQueue,
      openQueue,
      closeQueue,
      selectedKey,
    ],
  );

  return (
    <GenerationContext.Provider value={value}>
      {children}
    </GenerationContext.Provider>
  );
}
