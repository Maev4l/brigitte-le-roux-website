// Input validation + filename normalization. Each validator returns
// either { ok: true, value } or { ok: false, error }. The handler short-
// circuits on the first error with a 400 response.

// Folders Sveltia is allowed to write to. Anything else is rejected.
// Mirrors the on-disk layout under packages/website/public/.
const ALLOWED_FOLDERS = new Set([
  'pdfs',
  'pdfs/publications',
  'pdfs/livres',
  'pdfs/livres/Reviews',
  'img',
  'data',
]);

// Content-types Sveltia is allowed to upload.
const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
]);

// Size caps in bytes. Picked by content-type group.
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DATA_BYTES = 100 * 1024 * 1024;

// Filename pattern after normalization. Restrictive on purpose — anything
// with shell-special chars or non-ASCII is rejected at this gateway.
const FILENAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export const validateFolder = (folder) => {
  if (typeof folder !== 'string') return { ok: false, error: 'folder must be a string' };
  if (!ALLOWED_FOLDERS.has(folder)) {
    return { ok: false, error: `folder not in allowlist: ${folder}` };
  }
  return { ok: true, value: folder };
};

export const validateContentType = (contentType) => {
  if (typeof contentType !== 'string') return { ok: false, error: 'contentType must be a string' };
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return { ok: false, error: `contentType not in allowlist: ${contentType}` };
  }
  return { ok: true, value: contentType };
};

// Replaces whitespace runs with a single underscore, matching the
// project's existing convention (commit 6155f17). Trims surrounding ws.
export const normalizeFilename = (filename) => {
  if (typeof filename !== 'string') return null;
  return filename.trim().replace(/\s+/g, '_');
};

export const validateFilename = (filename) => {
  const normalized = normalizeFilename(filename);
  if (!normalized) return { ok: false, error: 'filename must be a non-empty string' };
  if (normalized.length > 255) return { ok: false, error: 'filename too long' };
  if (!FILENAME_PATTERN.test(normalized)) {
    return { ok: false, error: `filename has disallowed characters: ${normalized}` };
  }
  return { ok: true, value: normalized };
};

// Pick a size cap based on the content-type group.
const capForContentType = (contentType) => {
  if (contentType === 'application/pdf') return MAX_PDF_BYTES;
  if (contentType.startsWith('image/')) return MAX_IMAGE_BYTES;
  return MAX_DATA_BYTES;
};

export const validateSize = (size, contentType) => {
  if (!Number.isInteger(size) || size <= 0) {
    return { ok: false, error: 'size must be a positive integer' };
  }
  const cap = capForContentType(contentType);
  if (size > cap) {
    return { ok: false, error: `size ${size} exceeds cap ${cap} for ${contentType}` };
  }
  return { ok: true, value: size };
};
