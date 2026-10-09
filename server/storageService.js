"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { AppError } = require("./errors");
const extensions = new Set([
  ".mp3",
  ".m4a",
  ".mp4",
  ".aac",
  ".wav",
  ".ogg",
  ".oga",
  ".webm",
  ".flac",
]);
function audioFormat(filename, originalName) {
  const size = fs.statSync(filename).size;
  if (size < 12) throw new AppError("File is not supported audio", 415);
  const fd = fs.openSync(filename, "r"),
    first = Buffer.alloc(Math.min(size, 65536)),
    tail = Buffer.alloc(Math.min(size, 65536));
  try {
    fs.readSync(fd, first, 0, first.length, 0);
    fs.readSync(fd, tail, 0, tail.length, Math.max(0, size - tail.length));
  } finally {
    fs.closeSync(fd);
  }
  const ext = path.extname(originalName).toLowerCase(),
    ascii = first.toString("latin1"),
    all = ascii + tail.toString("latin1");
  if (!extensions.has(ext))
    throw new AppError("Unsupported audio extension", 415);
  if (
    ext === ".wav" &&
    size >= 44 &&
    ascii.startsWith("RIFF") &&
    ascii.slice(8, 12) === "WAVE" &&
    ascii.includes("fmt ") &&
    ascii.includes("data")
  )
    return { ext: ".wav", mime: "audio/wav" };
  if (ext === ".flac" && ascii.startsWith("fLaC") && size > 42)
    return { ext: ".flac", mime: "audio/flac" };
  if (
    [".ogg", ".oga"].includes(ext) &&
    ascii.startsWith("OggS") &&
    (ascii.includes("vorbis") || ascii.includes("OpusHead"))
  )
    return { ext: ".ogg", mime: "audio/ogg" };
  if (
    [".m4a", ".mp4"].includes(ext) &&
    ascii.slice(4, 8) === "ftyp" &&
    all.includes("soun")
  )
    return { ext: ".m4a", mime: "audio/mp4" };
  if (
    ext === ".webm" &&
    first.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])) &&
    (all.includes("A_OPUS") || all.includes("A_VORBIS"))
  )
    return { ext: ".webm", mime: "audio/webm" };
  if (ext === ".aac" && first[0] === 255 && (first[1] & 246) === 240)
    return { ext: ".aac", mime: "audio/aac" };
  if (ext === ".mp3") {
    for (let i = 0; i < first.length - 3; i++)
      if (
        first[i] === 255 &&
        (first[i + 1] & 224) === 224 &&
        (first[i + 1] & 6) !== 0 &&
        (first[i + 2] & 240) !== 240 &&
        (first[i + 2] & 12) !== 12
      )
        return { ext: ".mp3", mime: "audio/mpeg" };
  }
  throw new AppError("Audio header does not match a supported format", 415);
}
function createStorage(db, storageDir) {
  const blobsDir = path.join(storageDir, "audio-blobs"),
    tmpDir = path.join(storageDir, "tmp"),
    streams = new Map();
  fs.mkdirSync(blobsDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  function filePath(blob) {
    if (!/^[a-f0-9]{64}\.[a-z0-9]+$/.test(blob.filename))
      throw new AppError("Invalid stored audio path", 500);
    return path.join(blobsDir, blob.filename);
  }
  async function ingest(temp, originalName, ownerId) {
    const format = audioFormat(temp, originalName),
      hash = createHash("sha256");
    for await (const part of fs.createReadStream(temp)) hash.update(part);
    const sha = hash.digest("hex"),
      now = Date.now(),
      filename = sha + format.ext,
      destination = path.join(blobsDir, filename);
    let newFile = false;
    // Temp and blob files share a filesystem. link() publishes only the complete file.
    try {
      fs.linkSync(temp, destination);
      newFile = true;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
    fs.rmSync(temp, { force: true });
    try {
      return db.transaction(() => {
        let blob = db
          .prepare("SELECT * FROM audio_blobs WHERE sha256=?")
          .get(sha);
        if (!blob) {
          blob = {
            id: randomUUID(),
            sha256: sha,
            filename,
            mime_type: format.mime,
            file_size: fs.statSync(destination).size,
          };
          db.prepare(
            "INSERT INTO audio_blobs(id,sha256,filename,mime_type,file_size,created_at) VALUES(?,?,?,?,?,?)",
          ).run(blob.id, sha, filename, format.mime, blob.file_size, now);
        }
        // A retry after a journalled GC failure can legitimately claim the blob again.
        db.prepare("UPDATE audio_blobs SET state='ready' WHERE id=?").run(
          blob.id,
        );
        let track = db
          .prepare(
            "SELECT * FROM library_tracks WHERE owner_device_id=? AND blob_id=?",
          )
          .get(ownerId, blob.id);
        const reused = !!track;
        if (track)
          db.prepare("UPDATE library_tracks SET visible=1 WHERE id=?").run(
            track.id,
          );
        else {
          const name =
            path.basename(originalName.replace(/\\/g, "/")).slice(0, 200) ||
            "Audio";
          track = { id: randomUUID() };
          db.prepare(
            "INSERT INTO library_tracks(id,owner_device_id,blob_id,display_name,original_filename,source_device_id,created_at) VALUES(?,?,?,?,?,?,?)",
          ).run(track.id, ownerId, blob.id, name, name, ownerId, now);
        }
        return { trackId: track.id, reused };
      })();
    } catch (err) {
      if (
        newFile &&
        !db.prepare("SELECT id FROM audio_blobs WHERE sha256=?").get(sha)
      )
        fs.rmSync(destination, { force: true });
      throw err;
    }
  }
  function collect() {
    const unused = db
      .prepare(
        `SELECT b.* FROM audio_blobs b WHERE NOT EXISTS(SELECT 1 FROM library_tracks t WHERE t.blob_id=b.id)
      AND NOT EXISTS(SELECT 1 FROM transfers x WHERE x.blob_id=b.id AND x.status IN ('offered','delivered'))`,
      )
      .all();
    for (const blob of unused) {
      if (streams.get(blob.id)) continue;
      try {
        db.prepare("UPDATE audio_blobs SET state='gc_pending' WHERE id=?").run(
          blob.id,
        );
        fs.rmSync(filePath(blob), { force: true });
        db.prepare("DELETE FROM audio_blobs WHERE id=?").run(blob.id);
      } catch {
        /* retained journal row retries on next collection/startup */
      }
    }
  }
  function reconcile() {
    for (const file of fs.readdirSync(tmpDir))
      if (file !== ".gitkeep")
        fs.rmSync(path.join(tmpDir, file), { force: true });
    for (const file of fs.readdirSync(blobsDir)) {
      if (
        /^[a-f0-9]{64}\.[a-z0-9]+$/.test(file) &&
        !db.prepare("SELECT id FROM audio_blobs WHERE filename=?").get(file)
      )
        fs.rmSync(path.join(blobsDir, file), { force: true });
    }
    collect();
  }
  function pin(blobId) {
    streams.set(blobId, (streams.get(blobId) || 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = streams.get(blobId) - 1;
      count ? streams.set(blobId, count) : streams.delete(blobId);
      collect();
    };
  }
  return {
    ingest,
    collect,
    reconcile,
    pin,
    filePath,
    tmpDir,
    blobsDir,
    streams,
  };
}
module.exports = { createStorage, audioFormat, extensions };
