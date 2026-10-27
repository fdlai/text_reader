import { Link, Route, Routes } from "react-router-dom";
import PlayerBar from "./components/PlayerBar";
import { PlayerProvider } from "./context/PlayerContext";
import Library from "./pages/Library";
import Reader from "./pages/Reader";
import Voices from "./pages/Voices";

export default function App() {
  return (
    <PlayerProvider>
      <main className="mx-auto max-w-2xl p-8 pb-32">
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
