export const DEFAULT_AVATAR_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_AVATAR_MAX_DIMENSION = 512;
export const DEFAULT_AVATAR_OUTPUT_MAX_BYTES = 512 * 1024;

/** Browser file pickers sometimes omit a MIME type for screenshots. Keep the
 * extension fallback explicit and injectable so callers may narrow it if needed. */
export const DEFAULT_IMAGE_EXTENSIONS = [
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "heic", "heif", "tif", "tiff",
] as const;

type AvatarReadOptions = {
  maxBytes?: number;
  imageExtensions?: readonly string[];
};

export const isImageFile = (
  file: Pick<File, "name" | "type">,
  imageExtensions: readonly string[] = DEFAULT_IMAGE_EXTENSIONS,
): boolean => {
  if (file.type.toLowerCase().startsWith("image/")) return true;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return imageExtensions.some((candidate) => candidate.toLowerCase() === extension);
};

export async function readAvatarFile(
  file: File,
  read: (file: File) => Promise<string>,
  { maxBytes = DEFAULT_AVATAR_MAX_BYTES, imageExtensions = DEFAULT_IMAGE_EXTENSIONS }: AvatarReadOptions = {},
): Promise<string> {
  if (!isImageFile(file, imageExtensions)) throw new Error("Choose an image for the profile picture.");
  if (file.size > maxBytes) throw new Error(`Profile picture exceeds the ${maxBytes} byte upload limit.`);
  return read(file);
}

export const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read profile picture."));
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("Could not read profile picture."));
    reader.readAsDataURL(file);
  });

export type AvatarCompressionOptions = {
  maxDimension?: number;
  maxOutputBytes?: number;
  mimeType?: string;
  quality?: number;
};

export const constrainedAvatarDimensions = (
  width: number,
  height: number,
  maxDimension = DEFAULT_AVATAR_MAX_DIMENSION,
): { width: number; height: number } => {
  const largest = Math.max(width, height, 1);
  const scale = Math.min(1, maxDimension / largest);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
};

const dataUrlBytes = (value: string) => {
  const base64 = value.split(",", 2)[1] ?? "";
  return Math.floor(base64.length * 3 / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
};

const loadImage = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error("Could not decode profile picture."));
  image.src = src;
});

/** Rasterise and bound profile images before persisting their data URL. */
export async function compressAvatarDataUrl(
  source: string,
  {
    maxDimension = DEFAULT_AVATAR_MAX_DIMENSION,
    maxOutputBytes = DEFAULT_AVATAR_OUTPUT_MAX_BYTES,
    mimeType = "image/webp",
    quality = 0.82,
  }: AvatarCompressionOptions = {},
): Promise<string> {
  const image = await loadImage(source);
  let dimensions = constrainedAvatarDimensions(image.naturalWidth || image.width, image.naturalHeight || image.height, maxDimension);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Profile picture compression is unavailable.");
  while (true) {
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    context.drawImage(image, 0, 0, dimensions.width, dimensions.height);
    const result = canvas.toDataURL(mimeType, quality);
    if (dataUrlBytes(result) <= maxOutputBytes) return result;
    if (dimensions.width === 1 && dimensions.height === 1) break;
    dimensions = constrainedAvatarDimensions(
      Math.max(1, Math.floor(dimensions.width * 0.8)),
      Math.max(1, Math.floor(dimensions.height * 0.8)),
      maxDimension,
    );
  }
  throw new Error(`Profile picture remains larger than the ${maxOutputBytes} byte limit after compression.`);
}
