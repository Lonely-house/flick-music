"use strict";
const path = require("node:path");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const Database = require("better-sqlite3");
const { createStorage, extensions } = require("../server/storageService");
const storageDir = process.env.FLICK_STORAGE_DIR
  ? path.resolve(process.env.FLICK_STORAGE_DIR)
  : path.join(__dirname, "..", "storage");
async function main() {
  const [command, arg, deviceId] = process.argv.slice(2);
  const db = new Database(path.join(storageDir, "music.db"), {
    fileMustExist: true,
  });
  db.pragma("foreign_keys=ON");
  try {
    if (command === "inspect") {
      for (const d of db.prepare("SELECT id,nickname FROM devices").all()) {
        console.log(`${d.nickname} → ${d.id}`);
        for (const t of db
          .prepare(
            "SELECT display_name,id,blob_id FROM library_tracks WHERE owner_device_id=? AND visible=1",
          )
          .all(d.id))
          console.log(
            `  ${t.display_name} → track ${t.id} → blob ${t.blob_id}`,
          );
      }
    } else if (command === "backup" && arg) {
      await db.backup(path.resolve(arg));
      console.log(
        "SQLite backup completed. Also back up audio-blobs, or stop the server and copy all storage/.",
      );
    } else if (command === "claim-legacy" && arg && deviceId) {
      if (!db.prepare("SELECT 1 FROM devices WHERE id=?").get(deviceId))
        throw new Error("Unknown target device ID");
      const storage = createStorage(db, storageDir),
        source = path.resolve(arg);
      for (const name of fs.readdirSync(source)) {
        const file = path.join(source, name);
        if (
          !fs.statSync(file).isFile() ||
          !extensions.has(path.extname(name).toLowerCase())
        )
          continue;
        const temp = path.join(storage.tmpDir, randomUUID() + ".part");
        fs.copyFileSync(file, temp);
        try {
          const result = await storage.ingest(temp, name, deviceId);
          console.log(`Claimed ${name} as ${result.trackId}`);
        } catch (err) {
          fs.rmSync(temp, { force: true });
          console.error(`Skipped ${name}: ${err.message}`);
        }
      }
    } else
      throw new Error(
        "Usage: node scripts/admin.js inspect | backup PATH | claim-legacy OLD_UPLOADS DEVICE_ID",
      );
  } finally {
    db.close();
  }
}
main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
