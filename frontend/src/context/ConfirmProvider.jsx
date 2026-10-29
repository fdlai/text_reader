import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmContext } from "./confirm";

// A styled replacement for the browser's confirm() popup, for actions that
// delete things. Used like confirm(), but awaited:
//   if (!(await confirm({ title: "Delete article?", message: "..." }))) return;
// It's a <dialog> opened with showModal(), so the browser dims the page,
// keeps keyboard focus inside the dialog, and turns Escape into "cancel".
export default function ConfirmProvider({ children }) {
  // The open request: { title, message, confirmLabel, cancelLabel, resolve },
  // or null while closed.
  const [request, setRequest] = useState(null);
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);

  const confirm = useCallback(
    ({ title, message, confirmLabel = "Delete", cancelLabel = "Cancel" }) =>
      new Promise((resolve) =>
        setRequest({ title, message, confirmLabel, cancelLabel, resolve }),
      ),
    [],
  );

  useEffect(() => {
    if (!request) return;
    dialogRef.current.showModal();
    // Cancel starts focused, so pressing Enter by habit doesn't delete.
    cancelRef.current.focus();
  }, [request]);

  function finish(confirmed) {
    request.resolve(confirmed);
    setRequest(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <dialog
          ref={dialogRef}
          // Escape: answer "no" rather than letting the browser just close it.
          onCancel={(e) => {
            e.preventDefault();
            finish(false);
          }}
          // Clicks on the dimmed area outside the box land on the <dialog>
          // itself; clicks inside land on the inner <div>.
          onClick={(e) => e.target === e.currentTarget && finish(false)}
          className="m-auto w-full max-w-md rounded-xl border border-gray-200 bg-white p-0 text-black shadow-2xl backdrop:bg-[rgb(0_0_0/0.5)]"
        >
          <div className="p-6">
            <h2 className="text-lg font-semibold">{request.title}</h2>
            <p className="mt-2 text-sm text-gray-600">{request.message}</p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                ref={cancelRef}
                onClick={() => finish(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-100"
              >
                {request.cancelLabel}
              </button>
              {/* Plain white text: the theme's "white" is dark in dark mode. */}
              <button
                onClick={() => finish(true)}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-[#fff] hover:bg-red-700"
              >
                {request.confirmLabel}
              </button>
            </div>
          </div>
        </dialog>
      )}
    </ConfirmContext.Provider>
  );
}
