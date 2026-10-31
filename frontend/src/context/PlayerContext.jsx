import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { chunkAudioUrl, saveProgress, updateVoiceSpeed } from "../api";
import { buildTimeline, fromPosition, toPosition } from "../timeline";

const PlayerContext = createContext(null);

export const usePlayer = () => useContext(PlayerContext);

// How far the skip buttons and arrow keys move. Short, for going back or
// forward about a sentence; the progress bar and "Play from here" are for
// bigger jumps.
export const SKIP_SECONDS = 5;

const VOLUME_KEY = "volume";

// The volume is kept in this browser rather than with the other
// preferences, because the right level depends on the device (laptop
// speakers, headphones, ...).
function savedVolume() {
  try {
    const saved = JSON.parse(localStorage.getItem(VOLUME_KEY));
    if (typeof saved?.volume === "number") {
      return {
        volume: Math.min(1, Math.max(0, saved.volume)),
        muted: Boolean(saved.muted),
      };
    }
  } catch {
    // storage unavailable or not valid JSON; use the default below
  }
  return { volume: 1, muted: false };
}

export function PlayerProvider({ children }) {
  const audioRef = useRef(null);
  const sessionRef = useRef(null);
  // Where to seek once the current chunk's audio has loaded.
  const pendingOffsetRef = useRef(null);
  const [session, setSession] = useState(null); // { documentId, title, presetId, chunks: [{ id, index, char_count }] }
  // { [chunkId]: { duration, audioId } }, only for chunks with audio.
  const [chunkAudio, setChunkAudio] = useState({});
  const [index, setIndex] = useState(0);
  const [offset, setOffset] = useState(0); // seconds into the current chunk
  const [playing, setPlaying] = useState(false);
  // True after the last chunk ends. Playback then stays at the end, so the
  // page shows the article was finished, until listening starts again.
  const [finished, setFinished] = useState(false);
  const [rate, setRate] = useState(1);
  // volume is 0 to 1. Muting keeps it, so unmuting returns to the same level.
  const [{ volume, muted }, setVolumeState] = useState(savedVolume);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    audioRef.current.volume = volume;
    audioRef.current.muted = muted;
    try {
      localStorage.setItem(VOLUME_KEY, JSON.stringify({ volume, muted }));
    } catch {
      // storage unavailable; the volume just isn't remembered
    }
  }, [volume, muted]);

  // Moving the slider also unmutes, as in most players.
  const changeVolume = useCallback(
    (newVolume) => setVolumeState({ volume: newVolume, muted: false }),
    [],
  );
  // Unmuting from a volume of 0 would still be silent, so it goes to half
  // volume instead.
  const toggleMute = useCallback(
    () =>
      setVolumeState((s) =>
        s.volume === 0
          ? { volume: 0.5, muted: false }
          : { ...s, muted: !s.muted },
      ),
    [],
  );

  const currentChunk = session?.chunks[index];
  const isReady = (chunk) => chunk.id in chunkAudio;
  const waiting = playing && currentChunk && !isReady(currentChunk);

  const timeline = useMemo(() => {
    if (!session) return null;
    const durations = Object.fromEntries(
      Object.entries(chunkAudio).map(([id, a]) => [id, a.duration]),
    );
    return buildTimeline(session.chunks, durations);
  }, [session, chunkAudio]);
  const position = timeline ? toPosition(timeline, index, offset) : 0;

  useEffect(() => {
    const audio = audioRef.current;
    if (!currentChunk) return;
    const ready = chunkAudio[currentChunk.id];
    if (!ready) {
      audio.pause();
      return;
    }
    const src = chunkAudioUrl(currentChunk.id, session.presetId, ready.audioId);
    if (audio.getAttribute("data-src") !== src) {
      audio.setAttribute("data-src", src);
      audio.src = src;
    }
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
    if (playing) audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }, [session, currentChunk, chunkAudio, playing, rate]);

  // The audio element's timeupdate event only fires about 4 times a second,
  // which is too coarse for word highlighting. While playing, read the time
  // every animation frame, skipping updates smaller than 0.05s.
  useEffect(() => {
    if (!playing) return;
    let frame;
    function tick() {
      const audio = audioRef.current;
      if (pendingOffsetRef.current === null && !audio.paused) {
        const t = audio.currentTime;
        setOffset((prev) => (Math.abs(prev - t) < 0.05 ? prev : t));
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  // Saving progress. Instead of saving constantly, the position is saved:
  //  - shortly after pausing or seeking (debounced, so five quick +5s
  //    clicks send one request, not five),
  //  - every 30 seconds while playing, in case the browser crashes,
  //  - right away when the tab is hidden or closed.
  // The latest position is kept in a ref so timers always save the current
  // value, and saves that wouldn't change anything are skipped.
  const latestRef = useRef(null);
  const lastSavedRef = useRef(null);
  const saveTimerRef = useRef(null);

  useEffect(() => {
    latestRef.current = session
      ? { documentId: session.documentId, index, offset, finished }
      : null;
  }, [session, index, offset, finished]);

  // Returns a promise that settles once the save is done (or right away if
  // there was nothing to save), so the Library can wait for it.
  const saveNow = useCallback(() => {
    clearTimeout(saveTimerRef.current);
    const p = latestRef.current;
    const last = lastSavedRef.current;
    if (!p) return Promise.resolve();
    if (
      last &&
      last.documentId === p.documentId &&
      last.index === p.index &&
      last.finished === p.finished &&
      Math.abs(last.offset - p.offset) < 0.5
    ) {
      return Promise.resolve();
    }
    lastSavedRef.current = p;
    return saveProgress(p.documentId, p.index, p.offset, p.finished).catch(
      () => {},
    );
  }, []);

  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(saveNow, 1000);
  }, [saveNow]);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(saveNow, 30000);
    return () => clearInterval(timer);
  }, [playing, saveNow]);

  useEffect(() => {
    if (session && !playing) scheduleSave();
  }, [session, playing, scheduleSave]);

  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === "hidden") saveNow();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", saveNow);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", saveNow);
    };
  }, [saveNow]);

  const start = useCallback(
    (
      newSession,
      newChunkAudio,
      startIndex,
      newRate,
      startOffset = 0,
      autoplay = true,
      startFinished = false,
    ) => {
      pendingOffsetRef.current = startOffset || null;
      // The starting point is already saved (it usually came from the
      // server), so there's no need to save it again.
      lastSavedRef.current = {
        documentId: newSession.documentId,
        index: startIndex,
        offset: startOffset,
        finished: startFinished,
      };
      setSession(newSession);
      setChunkAudio(newChunkAudio);
      setIndex(startIndex);
      setOffset(startOffset);
      setFinished(startFinished);
      setRate(newRate);
      setPlaying(autoplay);
    },
    [],
  );

  // Stops and unloads the player, e.g. when its audio is being deleted. The
  // position is saved first, so listening can resume after regenerating,
  // unless save is false (e.g. the whole document is being deleted).
  const close = useCallback(
    (save = true) => {
      if (save) {
        saveNow();
      } else {
        clearTimeout(saveTimerRef.current);
        latestRef.current = null;
      }
      const audio = audioRef.current;
      audio.pause();
      audio.removeAttribute("src");
      audio.removeAttribute("data-src");
      audio.load();
      pendingOffsetRef.current = null;
      setPlaying(false);
      setSession(null);
      setChunkAudio({});
    },
    [saveNow],
  );

  const updateChunkAudio = useCallback(
    (documentId, presetId, newChunkAudio) => {
      const s = sessionRef.current;
      if (s && s.documentId === documentId && s.presetId === presetId) {
        setChunkAudio(newChunkAudio);
      }
    },
    [],
  );

  // Moves to a point inside a chunk. If that chunk's audio is already
  // loaded, seek directly; otherwise seek once it loads.
  const goTo = useCallback(
    (newIndex, newOffset) => {
      const audio = audioRef.current;
      const chunkId = session.chunks[newIndex].id;
      const src = chunkAudioUrl(
        chunkId,
        session.presetId,
        chunkAudio[chunkId]?.audioId,
      );
      if (audio.getAttribute("data-src") === src && audio.readyState >= 1) {
        audio.currentTime = newOffset;
        pendingOffsetRef.current = null;
      } else {
        pendingOffsetRef.current = newOffset;
      }
      setIndex(newIndex);
      setOffset(newOffset);
      // Moving anywhere means the article is being listened to again.
      setFinished(false);
      scheduleSave();
    },
    [session, chunkAudio, scheduleSave],
  );

  const seekTo = useCallback(
    (newPosition) => {
      const target = fromPosition(timeline, newPosition);
      goTo(target.index, target.offset);
    },
    [timeline, goTo],
  );

  const jumpTo = useCallback(
    (i, newOffset = 0) => {
      goTo(i, newOffset);
      setPlaying(true);
    },
    [goTo],
  );

  // Play on a finished article starts it over.
  const toggle = useCallback(() => {
    if (finished) jumpTo(0, 0);
    else setPlaying((p) => !p);
  }, [finished, jumpTo]);

  // Changing speed also saves it as the voice's speed, so it's remembered
  // next time. Debounced like progress saves: several quick clicks on +
  // send one request.
  const speedTimerRef = useRef(null);
  // { [presetId]: speed } changed in this visit. Pages loaded the voice list
  // earlier and may have older speeds, so they check here first (speedFor).
  const changedSpeedsRef = useRef({});
  const speedFor = useCallback(
    (presetId, savedSpeed) => changedSpeedsRef.current[presetId] ?? savedSpeed,
    [],
  );
  const changeRate = useCallback((newRate) => {
    setRate(newRate);
    const presetId = sessionRef.current?.presetId;
    if (!presetId) return;
    changedSpeedsRef.current[presetId] = newRate;
    clearTimeout(speedTimerRef.current);
    speedTimerRef.current = setTimeout(
      () => updateVoiceSpeed(presetId, newRate).catch(() => {}),
      1000,
    );
  }, []);

  const skip = useCallback(
    (seconds) => seekTo(position + seconds),
    [seekTo, position],
  );

  function handleEnded() {
    if (index < session.chunks.length - 1) {
      goTo(index + 1, 0);
    } else {
      // Finished: stay at the end, so the page (and Library) shows it.
      setPlaying(false);
      setFinished(true);
    }
  }

  function handleLoadedMetadata(e) {
    if (pendingOffsetRef.current !== null) {
      e.target.currentTime = pendingOffsetRef.current;
      pendingOffsetRef.current = null;
    }
  }

  function handleTimeUpdate(e) {
    // Until a pending seek is applied, the audio reports the start of the
    // file, which would briefly show the wrong position.
    if (pendingOffsetRef.current === null) setOffset(e.target.currentTime);
  }

  const value = {
    session,
    index,
    offset,
    playing,
    finished,
    waiting,
    rate,
    changeRate,
    volume,
    muted,
    changeVolume,
    toggleMute,
    speedFor,
    timeline,
    position,
    start,
    close,
    saveNow,
    updateChunkAudio,
    jumpTo,
    seekTo,
    toggle,
    skip,
  };

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        onEnded={handleEnded}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
      />
    </PlayerContext.Provider>
  );
}
