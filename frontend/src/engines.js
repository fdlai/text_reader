export const ENGINE_NAMES = {
  kokoro: "Kokoro",
  qwen: "Qwen",
  openai: "OpenAI",
};

// Kokoro voice ids start with accent and gender: "bf_emma" is a British
// female voice.
const ACCENTS = { a: "American", b: "British" };
const GENDERS = { f: "female", m: "male" };
export const kokoroDetail = (id) =>
  `${ACCENTS[id[0]] ?? ""} · ${GENDERS[id[1]] ?? ""}`;
