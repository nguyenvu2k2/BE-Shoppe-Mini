/**
 * Shared S3 upload rules — used by FileService (key/ACL) and FileController (validate).
 * Keep policy here so every upload path shares the same limits.
 */

/** Prefix folders inside the bucket (key = `{folder}/{uuid}.ext`) */
export const S3_FOLDERS = {
  AVATARS: 'avatars',
  CATEGORIES: 'categories',
  PRODUCTS: 'products',
  TEMP: 'temp',
} as const;

export type S3Folder = (typeof S3_FOLDERS)[keyof typeof S3_FOLDERS];

export const S3_ALLOWED_FOLDERS: readonly S3Folder[] = Object.values(S3_FOLDERS);

/** MIME types accepted for image upload */
export const S3_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

export type S3AllowedMimeType = (typeof S3_ALLOWED_MIME_TYPES)[number];

/** MIME → file extension when building the object key */
export const S3_MIME_TO_EXT: Record<S3AllowedMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** Max upload size (bytes). Multer + service both enforce this. */
export const S3_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
