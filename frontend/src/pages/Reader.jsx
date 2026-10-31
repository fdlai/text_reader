import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  createDocument,
  deleteDocumentAudio,
  generateAudio,
  getAudioStatus,
  getDocument,
  getProgress,
  listVoices,
  moveDocuments,
  regenerateOutdated,
} from "../api";
import ChunkText from "../components/ChunkText";
import EngineNotice from "../components/EngineNotice";
import MoveDialog from "../components/MoveDialog";
import PreferencesPanel from "../components/PreferencesPanel";
import VoicePicker from "../components/VoicePicker";
import { useBreadcrumb } from "../context/breadcrumb";
import { useConfirm } from "../context/confirm";
import { queueKey, useGeneration } from "../context/generation";
import { SKIP_SECONDS, usePlayer } from "../context/PlayerContext";
import {
  FONTS,
  HIGHLIGHT_COLORS,
  usePreferences,
} from "../context/preferences";
import { collectionPath } from "../paths";
import { useEngines } from "../useEngines";
import { chunkLength, wordIndexAt } from "../timeline";

// Space isn't included: on this page it plays and pauses (see shortcuts).
const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
]);

// While following, the line being read is kept between these fractions of
// the window height, and re-centered at FOLLOW_AT when it drifts outside.
const FOLLOW_TOP = 0.2;
const FOLLOW_BOTTOM = 0.6;
const FOLLOW_AT = 0.4;

// Where on screen the reading is, as a y coordinate relative to the window:
// the highlighted word if there is one, otherwise an estimate from how far
// through the chunk's audio playback is.
function readingY(chunkEl, offset, length) {
  const word = chunkEl.querySelector("[data-current-word]");
  if (word) return word.getBoundingClientRect().top;
  const rect = chunkEl.getBoundingClientRect();
  const fraction = length ? Math.min(offset / length, 1) : 0;
  return rect.top + fraction * rect.height;
}

// What the player needs to know about a document to play it.
function playerSession(doc, presetId) {
  return {
    documentId: doc.id,
    title: doc.title,
    presetId,
    chunks: doc.chunks.map(({ id, index, char_count }) => ({
      id,
      index,
      char_count,
    })),
  };
}

// { [chunkId]: { duration, audioId } } for the chunks whose audio is ready.
function readyAudio(status) {
  return Object.fromEntries(
    status.chunks
      .filter((c) => c.ready)
      .map((c) => [
        c.chunk_id,
        { duration: c.duration_sec, audioId: c.audio_id },
      ]),
  );
}

