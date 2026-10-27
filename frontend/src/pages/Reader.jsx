import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  generateAudio,
  getAudioStatus,
  getDocument,
  getProgress,
  listVoices,
  regenerateOutdated,
} from "../api";
import ChunkText from "../components/ChunkText";
import PreferencesPanel from "../components/PreferencesPanel";
import { usePlayer } from "../context/PlayerContext";
import { chunkLength, wordIndexAt } from "../timeline";

const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
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
  const { updateChunkAudio } = player;
  const [doc, setDoc] = useState(null);
  const [voices, setVoices] = useState([]);
  const [presetId, setPresetId] = useState(
    () => Number(localStorage.getItem("voicePresetId")) || null,
  );
  const [status, setStatus] = useState(null);
  const [progress, setProgress] = useState(null); // where listening left off
  const [pollKey, setPollKey] = useState(0);
  const [error, setError] = useState("");
  // When true, the page scrolls to keep the text being read on screen.
  const [following, setFollowing] = useState(true);
  // { chunkIndex, wordIndex, text, top, left } while text is selected.
  const [selectionPopup, setSelectionPopup] = useState(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  // { word, n } to fill in on the Pronunciations tab ("Fix pronunciation").
  const [pronunciationPrefill, setPronunciationPrefill] = useState(null);
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
        if (s.generating) timer = setTimeout(poll, 2000);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    }
    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [documentId, presetId, pollKey, updateChunkAudio]);

  const sameSession =
    player.session?.documentId === documentId &&
    player.session?.presetId === presetId;
  const activeIndex = sameSession ? player.index : -1;

  // On opening a document, load it into the player paused at the saved
  // position, so the progress bar shows where listening left off. Skipped
  // if something is playing, so opening a page never interrupts it.
  const { start } = player;
  useEffect(() => {
    const preset = voices.find((v) => v.id === presetId);
    const hasAudio = status?.chunks.some((c) => c.ready);
    if (!doc || !progress || !preset || !hasAudio) return;
    if (player.playing || sameSession) return;
    start(
      playerSession(doc, presetId),
      readyAudio(status),
      progress.chunk_index,
      preset.speed,
      progress.offset_sec,
      false,
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
          text: selection
            .toString()
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 100),
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
  const readyChunks = status?.chunks.filter((c) => c.ready) ?? [];
  const allReady = status && readyChunks.length === status.chunks.length;
  const isReady = (index) => status?.chunks[index]?.ready;
  const outdatedCount = status?.chunks.filter((c) => c.outdated).length ?? 0;
  // Audio made before word timings existed (or whose timings failed) has
  // none; that chunk is then highlighted as a whole instead.
  const activeWordTimes =
    activeIndex >= 0 ? status?.chunks[activeIndex]?.word_times : null;
  const currentWord = activeWordTimes
    ? wordIndexAt(activeWordTimes, offset)
    : -1;

  function handlePresetChange(e) {
    const value = Number(e.target.value);
    // Keep the listening position when switching to another voice.
    if (sameSession) {
      setProgress({ chunk_index: player.index, offset_sec: player.offset });
    }
    localStorage.setItem("voicePresetId", value);
    setStatus(null);
    setPresetId(value);
  }

  async function handleGenerate() {
    setError("");
    try {
      await generateAudio(documentId, presetId);
      setPollKey((k) => k + 1);
    } catch (e) {
      setError(e.message);
    }
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

  async function handleRegenerateOutdated() {
    setError("");
    try {
      await regenerateOutdated(documentId, presetId);
      setPollKey((k) => k + 1);
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
    // n counts prefills, so fixing the same word twice still starts fresh.
    setPronunciationPrefill((p) => ({ word, n: (p?.n ?? 0) + 1 }));
    setPrefsOpen(true);
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
    if (sameSession) {
      player.jumpTo(index, offset);
      return;
    }
    player.start(
      playerSession(doc, presetId),
      readyAudio(status),
      index,
      preset.speed,
      offset,
    );
  }

  return (
    <article>
      <div className="flex items-center justify-between">
        <Link to="/" className="text-sm text-gray-500 hover:underline">
          &larr; Library
        </Link>
        <button
          onClick={() => setPrefsOpen(true)}
          className="text-sm text-gray-500 hover:text-black"
        >
          ⚙ Preferences
        </button>
      </div>
      <h1 className="mt-4 text-3xl font-semibold">{doc.title}</h1>
      <a
        href={doc.source_url}
        target="_blank"
        rel="noreferrer"
        className="mt-1 block truncate text-sm text-gray-500 hover:underline"
      >
        {doc.source_url}
      </a>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <select
          value={presetId ?? ""}
          onChange={handlePresetChange}
          className="rounded border border-gray-300 px-2 py-2"
        >
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} ({v.engine === "kokoro" ? "Free" : "OpenAI"})
            </option>
          ))}
        </select>

        {isReady(0) &&
          (sameSession ? (
            <button
              onClick={player.toggle}
              className="rounded bg-black px-4 py-2 text-white"
            >
              {player.playing ? "Pause" : "Play"}
            </button>
          ) : (
            <button
              onClick={() => play(progress.chunk_index, progress.offset_sec)}
              className="rounded bg-black px-4 py-2 text-white"
            >
              Play
            </button>
          ))}

        {status && !allReady && !status.generating && (
          <button
            onClick={handleGenerate}
            className="rounded border border-gray-300 px-4 py-2"
          >
            {readyChunks.length ? "Generate remaining audio" : "Generate audio"}
          </button>
        )}

        {status?.generating && (
          <span className="text-sm text-gray-500">
            Generating audio: {readyChunks.length} of {status.chunks.length}{" "}
            sections ready
          </span>
        )}

        <Link to="/voices" className="text-sm text-gray-500 hover:underline">
          Manage voices
        </Link>
      </div>

      {outdatedCount > 0 && !status.generating && (
        <p className="mt-3 text-sm text-amber-700">
          {outdatedCount} {outdatedCount === 1 ? "section uses" : "sections use"}{" "}
          an older pronunciation.{" "}
          <button
            onClick={handleRegenerateOutdated}
            className="font-medium underline hover:text-black"
          >
            Regenerate {outdatedCount === 1 ? "it" : "them"}
          </button>
        </p>
      )}

      {(error || status?.error) && (
        <p className="mt-3 text-red-600">{error || status.error}</p>
      )}

      <div ref={textRef} className="mt-8 space-y-4 leading-8">
        {doc.chunks.map((chunk) => (
          <div
            key={chunk.id}
            ref={(el) => (chunkRefs.current[chunk.index] = el)}
            data-chunk={chunk.index}
            className={`space-y-4 rounded p-2 ${
              activeIndex === chunk.index && !activeWordTimes
                ? "bg-yellow-100"
                : ""
            }`}
          >
            <ChunkText
              paragraphs={chunk.paragraphs}
              currentWord={activeIndex === chunk.index ? currentWord : -1}
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

      {prefsOpen && (
        <PreferencesPanel
          onClose={() => setPrefsOpen(false)}
          prefill={pronunciationPrefill}
          voice={preset}
          onPronunciationsChange={() => setPollKey((k) => k + 1)}
        />
      )}

      {sameSession && !following && (
        <button
          onClick={backToCurrent}
          className="fixed bottom-28 left-1/2 -translate-x-1/2 rounded-full bg-black px-4 py-2 text-sm text-white shadow-lg"
        >
          Back to current
        </button>
      )}
    </article>
  );
}
