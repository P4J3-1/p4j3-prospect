const { app } = require("electron");

let autoUpdater = null;
let sendToRenderer = null;
let checkTimer = null;
let isInit = false;
let checkInFlight = null;
// Último estado conhecido. O renderer monta depois do primeiro check, então sem
// este cache um "nova versão disponível" podia ser emitido para o vazio.
let lastState = { status: "idle", ts: Date.now() };
let downloadInFlight = false;

function getUpdateAvailabilityError() {
  if (!app.isPackaged) {
    return "Atualizações funcionam na versão instalada, não na prévia de desenvolvimento.";
  }
  // `win-unpacked` é a saída de build para testes locais. Não existe instalador
  // para substituir nesse caso, portanto tentar atualizar só gera um erro opaco.
  if (/[\\/]win-unpacked[\\/]/i.test(process.execPath || "")) {
    return "Você está usando a versão portátil de teste. Instale pelo arquivo Setup para receber atualizações automáticas.";
  }
  return null;
}

function init(sendFn) {
  if (isInit) return;
  sendToRenderer = sendFn;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (e) {
    console.warn("[UPDATER] electron-updater não disponível:", e.message);
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on("checking-for-update", () => {
    emit("checking");
  });

  autoUpdater.on("update-available", (info) => {
    emit("available", { version: info.version, releaseNotes: info.releaseNotes });
  });

  autoUpdater.on("update-not-available", () => {
    emit("not-available");
  });

  autoUpdater.on("download-progress", (p) => {
    emit("progress", {
      percent: Math.round(p.percent || 0),
      bytesPerSecond: Math.round(p.bytesPerSecond || 0),
      transferred: Number(p.transferred) || 0,
      total: Number(p.total) || 0,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    downloadInFlight = false;
    emit("downloaded", { version: info.version });
  });

  autoUpdater.on("error", (err) => {
    downloadInFlight = false;
    emit("error", { message: err?.message || String(err) });
  });

  isInit = true;

  const unavailableReason = getUpdateAvailabilityError();
  if (unavailableReason) {
    console.log("[UPDATER] skip check —", unavailableReason);
    return;
  }

  // A checagem roda em toda abertura do app e depois a cada 6 h.
  setTimeout(() => checkForUpdates(), 4000);
  checkTimer = setInterval(() => checkForUpdates(), 6 * 60 * 60 * 1000);
}

function emit(status, data) {
  const payload = { status, ...(data || {}), ts: Date.now() };
  lastState = payload;
  try {
    if (sendToRenderer) sendToRenderer("update-status", payload);
  } catch {}
  console.log("[UPDATER]", status, data || "");
}

async function checkForUpdates() {
  if (!autoUpdater) return { success: false, error: "Atualizador não inicializado" };
  const unavailableReason = getUpdateAvailabilityError();
  if (unavailableReason) {
    return {
      success: false,
      error: unavailableReason,
    };
  }
  if (checkInFlight) return checkInFlight;
  checkInFlight = autoUpdater.checkForUpdates()
    .then((result) => ({ success: true, updateInfo: result?.updateInfo || null }))
    .catch((e) => ({ success: false, error: e?.message || "Não foi possível verificar a atualização" }))
    .finally(() => {
      checkInFlight = null;
    });
  return checkInFlight;
}

async function downloadUpdate() {
  if (!autoUpdater) return { success: false, error: "Atualizador não inicializado" };
  const unavailableReason = getUpdateAvailabilityError();
  if (unavailableReason) {
    return {
      success: false,
      error: unavailableReason,
    };
  }
  if (downloadInFlight) return { success: true, alreadyRunning: true };
  downloadInFlight = true;
  emit("progress", { percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 });
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (e) {
    downloadInFlight = false;
    return { success: false, error: e.message };
  }
}

function quitAndInstall() {
  if (!autoUpdater) return { success: false, error: "Atualizador não inicializado" };
  const unavailableReason = getUpdateAvailabilityError();
  if (unavailableReason) return { success: false, error: unavailableReason };
  try {
    autoUpdater.quitAndInstall();
    return { success: true };
  } catch (e) {
    console.error("[UPDATER] quitAndInstall:", e.message);
    return { success: false, error: e?.message || "Não foi possível instalar a atualização" };
  }
}

/** Capacidade + último evento. O renderer usa isto para se sincronizar ao abrir. */
function getStatus() {
  return {
    isPackaged: app.isPackaged,
    version: app.getVersion(),
    hasUpdater: !!autoUpdater,
    unavailableReason: getUpdateAvailabilityError(),
    last: lastState,
  };
}

function shutdown() {
  if (checkTimer) clearInterval(checkTimer);
  checkTimer = null;
}

module.exports = { init, checkForUpdates, downloadUpdate, quitAndInstall, getStatus, shutdown };
