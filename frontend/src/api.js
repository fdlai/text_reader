async function request(path, options, parse = (r) => r.json()) {
  const response = await fetch(`/api${path}`, options);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail))
        message = body.detail[0]?.msg ?? message;
    } catch {
      // response had no JSON body
    }
    throw new Error(message);
  }
  return response.status === 204 ? null : parse(response);
}

const json = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const listDocuments = () => request("/documents");

export const getDocument = (id) => request(`/documents/${id}`);

export const createDocument = (url) =>
  request("/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

export const deleteDocument = (id) =>
  request(`/documents/${id}`, { method: "DELETE" });

export const getProgress = (id) => request(`/documents/${id}/progress`);

// keepalive lets the request finish even if the page is being closed.
export const saveProgress = (id, chunkIndex, offsetSec) =>
  request(`/documents/${id}/progress`, {
    ...json("PUT", { chunk_index: chunkIndex, offset_sec: offsetSec }),
    keepalive: true,
  });

export const listVoices = () => request("/voice-presets");

export const listEngineVoices = () => request("/voice-presets/voices");

export const createVoice = (voice) =>
  request("/voice-presets", json("POST", voice));

export const updateVoice = (id, voice) =>
  request(`/voice-presets/${id}`, json("PUT", voice));

export const deleteVoice = (id) =>
  request(`/voice-presets/${id}`, { method: "DELETE" });

export const previewVoice = (voice) =>
  request("/voice-presets/preview", json("POST", voice), (r) => r.blob());

export const generateAudio = (documentId, voicePresetId) =>
  request(
    `/documents/${documentId}/generate`,
    json("POST", { voice_preset_id: voicePresetId }),
  );

export const getAudioStatus = (documentId, voicePresetId) =>
  request(
    `/documents/${documentId}/audio-status?voice_preset_id=${voicePresetId}`,
  );

// audioId isn't used by the backend; it only makes the URL change when the
// audio is regenerated, so the browser doesn't play its cached old copy.
export const chunkAudioUrl = (chunkId, voicePresetId, audioId) =>
  `/api/chunks/${chunkId}/audio?voice_preset_id=${voicePresetId}&v=${audioId}`;

export const regenerateOutdated = (documentId, voicePresetId) =>
  request(
    `/documents/${documentId}/regenerate-outdated`,
    json("POST", { voice_preset_id: voicePresetId }),
  );

export const listPronunciations = () => request("/pronunciations");

export const createPronunciation = (entry) =>
  request("/pronunciations", json("POST", entry));

export const updatePronunciation = (id, entry) =>
  request(`/pronunciations/${id}`, json("PUT", entry));

export const deletePronunciation = (id) =>
  request(`/pronunciations/${id}`, { method: "DELETE" });
