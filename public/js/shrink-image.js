// Shrinks a picture in the browser before it's uploaded to the blog. It ends
// up at most MAX_SIDE pixels on its longest side, re-saved as a JPEG, or a
// PNG if it has see-through parts. Re-saving also strips phone metadata like
// GPS location. GIFs are left alone so animations keep working. Borrowed
// from tcc.place, where it does the same job.

const MAX_SIDE = 1920;

// the most the server takes for one picture (server/blog.js)
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
  // Always the re-saved one, even when it comes out a little bigger, since the
  // original could still have the phone's location in it.
  return blob;
}
