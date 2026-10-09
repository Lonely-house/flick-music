"use strict";
// Sound cues are shared by the demo installation, not part of any private music library.
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { AppError } = require("./errors");
const { audioFormat, extensions } = require("./storageService");

const KINDS = Object.freeze(["paired", "receiverReady", "uploaded", "delivered"]);
const MAX_CUE_BYTES = 5 * 1024 * 1024;
function checkKind(kind) {
  if (!KINDS.includes(kind)) throw new AppError("Unknown sound event", 404);
  return kind;
}
function createSoundService(storageDir) {
  const dir = path.join(storageDir, "sound-effects");
  const configPath = path.join(dir, "settings.json");
  fs.mkdirSync(dir, { recursive: true });
  let config = {};
  try {
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const kind of KINDS) {
          const row = parsed[kind];
          if (
            row && typeof row === "object" &&
            typeof row.file === "string" &&
            /^[a-f0-9-]{36}\.[a-z0-9]+$/.test(row.file) &&
            fs.existsSync(path.join(dir, row.file))
          ) config[kind] = row;
        }
      }
    }
  } catch (err) {
    throw new Error("Unable to read saved sound settings: " + err.message);
  }
  function persist(next) {
    const temp = path.join(dir, randomUUID() + ".json.tmp");
    try {
      fs.writeFileSync(temp, JSON.stringify(next, null, 2));
      fs.renameSync(temp, configPath);
      config = next;
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }
  function list() {
    const result = {};
    for (const kind of KINDS) {
      const row = config[kind];
      result[kind] = row
        ? {
            name: row.name,
            mimeType: row.mimeType,
            revision: row.revision,
            url: `/api/sounds/${kind}/file?v=${encodeURIComponent(row.revision)}`,
          }
        : null;
    }
    return result;
  }
  function put(kind, file) {
    checkKind(kind);
    if (!file || !file.buffer || file.buffer.length < 12 || file.buffer.length > MAX_CUE_BYTES)
      throw new AppError("Sound file must be a supported audio file up to 5 MB", 415);
    const name = path.basename(String(file.originalname || "sound").replace(/\\/g, "/")).slice(0, 100);
    if (!extensions.has(path.extname(name).toLowerCase()))
      throw new AppError("Unsupported audio filename extension", 415);
    const staging = path.join(dir, randomUUID() + ".tmp");
    let final = null;
    try {
      fs.writeFileSync(staging, file.buffer, { flag: "wx" });
      const format = audioFormat(staging, name);
      const filename = randomUUID() + format.ext;
      final = path.join(dir, filename);
      fs.renameSync(staging, final);
      const old = config[kind];
      persist({ ...config, [kind]: {
        name, file: filename, mimeType: format.mime, revision: randomUUID(),
      }});
      if (old) fs.rmSync(path.join(dir, old.file), { force: true });
      return list()[kind];
    } catch (err) {
      if (final && !Object.values(config).some((row) => row.file === path.basename(final)))
        fs.rmSync(final, { force: true });
      throw err;
    } finally {
      fs.rmSync(staging, { force: true });
    }
  }
  function reset(kind) {
    checkKind(kind);
    const old = config[kind];
    if (old) {
      const next = { ...config };
      delete next[kind];
      persist(next);
      fs.rmSync(path.join(dir, old.file), { force: true });
    }
    return null;
  }
  function file(kind) {
    checkKind(kind);
    const row = config[kind];
    if (!row) throw new AppError("This event uses the built-in sound", 404);
    const filename = path.join(dir, row.file);
    if (!fs.existsSync(filename)) throw new AppError("Sound file unavailable", 404);
    return { filename, mimeType: row.mimeType };
  }
  return { list, put, reset, file, dir };
}
module.exports = { createSoundService, KINDS, MAX_CUE_BYTES, checkKind };
