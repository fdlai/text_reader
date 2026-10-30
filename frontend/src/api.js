async function request(path, options, parse = (r) => r.json()) {
  const response = await fetch(`/api${path}`, options);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let detail;
    try {
      const body = await response.json();
      detail = body.detail;
      if (typeof detail === "string") message = detail;
      else if (Array.isArray(detail)) message = detail[0]?.msg ?? message;
      // Some errors send extra information along with their message.
      else if (detail?.message) message = detail.message;
    } catch {
      // response had no JSON body
    }
    const error = new Error(message);
    error.detail = detail;
    throw error;
  }
  return response.status === 204 ? null : parse(response);
}

const json = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// Includes Unsorted (id null) last, if anything is in it.
export const listCollections = () => request("/collections");

export const getCollection = (id) => request(`/collections/${id}`);

export const createCollection = (name) =>
  request("/collections", json("POST", { name }));

export const renameCollection = (id, name) =>
  request(`/collections/${id}`, json("PATCH", { name }));

// Its articles move to Unsorted, unless deleteDocuments is true.
export const deleteCollection = (id, deleteDocuments) =>
  request(`/collections/${id}?delete_documents=${deleteDocuments}`, {
    method: "DELETE",
  });

// The documents in a collection; collectionId null means Unsorted.
export const listDocuments = (collectionId) =>
  request(
    collectionId === null
      ? "/documents?unsorted=true"
      : `/documents?collection_id=${collectionId}`,
  );

// The unfinished articles listened to most recently, from any collection.
export const listRecentDocuments = () => request("/documents/recent");

export const getDocument = (id) => request(`/documents/${id}`);

export const moveDocuments = (documentIds, collectionId) =>
  request(
    "/documents/move",
    json("POST", { document_ids: documentIds, collection_id: collectionId }),
  );

// If the page is already in the Library, fails with error.detail.document_id
// set to the copy that's there.
export const createDocument = (url, collectionId) =>
  request("/documents", json("POST", { url, collection_id: collectionId }));

export const deleteDocument = (id) =>
  request(`/documents/${id}`, { method: "DELETE" });

export const deleteDocuments = (ids) =>
  request("/documents/delete", json("POST", { document_ids: ids }));

export const getProgress = (id) => request(`/documents/${id}/progress`);

// keepalive lets the request finish even if the page is being closed.
export const saveProgress = (id, chunkIndex, offsetSec, finished) =>
  request(`/documents/${id}/progress`, {
    ...json("PUT", {
      chunk_index: chunkIndex,
      offset_sec: offsetSec,
      finished,
    }),
    keepalive: true,
  });

export const listVoices = () => request("/voice-presets");

export const listEngineVoices = () => request("/voice-presets/voices");

export const createVoice = (voice) =>
  request("/voice-presets", json("POST", voice));

export const updateVoice = (id, voice) =>
  request(`/voice-presets/${id}`, json("PUT", voice));

export const renameVoice = (id, name) =>
  request(`/voice-presets/${id}/name`, json("PATCH", { name }));

export const updateVoiceSpeed = (id, speed) =>
  request(`/voice-presets/${id}/speed`, json("PATCH", { speed }));

export const deleteVoice = (id) =>
  request(`/voice-presets/${id}`, { method: "DELETE" });

// A saved clip of the voice, made on first request (see the backend).
export const voiceSampleUrl = (id) => `/api/voice-presets/${id}/sample`;

export const coverUrl = (documentId) => `/api/documents/${documentId}/cover`;

// Without voice.text, the voice reads the standard sample text, so the
// clip can be saved as the voice's sample (see createVoice's sample_b64).
export const previewVoice = (voice) =>
  request("/voice-presets/preview", json("POST", voice), (r) => r.blob());

export const getPreferences = () => request("/preferences");

export const savePreferences = (prefs) =>
  request("/preferences", json("PUT", prefs));

export const getEngines = () => request("/engines");

export const listCustomVoices = () => request("/custom-voices");

// Returns a WAV sample of a new voice; nothing is saved until createCustomVoice.
export const designVoice = (description) =>
  request("/custom-voices/design", json("POST", { description }), (r) =>
    r.blob(),
  );

export const createCustomVoice = (voice) =>
  request("/custom-voices", json("POST", voice));

export const deleteCustomVoice = (id) =>
  request(`/custom-voices/${id}`, { method: "DELETE" });

export const customVoiceSampleUrl = (id) => `/api/custom-voices/${id}/sample`;

// Queues generation; with front=true the job goes ahead of other documents.
export const generateAudio = (documentId, voicePresetId, front = false) =>
  request(
    `/documents/${documentId}/generate`,
    json("POST", { voice_preset_id: voicePresetId, front }),
  );

export const getAudioStatus = (documentId, voicePresetId) =>
  request(
    `/documents/${documentId}/audio-status?voice_preset_id=${voicePresetId}`,
  );

// audioId isn't used by the backend; it only makes the URL change when the
// audio is regenerated, so the browser doesn't play its cached old copy.
export const chunkAudioUrl = (chunkId, voicePresetId, audioId) =>
  `/api/chunks/${chunkId}/audio?voice_preset_id=${voicePresetId}&v=${audioId}`;

// Cancels generation for this document and voice, and deletes its audio.
export const deleteDocumentAudio = (documentId, voicePresetId) =>
  request(`/documents/${documentId}/audio?voice_preset_id=${voicePresetId}`, {
    method: "DELETE",
  });

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
