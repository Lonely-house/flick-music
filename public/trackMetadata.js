(function (root) {
  "use strict";
  // Read common MP3 ID3v2 title/artist tags from an authenticated byte-range
  // request. No third-party decoder, database migration or public file URLs.
  function synchsafe(bytes, offset) {
    return (bytes[offset] << 21) | (bytes[offset + 1] << 14) |
      (bytes[offset + 2] << 7) | bytes[offset + 3];
  }
  function text(bytes, offset, size) {
    if (size < 2 || offset + size > bytes.length) return "";
    const encoding = bytes[offset];
    let payload = bytes.subarray(offset + 1, offset + size);
    try {
      if (encoding === 0) {
        return new TextDecoder("iso-8859-1").decode(payload).split("\0")[0].trim();
      }
      if (encoding === 3) {
        return new TextDecoder("utf-8").decode(payload).split("\0")[0].trim();
      }
      if (encoding === 1 || encoding === 2) {
        let label = "utf-16le";
        if (encoding === 2) {
          const swapped = new Uint8Array(payload.length);
          for (let i = 0; i + 1 < payload.length; i += 2) {
            swapped[i] = payload[i + 1]; swapped[i + 1] = payload[i];
          }
          payload = swapped;
        } else if (payload.length > 1 && payload[0] === 0xfe && payload[1] === 0xff) {
          const swapped = new Uint8Array(payload.length - 2);
          for (let i = 2; i + 1 < payload.length; i += 2) {
            swapped[i - 2] = payload[i + 1]; swapped[i - 1] = payload[i];
          }
          payload = swapped;
        }
        const clean = new TextDecoder(label).decode(payload);
        return clean.replace(/^\ufeff/, "").split("\0")[0].trim();
      }
    } catch {}
    return "";
  }
  function parseID3(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length < 10 || bytes[0] !== 73 || bytes[1] !== 68 || bytes[2] !== 51) return null;
    const ver = bytes[3], flags = bytes[5];
    if (![2,3,4].includes(ver)) return null;
    if (flags & 0x40) return null; // unsupported extended header
    const size = synchsafe(bytes, 6), end = Math.min(bytes.length, 10 + size);
    if (size <= 0 || size > 2 * 1024 * 1024) return null;
    const meta = {};
    let offset = 10;
    while (offset < end) {
      const old = ver === 2;
      const head = old ? 6 : 10;
      if (offset + head > end) break;
      const id = String.fromCharCode(...bytes.subarray(offset, offset + (old ? 3 : 4)));
      if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
      const sizeIndex = offset + (old ? 3 : 4);
      const frameSize = old
        ? (bytes[sizeIndex] << 16) | (bytes[sizeIndex+1] << 8) | bytes[sizeIndex+2]
        : ver === 4 ? synchsafe(bytes,sizeIndex)
        : (bytes[sizeIndex]*0x1000000 + (bytes[sizeIndex+1]<<16) +
           (bytes[sizeIndex+2]<<8) + bytes[sizeIndex+3]);
      if (frameSize <= 0 || offset + head + frameSize > end) break;
      const dataOffset = offset + head;
      const field = ["TIT2","TT2"].includes(id) ? "title"
        : ["TPE1","TP1"].includes(id) ? "artist" : null;
      if (field) {
        const value = text(bytes,dataOffset,frameSize);
        if (value && value.length <= 180) meta[field] = value;
      }
      offset = dataOffset + frameSize;
      if (meta.title && meta.artist) break;
    }
    return meta.title || meta.artist ? meta : null;
  }
  async function readTrackTags(track, fetchImpl = root.fetch.bind(root)) {
    if (!track || !track.audioUrl || !(
      track.mimeType === "audio/mpeg" || /\.mp3$/i.test(track.displayName || ""))) return null;
    try {
      const response = await fetchImpl(track.audioUrl, {
        method:"GET", credentials:"same-origin",
        headers:{Range:"bytes=0-131071"}
      });
      if (!response.ok) return null;
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 262144) return null;
      return parseID3(buffer);
    } catch { return null; }
  }
  const api = { parseID3, readTrackTags };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FlickTrackMetadata = api;
})(typeof window === "undefined" ? globalThis : window);
