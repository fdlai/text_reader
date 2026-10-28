// Explains why an engine can't generate (e.g. Docker Desktop isn't
// running), with a button to check again once it's fixed. Shows nothing
// while the engine is available or its status is still loading.
export default function EngineNotice({ status, checking, onRecheck }) {
  if (!status || status.available) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <span>{status.reason}</span>
      <button
        type="button"
        onClick={onRecheck}
        disabled={checking}
        className="font-medium underline hover:text-black disabled:opacity-50"
      >
        {checking ? "Checking..." : "Check again"}
      </button>
    </div>
  );
}
