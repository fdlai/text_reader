import { createContext, useContext } from "react";

// The generation queue and whether it's paused, for the header's queue
// button, the queue panel, the Reader and the player bar. See
// GenerationProvider for what's in it.
export const GenerationContext = createContext(null);

export const useGeneration = () => useContext(GenerationContext);

// A queued article is one document with one voice; this names it, e.g. for
// the queue panel's selection.
export const queueKey = (documentId, presetId) => `${documentId}-${presetId}`;
