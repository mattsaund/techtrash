// File type sniffing and Range responses, used by the blog and the disk.

// From magic bytes, never the name or the client's Content-Type. { ext, type }, or null if unknown.
export function mediaType(bytes) {
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return { ext: "png", type: "image/png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  if (ascii(0, 4) === "GIF8") return { ext: "gif", type: "image/gif" };
  if (ascii(0, 2) === "BM") return { ext: "bmp", type: "image/bmp" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { ext: "webp", type: "image/webp" };
  if (ascii(4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(8, 12))) return { ext: "avif", type: "image/avif" };
  // MP3 starts with an ID3 tag or a frame sync with a nonzero layer
  if (ascii(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0)) return { ext: "mp3", type: "audio/mpeg" };
  // ADTS AAC has the same sync and layer 00
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return { ext: "aac", type: "audio/aac" };
  if (ascii(4, 8) === "ftyp" && ["M4A ", "M4B ", "mp42", "mp41", "isom", "iso2", "dash"].includes(ascii(8, 12))) return { ext: "m4a", type: "audio/mp4" };
  if (ascii(0, 4) === "OggS") return { ext: "ogg", type: "audio/ogg" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return { ext: "wav", type: "audio/wav" };
  if (ascii(0, 4) === "fLaC") return { ext: "flac", type: "audio/flac" };
  return null;
}

// Single-range responses (Range: bytes=...) so players can seek. read(start, end) is inclusive.
export function sendPart(request, size, headers, read) {
  headers = { ...headers, "accept-ranges": "bytes" };
  const asked = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (!asked || (!asked[1] && !asked[2])) {
    return new Response(size ? read(0, size - 1) : null, { headers: { ...headers, "content-length": String(size) } });
  }
  // bytes=10- is from 10 to the end, and bytes=-10 is the last 10
  const start = asked[1] ? Number(asked[1]) : Math.max(0, size - Number(asked[2]));
  const end = asked[1] && asked[2] ? Math.min(Number(asked[2]), size - 1) : size - 1;
  if (start > end) return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
  return new Response(read(start, end), {
    status: 206,
    headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
  });
}
