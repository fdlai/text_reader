import { Link, Route, Routes, useMatch } from "react-router-dom";
import PlayerBar from "./components/PlayerBar";
import { PlayerProvider } from "./context/PlayerContext";
import { PAGE_WIDTHS, usePreferences } from "./context/preferences";
import Library from "./pages/Library";
import Reader from "./pages/Reader";
import Voices from "./pages/Voices";

export default function App() {
  const { prefs } = usePreferences();
  // Only the reading page follows the Page width setting; the others
  // stay at a comfortable width for lists and forms.
  const reading = useMatch("/documents/:id");
  const width = reading ? PAGE_WIDTHS[prefs.page_width].className : "max-w-2xl";

  return (
    <PlayerProvider>
      <main className={`mx-auto ${width} p-8 pb-32`}>
        <nav className="mb-8 flex gap-4 text-sm text-gray-600">
          <Link to="/" className="hover:text-black">
            Library
          </Link>
          <Link to="/voices" className="hover:text-black">
            Voices
          </Link>
        </nav>
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/documents/:id" element={<Reader />} />
          <Route path="/voices" element={<Voices />} />
        </Routes>
      </main>
      <PlayerBar />
    </PlayerProvider>
  );
}
