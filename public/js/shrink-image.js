// techtrash.org : shrinks a picture in the browser before it's uploaded (any
// picture in what's written on the site): at most MAX_SIDE pixels on its longest side, re-saved as a
// JPEG, or a PNG if it has see-through parts. That also strips phone metadata
// like GPS location. GIFs are left alone so animations keep working.
// (From tcc.place, where it does the same job.)

const MAX_SIDE = 1920;

// the most the server takes for one picture
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
  // a small picture that was already compact can come out bigger, so keep the original then
  return scale === 1 && blob.size >= file.size ? file : blob;
}
