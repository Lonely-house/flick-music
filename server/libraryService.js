"use strict";
const fs = require("node:fs");
const { AppError, requireId } = require("./errors");
function parseRange(value, size) {
  if (!value) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!m || (!m[1] && !m[2])) throw new AppError("Invalid Range", 416);
  let start, end;
  if (!m[1]) {
    const suffix = Number(m[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0)
      throw new AppError("Invalid Range", 416);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Number(m[2]) : size - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    throw new AppError("Invalid Range", 416);
  return { start, end: Math.min(end, size - 1) };
}
function createLibrary(db, storage, changed = () => {}) {
  const query = `SELECT t.*, b.sha256,b.filename,b.mime_type,b.file_size,b.state FROM library_tracks t JOIN audio_blobs b ON b.id=t.blob_id`;
  function track(id, ownerId, includePending = false) {
    requireId(id);
    const row = db
      .prepare(
        query +
          " WHERE t.id=? AND t.owner_device_id=?" +
          (includePending ? "" : " AND t.visible=1"),
      )
      .get(id, ownerId);
    if (!row) throw new AppError("Track not found in your library", 404);
    return row;
  }
  function present(row) {
    return {
      id: row.id,
      displayName: row.display_name,
      originalFilename: row.original_filename,
      sourceDeviceId: row.source_device_id,
      createdAt: row.created_at,
      duration: row.duration || null,
      fileSize: row.file_size,
      mimeType: row.mime_type,
      audioUrl: "/api/tracks/" + row.id + "/stream",
    };
  }
  function list(ownerId) {
    return db
      .prepare(
        query +
          " WHERE t.owner_device_id=? AND t.visible=1 ORDER BY t.created_at DESC,t.id",
      )
      .all(ownerId)
      .map(present);
  }
  function remove(ownerId, ids) {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100)
      throw new AppError("Choose between 1 and 100 tracks");
    const unique = [...new Set(ids.map(requireId))];
    db.transaction(() => {
      for (const id of unique) track(id, ownerId); // validate the whole batch before any mutation
      for (const id of unique)
        db.prepare(
          "DELETE FROM library_tracks WHERE id=? AND owner_device_id=?",
        ).run(id, ownerId);
    })();
    changed(ownerId, { deletedIds: unique });
    storage.collect();
    return unique;
  }
  function stream(req, res, next) {
    let release;
    try {
      const row = track(req.params.id, req.session.device_id),
        filename = storage.filePath(row);
      if (row.state !== "ready" || !fs.existsSync(filename))
        throw new AppError("Audio file is missing. Upload it again.", 404);
      const size = fs.statSync(filename).size,
        etag = '"' + row.sha256 + '"';
      res.set({
        "Accept-Ranges": "bytes",
        "Content-Type": row.mime_type,
        "Cache-Control": "private, no-store",
        ETag: etag,
      });
      let range;
      try {
        range = parseRange(
          req.headers["if-range"] && req.headers["if-range"] !== etag
            ? null
            : req.headers.range,
          size,
        );
      } catch (err) {
        res.set("Content-Range", "bytes */" + size);
        throw err;
      }
      const start = range?.start || 0,
        end = range?.end ?? size - 1;
      if (range)
        res.status(206).set("Content-Range", `bytes ${start}-${end}/${size}`);
      res.set("Content-Length", String(end - start + 1));
      if (req.method === "HEAD") return res.end();
      release = storage.pin(row.blob_id);
      res.once("close", release);
      res.once("finish", release);
      const file = fs.createReadStream(filename, { start, end });
      res.once("close", () => file.destroy());
      file.on("error", (err) => {
        release();
        if (res.headersSent) res.destroy();
        else next(new AppError("Audio could not be read", 500));
      });
      file.pipe(res);
    } catch (err) {
      release?.();
      next(err);
    }
  }
  return { track, present, list, remove, stream };
}
module.exports = { createLibrary, parseRange };
