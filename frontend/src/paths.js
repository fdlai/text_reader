// The page of a collection; id null is Unsorted.
export const collectionPath = (id) => `/collections/${id ?? "unsorted"}`;

// The page for typing or pasting in a new article.
export const newTextPath = (id) => `${collectionPath(id)}/new`;

// The page for editing an article's title and text.
export const editPath = (id) => `/documents/${id}/edit`;
