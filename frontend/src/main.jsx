import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import "./fonts.css";
import App from "./App.jsx";
import ConfirmProvider from "./context/ConfirmProvider";
import { applyTheme, cachedPreferences } from "./context/preferences";
import PreferencesProvider from "./context/PreferencesProvider";

// Before the first render, so the page never flashes in the wrong theme.
applyTheme(cachedPreferences().theme);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <PreferencesProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </PreferencesProvider>
    </BrowserRouter>
  </StrictMode>,
);