export default function Reader() {
  const documentId = Number(useParams().id);
  const player = usePlayer();
  const { prefs, update, panel, setPanel } = usePreferences();
  const engines = useEngines();
  const confirm = useConfirm();
  const generation = useGeneration();
  const navigate = useNavigate();
  const { setBreadcrumb } = useBreadcrumb();
  const { updateChunkAudio } = player;
  const [doc, setDoc] = useState(null);
  const [voices, setVoices] = useState([]);
  // Starts with the most recently picked voice. (The voice used to be kept
  // in localStorage, which is still read once so it isn't lost.)
  const [presetId, setPresetId] = useState(
    () =>
      prefs.recent_voices[0] ??
      (Number(localStorage.getItem("voicePresetId")) || null),
  );
  const [status, setStatus] = useState(null);
  const [progress, setProgress] = useState(null); // where listening left off
  const [pollKey, setPollKey] = useState(0);
  const [error, setError] = useState("");
  const [addingNext, setAddingNext] = useState(false);
  const [moving, setMoving] = useState(false); // the Move popup is open
  // When true, the page scrolls to keep the text being read on screen.
  const [following, setFollowing] = useState(true);
  // { chunkIndex, wordIndex, text, top, left } while text is selected.
  const [selectionPopup, setSelectionPopup] = useState(null);
  // Counts "Fix pronunciation" prefills, so fixing the same word twice still
  // starts fresh.
  const prefillCountRef = useRef(0);
  const chunkRefs = useRef({});
  const textRef = useRef(null);

  useEffect(() => {
    Promise.all([
      getDocument(documentId),
      listVoices(),
      getProgress(documentId),
    ])
      .then(([d, v, p]) => {
        setDoc(d);
        setVoices(v);
        setProgress(p);
        setPresetId((current) =>
          v.some((x) => x.id === current) ? current : (v[0]?.id ?? null),
        );
      })
      .catch((e) => setError(e.message));
  }, [documentId]);

  // The browser tab shows the article's title while it's open.
  useEffect(() => {
    if (!doc) return;
    document.title = `${doc.title} · Audifire`;
    return () => {
      document.title = "Audifire";
    };
  }, [doc]);

  // The header links back to the article's collection while it's open.
  const libraryPath = doc ? collectionPath(doc.collection_id) : "/";
  const collectionName = doc?.collection_name ?? "Unsorted";
  const loaded = doc !== null;
  useEffect(() => {
    if (!loaded) return;
    setBreadcrumb({ to: libraryPath, label: collectionName });
    return () => setBreadcrumb(null);
  }, [loaded, libraryPath, collectionName, setBreadcrumb]);

  useEffect(() => {
    if (!presetId) return;
    let cancelled = false;
    let timer;

    async function poll() {
      try {
        const s = await getAudioStatus(documentId, presetId);
        if (cancelled) return;
        setStatus(s);
        updateChunkAudio(documentId, presetId, readyAudio(s));
        // Nothing changes while paused; resuming runs this again.
        if (s.generating && !generation.paused) timer = setTimeout(poll, 2000);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    }
    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [documentId, presetId, pollKey, updateChunkAudio, generation.paused]);

  const sameSession =
    player.session?.documentId === documentId &&
    player.session?.presetId === presetId;
  const activeIndex = sameSession ? player.index : -1;

  // On opening a document, load it into the player paused at the saved
  // position, so the progress bar shows where listening left off. Skipped
  // if something is playing, so opening a page never interrupts it.
  const { start, speedFor } = player;
  useEffect(() => {
    const preset = voices.find((v) => v.id === presetId);
    const hasAudio = status?.chunks.some((c) => c.ready);
    if (!doc || !progress || !preset || !hasAudio) return;
    if (player.playing || sameSession) return;
    start(
      playerSession(doc, presetId),
      readyAudio(status),
      progress.chunk_index,
      speedFor(presetId, preset.speed),
      progress.offset_sec,
      false,
      progress.finished,
    );
  }, [
    doc,
    progress,
    voices,
    presetId,
    status,
    player.playing,
    sameSession,
    start,
    speedFor,
  ]);

  // Scrolling by hand stops following. Only user input is listened for, so
  // the page's own scrolling below doesn't turn following off.
  useEffect(() => {
    const stop = () => setFollowing(false);
    function handleKey(e) {
      // Arrow keys inside the voice picker or progress bar don't scroll the page.
      const inControl = e.target.closest("input, select, textarea, button");
      if (SCROLL_KEYS.has(e.key) && !inControl) stop();
    }
    function handlePointerDown(e) {
      // A press on the page's scrollbar targets the <html> element.
      if (e.target === document.documentElement) stop();
    }
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchmove", stop, { passive: true });
    window.addEventListener("keydown", handleKey);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchmove", stop);
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  // The same function every render, so the panel doesn't re-add its
  // listeners each time the page updates during playback.
  const closePanel = useCallback(() => setPanel(null), [setPanel]);

  // What Space does right now: play/pause, or null if nothing can play yet.
  // Likewise for the arrow keys: skip, or null if this article isn't the one
  // playing. Kept in refs (refreshed after every render) so the key listener
  // below is set up once but always sees the current state.
  const playPauseRef = useRef(null);
  const skipRef = useRef(null);
  useEffect(() => {
    const canStart = doc && progress && status?.chunks[0]?.ready;
    playPauseRef.current = sameSession
      ? player.toggle
      : canStart
        ? resume
        : null;
    skipRef.current = sameSession ? player.skip : null;
  });

  // Keyboard shortcuts: L goes back to the collection, Space plays/pauses,
  // Left/Right arrows go back/forward SKIP_SECONDS (hold to keep skipping).
  // (P for Preferences and M for mute work on every page; see Header and
  // PlayerBar.)
  // Ignored while typing in a box. Space is also left alone on a focused
  // button (the browser uses it to press that button), and when nothing can
  // play, so it still scrolls the page then.
  useEffect(() => {
    function handleShortcut(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Also ignored while a confirmation dialog is open.
      if (
        e.target.closest("input, select, textarea, [contenteditable], dialog")
      )
        return;
      // Back to the list this article is in.
      if (e.key === "l" || e.key === "L") {
        navigate(libraryPath);
        return;
      }
      const playPause = playPauseRef.current;
      if (e.key === " " && playPause && !e.target.closest("button")) {
        e.preventDefault(); // otherwise Space would also scroll the page
        if (!e.repeat) playPause();
        return;
      }
      const skip = skipRef.current;
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && skip) {
        e.preventDefault(); // otherwise a wide page would scroll sideways
        skip(e.key === "ArrowLeft" ? -SKIP_SECONDS : SKIP_SECONDS);
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [navigate, libraryPath]);

  // "Play from here": when a selection is finished inside the text, find its
  // first word and show a button above the selection.
  useEffect(() => {
    function handleSelectionEnd() {
      // Wait a moment for the browser to finish updating the selection.
      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection.rangeCount || selection.isCollapsed) return;
        const range = selection.getRangeAt(0);
        const words = textRef.current?.querySelectorAll("[data-word]") ?? [];
        const first = [...words].find((el) => range.intersectsNode(el));
        if (!first) return;
        const rect = range.getBoundingClientRect();
        // Selecting text means looking at something, so stop auto-scrolling.
        setFollowing(false);
        setSelectionPopup({
          chunkIndex: Number(first.closest("[data-chunk]").dataset.chunk),
          wordIndex: Number(first.dataset.word),
          text: selection.toString().replace(/\s+/g, " ").trim().slice(0, 100),
          // Page coordinates, so the button stays with the text on scroll.
          top: rect.top + window.scrollY,
          left: rect.left + rect.width / 2 + window.scrollX,
        });
      });
    }
    function handleSelectionChange() {
      if (window.getSelection().isCollapsed) setSelectionPopup(null);
    }
    document.addEventListener("mouseup", handleSelectionEnd);
    document.addEventListener("keyup", handleSelectionEnd);
    document.addEventListener("touchend", handleSelectionEnd);
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("mouseup", handleSelectionEnd);
      document.removeEventListener("keyup", handleSelectionEnd);
      document.removeEventListener("touchend", handleSelectionEnd);
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, []);

  const { timeline, offset, playing } = player;

  useEffect(() => {
    const chunkEl = chunkRefs.current[activeIndex];
    if (!following || !playing || !chunkEl) return;
    const y = readingY(chunkEl, offset, chunkLength(timeline, activeIndex));
    const height = window.innerHeight;
    if (y < height * FOLLOW_TOP || y > height * FOLLOW_BOTTOM) {
      window.scrollBy({ top: y - height * FOLLOW_AT, behavior: "smooth" });
    }
  }, [following, playing, activeIndex, offset, timeline]);

  if (error && !doc) return <p className="text-red-600">{error}</p>;
  if (!doc) return <p className="text-gray-500">Loading...</p>;

  const preset = voices.find((v) => v.id === presetId);
  const finished = sameSession ? player.finished : progress?.finished;
  const readyChunks = status?.chunks.filter((c) => c.ready) ?? [];
  const allReady = status && readyChunks.length === status.chunks.length;
  // Finished audio plays without the engine, so this only matters when
  // something still needs generating.
  const engineStatus = engines.engines?.[preset?.engine];
  const canGenerate = engineStatus?.available !== false;
  const isReady = (index) => status?.chunks[index]?.ready;
  const outdatedCount = status?.chunks.filter((c) => c.outdated).length ?? 0;
  // Audio made before word timings existed (or whose timings failed) has
  // none; that chunk is then highlighted as a whole instead.
  const activeWordTimes =
    activeIndex >= 0 ? status?.chunks[activeIndex]?.word_times : null;
  const currentWord = activeWordTimes
    ? wordIndexAt(activeWordTimes, offset)
    : -1;

  function handleVoiceChange(value) {
    if (value === presetId) return;
    // Keep the listening position when switching to another voice.
    if (sameSession) {
      setProgress({
        chunk_index: player.index,
        offset_sec: player.offset,
        finished: player.finished,
      });
    }
    // Most recent first, without repeats or voices that were deleted.
    update({
      recent_voices: [
        value,
        ...prefs.recent_voices.filter(
          (id) => id !== value && voices.some((v) => v.id === id),
        ),
      ].slice(0, 10),
    });
    setStatus(null);
    setPresetId(value);
  }

  async function handleGenerate(front = false) {
    setError("");
    try {
      await generateAudio(documentId, presetId, front);
      setPollKey((k) => k + 1);
      generation.refresh(); // so the header's queue count includes it
    } catch (e) {
      setError(e.message);
    }
  }

  // Adds the next part to this part's collection (unless it's in the Library
  // already) and starts generating its audio with the current voice, then
  // opens it if `open`.
  async function handleNextPart(open) {
    let id = doc.next_document_id;
    if (id == null) {
      setError("");
      setAddingNext(true);
      try {
        id = (await createDocument(doc.next_url, doc.collection_id)).id;
        // Joins the back of the queue, so this part's audio still comes first.
        if (presetId && canGenerate) {
          await generateAudio(id, presetId);
          generation.refresh();
        }
      } catch (e) {
        // Already in the Library after all (e.g. just added from the Library
        // page): the error says which one, so that one is used.
        id ??= e.detail?.document_id;
        if (e.detail?.document_id == null) setError(e.message);
      } finally {
        setAddingNext(false);
      }
      if (id == null) return;
      setDoc((d) => ({ ...d, next_document_id: id }));
    }
    if (open) navigate(`/documents/${id}`);
  }

  async function handleMove(target) {
    await moveDocuments([doc.id], target.id);
    setDoc((d) => ({
      ...d,
      collection_id: target.id,
      collection_name: target.name,
    }));
    setMoving(false);
  }

  function backToCurrent() {
    setFollowing(true);
    const chunkEl = chunkRefs.current[activeIndex];
    if (!chunkEl) return;
    const y = readingY(chunkEl, offset, chunkLength(timeline, activeIndex));
    window.scrollBy({
      top: y - window.innerHeight * FOLLOW_AT,
      behavior: "smooth",
    });
  }

  // Deletes this voice's audio for this document (only offered when it
  // isn't generating). Other voices' audio and the saved position are kept.
  async function handleDeleteAudio() {
    const confirmed = await confirm({
      title: "Delete audio?",
      message: `All of this article's audio made with "${preset.name}" will be deleted. Your listening position is kept.`,
      confirmLabel: "Delete audio",
    });
    if (!confirmed) return;
    setError("");
    try {
      if (sameSession) {
        setProgress({
          chunk_index: player.index,
          offset_sec: player.offset,
          finished: player.finished,
        });
        player.close();
      }
      // Cleared so the player isn't reloaded from the old status meanwhile.
      setStatus(null);
      await deleteDocumentAudio(documentId, presetId);
      setPollKey((k) => k + 1);
      // If this was the last article waiting, generation is no longer paused.
      generation.refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleRegenerateOutdated() {
    setError("");
    try {
      await regenerateOutdated(documentId, presetId);
      setPollKey((k) => k + 1);
      generation.refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  function fixPronunciation() {
    // Drop punctuation around the selection, e.g. quotes or a trailing comma.
    const word = selectionPopup.text.replace(
      /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,
      "",
    );
    prefillCountRef.current += 1;
    setPanel({ prefill: { word, n: prefillCountRef.current } });
    window.getSelection().removeAllRanges();
    setSelectionPopup(null);
  }

  function playFromSelection() {
    const { chunkIndex, wordIndex } = selectionPopup;
    const wordTimes = status.chunks[chunkIndex].word_times;
    // Without word timings, the best available is the start of the chunk.
    play(chunkIndex, wordTimes ? wordTimes[wordIndex] : 0);
    window.getSelection().removeAllRanges();
    setSelectionPopup(null);
  }

  function play(index, offset = 0) {
    setFollowing(true);
    // What's being listened to should generate before other documents.
    if (status?.queue_position > 0) handleGenerate(true);
    if (sameSession) {
      player.jumpTo(index, offset);
      return;
    }
    player.start(
      playerSession(doc, presetId),
      readyAudio(status),
      index,
      speedFor(presetId, preset.speed),
      offset,
    );
  }

  // Continues from the saved position, or starts over if it was finished.
  function resume() {
    if (progress.finished) play(0, 0);
    else play(progress.chunk_index, progress.offset_sec);
  }

  const listenAgain = (
    <button
      onClick={() => play(0, 0)}
      className="rounded bg-black px-4 py-2 text-white"
    >
      Listen again
    </button>
  );

  return (
    // The extra bottom space keeps the floating button above the player bar
    // from covering the last line.
    <article className="pb-16">
      <h1 className="text-3xl font-semibold">{doc.title}</h1>
      <a
        href={doc.source_url}
        target="_blank"
        rel="noreferrer"
        className="mt-1 block truncate text-sm text-gray-500 hover:underline"
      >
        {doc.source_url}
      </a>
      <p className="mt-1 text-sm text-gray-500">
        In{" "}
        <Link to={libraryPath} className="hover:underline">
          {collectionName}
        </Link>{" "}
        ·{" "}
        <button onClick={() => setMoving(true)} className="hover:text-black">
          Move
        </button>
      </p>
      {moving && (
        <MoveDialog
          count={1}
          currentId={doc.collection_id}
          onMove={handleMove}
          onClose={() => setMoving(false)}
        />
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <VoicePicker
          voices={voices}
          value={presetId}
          onChange={handleVoiceChange}
          recent={prefs.recent_voices}
          engines={engines}
        />

        {isReady(0) &&
          (finished ? (
            <>
              <span className="text-sm text-gray-500">✓ Finished</span>
              {listenAgain}
            </>
          ) : sameSession ? (
            <button
              onClick={player.toggle}
              className="rounded bg-black px-4 py-2 text-white"
            >
              {player.playing ? "Pause" : "Play"}
            </button>
          ) : (
            <button
              onClick={resume}
              className="rounded bg-black px-4 py-2 text-white"
            >
              Play
            </button>
          ))}

        {status && !allReady && !status.generating && canGenerate && (
          <button
            onClick={() => handleGenerate()}
            className="rounded border border-gray-300 px-4 py-2"
          >
            {readyChunks.length ? "Generate remaining audio" : "Generate audio"}
          </button>
        )}

        {/* The queue panel has the controls (reorder, pause, remove), so
            the status opens it. */}
        {status?.generating && (
          <button
            onClick={() => generation.openQueue(queueKey(documentId, presetId))}
            title="Open the generation queue, with this article selected"
            data-queue-toggle
            className="text-sm text-gray-500 underline decoration-gray-300 underline-offset-2 hover:text-black hover:decoration-black"
          >
            {generation.paused
              ? "Generation paused: "
              : status.queue_position > 0
                ? `Queued: ${status.queue_position} ${status.queue_position === 1 ? "article" : "articles"} ahead. `
                : "Generating audio: "}
            {readyChunks.length} of {status.chunks.length} sections ready
          </button>
        )}

        {/* While generating, it's removed from the queue panel instead. */}
        {!status?.generating && readyChunks.length > 0 && (
          <button
            onClick={handleDeleteAudio}
            className="text-sm text-gray-500 hover:text-red-600"
          >
            Delete audio
          </button>
        )}

        {/* Only pages with a next part (e.g. a novel's chapters) have one. */}
        {doc.next_url &&
          (doc.next_document_id ? (
            <Link
              to={`/documents/${doc.next_document_id}`}
              className="text-sm text-gray-500 hover:underline"
            >
              Open next part →
            </Link>
          ) : (
            <button
              onClick={() => handleNextPart(false)}
              disabled={addingNext}
              title="Adds it to this collection and starts generating its audio"
              className="text-sm text-gray-500 hover:underline disabled:opacity-50"
            >
              {addingNext ? "Adding next part..." : "Add next part"}
            </button>
          ))}
      </div>

      {status && !allReady && (
        <div className="mt-3">
          <EngineNotice
            status={engineStatus}
            checking={engines.checking}
            onRecheck={engines.recheck}
          />
        </div>
      )}

      {outdatedCount > 0 && !status.generating && (
        <p className="mt-3 text-sm text-amber-700">
          {outdatedCount}{" "}
          {outdatedCount === 1 ? "section uses" : "sections use"} an older
          pronunciation.{" "}
          <button
            onClick={handleRegenerateOutdated}
            className="font-medium underline hover:text-black"
          >
            Regenerate {outdatedCount === 1 ? "it" : "them"}
          </button>
        </p>
      )}

      {/* Only set when something went wrong and is being fixed, e.g. Qwen
          restarting after running out of GPU memory. */}
      {status?.notice && (
        <p className="mt-3 text-sm text-amber-700">{status.notice}</p>
      )}

      {(error || status?.error) && (
        <p className="mt-3 text-red-600">{error || status.error}</p>
      )}

      <div
        ref={textRef}
        className="mt-8 space-y-4"
        style={{
          fontFamily: FONTS[prefs.font].family,
          fontSize: `${prefs.font_size}px`,
          lineHeight: 1.8,
          textAlign: prefs.align,
          // The browser's English hyphenation rules (from <html lang="en">).
          hyphens: prefs.hyphenate ? "auto" : "manual",
          // See-through tints used by the highlights (see ChunkText).
          "--highlight-word": `rgb(${HIGHLIGHT_COLORS[prefs.highlight_color]} / 0.4)`,
          "--highlight-chunk": `rgb(${HIGHLIGHT_COLORS[prefs.highlight_color]} / 0.15)`,
        }}
      >
        {doc.chunks.map((chunk) => (
          <div
            key={chunk.id}
            ref={(el) => (chunkRefs.current[chunk.index] = el)}
            data-chunk={chunk.index}
            className={`space-y-4 rounded p-2 ${
              activeIndex === chunk.index &&
              !activeWordTimes &&
              prefs.highlight_words
                ? "bg-(--highlight-chunk)"
                : ""
            }`}
          >
            <ChunkText
              paragraphs={chunk.paragraphs}
              currentWord={activeIndex === chunk.index ? currentWord : -1}
              highlight={prefs.highlight_words}
            />
          </div>
        ))}
      </div>

      {selectionPopup && (
        <div
          // Clicking would normally clear the selection before the click
          // registers; preventing the mousedown keeps it.
          onMouseDown={(e) => e.preventDefault()}
          style={{ top: selectionPopup.top, left: selectionPopup.left }}
          className="absolute z-10 -mt-2 flex -translate-x-1/2 -translate-y-full gap-2"
        >
          {isReady(selectionPopup.chunkIndex) && (
            <button
              onClick={playFromSelection}
              className="rounded-full bg-black px-3 py-1.5 text-sm whitespace-nowrap text-white shadow-lg"
            >
              ▶ Play from here
            </button>
          )}
          <button
            onClick={fixPronunciation}
            className="rounded-full bg-black px-3 py-1.5 text-sm whitespace-nowrap text-white shadow-lg"
          >
            Fix pronunciation
          </button>
        </div>
      )}

      {panel && (
        <PreferencesPanel
          // A new prefill reopens the panel on the Pronunciations tab.
          key={panel.prefill?.n ?? 0}
          onClose={closePanel}
          prefill={panel.prefill}
          voice={preset}
          onPronunciationsChange={() => setPollKey((k) => k + 1)}
        />
      )}

      {/* Floats above the player bar. Once finished, "Back to current"
          would only lead to the last word, so Listen again takes its place,
          visible wherever the page is scrolled. */}
      {finished && isReady(0) ? (
        <div className="fixed bottom-28 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-black py-1.5 pr-1.5 pl-4 text-sm text-white shadow-lg">
          ✓ Finished
          {/* With a next part, that's the main button and this one is quieter. */}
          <button
            onClick={() => play(0, 0)}
            className={`rounded-full px-3 py-1 ${doc.next_url ? "border border-white/40 hover:bg-white/15" : "bg-white text-black"}`}
          >
            Listen again
          </button>
          {doc.next_url && (
            <button
              onClick={() => handleNextPart(true)}
              disabled={addingNext}
              className="rounded-full bg-white px-3 py-1 text-black disabled:opacity-50"
            >
              {addingNext ? "Adding..." : "Next part →"}
            </button>
          )}
        </div>
      ) : (
        sameSession &&
        !following && (
          <button
            onClick={backToCurrent}
            className="fixed bottom-28 left-1/2 -translate-x-1/2 rounded-full bg-black px-4 py-2 text-sm text-white shadow-lg"
          >
            Back to current
          </button>
        )
      )}
    </article>
  );
}
