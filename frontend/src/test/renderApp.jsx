import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../App";
import ConfirmProvider from "../context/ConfirmProvider";
import GenerationProvider from "../context/GenerationProvider";
import PreferencesProvider from "../context/PreferencesProvider";

// Renders the whole app (header, pages, player bar) at an address, with
// the same providers as main.jsx. The browser's address bar is replaced by
// one kept in memory. api.js must be faked in the test file (see fakeApi).
export function renderApp(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PreferencesProvider>
        <ConfirmProvider>
          <GenerationProvider>
            <App />
          </GenerationProvider>
        </ConfirmProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );
}
