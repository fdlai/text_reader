// What the last edit of an article changed, passed from the editor to the
// Reader, which shows it once ("Text updated: 2 sections changed").
// { documentId, changed, first_changed } or null.
let pending = null;

export function setEditNotice(documentId, result) {
  pending = { documentId, ...result };
}

// The notice for this article, if there is one. It's only shown once.
export function takeEditNotice(documentId) {
  if (pending?.documentId !== documentId) return null;
  const notice = pending;
  pending = null;
  return notice;
}
