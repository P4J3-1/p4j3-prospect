const fs = require("fs");
const path = require("path");

// Guarda a base de leads (a string JSON de `sigma_leads`) em arquivo no
// userData. O localStorage do renderer tem teto de ~5–10 MB por origem e
// estourava com alguns milhares de leads.
const MAX_LEADS_BYTES = 256 * 1024 * 1024;

function createLeadsFileStore(filePath, { debounceMs = 300 } = {}) {
  let pending = null; // string a gravar, ou null para apagar
  let hasPending = false;
  let timer = null;

  function load() {
    if (hasPending) return pending;
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!hasPending) return;
    const value = pending;
    hasPending = false;
    pending = null;
    if (value === null) {
      fs.rmSync(filePath, { force: true });
      return;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, value, { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(tempPath, filePath);
  }

  function save(value) {
    if (value !== null && typeof value !== "string") throw new TypeError("leads devem ser string JSON ou null");
    if (value !== null && Buffer.byteLength(value, "utf-8") > MAX_LEADS_BYTES) {
      throw new RangeError("Base de leads excede o limite de armazenamento");
    }
    pending = value;
    hasPending = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try { flush(); } catch (error) { console.warn("[LEADS-STORE] save:", error.message); }
    }, debounceMs);
  }

  return { load, save, flush };
}

module.exports = { createLeadsFileStore, MAX_LEADS_BYTES };
