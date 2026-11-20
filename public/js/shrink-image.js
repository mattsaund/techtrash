// Shrinks a blog upload to MAX_SIDE px on its longest side, as JPEG, or PNG if
// it has transparency. Re-encoding strips metadata like GPS location. GIFs pass
// through so animations keep working. Borrowed from tcc.place.

const MAX_SIDE = 1920;

// Keep in sync with server/blog.js MAX_PICTURE_BYTES.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function hasTransparency(context, width, height) {
  const pixels = context.getImageData(0, 0, width, height).data;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 255) return true;
  }
  return false;
}

export async function shrinkImage(file) {
  if (file.type === "image/gif") return file;

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const type = hasTransparency(context, width, height) ? "image/png" : "image/jpeg";
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
  if (!blob) throw new Error("couldn't save the shrunk picture");
  // Always the re-encode, even if bigger. The original may carry GPS data.
  return blob;
}
