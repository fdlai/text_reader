import { useCallback, useMemo, useState } from "react";
import { Route, Routes, useMatch, useParams } from "react-router-dom";
import Header from "./components/Header";
import PlayerBar from "./components/PlayerBar";
import PreferencesPanel from "./components/PreferencesPanel";
import { BreadcrumbContext } from "./context/breadcrumb";
import { PlayerProvider } from "./context/PlayerContext";
import { PAGE_WIDTHS, usePreferences } from "./context/preferences";
import Collection from "./pages/Collection";
import Home from "./pages/Home";
import Reader from "./pages/Reader";
import Voices from "./pages/Voices";

// Going straight from one article to another (e.g. "Next part") would
// otherwise reuse the Reader with the old article's state still in it. A new
// key makes it start fresh, as if opened from the Library. The same goes for
// collections.
function ReaderPage() {
  const { id } = useParams();
  return <Reader key={id} />;
}

function CollectionPage() {
  const { id } = useParams();
  return <Collection key={id} />;
}

export default function App() {
  const { prefs, panel, setPanel } = usePreferences();
  const closePanel = useCallback(() => setPanel(null), [setPanel]);
  // Only the reading page follows the Page width setting; the others
  // stay at a comfortable width for lists and forms, except the home page,
  // a little wider to fit three collection cards across.
  const reading = useMatch("/documents/:id");
  const home = useMatch("/");
  const width = reading
    ? PAGE_WIDTHS[prefs.page_width].className
    : home
      ? "max-w-3xl"
      : "max-w-2xl";
  // Set by the Reader, shown by the Header (see context/breadcrumb.js).
  const [breadcrumb, setBreadcrumb] = useState(null);
  const breadcrumbValue = useMemo(
    () => ({ breadcrumb, setBreadcrumb }),
    [breadcrumb],
  );

  return (
    <PlayerProvider>
      <BreadcrumbContext.Provider value={breadcrumbValue}>
        <Header />
        <main className={`mx-auto ${width} p-8 pb-32`}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/collections/:id" element={<CollectionPage />} />
            <Route path="/documents/:id" element={<ReaderPage />} />
            <Route path="/voices" element={<Voices />} />
          </Routes>
        </main>
        {/* The Reader shows its own, which knows the voice being used. */}
        {panel && !reading && (
          <PreferencesPanel key={panel.prefill?.n ?? 0} onClose={closePanel} />
        )}
      </BreadcrumbContext.Provider>
      <PlayerBar />
    </PlayerProvider>
  );
}
