import { createContext, useContext } from "react";

export const ConfirmContext = createContext(null);

// Returns confirm({ title, message, confirmLabel, cancelLabel }), which
// shows the confirmation dialog and resolves to true (confirmed) or false.
export const useConfirm = () => useContext(ConfirmContext);
