export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;
export const AVATAR_ERROR = "Envie uma imagem PNG, JPG ou WebP de até 2 MB.";
