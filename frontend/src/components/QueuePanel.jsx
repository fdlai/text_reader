import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteDocumentAudio } from "../api";
import { useConfirm } from "../context/confirm";
import { queueKey, useGeneration } from "../context/generation";
import { usePlayer } from "../context/PlayerContext";
import { ENGINE_NAMES } from "../engines";
import Cover from "./Cover";

const keyOf = (item) => queueKey(item.document_id, item.voice_preset_id);

// Icons are drawn with lines in the text color, so they follow the theme.
function Icon({ children }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// A toolbar button: an icon with a short label under it. title gives the
// longer description on hover.
function ToolButton({ label, title, onClick, disabled, danger, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex flex-1 flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] font-medium hover:bg-white disabled:opacity-35 disabled:hover:bg-transparent ${
        danger ? "text-red-600" : ""
      }`}
    >
      <Icon>{children}</Icon>
      {label}
    </button>
  );
}

// The list of articles waiting for audio, in the order they'll be made.
// Select one, then use the toolbar to move it or remove it. Keys: ↑/↓
// select, Alt+↑/↓ move, Delete removes, Escape closes.
export default function QueuePanel() {
  const generation = useGeneration();
  const { items, paused, closeQueue, move, refresh } = generation;
  const { selectedKey, setSelectedKey } = generation;
  const player = usePlayer();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const ref = useRef(null);

  // The selection follows the article as it moves. Once it's no longer
  // queued (finished or removed), nothing is selected.
  const index = items.findIndex((item) => keyOf(item) === selectedKey);
  const selected = index >= 0 ? items[index] : null;

  // Keeps the selected row in view, e.g. after moving it with the keyboard.
  useEffect(() => {
    if (!selectedKey) return;
    ref.current
      .querySelector(`[data-queue-key="${selectedKey}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedKey, index]);

  async function run(action) {
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e.message);
    }
  }

  const moveSelected = (to) =>
    selected &&
    run(() => move(selected.document_id, selected.voice_preset_id, to));

  // Like the Reader's Cancel: stops generating it and deletes the audio
  // already made with that voice.
  async function removeSelected() {
    if (!selected) return;
    const { document_id, voice_preset_id, title, voice_name, ready } = selected;
    const sections = `${ready} ${ready === 1 ? "section" : "sections"}`;
    const confirmed = await confirm({
      title: "Remove from queue?",
      message:
        ready > 0
          ? `Generating "${title}" stops, and the ${sections} already made with "${voice_name}" will be deleted.`
          : `Generating "${title}" with "${voice_name}" stops.`,
      confirmLabel: "Remove",
      cancelLabel: "Keep it",
    });
    if (!confirmed) return;
    run(async () => {
      // Its audio is about to disappear, so stop playing it (saving the
      // position first, as the Reader does).
      if (
        player.session?.documentId === document_id &&
        player.session?.presetId === voice_preset_id
      ) {
        player.close();
      }
      await deleteDocumentAudio(document_id, voice_preset_id);
      setSelectedKey(null);
      await refresh();
    });
  }

  function openSelected() {
    if (!selected) return;
    closeQueue();
    navigate(`/documents/${selected.document_id}`);
  }

  // Kept in a ref (refreshed after every render) so the listeners below are
  // added once but always see the current state.
  const handlersRef = useRef(null);
  useEffect(() => {
    handlersRef.current = {
      selectBy(step) {
        if (!items.length) return;
        const next =
          index < 0
            ? step > 0
              ? 0
              : items.length - 1
            : Math.min(items.length - 1, Math.max(0, index + step));
        setSelectedKey(keyOf(items[next]));
      },
      moveSelected,
      removeSelected,
    };
  });

  // Close when clicking outside the panel, as Preferences does (the player
  // bar, the header's queue button and popups don't count), and handle the
  // keys while it's open. Ignored while typing in a box or with a popup open.
  useEffect(() => {
    function handlePointerDown(e) {
      if (e.target.closest("dialog")) return;
      if (
        !ref.current.contains(e.target) &&
        !e.target.closest("[data-player-bar], [data-queue-toggle]")
      ) {
        closeQueue();
      }
    }
    function handleKey(e) {
      if (
        e.target.closest("input, select, textarea, [contenteditable], dialog")
      )
        return;
      const h = handlersRef.current;
      if (e.key === "Escape") closeQueue();
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault(); // otherwise the page scrolls too
        const up = e.key === "ArrowUp";
        if (e.altKey) h.moveSelected(up ? "up" : "down");
        else h.selectBy(up ? -1 : 1);
      } else if (e.key === "Delete") h.removeSelected();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [closeQueue]);

  const n = items.length;

  return (
    <aside
      ref={ref}
      className="fixed inset-y-0 right-0 z-30 flex w-full max-w-sm flex-col border-l border-gray-200 bg-white shadow-xl"
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div>
          <h2 className="text-xl font-semibold">Generation queue</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            {n} {n === 1 ? "article" : "articles"} ·{" "}
            {paused ? "paused" : n ? "generating" : "nothing waiting"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Queue-wide, so it's up here rather than in the toolbar, which
              acts on the selected article. */}
          {n > 0 && (
            <button
              onClick={() =>
                run(paused ? generation.resume : generation.confirmPause)
              }
              title={
                paused
                  ? "Resume: continue generating where it left off"
                  : "Pause all: stop all generation and free up the GPU"
              }
              className="flex flex-col items-center gap-0.5 rounded-lg border border-gray-300 px-2.5 py-1.5 text-[11px] font-medium hover:border-black"
            >
              {paused ? (
                <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
                  <path
                    d="M4 2.5v11a.5.5 0 0 0 .76.43l9-5.5a.5.5 0 0 0 0-.86l-9-5.5A.5.5 0 0 0 4 2.5Z"
                    fill="currentColor"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
                  <rect
                    x="3.5"
                    y="2.5"
                    width="3"
                    height="11"
                    rx="1"
                    fill="currentColor"
                  />
                  <rect
                    x="9.5"
                    y="2.5"
                    width="3"
                    height="11"
                    rx="1"
                    fill="currentColor"
                  />
                </svg>
              )}
              {paused ? "Resume" : "Pause all"}
            </button>
          )}
          <button
            onClick={closeQueue}
            aria-label="Close queue"
            className="text-2xl leading-none text-gray-500 hover:text-black"
          >
            ×
          </button>
        </div>
      </div>

      <div className="mx-5 mt-4 flex gap-1 rounded-xl bg-gray-100 p-1.5">
        <ToolButton
          label="To top"
          title="Move to top: generate it next (Alt+↑ moves up one)"
          onClick={() => moveSelected("top")}
          disabled={index <= 0}
        >
          <path d="M5 4h14" />
          <path d="M12 20V9" />
          <path d="m7 13 5-5 5 5" />
        </ToolButton>
        <ToolButton
          label="Up"
          title="Move up one place (Alt+↑)"
          onClick={() => moveSelected("up")}
          disabled={index <= 0}
        >
          <path d="m6 15 6-6 6 6" />
        </ToolButton>
        <ToolButton
          label="Down"
          title="Move down one place (Alt+↓)"
          onClick={() => moveSelected("down")}
          disabled={index < 0 || index === n - 1}
        >
          <path d="m6 9 6 6 6-6" />
        </ToolButton>
        <ToolButton
          label="Open"
          title="Open the article"
          onClick={openSelected}
          disabled={!selected}
        >
          <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4z" />
          <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z" />
        </ToolButton>
        <ToolButton
          label="Remove"
          title="Remove: stop generating it and delete its audio for this voice (Delete)"
          onClick={removeSelected}
          disabled={!selected}
          danger
        >
          <path d="M4 7h16" />
          <path d="M9 7V4h6v3" />
          <path d="M6 7l1 13h10l1-13" />
          <path d="M10 11v5" />
          <path d="M14 11v5" />
        </ToolButton>
      </div>
      <p className="mx-5 mt-2 h-4 text-xs text-gray-500">
        {error ? (
          <span className="text-red-600">{error}</span>
        ) : (
          !selected && n > 0 && "Select an article, then choose an action."
        )}
      </p>

      <div className="flex-1 space-y-1 overflow-y-auto px-3 pt-2 pb-5">
        {items.map((item, i) => {
          const key = keyOf(item);
          const isSelected = key === selectedKey;
          const pct = item.total ? (item.ready / item.total) * 100 : 0;
          return (
            <button
              key={key}
              data-queue-key={key}
              onClick={() => setSelectedKey(isSelected ? null : key)}
              aria-pressed={isSelected}
              className={`flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left ${
                isSelected
                  ? "bg-gray-100 ring-[1.5px] ring-black"
                  : "hover:bg-gray-100"
              }`}
            >
              <Cover
                doc={{
                  id: item.document_id,
                  title: item.title,
                  has_cover: item.has_cover,
                }}
                size="h-13 w-10 text-lg"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                {/* Two lines before cutting off, so the end of a title
                    (e.g. a chapter number) usually shows; hovering shows
                    the rest of a longer one. */}
                <span
                  title={item.title}
                  className="line-clamp-2 text-sm font-medium"
                >
                  {item.title}
                </span>
                <span className="truncate text-xs text-gray-500">
                  {item.voice_name} · {ENGINE_NAMES[item.engine]}
                </span>
                <span className="flex gap-2 text-xs text-gray-600">
                  <span
                    className={`font-medium ${!paused && i === 0 ? "text-green-600" : ""}`}
                  >
                    {paused
                      ? "Paused"
                      : i === 0
                        ? "Generating now"
                        : i === 1
                          ? "Up next"
                          : "Waiting"}
                  </span>
                  {item.ready} of {item.total} sections
                </span>
                <span className="mt-0.5 h-1 overflow-hidden rounded-full bg-gray-200">
                  <span
                    className="block h-full bg-black"
                    style={{ width: `${pct}%` }}
                  />
                </span>
              </span>
            </button>
          );
        })}
        {n === 0 && (
          <div className="px-4 py-10 text-center text-sm text-gray-500">
            <p className="font-medium text-gray-600">
              Nothing is waiting for audio.
            </p>
            <p className="mt-1">
              Articles show up here while their audio is generated, and you can
              reorder or pause them.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
