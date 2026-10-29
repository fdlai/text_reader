import { useCallback, useEffect, useRef, useState } from "react";
import { voiceSampleUrl } from "./api";
import { usePlayer } from "./context/PlayerContext";

// Plays voices' sample clips (the ▶ buttons), one at a time. Starting one
// pauses the article, so the two don't talk over each other.
// previewing: { id, loading } for the voice being previewed, or null.
export function useSamplePlayer() {
  const [previewing, setPreviewing] = useState(null);
  const [error, setError] = useState("");
  const audioRef = useRef(null);
  const player = usePlayer();

  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPreviewing(null);
  }, []);

  // Stop when the page using it goes away.
  useEffect(() => () => audioRef.current?.pause(), []);

  async function toggle(voice) {
    if (previewing?.id === voice.id) {
      stop();
      return;
    }
    setError("");
    if (player.playing) player.toggle();
    audioRef.current?.pause();
    const audio = new Audio(voiceSampleUrl(voice.id));
    audioRef.current = audio;
    audio.onended = () => setPreviewing(null);
    setPreviewing({ id: voice.id, loading: true });
    try {
      // A voice's first preview may take a few seconds while its clip is made.
      await audio.play();
      if (audioRef.current === audio) {
        setPreviewing({ id: voice.id, loading: false });
      }
    } catch {
      if (audioRef.current !== audio) return; // another preview replaced it
      setPreviewing(null);
      // An <audio> element can't read the server's explanation (e.g. Docker
      // isn't running); the engine notices show those.
      setError(`Couldn't play a sample of "${voice.name}".`);
    }
  }

  return { previewing, error, toggle, stop };
}
