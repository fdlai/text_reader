export const ENGINE_NAMES = {
  kokoro: "Kokoro",
  qwen: "Qwen",
  openai: "OpenAI",
};

// Voices of one engine, in the order menus show them: Kokoro voices stay
// grouped by accent and gender (their ids sort that way), the user's own
// voices are sorted by name.
export function sortVoices(voices, engine) {
  return voices
    .filter((v) => v.engine === engine)
    .sort((a, b) =>
      engine === "kokoro"
        ? a.base_voice.localeCompare(b.base_voice)
        : a.name.localeCompare(b.name),
    );
}

// The voice new articles start with: the chosen default voice, or Michael
// (a free voice every install has) if it was deleted or none was chosen.
export function defaultVoiceId(voices, chosenId) {
  return (
    [chosenId, voices.find((v) => v.base_voice === "am_michael")?.id].find(
      (id) => voices.some((v) => v.id === id),
    ) ??
    voices[0]?.id ??
    null
  );
}

// Kokoro voice ids start with accent and gender: "bf_emma" is a British
// female voice.
const ACCENTS = { a: "American", b: "British" };
const GENDERS = { f: "female", m: "male" };
export const kokoroDetail = (id) =>
  `${ACCENTS[id[0]] ?? ""} · ${GENDERS[id[1]] ?? ""}`;
