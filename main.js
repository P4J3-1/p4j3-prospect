const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Tray, Menu, nativeImage, screen, powerSaveBlocker, Notification, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFile } = require("child_process");
const QRCode = require("qrcode");

// O smoke empacotado usa um perfil descartável; nunca misture seus dados com o perfil real.
if (process.env.SIGMA_QA === "1" && process.env.SIGMA_QA_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.SIGMA_QA_USER_DATA));
} else {
  // O app virou P4J3 Prospect, mas a pasta de dados mantém o nome antigo para
  // preservar leads, sessões do WhatsApp e campanhas de quem já usava. Instalado
  // e "npm start" usavam pastas diferentes; fica a que já existe, para quem
  // passou do modo desenvolvimento para o instalador não abrir o app vazio.
  const appDataDir = app.getPath("appData");
  const userDataCandidates = app.isPackaged
    ? ["Sigma GMaps Scraper", "sigma-gmaps-scraper"]
    : ["sigma-gmaps-scraper", "Sigma GMaps Scraper"];
  const existingUserData = userDataCandidates.find((dir) => fs.existsSync(path.join(appDataDir, dir)));
  app.setPath("userData", path.join(appDataDir, existingUserData || userDataCandidates[0]));
}

// Suppress GPU and Cache errors in console
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
app.commandLine.appendSwitch("disable-software-rasterizer");
// Reduz cache de disco do Chromium (evita JS antigo tipo index-BC5opcok.js)
app.commandLine.appendSwitch("disable-http-cache");
app.commandLine.appendSwitch("disk-cache-size", "1");

let ffmpegPath = "ffmpeg";
try {
  ffmpegPath = require("ffmpeg-static") || "ffmpeg";
} catch (e) {}
const { scrapeGoogleMaps, placeIdFromUrl, nameKey } = require("./scraper");
const { AreaCache, cityGrid, fetchNeighborhoods, nicheVariations } = require("./utils/area-discovery");
const { saveToCSV } = require("./utils/csv");
const { saveReport } = require("./utils/report");
const {
  assertAllowedMediaPath,
  assertConnectionId,
  assertMaxBytes,
  clampInteger,
  createConnectionId,
  isHttpUrl,
  limitString,
  resolveInside,
} = require("./utils/security");
const { WhatsAppProviderFactory } = require("./whatsapp/provider");
const { normalizePhone } = require("./whatsapp/phone-normalizer");
const { CampaignManager } = require("./campaigns/campaign-manager");
const {
  interpolate: interpolateTemplate,
} = require("./campaigns/template-engine");
const { LeadScoringService } = require("./lead-scoring");
const { saveProspectingCSV } = require("./lead-scoring/export-service");
const { runAiTask } = require("./lead-scoring/ai-sales-analyzer");
const { researchLead, webSearch } = require("./lead-scoring/lead-intel");
const { runRadar, auditSite, diagnose } = require("./agents/web-hunter");
const { chromium } = require("playwright");
const { optimizeCampaignMessage } = require("./lead-scoring/message-optimizer");
const { computeInsights } = require("./campaigns/learning");
const { TriageStore, computeTriage, triageKey, triageLeads } = require("./lead-scoring/lead-triage");
const { SendQueue } = require("./campaigns/send-queue");
const { phoneCore: phoneKey } = require("./utils/phone-key");
const { isAutoReply, isProspectingConversation } = require("./utils/outreach-classifier");
const { composeMessages } = require("./campaigns/outreach-composer");
const { entryOffer, imageDiagnosis, nextOffer, objectionsFor, OFFERS } = require("./campaigns/offer-ladder");
const { DailyQuota } = require("./campaigns/daily-quota");
const { AgentStore } = require("./agents/agent-store");
const { Autopilot } = require("./agents/autopilot");
const { DEFAULT_OFFERS } = require("./agents/sales-playbook");
const { understand, SCREENS } = require("./agents/jarvis");
const { whatsappXray } = require("./utils/whatsapp-xray");
const { runAnalyst, suggestReplies, writeProposal } = require("./agents/ai-agents");
const { LeadMemory, temperatureOf } = require("./campaigns/lead-memory");
const { backupRoot, hasBackupToday, listBackups, runBackup } = require("./utils/backup");
const { KanbanStore } = require("./kanban/kanban-store");
const { normalizeAddress } = require("./utils/address-normalizer");
const { normalizeText } = require("./utils/text-normalizer");
const { normalizeLeadLinks, normalizePhoneDisplay, hostOf, isSocialUrl, isAggregatorUrl } = require("./utils/lead-links");
const { geocodeAddress, isValidCoord } = require("./utils/geocode");
const { migrateExistingData } = require("./utils/existing-data-migrator");
const { createLeadsFileStore } = require("./utils/leads-file-store");
const { createSecretBox } = require("./utils/secret-box");
const { ContactStatusStore } = require("./utils/contact-status-store");
const { isOptOutMessage, messageText } = require("./campaigns/contact-guard");
const {
  DEFAULT_WINDOW_BOUNDS,
  readWindowState,
  resolveBounds,
  writeWindowState,
} = require("./utils/window-state");

const autoUpdaterMod = require("./utils/auto-updater");
const { ensureInstallId } = require("./utils/install-id");
const appMetrics = require("./utils/app-metrics");

let mainWindow;
const whatsappProviders = new Map();
let activeWhatsAppId = null;
let campaignManager = null;
let leadScoringService = null;
let kanbanStore = null;
let contactStatus = null;
let agentStore = null;
let autopilot = null;
let triageStore = null;
let sendQueue = null;
let leadMemory = null;
const notifiedReplies = new Map();
const resultStore = new Map();
const allowedMediaPaths = new Set();
const activeScrapes = new Map();
const { LIMIT_TIERS } = require("./campaigns/daily-quota");
const { shouldPreventSuspension } = require("./utils/background-holds");
let powerBlockerId = null;
let tray = null;
let isExitInProgress = false;
let closePromptInFlight = false;
let trayHintShown = false;
let windowStateSaveTimer = null;
let displaySafetyRegistered = false;
let desktopPreferences = null;

function normalizeIncomingLead(item = {}) {
  const links = normalizeLeadLinks(item);
  return {
    ...item,
    name: normalizeText(item?.name),
    category: normalizeText(item?.category),
    city: normalizeText(item?.city || item?.cidade),
    state: normalizeText(item?.state || item?.uf),
    neighborhood: normalizeText(item?.neighborhood || item?.bairro),
    address: normalizeAddress(item?.address),
    phone: normalizePhoneDisplay(item?.phone || item?.tel) || normalizeText(item?.phone),
    website: links.website,
    instagram: links.instagram,
  };
}

const defaultWhatsAppSettings = {
  notifications: {
    desktop: true,
    sound: true,
    showPreview: true,
    notifyGroups: true,
    quietHours: null,
  },
  media: {
    autoDownloadImages: true,
    autoDownloadAudio: true,
    autoDownloadVideos: false,
    autoDownloadDocuments: false,
    autoDownloadStickers: true,
    maxAutoDownloadBytes: 5 * 1024 * 1024,
    cacheLimitBytes: 1024 * 1024 * 1024,
  },
  previews: {
    links: true,
    pdf: true,
    videoPreloadBytes: 5 * 1024 * 1024,
  },
  groups: {
    allowFunnels: false,
    confirmFunnels: true,
    allowCampaigns: false,
    downloadPictures: true,
  },
  /** Regras de disparo de campanhas (anti-ban / aquecimento) */
  campaigns: {
    // Limite diário por número: 10 | 30 | 60 | 100
    dailyLimit: 10,
    // Tiers já liberados pelo usuário (progressivo)
    unlockedLimits: [10],
    // true = sem limite (por conta e risco)
    manualUnlimited: false,
    // Janela de envio (horário local)
    workingHoursEnabled: true,
    workingHoursStart: "07:00",
    workingHoursEnd: "18:00",
    // Região do agendamento: 'system' (padrão) ou IANA (ex.: America/Sao_Paulo)
    timeZone: "system",
  },
};
let cachedWhatsAppSettings = null;

const MAX_SCRAPE_RESULTS = 1000;
const MAX_QUERY_LENGTH = 200;
const MAX_EXPORT_LEADS = 20000;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
const MAX_STICKER_BYTES = 5 * 1024 * 1024;

const DESKTOP_PREFERENCES_VERSION = 1;
const DEFAULT_DESKTOP_PREFERENCES = Object.freeze({
  version: DESKTOP_PREFERENCES_VERSION,
  closeBehavior: "ask",
  zoom: 1,
});

function clampUiZoom(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(0.8, Math.min(1.5, Math.round(numeric * 100) / 100));
}

function getDesktopPreferencesPath() {
  return path.join(app.getPath("userData"), "desktop-preferences-v1.json");
}

function loadDesktopPreferences() {
  if (desktopPreferences) return desktopPreferences;
  try {
    const raw = JSON.parse(fs.readFileSync(getDesktopPreferencesPath(), "utf8"));
    desktopPreferences = {
      version: DESKTOP_PREFERENCES_VERSION,
      closeBehavior: raw?.closeBehavior === "tray" || raw?.closeBehavior === "quit" ? raw.closeBehavior : "ask",
      zoom: clampUiZoom(raw?.zoom),
    };
  } catch {
    desktopPreferences = { ...DEFAULT_DESKTOP_PREFERENCES };
  }
  return desktopPreferences;
}

function saveDesktopPreferences(patch = {}) {
  const current = loadDesktopPreferences();
  desktopPreferences = {
    ...current,
    ...patch,
    version: DESKTOP_PREFERENCES_VERSION,
    closeBehavior: patch.closeBehavior === "tray" || patch.closeBehavior === "quit"
      ? patch.closeBehavior
      : current.closeBehavior,
    zoom: clampUiZoom(patch.zoom ?? current.zoom),
  };
  try {
    const filePath = getDesktopPreferencesPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(desktopPreferences, null, 2), { mode: 0o600 });
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    console.warn("[DESKTOP] preference save:", error.message);
  }
  return desktopPreferences;
}

function getWindowDisplays() {
  try {
    return screen.getAllDisplays();
  } catch {
    return [];
  }
}

function getCapturedWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const bounds = mainWindow.isMaximized() ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  return {
    bounds,
    displayId: display?.id || null,
    isMaximized: mainWindow.isMaximized(),
  };
}

function persistWindowState() {
  if (!app.isReady()) return null;
  const state = getCapturedWindowState();
  if (!state) return null;
  try {
    return writeWindowState(app.getPath("userData"), state, getWindowDisplays(), DEFAULT_WINDOW_BOUNDS);
  } catch (error) {
    console.warn("[DESKTOP] window state save:", error.message);
    return null;
  }
}

function scheduleWindowStateSave() {
  if (windowStateSaveTimer) clearTimeout(windowStateSaveTimer);
  windowStateSaveTimer = setTimeout(() => {
    windowStateSaveTimer = null;
    persistWindowState();
  }, 180);
}

function ensureWindowIsVisible() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMaximized()) return;
  const current = mainWindow.getBounds();
  const restored = resolveBounds(current, getWindowDisplays(), DEFAULT_WINDOW_BOUNDS);
  const changed = ["x", "y", "width", "height"].some((key) => restored[key] !== current[key]);
  if (changed) mainWindow.setBounds(restored);
  scheduleWindowStateSave();
}

function getTraySnapshot() {
  const whatsapp = getAggregateWhatsAppStatus();
  const activeCampaigns = (campaignManager?.getAll?.() || [])
    .filter((campaign) => ["running", "scheduled"].includes(campaign?.status));
  return {
    whatsapp,
    activeCampaigns,
    whatsappLabel: whatsapp?.connected ? "conectado" : whatsapp?.status || "desconectado",
  };
}

function getTrayImage() {
  for (const candidate of [
    path.join(__dirname, "assets", "icon.ico"),
    path.join(__dirname, "sigmalogo.ico"),
  ]) {
    const image = nativeImage.createFromPath(candidate);
    if (!image.isEmpty()) return image;
  }
  return nativeImage.createEmpty();
}

function updateTray() {
  if (!tray) return;
  const snapshot = getTraySnapshot();
  tray.setToolTip(`P4J3 Prospect — WhatsApp ${snapshot.whatsappLabel}; ${snapshot.activeCampaigns.length} campanha(s) ativa(s)`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Abrir P4J3 Prospect", click: () => restoreMainWindow() },
    { type: "separator" },
    { label: `WhatsApp: ${snapshot.whatsappLabel}`, enabled: false },
    { label: `Campanhas ativas: ${snapshot.activeCampaigns.length}`, enabled: false },
    {
      label: "Pausar campanhas ativas",
      enabled: snapshot.activeCampaigns.length > 0,
      click: () => pauseActiveCampaignsFromTray(),
    },
    { type: "separator" },
    { label: "Sair do P4J3 Prospect", click: () => quitApplication() },
  ]));
}

function currentCampaignList() {
  try {
    return campaignManager?.getAll?.() || [];
  } catch {
    return [];
  }
}

/**
 * Autonomia em segundo plano: enquanto houver campanha disparando/
 * agendada ou extração rodando, segura o app acordado (o usuário pode
 * usar outros programas) e solta quando tudo termina.
 */
function refreshBackgroundHolds() {
  let want = false;
  try {
    want = shouldPreventSuspension({ campaigns: currentCampaignList(), activeScrapes: activeScrapes.size });
  } catch {
    want = false;
  }
  try {
    const alive = powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId);
    if (want && !alive) {
      powerBlockerId = powerSaveBlocker.start("prevent-app-suspension");
      console.log("[POWER] hold ativo: trabalho em segundo plano.");
    } else if (!want && powerBlockerId !== null) {
      try {
        powerSaveBlocker.stop(powerBlockerId);
      } catch {}
      powerBlockerId = null;
      console.log("[POWER] hold liberado: nada em andamento.");
    }
  } catch (error) {
    console.warn("[POWER] hold:", error.message);
  }
  updateTray();
}

/** Avisa no Windows (respeita Configurações → notificações). */
function notifyUser({ title, body }) {
  const cleanTitle = limitString(title || "P4J3 Prospect", 120, "P4J3 Prospect");
  const cleanBody = limitString(body || "", 220, "");
  if (!cleanBody) return;
  let desktop = true;
  let sound = true;
  try {
    const current = cachedWhatsAppSettings || loadWhatsAppSettings();
    desktop = current?.notifications?.desktop !== false;
    sound = current?.notifications?.sound !== false;
  } catch {}
  if (!desktop) return;
  try {
    if (tray && (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible())) {
      tray.displayBalloon({ title: cleanTitle, content: cleanBody.slice(0, 200), iconType: "info" });
    }
  } catch {}
  try {
    if (Notification.isSupported()) {
      new Notification({ title: cleanTitle, body: cleanBody, silent: !sound }).show();
    }
  } catch (error) {
    console.warn("[NOTIFY]:", error.message);
  }
}

function initializeTray() {
  if (tray) return tray;
  tray = new Tray(getTrayImage());
  tray.on("click", () => restoreMainWindow());
  tray.on("double-click", () => restoreMainWindow());
  tray.on("right-click", () => tray?.popUpContextMenu());
  updateTray();
  return tray;
}

function showTrayHint() {
  if (trayHintShown || !tray) return;
  trayHintShown = true;
  try {
    tray.displayBalloon({
      title: "P4J3 Prospect continua em segundo plano",
      content: "Use o ícone da bandeja para abrir ou sair com segurança.",
      iconType: "info",
    });
  } catch {
    /* optional Windows notification */
  }
}

function hideMainWindow(reason = "minimize") {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.hide();
  updateTray();
  if (reason === "minimize" || reason === "close") showTrayHint();
  return true;
}

function restoreMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  ensureWindowIsVisible();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  updateTray();
}

function quitApplication() {
  if (isExitInProgress) return;
  isExitInProgress = true;
  persistWindowState();
  try { tray?.destroy(); } catch {}
  tray = null;
  app.quit();
}

function requestWindowClose() {
  if (!mainWindow || mainWindow.isDestroyed() || isExitInProgress || closePromptInFlight) return;
  const preferences = loadDesktopPreferences();
  if (preferences.closeBehavior === "tray") {
    hideMainWindow("close");
    return;
  }
  if (preferences.closeBehavior === "quit") {
    quitApplication();
    return;
  }

  closePromptInFlight = true;
  dialog.showMessageBox(mainWindow, {
    type: "question",
    title: "Fechar P4J3 Prospect",
    message: "Deseja continuar em segundo plano ou encerrar o P4J3 Prospect?",
    detail: "Campanhas interrompidas nunca serão retomadas automaticamente após um encerramento.",
    buttons: ["Continuar em segundo plano", "Encerrar P4J3 Prospect"],
    defaultId: 0,
    cancelId: 0,
    checkboxLabel: "Lembrar minha escolha",
    checkboxChecked: false,
  }).then((result) => {
    const behavior = result.response === 1 ? "quit" : "tray";
    if (result.checkboxChecked) saveDesktopPreferences({ closeBehavior: behavior });
    if (behavior === "quit") quitApplication();
    else hideMainWindow("close");
  }).catch((error) => {
    console.warn("[DESKTOP] close dialog:", error.message);
    hideMainWindow("close");
  }).finally(() => {
    closePromptInFlight = false;
  });
}

function pauseActiveCampaignsFromTray() {
  const activeCampaigns = (campaignManager?.getAll?.() || [])
    .filter((campaign) => ["running", "scheduled"].includes(campaign?.status));
  for (const campaign of activeCampaigns) {
    try {
      campaignManager.pause(campaign.id, "tray_safe_pause");
      safeSend("campaign-progress", { campaignId: campaign.id, event: "paused", data: { reason: "tray_safe_pause" } });
    } catch (error) {
      console.warn("[TRAY] campaign pause:", error.message);
    }
  }
      try { kanbanStore?.syncCampaigns(campaignsForKanban(), { replace: true, existingOnly: true }); } catch {}
  updateTray();
}

function registerDisplaySafety() {
  if (displaySafetyRegistered) return;
  displaySafetyRegistered = true;
  const reconcile = () => setTimeout(() => ensureWindowIsVisible(), 0);
  screen.on("display-added", reconcile);
  screen.on("display-removed", reconcile);
  screen.on("display-metrics-changed", reconcile);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
app.on("second-instance", () => restoreMainWindow());
app.on("activate", () => restoreMainWindow());
app.on("window-all-closed", () => {
  if (!isExitInProgress) updateTray();
});

function getSessionsRoot() {
  return path.join(app.getPath("userData"), "whatsapp-sessions");
}

function resolveSessionPath(connectionId) {
  return resolveInside(getSessionsRoot(), assertConnectionId(connectionId));
}

function rememberAllowedMediaPath(filePath) {
  if (!filePath) return;
  allowedMediaPaths.add(path.resolve(filePath));
  saveAllowedMediaPaths();
}

function getAllowedMediaStorePath() {
  return path.join(app.getPath("userData"), "allowed-media-paths.json");
}

function getWhatsAppSettingsPath() {
  return path.join(app.getPath("userData"), "whatsapp-settings.json");
}

function loadWhatsAppSettings() {
  if (cachedWhatsAppSettings) return cachedWhatsAppSettings;
  try {
    const filePath = getWhatsAppSettingsPath();
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      cachedWhatsAppSettings = {
        ...defaultWhatsAppSettings,
        ...raw,
        notifications: { ...defaultWhatsAppSettings.notifications, ...(raw.notifications || {}) },
        media: { ...defaultWhatsAppSettings.media, ...(raw.media || {}) },
        previews: { ...defaultWhatsAppSettings.previews, ...(raw.previews || {}) },
        groups: { ...defaultWhatsAppSettings.groups, ...(raw.groups || {}) },
        campaigns: normalizeCampaignSettings({
          ...defaultWhatsAppSettings.campaigns,
          ...(raw.campaigns || {}),
        }),
      };
      return cachedWhatsAppSettings;
    }
  } catch (e) {}
  cachedWhatsAppSettings = JSON.parse(JSON.stringify(defaultWhatsAppSettings));
  return cachedWhatsAppSettings;
}

function normalizeCampaignSettings(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  let dailyLimit = Number(input.dailyLimit);
  if (!LIMIT_TIERS.includes(dailyLimit)) dailyLimit = 10;
  let unlocked = Array.isArray(input.unlockedLimits)
    ? input.unlockedLimits.map(Number).filter((n) => LIMIT_TIERS.includes(n))
    : [10];
  if (!unlocked.includes(10)) unlocked = [10, ...unlocked];
  unlocked = [...new Set(unlocked)].sort((a, b) => a - b);
  // Garante que o limite atual está desbloqueado
  if (!unlocked.includes(dailyLimit) && !input.manualUnlimited) {
    dailyLimit = Math.max(...unlocked);
  }
  const hhmm = (v, fallback) => {
    const s = String(v || "").trim();
    return /^\d{1,2}:\d{2}$/.test(s) ? s.padStart(5, "0") : fallback;
  };
  let timeZone = "system";
  if (typeof input.timeZone === "string" && input.timeZone !== "system") {
    try {
      new Intl.DateTimeFormat("pt-BR", { timeZone: input.timeZone });
      timeZone = input.timeZone;
    } catch {
      timeZone = "system";
    }
  }
  return {
    dailyLimit,
    unlockedLimits: unlocked,
    manualUnlimited: !!input.manualUnlimited,
    workingHoursEnabled: input.workingHoursEnabled !== false,
    workingHoursStart: hhmm(input.workingHoursStart, "07:00"),
    workingHoursEnd: hhmm(input.workingHoursEnd, "18:00"),
    timeZone,
  };
}

function saveWhatsAppSettings(nextSettings) {
  cachedWhatsAppSettings = {
    ...defaultWhatsAppSettings,
    ...(nextSettings || {}),
    notifications: {
      ...defaultWhatsAppSettings.notifications,
      ...((nextSettings || {}).notifications || {}),
    },
    media: {
      ...defaultWhatsAppSettings.media,
      ...((nextSettings || {}).media || {}),
    },
    previews: {
      ...defaultWhatsAppSettings.previews,
      ...((nextSettings || {}).previews || {}),
    },
    groups: {
      ...defaultWhatsAppSettings.groups,
      ...((nextSettings || {}).groups || {}),
    },
    campaigns: normalizeCampaignSettings({
      ...defaultWhatsAppSettings.campaigns,
      ...((nextSettings || {}).campaigns || {}),
    }),
  };
  try {
    fs.writeFileSync(
      getWhatsAppSettingsPath(),
      JSON.stringify(cachedWhatsAppSettings, null, 2),
      { mode: 0o600 },
    );
  } catch (e) {}
  return cachedWhatsAppSettings;
}

function loadAllowedMediaPaths() {
  try {
    const storePath = getAllowedMediaStorePath();
    if (!fs.existsSync(storePath)) return;
    const paths = JSON.parse(fs.readFileSync(storePath, "utf-8"));
    if (Array.isArray(paths)) {
      paths.filter((p) => typeof p === "string").forEach((p) => allowedMediaPaths.add(path.resolve(p)));
    }
  } catch (e) {
    /* ignore */
  }
}

function saveAllowedMediaPaths() {
  if (!app.isReady()) return;
  try {
    const paths = [...allowedMediaPaths].slice(-1000);
    fs.writeFileSync(getAllowedMediaStorePath(), JSON.stringify(paths, null, 2), { mode: 0o600 });
  } catch (e) {
    /* ignore */
  }
}

function isInsideTriggerAudioDir(filePath) {
  try {
    const root = path.resolve(getTriggerAudioDir());
    const resolved = path.resolve(filePath);
    return resolved === root || resolved.startsWith(root + path.sep);
  } catch {
    return false;
  }
}

function resolveSelectedMediaPath(filePath, maxBytes, label) {
  // Cliques de gatilho em userData/trigger-audio são sempre permitidos
  if (typeof filePath === "string" && isInsideTriggerAudioDir(filePath)) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) throw new Error("Arquivo de áudio do gatilho não encontrado");
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error("Selected path is not a file");
    assertMaxBytes(stat.size, maxBytes, label);
    rememberAllowedMediaPath(resolved);
    return resolved;
  }
  const resolved = assertAllowedMediaPath(filePath, allowedMediaPaths);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error("Selected path is not a file");
  assertMaxBytes(stat.size, maxBytes, label);
  return resolved;
}

function sanitizeTemplate(template) {
  if (typeof template === "string") {
    return limitString(template, 4096);
  }
  const input = template && typeof template === "object" ? template : {};
  const output = {
    text: limitString(input.text, 4096),
    variables: Array.isArray(input.variables)
      ? input.variables.map((v) => limitString(v, 40)).slice(0, 50)
      : [],
  };
  if (input.header) output.header = limitString(input.header, 512);
  if (input.footer) output.footer = limitString(input.footer, 512);
  if (Array.isArray(input.buttons)) {
    output.buttons = input.buttons.slice(0, 3).map((button, index) => ({
      id: limitString(button.id || button.buttonId || `btn_${index + 1}`, 64),
      text: limitString(button.text || button.buttonText, 80),
    }));
  }
  if (input.media && input.media.filePath) {
    const mediaPath = resolveSelectedMediaPath(input.media.filePath, MAX_MEDIA_BYTES, "Media file");
    output.media = {
      filePath: mediaPath,
      fileName: path.basename(mediaPath),
      mimetype: limitString(input.media.mimetype, 120),
      ptt: !!input.media.ptt,
    };
  }
  return output;
}

/**
 * Aceita:
 * - telefone: "21999999999" / "+55..."
 * - grupo: "120363...@g.us"
 * - objeto: { phone, jid, name, isGroup, source }
 */
function sanitizeCampaignRecipient(raw) {
  if (raw == null) return null;

  // string pura
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return null;
    if (s.endsWith("@g.us") || s.includes("@g.us")) {
      const jid = s.includes("@") ? s : `${s}@g.us`;
      return {
        leadId: `grp_${jid}`,
        name: jid.split("@")[0],
        phone: jid,
        phoneRaw: s,
        jid,
        isGroup: true,
        source: "group",
      };
    }
    const normalized = normalizePhone(s);
    if (!normalized.valid) return null;
    return {
      leadId: normalized.number,
      name: "",
      phone: normalized.number,
      phoneRaw: s,
      jid: `${normalized.number}@s.whatsapp.net`,
      isGroup: false,
      source: "manual",
    };
  }

  if (typeof raw !== "object") return null;

  const name = limitString(normalizeText(raw.name || raw.company || raw.notify || ""), 120, "");
  const source = limitString(raw.source || "manual", 40, "manual");
  const kanbanStage = ["new", "conversation", "finished"].includes(raw.kanbanStage)
    ? raw.kanbanStage
    : null;
  const kanbanOrder = Number.isFinite(Number(raw.kanbanOrder))
    ? Number(raw.kanbanOrder)
    : null;
  const jidRaw = String(raw.jid || raw.phone || "").trim();

  // Grupo WhatsApp
  if (
    raw.isGroup === true ||
    jidRaw.endsWith("@g.us") ||
    String(raw.phone || "").includes("@g.us")
  ) {
    let jid = jidRaw || String(raw.phone || "").trim();
    if (!jid) return null;
    if (!jid.includes("@")) jid = `${jid}@g.us`;
    if (!jid.endsWith("@g.us")) return null;
    let connectionId = null;
    if (raw.connectionId) {
      try {
        connectionId = assertConnectionId(raw.connectionId);
      } catch {
        connectionId = null;
      }
    }
    return {
      leadId: limitString(raw.leadId || `grp_${jid}`, 120, `grp_${jid}`),
      name: name || jid.split("@")[0],
      phone: jid,
      phoneRaw: raw.phoneRaw || jid,
      jid,
      isGroup: true,
      source: source === "manual" ? "group" : source,
      connectionId,
      company: limitString(normalizeText(raw.company || name), 120, ""),
      category: limitString(normalizeText(raw.category), 80, "grupo"),
      kanbanStage,
      kanbanOrder,
    };
  }

  // Contato / lead com telefone
  const rawPhone = raw.phone || raw.phoneRaw || (jidRaw.includes("@") ? jidRaw.replace(/@.*$/, "") : jidRaw);
  const normalized = normalizePhone(String(rawPhone || ""));
  if (!normalized.valid) return null;
  const jid =
    jidRaw.endsWith("@s.whatsapp.net") || jidRaw.endsWith("@lid")
      ? jidRaw
      : `${normalized.number}@s.whatsapp.net`;
  let connectionId = null;
  if (raw.connectionId) {
    try {
      connectionId = assertConnectionId(raw.connectionId);
    } catch {
      connectionId = null;
    }
  }
  return {
    leadId: limitString(raw.leadId || raw.id || normalized.number, 120, normalized.number),
    name,
    phone: normalized.number,
    phoneRaw: String(rawPhone || normalized.number),
    jid,
    isGroup: false,
    source,
    connectionId,
    company: limitString(normalizeText(raw.company || name), 120, ""),
    category: limitString(normalizeText(raw.category), 80, ""),
    website: limitString(raw.website || raw.site, 240, ""),
    site: limitString(raw.website || raw.site, 240, ""),
    instagram: limitString(raw.instagram, 120, ""),
    email: limitString(raw.email, 160, ""),
    address: limitString(normalizeAddress(raw.address), 240, ""),
    rating: raw.rating || "",
    totalReviews: raw.totalReviews || "",
    score: raw.score || "",
    prioridade: limitString(raw.prioridade, 40, ""),
    // Campos da análise de IA e da pesquisa do lead: sem eles as variáveis
    // {{mensagem_whatsapp_ia}}, {{saudacao}} etc. chegavam vazias no disparo.
    dor_principal: limitString(raw.dor_principal, 400, ""),
    oportunidade_principal: limitString(raw.oportunidade_principal, 400, ""),
    argumento_principal: limitString(raw.argumento_principal, 400, ""),
    mensagem_whatsapp_ia: limitString(raw.mensagem_whatsapp_ia, 1000, ""),
    ticket_estimado: limitString(raw.ticket_estimado, 80, ""),
    chance_resposta: limitString(raw.chance_resposta, 40, ""),
    decisor: limitString(typeof raw.decisor === "object" ? raw.decisor?.nome : raw.decisor, 120, ""),
    saudacao: limitString(raw.saudacao, 80, ""),
    kanbanStage,
    kanbanOrder,
  };
}

function sanitizeCampaignData(data) {
  const input = data && typeof data === "object" ? data : {};
  const leads = Array.isArray(input.leadIds) ? input.leadIds.slice(0, 5000) : [];
  const seen = new Set();
  const normalizedLeads = [];
  for (const lead of leads) {
    const item = sanitizeCampaignRecipient(lead);
    if (!item) continue;
    const key = item.isGroup ? `g:${item.jid}` : `p:${item.phone}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalizedLeads.push(item);
  }
  if (!normalizedLeads.length) {
    throw new Error("Nenhum destinatário válido (telefone ou grupo)");
  }
  const intervalMs = clampInteger(input.schedule?.intervalMs, 5000, 60 * 60 * 1000, 30000);
  let connectionIds = [];
  if (Array.isArray(input.connectionIds)) {
    for (const rawId of input.connectionIds) {
      try {
        const id = assertConnectionId(rawId);
        if (!connectionIds.includes(id)) connectionIds.push(id);
      } catch {
        /* skip invalid */
      }
    }
  }
  let connectionId = null;
  if (input.connectionId) {
    try {
      connectionId = assertConnectionId(input.connectionId);
    } catch {
      connectionId = null;
    }
  }
  if (!connectionId && connectionIds[0]) connectionId = connectionIds[0];
  if (connectionId && !connectionIds.includes(connectionId)) {
    connectionIds = [connectionId, ...connectionIds];
  }

  // Propaga connectionId por lead (round-robin se multi e lead sem id)
  const leadsWithConn = normalizedLeads.map((lead, idx) => {
    let leadConn = lead.connectionId || null;
    if (leadConn) {
      try {
        leadConn = assertConnectionId(leadConn);
      } catch {
        leadConn = null;
      }
    }
    if (!leadConn && connectionIds.length) {
      leadConn = connectionIds[idx % connectionIds.length];
    }
    return { ...lead, connectionId: leadConn };
  });

  let workingHours = null;
  if (input.schedule?.workingHours && typeof input.schedule.workingHours === "object") {
    const wh = input.schedule.workingHours;
    workingHours = {
      enabled: wh.enabled !== false,
      start: limitString(wh.start || "07:00", 8, "07:00"),
      end: limitString(wh.end || "18:00", 8, "18:00"),
    };
  }
  const scheduleTimeZone =
    typeof input.schedule?.timeZone === "string" && input.schedule.timeZone
      ? limitString(input.schedule.timeZone, 80)
      : null;

  const groupIds = Array.isArray(input.groupIds)
    ? [...new Set(input.groupIds.map((g) => limitString(String(g || ""), 80)).filter(Boolean))].slice(0, 20)
    : [];

  return {
    ...input,
    id: input.id ? limitString(input.id, 80) : undefined,
    name: limitString(input.name, 160, "Campanha"),
    provider: input.provider === "meta" ? "meta" : "baileys",
    connectionId,
    connectionIds,
    groupIds,
    groupId: input.groupId ? limitString(String(input.groupId), 80) : (groupIds[0] || null),
    groupName: input.groupName ? limitString(String(input.groupName), 160) : "",
    template: sanitizeTemplate(input.template),
    leadIds: leadsWithConn,
    schedule: {
      mode: ["immediate", "interval", "scheduled"].includes(input.schedule?.mode)
        ? input.schedule.mode
        : "interval",
      intervalMs,
      startAt: input.schedule?.startAt == null || input.schedule.startAt === ""
        ? null
        : (Number.isFinite(Number(input.schedule.startAt)) ? Number(input.schedule.startAt) : null),
      workingHours,
      timeZone: scheduleTimeZone,
    },
  };
}

function sanitizeCampaignUpdates(updates) {
  const input = updates && typeof updates === "object" ? { ...updates } : {};
  if (input.connectionId) input.connectionId = assertConnectionId(input.connectionId);
  if (Array.isArray(input.connectionIds)) {
    const ids = [];
    for (const rawId of input.connectionIds) {
      try {
        const id = assertConnectionId(rawId);
        if (!ids.includes(id)) ids.push(id);
      } catch {
        /* skip invalid */
      }
    }
    input.connectionIds = ids;
    if (input.connectionId && !ids.includes(input.connectionId)) {
      input.connectionIds = [input.connectionId, ...ids];
    }
  } else if (input.connectionId) {
    input.connectionIds = [input.connectionId];
  }
  if (input.template) input.template = sanitizeTemplate(input.template);
  // Grupo vinculado (1 campanha = 1 grupo). Só toca quando a chave vem no
  // payload — atualizações parciais (ex.: mover card no Kanban) preservam.
  if ("groupId" in input) input.groupId = input.groupId ? limitString(String(input.groupId), 80) : null;
  if ("groupName" in input) input.groupName = input.groupName ? limitString(String(input.groupName), 160) : "";
  if ("groupIds" in input) {
    input.groupIds = Array.isArray(input.groupIds)
      ? [...new Set(input.groupIds.map((g) => limitString(String(g || ""), 80)).filter(Boolean))].slice(0, 20)
      : [];
  }
  if (input.media && input.media.filePath) {
    const mediaPath = resolveSelectedMediaPath(input.media.filePath, MAX_MEDIA_BYTES, "Media file");
    input.media = { ...input.media, filePath: mediaPath, fileName: path.basename(mediaPath) };
  }
  if (input.name) input.name = limitString(input.name, 160);
  if (input.status && ["running", "scheduled"].includes(input.status)) {
    throw new Error("Use Iniciar/Retomar para ativar a campanha em vez de editar o status.");
  }
  if (input.status && !["ready", "paused", "completed", "cancelled"].includes(input.status)) {
    throw new Error("Invalid campaign status");
  }
  // Agendamento: mesmo padrão do create (modo / intervalo / início / janela).
  // Permite editar campanha pausada/pronta e reagendar disparo direto.
  if (input.schedule && typeof input.schedule === "object") {
    const s = input.schedule;
    const mode = ["immediate", "interval", "scheduled"].includes(s.mode) ? s.mode : "interval";
    const intervalMs = clampInteger(s.intervalMs, 5000, 60 * 60 * 1000, 30000);
    let startAt = s.startAt == null || s.startAt === ""
      ? null
      : (Number.isFinite(Number(s.startAt)) ? Number(s.startAt) : null);
    // Disparo direto (immediate/interval) nunca carrega startAt residual.
    if (mode !== "scheduled") startAt = null;
    let workingHours = null;
    if (s.workingHours === null) {
      workingHours = null;
    } else if (s.workingHours && typeof s.workingHours === "object") {
      workingHours = {
        enabled: s.workingHours.enabled !== false,
        start: limitString(s.workingHours.start || "07:00", 8, "07:00"),
        end: limitString(s.workingHours.end || "18:00", 8, "18:00"),
      };
    }
    input.schedule = {
      mode,
      intervalMs,
      startAt,
      workingHours,
      timeZone: typeof s.timeZone === "string" && s.timeZone ? limitString(s.timeZone, 80) : null,
    };
  }
  // Permite editar a lista de destinatários (leadIds ou leads)
  if (Array.isArray(input.leadIds) || Array.isArray(input.leads)) {
    const rawList = Array.isArray(input.leadIds) ? input.leadIds : input.leads;
    const seen = new Set();
    const leads = [];
    for (const item of rawList.slice(0, 5000)) {
      const row = sanitizeCampaignRecipient(item);
      if (!row) continue;
      const key = row.isGroup ? `g:${row.jid}` : `p:${row.phone}`;
      if (seen.has(key)) continue;
      seen.add(key);
      leads.push({
        ...row,
        status: item?.status && ["pending", "sent", "failed", "delivered", "read", "replied"].includes(item.status)
          ? item.status
          : "pending",
        errorMessage: item?.errorMessage || null,
        sentAt: item?.sentAt || null,
        deliveredAt: item?.deliveredAt || null,
        readAt: item?.readAt || null,
        repliedAt: item?.repliedAt || null,
        lastReplyAt: item?.lastReplyAt || null,
        responseTimeMs: item?.responseTimeMs ?? null,
        messageId: item?.messageId || null,
        retryCount: item?.retryCount || 0,
        openCount: Number(item?.openCount) || 0,
        openedAt: item?.openedAt || null,
        lastOpenAt: item?.lastOpenAt || null,
        replyCount: Number(item?.replyCount) || 0,
        replyTimestamps: Array.isArray(item?.replyTimestamps) ? item.replyTimestamps : [],
        kanbanStage: ["new", "conversation", "finished"].includes(item?.kanbanStage)
          ? item.kanbanStage
          : null,
        kanbanOrder: Number.isFinite(Number(item?.kanbanOrder))
          ? Number(item.kanbanOrder)
          : null,
      });
    }
    if (!leads.length) throw new Error("Lista de destinatários ficou vazia");
    input.leads = leads;
    delete input.leadIds;
    try {
      const { recomputeStats } = require("./campaigns/campaign-analytics");
      input.stats = recomputeStats({ leads });
    } catch {
      input.stats = {
        total: leads.length,
        pending: leads.filter((l) => l.status === "pending").length,
        sent: leads.filter((l) => ["sent", "delivered", "read", "replied"].includes(l.status)).length,
        delivered: leads.filter((l) => ["delivered", "read", "replied"].includes(l.status)).length,
        read: leads.filter((l) => ["read", "replied"].includes(l.status)).length,
        replied: leads.filter((l) => l.repliedAt).length,
        failed: leads.filter((l) => l.status === "failed").length,
        avgResponseTimeMs: 0,
      };
    }
  }
  return input;
}

function mergeWhatsAppSettingsPatch(base, patch) {
  const input = patch && typeof patch === "object" ? patch : {};
  return {
    ...base,
    ...input,
    notifications: {
      ...base.notifications,
      ...(input.notifications || {}),
    },
    media: {
      ...base.media,
      ...(input.media || {}),
    },
    previews: {
      ...base.previews,
      ...(input.previews || {}),
    },
    groups: {
      ...base.groups,
      ...(input.groups || {}),
    },
    campaigns: normalizeCampaignSettings({
      ...(base.campaigns || defaultWhatsAppSettings.campaigns),
      ...(input.campaigns || {}),
    }),
  };
}

function getStickerStorePath() {
  return path.join(app.getPath("userData"), "whatsapp-stickers.json");
}

function loadStickerStore() {
  try {
    const filePath = getStickerStorePath();
    if (!fs.existsSync(filePath)) return [];
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Array.isArray(raw)
      ? raw.filter((item) => item?.filePath && fs.existsSync(item.filePath))
      : [];
  } catch (e) {
    return [];
  }
}

function saveStickerStore(stickers) {
  try {
    fs.writeFileSync(
      getStickerStorePath(),
      JSON.stringify(Array.isArray(stickers) ? stickers : [], null, 2),
      { mode: 0o600 },
    );
  } catch (e) {}
}

async function fetchLinkPreview(url) {
  if (!isHttpUrl(url)) throw new Error("Invalid URL");
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  const html = await res.text();
  const attr = (tag, name) => {
    const match = tag.match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
    return match ? match[1].trim() : "";
  };
  const pickMeta = (key, value) => {
    const tags = html.match(/<meta\b[^>]*>/gi) || [];
    for (const tag of tags) {
      if (attr(tag, key).toLowerCase() === value.toLowerCase()) {
        return attr(tag, "content");
      }
    }
    return "";
  };
  const pickTitle = () => {
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match ? match[1].trim() : "";
  };
  const title =
    pickMeta("property", "og:title") ||
    pickMeta("name", "twitter:title") ||
    pickTitle();
  const description =
    pickMeta("property", "og:description") ||
    pickMeta("name", "twitter:description") ||
    pickMeta("name", "description");
  const image = pickMeta("property", "og:image") || pickMeta("name", "twitter:image");
  const siteName = pickMeta("property", "og:site_name");
  return {
    success: true,
    url,
    title: limitString(title, 180),
    description: limitString(description, 240),
    image: limitString(image, 1024),
    siteName: limitString(siteName, 120),
    host: new URL(url).host,
  };
}

function safeSend(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    try {
      mainWindow.webContents.send(channel, ...args);
    } catch (e) {
      console.error(`Failed to send on channel ${channel}:`, e);
    }
  }
}

function sendAppMetrics(channel, payload) {
  safeSend(channel, payload);
}

/**
 * Carrega UI direto de renderer/dist (sem TEMP sticky).
 * Obs: NÃO bloqueia a string "monStats" no JS — ela só aparece no detector
 * de sessão antiga do ErrorBoundary, não no bug do monitor (já removido).
 */
function getUiIndexPath() {
  const indexSrc = path.join(__dirname, "renderer", "dist", "index.html");
  if (!fs.existsSync(indexSrc)) {
    throw new Error(`UI não encontrada: ${indexSrc}. Rode: npm run build:renderer`);
  }
  return indexSrc;
}

function purgeOldUiTemps() {
  try {
    const tempRoot = app.getPath("temp");
    for (const name of fs.readdirSync(tempRoot)) {
      if (!name.startsWith("sigma-ui-")) continue;
      try {
        fs.rmSync(path.join(tempRoot, name), { recursive: true, force: true });
      } catch { /* ignore lock */ }
    }
  } catch (e) {
    console.warn("[WINDOW] limpeza temp:", e.message);
  }
}

/** Assets atualmente no dist — qualquer outro index-*.js é lixo de cache */
function getAllowedUiAssetNames() {
  try {
    const assetsDir = path.join(__dirname, "renderer", "dist", "assets");
    if (!fs.existsSync(assetsDir)) return new Set();
    return new Set(fs.readdirSync(assetsDir));
  } catch {
    return new Set();
  }
}

function getCurrentUiStamp() {
  try {
    const html = fs.readFileSync(getUiIndexPath(), "utf8");
    const m = html.match(/sigma-ui-build"\s+content="([^"]+)"/i)
      || html.match(/\?v=(ui-[a-z0-9]+)/i)
      || html.match(/(?:P4J3 Prospect|Sigma Control Center) · (ui-[a-z0-9]+)/i);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

async function loadAppUi(win) {
  if (!win || win.isDestroyed()) return;
  purgeOldUiTemps();
  const ses = win.webContents.session;
  try {
    await ses.clearCache();
  } catch { /* ignore */ }
  try {
    await ses.clearStorageData({
      storages: ["cachestorage", "serviceworkers", "shadercache"],
    });
  } catch { /* ignore */ }
  try {
    const userData = app.getPath("userData");
    for (const dir of ["Cache", "Code Cache", "GPUCache", "Service Worker", "Shared Dictionary"]) {
      const full = path.join(userData, dir);
      if (fs.existsSync(full)) fs.rmSync(full, { recursive: true, force: true });
    }
  } catch (e) {
    console.warn("[WINDOW] cache disk:", e.message);
  }

  const indexHtml = getUiIndexPath();
  const stamp = getCurrentUiStamp();
  const assets = [...getAllowedUiAssetNames()];
  console.log("[WINDOW] carregando UI de:", indexHtml);
  console.log("[WINDOW] stamp:", stamp || "(?)");
  console.log("[WINDOW] assets permitidos:", assets.join(", ") || "(nenhum)");
  await win.loadFile(indexHtml);
}

function createWindow() {
  const restoredState = readWindowState(
    app.getPath("userData"),
    getWindowDisplays(),
    DEFAULT_WINDOW_BOUNDS,
  );
  mainWindow = new BrowserWindow({
    x: restoredState.bounds.x,
    y: restoredState.bounds.y,
    width: restoredState.bounds.width,
    height: restoredState.bounds.height,
    minWidth: DEFAULT_WINDOW_BOUNDS.minWidth,
    minHeight: DEFAULT_WINDOW_BOUNDS.minHeight,
    frame: false,
    show: false,
    title: "P4J3 Prospect",
    icon: path.join(__dirname, "assets", "icon.ico"),
    backgroundColor: resolveWindowBgColor(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  if (restoredState.isMaximized) mainWindow.maximize();

  const ses = mainWindow.webContents.session;
  // Bloqueia bundles mortos + qualquer index-*.js que não exista no dist atual
  ses.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url || "";
    // hashes / sessões antigas conhecidas (inclui o stack do user: 7F4QwPd2 / ui-mrfg9u99)
    if (
      /BC5opcok|rad4ZrnG|7F4QwPd2|CaedZwU-|Dj5wJ2qb|DcxOVIQk|index-[A-Za-z0-9_-]+\.js|ui-mrfg9u99|ui-mrfgdzq8|ui-mrfggm2t|ui-mrfglw3f|sigma-ui-1783703330457/i.test(
        url,
      )
    ) {
      console.error("[WINDOW] BLOQUEADO asset antigo:", url);
      callback({ cancel: true });
      return;
    }
    const assetMatch = url.match(/\/assets\/(index-[^/?#]+\.(?:js|css))(?:\?|$)/i);
    if (assetMatch) {
      const allowed = getAllowedUiAssetNames();
      if (allowed.size > 0 && !allowed.has(assetMatch[1])) {
        console.error("[WINDOW] BLOQUEADO asset fora do dist:", assetMatch[1], "url=", url);
        callback({ cancel: true });
        return;
      }
    }
    callback({});
  });

  loadAppUi(mainWindow).catch((err) => {
    console.error("[WINDOW] falha ao carregar UI:", err.message);
    dialog.showErrorBox("UI não carregou", err.message);
  });

  mainWindow.webContents.on("did-finish-load", () => {
    applyUiZoom(mainWindow);
    const expectedStamp = getCurrentUiStamp();
    const allowed = [...getAllowedUiAssetNames()];
    mainWindow.webContents
      .executeJavaScript(`(function(){
        try {
          localStorage.removeItem('sigma_last_react_error');
          localStorage.removeItem('sigma_last_react_error_at');
        } catch (e) {}
        var scripts = [...document.scripts].map(function(s){ return s.src || ''; });
        var meta = (document.querySelector('meta[name="sigma-ui-build"]') || {}).content || '';
        var hasOld = scripts.some(function(s){
          return /BC5opcok|rad4ZrnG|7F4QwPd2|CaedZwU-|Dj5wJ2qb|ui-mrfg9u99|sigma-ui-/i.test(s);
        });
        var expected = ${JSON.stringify(expectedStamp)};
        var allowed = ${JSON.stringify(allowed)};
        var badScript = scripts.some(function(s){
          var m = s.match(/\\/assets\\/(index-[^/?#]+\\.js)/i);
          return m && allowed.length && allowed.indexOf(m[1]) < 0;
        });
        var stampMismatch = expected && meta && expected !== meta;
        return {
          title: document.title,
          scripts: scripts,
          href: location.href,
          meta: meta,
          expected: expected,
          hasOld: hasOld || badScript || stampMismatch,
          reason: hasOld ? 'old-hash' : badScript ? 'not-in-dist' : stampMismatch ? 'stamp-mismatch' : ''
        };
      })()`)
      .then((info) => {
        console.log("[WINDOW] UI carregada:", JSON.stringify(info));
        if (info?.hasOld) {
          console.warn("[WINDOW] UI antiga detectada (", info.reason, ") — forçando reload do dist");
          loadAppUi(mainWindow).catch(() => {});
        }
      })
      .catch(() => {});
  });

  mainWindow.webContents.on("console-message", (event, level, message, line, sourceId) => {
    console.log(`[RENDERER CONSOLE] ${message} (line ${line}) ${sourceId || ""}`);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const currentUrl = mainWindow.webContents.getURL();
    if (url !== currentUrl) {
      event.preventDefault();
      if (isHttpUrl(url)) shell.openExternal(url).catch(() => {});
    }
  });
  mainWindow.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      const allowed =
        webContents === mainWindow.webContents &&
        ["media", "microphone", "audioCapture", "notifications", "geolocation"].includes(permission);
      callback(allowed);
    },
  );
  // Electron 28+: checagem síncrona também precisa liberar microfone
  mainWindow.webContents.session.setPermissionCheckHandler(
    (webContents, permission) => {
      if (webContents !== mainWindow.webContents) return false;
      return ["media", "microphone", "audioCapture", "notifications", "clipboard-read", "geolocation"].includes(
        permission,
      );
    },
  );

  mainWindow.on("maximize", () =>
    {
      safeSend("win-state", true);
      scheduleWindowStateSave();
    },
  );
  mainWindow.on("unmaximize", () =>
    {
      safeSend("win-state", false);
      scheduleWindowStateSave();
    },
  );
  mainWindow.on("move", scheduleWindowStateSave);
  mainWindow.on("resize", scheduleWindowStateSave);
  mainWindow.on("minimize", (event) => {
    if (isExitInProgress) return;
    event.preventDefault();
    hideMainWindow("minimize");
  });
  mainWindow.on("close", (event) => {
    if (isExitInProgress) return;
    event.preventDefault();
    requestWindowClose();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    updateTray();
  });

  mainWindow.once("ready-to-show", () => {
    ensureWindowIsVisible();
    mainWindow.show();
    mainWindow.focus();
    updateTray();
  });
}

app.whenReady().then(() => {
  registerDisplaySafety();
  initializeTray();
  try {
    const migration = migrateExistingData(app.getPath("userData"));
    if (migration.changed) {
      console.log("[DATA-MIGRATION] Existing data normalized:", JSON.stringify(migration));
    }
  } catch (error) {
    // A migration failure must never prevent the desktop shell from opening.
    console.warn("[DATA-MIGRATION] skipped:", error.message);
  }
  createWindow();
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
  loadAllowedMediaPaths();
  loadWhatsAppSettings();
  cleanOldTempFiles();
  try { ensureInstallId(); } catch {}
  try { appMetrics.track("app_open"); } catch {}
  try { autoUpdaterMod.init((ch, payload) => safeSend(ch, payload)); } catch (e) { console.warn("[UPDATER] init:", e.message); }
  agentStore = new AgentStore(app.getPath("userData"), {
    onLog: (entry) => safeSend("agent-log", entry),
  });
  triageStore = new TriageStore(app.getPath("userData"), {
    onChange: (changed) => safeSend("triage-changed", changed),
  });
  leadMemory = new LeadMemory(app.getPath("userData"));
  sendQueue = new SendQueue(app.getPath("userData"), {
    onChange: (snapshot) => safeSend("queue-changed", snapshot),
  });
  // Envio aprovado sai no ritmo seguro; recontato é planejado de hora em hora (24/7).
  setInterval(() => queueTick().catch((error) => console.warn("[FILA] envio:", error.message)), 15000);
  setInterval(() => planQueueRecontacts().catch((error) => console.warn("[FILA] recontato:", error.message)), 60 * 60 * 1000);
  setTimeout(() => planQueueRecontacts().catch(() => {}), 60000);
  // Backup diário (mantém 7 dias): confere 2 min após abrir e a cada 6 h.
  const dailyBackup = () => {
    try {
      if (!hasBackupToday(app.getPath("userData"))) runBackup(app.getPath("userData"));
    } catch (error) {
      console.warn("[BACKUP]", error.message);
    }
  };
  setTimeout(dailyBackup, 2 * 60 * 1000);
  setInterval(dailyBackup, 6 * 60 * 60 * 1000);
  contactStatus = new ContactStatusStore(app.getPath("userData"), {
    onChange: (phone, entry) => {
      safeSend("contact-status-changed", { phone, entry });
      if (sendQueue?.historyFor(phone).length) scheduleKanbanQueueSync();
      if (entry?.status === "respondeu" && entry.lastReplyAt && Date.now() - entry.lastReplyAt < 120000
        && notifiedReplies.get(phone) !== entry.lastReplyAt) {
        notifiedReplies.set(phone, entry.lastReplyAt);
        notifyUser({
          title: `${entry.name || "Um lead"} respondeu!`,
          body: "Responda rápido: velocidade de resposta é o que mais fecha venda. Use “Sugerir resposta” no WhatsApp.",
        });
        safeSend("lead-replied", { phone, name: entry.name || "" });
        safeSend("jarvis-say", { text: `Senhor, ${entry.name || "um lead"} respondeu.`, priority: true });
      }
    },
  });
  // Contatados sempre atualizados: logo após abrir e a cada 15 min (pega o que foi enviado pelo celular).
  // A rodada de 15 min também confere a conexão e reconecta se tiver caído.
  scheduleContactHistorySync(20000);
  setInterval(() => {
    refreshWhatsApp({ auto: true }).catch((error) => console.warn("[WA-REFRESH]", error.message));
  }, 15 * 60 * 1000);
  setupAutopilot();
  campaignManager = new CampaignManager(app.getPath("userData"));
  campaignManager.setProvidersMap(whatsappProviders);
  campaignManager.setCampaignSettingsProvider(() => {
    const s = loadWhatsAppSettings();
    return s?.campaigns || defaultWhatsAppSettings.campaigns;
  });
  const bootRecovery = campaignManager.interruptForRestart();
  if (bootRecovery.interruptedCount > 0) {
    console.log(`[CAMPAIGN] Recovery confirmation required for ${bootRecovery.interruptedCount} campaign(s).`);
  }
  if (bootRecovery.missedCount > 0) {
    console.log(`[CAMPAIGN] ${bootRecovery.missedCount} campaign(s) paused for missed schedule (recovery popup on UI).`);
  }
  const rearmed = campaignManager.rearmScheduled();
  if (rearmed > 0) {
    console.log(`[CAMPAIGN] ${rearmed} future scheduled campaign(s) re-armed automatically.`);
  }
  leadScoringService = new LeadScoringService(app.getPath("userData"), (payload) => {
    safeSend("lead-scoring-progress", payload);
  }, { secretBox: createSecretBox(safeStorage) });
  kanbanStore = new KanbanStore(app.getPath("userData"));
  campaignManager.setProgressCallback((campaignId, event, data) => {
    if (event === "lead-sent") recordCampaignContact(campaignId, data?.leadId);
    // Analista reescreve o playbook a cada 25 novos envios e ao fim da campanha.
    if (event === "completed" || event === "lead-sent") {
      runAnalystAgent({ auto: true }).catch(() => {});
    }
  try { kanbanStore?.syncCampaigns(campaignsForKanban(), { replace: true, existingOnly: true }); } catch (error) { console.warn("[KANBAN] campaign sync:", error.message); }
    safeSend("campaign-progress", {
      campaignId,
      event,
      data,
    });
    try {
      const campaign = campaignManager?.get?.(campaignId);
      const name = campaign?.name || "Campanha";
      if (event === "completed") {
        notifyUser({ title: "Campanha concluída", body: `“${name}” terminou os disparos.` });
      } else if (event === "daily-limit") {
        notifyUser({ title: "Limite diário atingido", body: `“${name}” pausada. A cota renova amanhã — ou retome quando quiser.` });
      } else if (event === "waiting" && data?.reason === "no_provider") {
        notifyUser({ title: "WhatsApp desconectado", body: `“${name}” aguardando conexão para continuar.` });
      } else if (event === "waiting" && data?.reason === "outside_hours") {
        notifyUser({ title: "Fora do horário", body: `“${name}” em espera e retoma na janela de disparo.` });
      }
    } catch {}
    refreshBackgroundHolds();
  });

  // Auto-reconnect saved WhatsApp sessions after renderer loads
  mainWindow.webContents.on("did-finish-load", () => {
    if (process.env.SIGMA_QA !== "1") setTimeout(() => autoReconnectSessions(), 2000);
  });
});

async function autoReconnectSessions() {
  const sessionsDir = getSessionsRoot();
  if (!fs.existsSync(sessionsDir)) return;

  let dirs;
  try {
    dirs = fs.readdirSync(sessionsDir).filter((d) => {
      try {
        assertConnectionId(d);
      } catch (e) {
        return false;
      }
      const fullPath = path.join(sessionsDir, d);
      return (
        fs.statSync(fullPath).isDirectory() &&
        fs.existsSync(path.join(fullPath, "whatsapp-auth", "creds.json"))
      );
    });
  } catch (e) {
    return;
  }

  if (dirs.length === 0) return;
  console.log("[AUTO-RECONNECT] Found", dirs.length, "saved session(s)");

  for (const dirName of dirs) {
    const sessionPath = path.join(sessionsDir, dirName);
    try {
      // Skip if already connected
      if (whatsappProviders.has(dirName)) continue;

      console.log("[AUTO-RECONNECT] Reconnecting:", dirName);
      sendWaStatus("connecting", {
        connectionId: dirName,
        msg: "Reconectando sessão salva...",
      });

      const provider = WhatsAppProviderFactory(
        "baileys",
        {},
        (status, data) => sendWaStatus(status, { ...(data || {}), connectionId: dirName }),
        (event) => onChatEvent({ ...event, connectionId: dirName }),
        sessionPath,
      );
      whatsappProviders.set(dirName, provider);
      // Só assume como ativa se ainda não houver ativa online
      const currentActive = activeWhatsAppId
        ? whatsappProviders.get(activeWhatsAppId)
        : null;
      if (
        !currentActive ||
        currentActive.getStatus?.() !== "connected"
      ) {
        activeWhatsAppId = dirName;
      }

      await provider.connect();

      // Prefere como ativa a sessão que acabou de ficar online
      if (provider.getStatus?.() === "connected") {
        activeWhatsAppId = dirName;
      }

      console.log("[AUTO-RECONNECT] Success:", dirName, provider.getPhoneNumber());
    } catch (e) {
      console.log("[AUTO-RECONNECT] Failed:", dirName, e.message);
      // Clean up failed provider
      whatsappProviders.delete(dirName);
      if (activeWhatsAppId === dirName) {
        // Prefere outra sessão já online
        const online = [...whatsappProviders.entries()].find(
          ([, p]) => p?.getStatus?.() === "connected"
        );
        activeWhatsAppId =
          online?.[0] || whatsappProviders.keys().next().value || null;
      }
      // If logged out, the creds were cleared by baileys-provider
      // so next start won't try to reconnect this session
    }
  }

  // Snapshot final para a UI (bolinha / lista) após reconectar N sessões
  try {
    const agg = getAggregateWhatsAppStatus();
    // Se a ativa não está online, aponta para qualquer online
    if (agg.connections?.length) {
      const activeOk = agg.connections.find(
        (c) => c.id === activeWhatsAppId && c.connected
      );
      if (!activeOk) {
        const firstOnline = agg.connections.find((c) => c.connected);
        if (firstOnline) activeWhatsAppId = firstOnline.id;
      }
    }
    const finalAgg = getAggregateWhatsAppStatus();
    safeSend("whatsapp-status-changed", {
      status: finalAgg.status,
      aggregateStatus: finalAgg.status,
      anyConnected: finalAgg.connected,
      connectionId: finalAgg.activeConnectionId,
      data: {
        connections: finalAgg.connections,
        aggregateStatus: finalAgg.status,
        anyConnected: finalAgg.connected,
        activeConnectionId: finalAgg.activeConnectionId,
        phoneNumber: finalAgg.phoneNumber,
        msg: "Auto-reconnect finished",
      },
    });
  } catch (e) {
    /* ignore */
  }
}

app.on("before-quit", async () => {
  isExitInProgress = true;
  if (windowStateSaveTimer) clearTimeout(windowStateSaveTimer);
  persistWindowState();
  try { leadsFileStore?.flush(); } catch (error) { console.warn("[LEADS-STORE] flush:", error.message); }
  try { contactStatus?.flush(); } catch (error) { console.warn("[CONTACT-STATUS] flush:", error.message); }
  try {
    if (powerBlockerId !== null) powerSaveBlocker.stop(powerBlockerId);
  } catch {}
  powerBlockerId = null;
  try { tray?.destroy(); } catch {}
  tray = null;
  try { autoUpdaterMod.shutdown(); } catch {}
  if (campaignManager) campaignManager.shutdown();
  for (const provider of whatsappProviders.values()) {
    try {
      await provider.disconnect();
    } catch (e) {
      /* ignore */
    }
  }
  whatsappProviders.clear();
  activeWhatsAppId = null;
});

// Clean temp files older than 24h
async function cleanOldTempFiles() {
  try {
    const userDataPath = app.getPath("userData");
    const files = fs.readdirSync(userDataPath);
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (
        (file.startsWith("gmaps_") ||
          file.startsWith("sigma_leads_") ||
          file.startsWith("campaign_")) &&
        (file.endsWith(".json") ||
          file.endsWith(".csv") ||
          file.endsWith(".txt"))
      ) {
        const filePath = path.join(userDataPath, file);
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > oneDay) {
          fs.unlinkSync(filePath);
        }
      }
    }
  } catch (e) {
    /* ignore cleanup errors */
  }
}

function sendProgress(msg) {
  safeSend("progress", msg);
}

function requireKanbanStore() {
  if (!kanbanStore) throw new Error("Kanban ainda está inicializando.");
  return kanbanStore;
}

function syncKanbanServiceSources() {
  const store = requireKanbanStore();
  // `replace: true` faz o quadro espelhar as fontes: lead que saiu da base ou
  // da campanha desaparece do Kanban em vez de ficar preso para sempre.
  if (leadScoringService) {
    const scoringLeads = leadScoringService.getAll({}).leads || [];
    store.syncLeads(scoringLeads, "scoring", { replace: true, existingOnly: true });
  }
  if (campaignManager) {
    const campaigns = campaignsForKanban();
    store.syncCampaigns(campaigns, { replace: true, existingOnly: true });
  }
  return store.getBoard();
}

/** Faixas de prioridade do scoring viram fonte única também no Kanban. */
function scoringThresholds() {
  try {
    return leadScoringService?.getSettings?.()?.rules?.thresholds || null;
  } catch (error) {
    return null;
  }
}

/**
 * Analisa sozinho o que acabou de ser extraído, quando o usuário liga a
 * opção em Configurar análise. Roda em segundo plano para não segurar a
 * extração e mantém o renderer informado pelo canal de progresso.
 */
function maybeAutoAnalyzeScrapedLeads(leads, query) {
  if (!Array.isArray(leads) || !leads.length) return;
  let enabled = false;
  try {
    enabled = leadScoringService?.getSettings?.()?.analysis?.autoAnalyzeAfterScrape === true;
  } catch (error) {
    enabled = false;
  }
  if (!enabled) return;
  const total = leads.length;
  safeSend("lead-scoring-progress", {
    event: "auto-started",
    total,
    message: `Analisando ${total} lead(s) extraído(s) automaticamente…`,
  });
  leadScoringService
    .analyzeBatch(leads, { query, searchLabel: query })
    .then((result) => {
      console.log(`[SCORING] automático: ${result.analyzedCount}/${result.count} (${result.skipped || 0} sem site)`);
      safeSend("lead-scoring-progress", {
        event: "auto-completed",
        analyzed: result.analyzedCount,
        failures: result.failures,
        skipped: result.skipped || 0,
        total: result.count,
        query,
        message: `Scoring automático concluído: ${result.analyzedCount} de ${result.count} lead(s).` +
          (result.skipped ? ` ${result.skipped} ignorado(s) (sem site).` : ""),
      });
    })
    .catch((error) => {
      console.warn("[SCORING] automático:", error.message);
      safeSend("lead-scoring-progress", {
        event: "auto-failed",
        message: `Scoring automático falhou: ${error.message}`,
      });
    });
}

ipcMain.handle("migrate-existing-data", async (_, { localStorage } = {}) => {
  try {
    const report = migrateExistingData(app.getPath("userData"), { localStorage });
    return { success: true, ...report };
  } catch (error) {
    return { success: false, changed: false, error: error.message, localStorageUpdates: {} };
  }
});

// ─── BASE DE LEADS (arquivo no userData) ────
let leadsFileStore = null;
function getLeadsFileStore() {
  if (!leadsFileStore) {
    leadsFileStore = createLeadsFileStore(path.join(app.getPath("userData"), "sigma-leads.json"));
  }
  return leadsFileStore;
}

// Síncrono de propósito: o renderer lê `sigma_leads` via localStorage.getItem.
ipcMain.on("leads-store-load", (event) => {
  try {
    event.returnValue = { success: true, value: getLeadsFileStore().load() };
  } catch (error) {
    event.returnValue = { success: false, error: error.message };
  }
});

ipcMain.on("leads-store-save", (_, value) => {
  try {
    getLeadsFileStore().save(value);
  } catch (error) {
    console.warn("[LEADS-STORE] save:", error.message);
  }
});

// ─── KANBAN GERAL ───────────────────────────
// O renderer só envia fontes de leads. Configuração, regras, histórico e
// persistência ficam no processo principal para não depender do localStorage.
ipcMain.handle("kanban-get-board", async () => {
  try {
    return { success: true, board: syncKanbanServiceSources(), thresholds: scoringThresholds() };
  } catch (error) {
    return { success: false, error: error.message, board: null };
  }
});

ipcMain.handle("kanban-sync-maps", async (_, { leads } = {}) => {
  try {
    const store = requireKanbanStore();
    const board = store.syncLeads(Array.isArray(leads) ? leads : [], "maps", {
      replace: true,
      authoritative: true,
    });
    return { success: true, board };
  } catch (error) {
    return { success: false, error: error.message, board: null };
  }
});

ipcMain.handle("kanban-record-deal", async (_, payload = {}) => {
  try {
    const board = requireKanbanStore().recordDeal({
      entityKey: limitString(payload?.entityKey, 180, ""),
      outcome: ["won", "lost", "open"].includes(payload?.outcome) ? payload.outcome : "open",
      value: Number(payload?.value) || 0,
      note: limitString(payload?.note, 200, ""),
      reminderAt: limitString(payload?.reminderAt, 80, ""),
      reminderNote: limitString(payload?.reminderNote, 200, ""),
    });
    return { success: true, board };
  } catch (error) {
    return { success: false, error: error.message, board: null };
  }
});

ipcMain.handle("kanban-reset", async () => {
  try {
    return { success: true, board: requireKanbanStore().reset() };
  } catch (error) {
    return { success: false, error: error.message, board: null };
  }
});

ipcMain.handle("kanban-save-config", async (_, { board, expectedRevision } = {}) => {
  try {
    const result = requireKanbanStore().saveConfig(board || {}, expectedRevision);
    return { success: true, board: result };
  } catch (error) {
    return { success: false, error: error.message, code: error.code || null, board: null };
  }
});

ipcMain.handle("kanban-move-card", async (_, payload = {}) => {
  try {
    const result = requireKanbanStore().moveCard(payload || {});
    return { success: true, board: result };
  } catch (error) {
    return { success: false, error: error.message, code: error.code || null, board: null };
  }
});

ipcMain.handle("kanban-apply-rules", async (_, { force } = {}) => {
  try {
    const result = requireKanbanStore().applyRules({ force: Boolean(force) });
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message, moved: 0, board: null };
  }
});

ipcMain.handle("kanban-resume-automation", async (_, { entityKey } = {}) => {
  try {
    const result = requireKanbanStore().resumeAutomation(entityKey);
    return { success: true, board: result };
  } catch (error) {
    return { success: false, error: error.message, board: null };
  }
});

// ─── UPDATE IPC ────────────────────────────
ipcMain.handle("update-check", async () => autoUpdaterMod.checkForUpdates());
ipcMain.handle("update-download", async () => autoUpdaterMod.downloadUpdate());
ipcMain.handle("update-install", async () => autoUpdaterMod.quitAndInstall());
ipcMain.handle("update-status", async () => autoUpdaterMod.getStatus());

// ─── METRICS / ANALYTICS IPC ─────────────
ipcMain.handle("metrics-get", async () => {
  try { return { success: true, ...appMetrics.getStats() }; } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle("metrics-track", async (_, { event, data } = {}) => {
  try {
    const ev = String(event || "").trim().slice(0, 80);
    if (!ev) return { success: false, error: "event required" };
    appMetrics.track(ev, data || {});
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle("metrics-settings-get", async () => {
  try { return { success: true, settings: appMetrics.loadSettings() }; } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle("metrics-settings-set", async (_, patch = {}) => {
  try {
    const cur = appMetrics.loadSettings();
    const next = { ...cur, ...patch, enabled: patch.enabled !== false };
    if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
    if (typeof patch.askedConsent === "boolean") next.askedConsent = patch.askedConsent;
    appMetrics.saveSettings(next);
    return { success: true, settings: next };
  } catch (e) { return { success: false, error: e.message }; }
});

// ─── START SCRAPE ──────────────────────────
ipcMain.handle("start-scrape", async (_, { query, maxResults, queryId, progressContext } = {}) => {
  const cleanQuery = limitString(query, MAX_QUERY_LENGTH).trim();
  const cleanMaxResults = clampInteger(maxResults, 1, MAX_SCRAPE_RESULTS, 30);
  const key = limitString(queryId, 80, "") || `scrape_${Date.now()}`;
  const rawProgressContext = progressContext && typeof progressContext === "object" ? progressContext : {};
  const totalNeighborhoods = clampInteger(rawProgressContext.totalNeighborhoods, 1, 5000, 1);
  const scrapeProgressContext = {
    neighborhood: limitString(rawProgressContext.neighborhood, 120, ""),
    neighborhoodIndex: clampInteger(rawProgressContext.neighborhoodIndex, 0, totalNeighborhoods - 1, 0),
    totalNeighborhoods,
    batchComplete: rawProgressContext.batchComplete === true,
  };
  // Busca por meta de novos: pula o que já está na base e para ao atingir a meta.
  const coords = rawProgressContext.coords && Number.isFinite(Number(rawProgressContext.coords.lat)) && Number.isFinite(Number(rawProgressContext.coords.lng))
    ? { lat: Number(rawProgressContext.coords.lat), lng: Number(rawProgressContext.coords.lng) }
    : null;
  const scrapeOptions = {
    skipKeys: rawProgressContext.skipKnown === true ? knownLeadKeys() : new Set(),
    maxNew: clampInteger(rawProgressContext.maxNew, 0, MAX_SCRAPE_RESULTS, 0),
    coords,
  };
  const cancelToken = { cancelled: false };
  activeScrapes.set(key, cancelToken);
  refreshBackgroundHolds();
  const emitProgress = (payload) => sendProgress({ queryId: key, ...scrapeProgressContext, ...payload });
  try {
    if (!cleanQuery) throw new Error("A consulta da extração é obrigatória.");
    try { appMetrics.track("scrape_started", { maxResults: cleanMaxResults, queryLen: cleanQuery.length }); } catch {}
    emitProgress({ status: "started", current: 0, total: cleanMaxResults, message: `Iniciando extração: ${cleanQuery}` });
    const result = await scrapeGoogleMaps(
      cleanQuery,
      cleanMaxResults,
      (event) => {
        const rawEvent = event && typeof event === "object" ? event : { message: event };
        const text = String(rawEvent.message || "");
        const match = text.match(/\[(\d+)\/(\d+)\]/);
        const foundMatch = text.match(/(?:\bFound:\s*(\d+))|(?:(\d+)\s+empresas?\s+encontradas?)/i);
        const hasCurrent = String(rawEvent.current ?? "").trim() !== "" && Number.isFinite(Number(rawEvent.current));
        const hasTotal = String(rawEvent.total ?? "").trim() !== "" && Number.isFinite(Number(rawEvent.total));
        const hasFound = String(rawEvent.found ?? "").trim() !== "" && Number.isFinite(Number(rawEvent.found));
        const normalizedLiveLead = rawEvent.lead && typeof rawEvent.lead === "object"
          ? normalizeIncomingLead(rawEvent.lead)
          : null;
        emitProgress({
          status: "running",
          current: hasCurrent ? Number(rawEvent.current) : (match ? Number(match[1]) : null),
          total: hasTotal ? Number(rawEvent.total) : (match ? Number(match[2]) : cleanMaxResults),
          found: hasFound ? Number(rawEvent.found) : (foundMatch ? Number(foundMatch[1] || foundMatch[2]) : null),
          message: text,
          ...(rawEvent.type ? { type: limitString(rawEvent.type, 40, "") } : {}),
          ...(normalizedLiveLead ? { lead: normalizedLiveLead } : {}),
        });
      },
      cancelToken,
      scrapeOptions,
    );
    if (!result || result.success === false) {
      const error = new Error(result?.error || "Não foi possível concluir a busca no Google Maps.");
      error.warnings = Array.isArray(result?.warnings) ? result.warnings : [];
      throw error;
    }
    let data = Array.isArray(result.data)
      ? result.data.map((item) => normalizeIncomingLead(item))
      : [];
    if (!data.length) throw new Error("Nenhum negócio foi encontrado para esta busca. Tente ajustar nicho ou localização.");

    // Deduplicate by name+address
    const seen = new Set();
    data = data.filter((item) => {
      const key = `${item.name}||${item.address}`.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    emitProgress({ status: "running", current: data.length, total: data.length, message: `${data.length} resultados únicos após deduplicação.` });

    const timestamp = Date.now();
    const safeQuery = cleanQuery.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "") || "query";
    const base = `gmaps_${safeQuery}_${timestamp}`;

    const userDataPath = app.getPath("userData");
    if (!fs.existsSync(userDataPath))
      fs.mkdirSync(userDataPath, { recursive: true });

    const jsonPath = path.join(userDataPath, `${base}.json`);
    const csvPath = path.join(userDataPath, `${base}.csv`);
    const reportPath = path.join(userDataPath, `${base}_report.txt`);

    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
    saveToCSV(data, csvPath);
    saveReport(query, data, reportPath);

    const resultKey = limitString(queryId, 80, "") || "_last";
    resultStore.set(resultKey, {
      query: cleanQuery,
      data,
      jsonPath,
      csvPath,
      reportPath,
      timestamp,
    });

    emitProgress({ status: "completed", current: data.length, total: data.length, message: `Extração concluída: ${data.length} resultado(s).` });
    notifyUser({ title: "Extração concluída", body: `${data.length} resultado(s) para “${cleanQuery}”.` });
    try { appMetrics.track("scrape_completed", { count: data.length, queryLen: cleanQuery.length }); } catch {}
    maybeAutoAnalyzeScrapedLeads(data, cleanQuery);
    // Agente de Triagem automático: roda depois de responder a UI, sem travar a extração.
    if (agentStore?.settings("triagem").auto) {
      setImmediate(() => runTriageAgent(data, { auto: true }).catch(() => {}));
    }

    return {
      success: true,
      preview: data.slice(0, 3),
      count: data.length,
      data,
      statistics: result.statistics,
      partial: Boolean(result.partial),
      warnings: Array.isArray(result.warnings) ? result.warnings : [],
    };
  } catch (err) {
    const cancelled = err?.code === "SCRAPE_CANCELLED" || cancelToken.cancelled;
    emitProgress({ status: cancelled ? "cancelled" : "failed", current: null, total: cleanMaxResults, message: cancelled ? "Extração cancelada." : `Erro na extração: ${err.message}`, error: err.message });
    if (!cancelled) notifyUser({ title: "Extração falhou", body: `“${cleanQuery}”: ${err.message}` });
    try { appMetrics.track("scrape_failed", { error: String(err.message).slice(0, 120) }); } catch {}
    return { success: false, error: err.message, cancelled, warnings: Array.isArray(err.warnings) ? err.warnings : [] };
  } finally {
    activeScrapes.delete(key);
    refreshBackgroundHolds();
  }
});

// Corrige uma base local criada antes da sanitização do ícone do Maps. A lista
// completa é processada em sequência; cache, fallback por CEP e rate-limit
// evitam rajadas e mantêm um resultado útil mesmo em endereços incompletos.
ipcMain.handle("repair-map-addresses", async (_, { leads } = {}) => {
  const candidates = Array.isArray(leads) ? leads : [];
  const repaired = [];
  const failures = [];
  const seen = new Set();

  for (const raw of candidates) {
    const key = limitString(raw?.key, 300, "");
    const address = normalizeAddress(raw?.address);
    if (!key || !address || seen.has(key)) continue;
    seen.add(key);

    const item = { key, address };
    try {
      const hint = [limitString(raw?.city, 120, ""), limitString(raw?.state, 8, "")]
        .filter(Boolean)
        .join(", ");
      const geo = await geocodeAddress(address, hint);
      if (geo && isValidCoord(Number(geo.lat), Number(geo.lng))) {
        item.latitude = geo.lat;
        item.longitude = geo.lng;
        item.coordSource = "nominatim";
        item.geocodeConfidence = geo.confidence || "approximate";
      } else {
        const message = "Endereço não localizado ou serviço de mapas indisponível.";
        item.error = message;
        failures.push({ key, error: message });
      }
    } catch (error) {
      const message = limitString(error?.message, 220, "Falha ao geocodificar endereço.");
      item.error = message;
      failures.push({ key, error: message });
    }
    repaired.push(item);
  }

  return { success: true, partial: failures.length > 0, repaired, failures };
});

ipcMain.handle("cancel-scrape", async (_, { queryId } = {}) => {
  const key = limitString(queryId, 80, "");
  if (key && activeScrapes.has(key)) {
    activeScrapes.get(key).cancelled = true;
    refreshBackgroundHolds();
    return { success: true, cancelled: 1 };
  }
  let cancelled = 0;
  for (const token of activeScrapes.values()) {
    token.cancelled = true;
    cancelled++;
  }
  refreshBackgroundHolds();
  return { success: true, cancelled };
});

// ─── SAVE FILE ─────────────────────────────
ipcMain.handle("save-file", async (_, { type, queryId }) => {
  const key = queryId || "_last";
  const entry = resultStore.get(key);
  if (!entry) return { success: false, message: "No results to save." };

  const map = {
    json: {
      name: `gmaps_${entry.query}_${entry.timestamp}.json`,
      path: entry.jsonPath,
    },
    csv: {
      name: `gmaps_${entry.query}_${entry.timestamp}.csv`,
      path: entry.csvPath,
    },
    report: {
      name: `gmaps_${entry.query}_${entry.timestamp}_report.txt`,
      path: entry.reportPath,
    },
  };

  if (!map[type]) return { success: false, message: "Invalid type." };

  const { filePath, canceled } = await dialog.showSaveDialog({
    title: `Save ${type.toUpperCase()}`,
    defaultPath: map[type].name,
  });

  if (canceled || !filePath)
    return { success: false, message: "Save cancelled." };

  fs.copyFileSync(map[type].path, filePath);
  return { success: true, savedTo: filePath };
});

// ─── SAVE ALL (MERGED) ─────────────────────
ipcMain.handle("save-all-files", async (_, { type }) => {
  if (resultStore.size === 0)
    return { success: false, message: "No results to save." };

  // Merge all results
  const allData = [];
  for (const entry of resultStore.values()) {
    for (const item of entry.data) {
      allData.push({ query: entry.query, ...item });
    }
  }

  const timestamp = Date.now();

  if (type === "json") {
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: "Save All JSON",
      defaultPath: `gmaps_all_${timestamp}.json`,
    });
    if (canceled || !filePath)
      return { success: false, message: "Save cancelled." };
    fs.writeFileSync(filePath, JSON.stringify(allData, null, 2));
    return { success: true, savedTo: filePath };
  }

  if (type === "csv") {
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: "Save All CSV",
      defaultPath: `gmaps_all_${timestamp}.csv`,
    });
    if (canceled || !filePath)
      return { success: false, message: "Save cancelled." };
    saveToCSV(allData, filePath, true);
    return { success: true, savedTo: filePath };
  }

  return { success: false, message: "Invalid type." };
});

// ─── EXPORT LEADS (cumulative from renderer) ─
ipcMain.handle("export-leads", async (_, { leads, format }) => {
  if (!leads || !leads.length)
    return { success: false, message: "No leads to export." };
  if (!Array.isArray(leads) || leads.length > MAX_EXPORT_LEADS) {
    return { success: false, message: "Too many leads to export at once." };
  }

  const timestamp = Date.now();

  if (format === "json") {
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: "Export Leads JSON",
      defaultPath: `sigma_leads_${timestamp}.json`,
    });
    if (canceled || !filePath)
      return { success: false, message: "Save cancelled." };
    fs.writeFileSync(filePath, JSON.stringify(leads, null, 2));
    return { success: true, savedTo: filePath };
  }

  if (format === "csv") {
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: "Export Leads CSV",
      defaultPath: `sigma_leads_${timestamp}.csv`,
    });
    if (canceled || !filePath)
      return { success: false, message: "Save cancelled." };
    saveToCSV(leads, filePath);
    return { success: true, savedTo: filePath };
  }

  return { success: false, message: "Invalid format." };
});

// ─── GET RESULT LIST ───────────────────────
ipcMain.handle("get-result-list", async () => {
  const list = [];
  for (const [key, entry] of resultStore) {
    list.push({
      queryId: key,
      query: entry.query,
      count: entry.data.length,
      timestamp: entry.timestamp,
    });
  }
  return list;
});

// ─── DELETE TEMP FILES ─────────────────────
ipcMain.handle("delete-temp-files", async () => {
  try {
    const userDataPath = app.getPath("userData");
    const files = fs.readdirSync(userDataPath);
    const deleted = [];

    for (const file of files) {
      if (
        (file.startsWith("gmaps_") ||
          file.startsWith("sigma_leads_") ||
          file.startsWith("campaign_")) &&
        (file.endsWith(".json") ||
          file.endsWith(".csv") ||
          file.endsWith(".txt"))
      ) {
        const filePath = path.join(userDataPath, file);
        fs.unlinkSync(filePath);
        deleted.push(file);
      }
    }

    resultStore.clear();

    if (deleted.length === 0) {
      return { success: false, message: "No files to delete." };
    }

    return { success: true, message: `${deleted.length} files deleted.` };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ─── UI THEME ──────────────────────────────
function getUiThemeFilePath() {
  return path.join(app.getPath("userData"), "ui-theme.json");
}

function readSavedTheme() {
  try {
    const filePath = getUiThemeFilePath();
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (raw?.theme === "light" || raw?.theme === "dark" || raw?.theme === "auto") {
        return raw.theme;
      }
    }
  } catch (e) {
    /* ignore */
  }
  return "light";
}

function resolveWindowBgColor() {
  const saved = readSavedTheme();
  if (saved === "dark") return "#0B0F1A";
  if (saved === "auto") {
    return nativeTheme?.shouldUseDarkColors ? "#0B0F1A" : "#F8FAFC";
  }
  return "#F8FAFC";
}

function applyUiZoom(win = mainWindow) {
  if (!win || win.isDestroyed()) return 1;
  const zoom = loadDesktopPreferences().zoom;
  try { win.webContents.setZoomFactor(zoom); } catch (error) { console.warn("[DESKTOP] zoom apply:", error.message); }
  return zoom;
}

function setUiZoom(value) {
  const preferences = saveDesktopPreferences({ zoom: value });
  applyUiZoom(mainWindow);
  return preferences.zoom;
}

ipcMain.handle("theme-get", () => readSavedTheme());
ipcMain.handle("theme-set", async (_, { theme } = {}) => {
  const next = theme === "light" || theme === "auto" ? theme : "dark";
  try {
    fs.writeFileSync(
      getUiThemeFilePath(),
      JSON.stringify({ theme: next }, null, 2),
      { mode: 0o600 },
    );
  } catch (e) {
    /* ignore */
  }
  return next;
});

// ─── WINDOW CONTROLS ───────────────────────
ipcMain.handle("win-minimize", () => hideMainWindow("minimize"));
ipcMain.handle("win-maximize", () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
  scheduleWindowStateSave();
});
ipcMain.handle("win-close", () => requestWindowClose());
ipcMain.handle("win-is-maximized", () => mainWindow?.isMaximized());
ipcMain.handle("ui-zoom-get", () => loadDesktopPreferences().zoom);
ipcMain.handle("ui-zoom-set", (_, { zoom } = {}) => setUiZoom(zoom));
ipcMain.handle("ui-zoom-reset", () => setUiZoom(1));
// Recarrega UI do renderer/dist (não faz location.reload na pasta TEMP velha)
ipcMain.handle("reload-ui", async () => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return { success: true, recreated: true };
    }
    await loadAppUi(mainWindow);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
ipcMain.handle("open-external", async (_, { url } = {}) => {
  try {
    if (!isHttpUrl(url)) return { success: false, error: "URL inválida" };
    await shell.openExternal(String(url));
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("open-site-window", async (_, { url } = {}) => {
  const target = String(url || '').trim();
  if (!isHttpUrl(target)) return { success: false, error: "URL inválida" };
  try {
    const siteWindow = new BrowserWindow({
      width: 1180,
      height: 780,
      minWidth: 720,
      minHeight: 480,
      parent: mainWindow || undefined,
      title: target,
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    siteWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    siteWindow.webContents.on("will-navigate", (event, nextUrl) => {
      if (!isHttpUrl(nextUrl)) event.preventDefault();
    });
    siteWindow.webContents.once("did-finish-load", () => {
      if (!siteWindow.isDestroyed()) siteWindow.show();
    });
    await siteWindow.loadURL(target);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ─── WHATSAPP CONNECTION ───────────────────
function getActiveWhatsAppProvider() {
  return activeWhatsAppId ? whatsappProviders.get(activeWhatsAppId) : null;
}

// Resolve a specific connection by id, falling back to the active provider.
// Lets the chat/messaging handlers accept an optional `connectionId` so the UI
// can talk to any connected number while keeping backward compatibility.
function resolveChatProvider(connectionId) {
  if (connectionId && typeof connectionId === "string") {
    const provider = whatsappProviders.get(connectionId);
    if (provider) return provider;
  }
  return getActiveWhatsAppProvider();
}

function listWhatsAppConnections() {
  return [...whatsappProviders.entries()].map(([id, provider]) => ({
    id,
    connected: provider.getStatus() === "connected",
    status: provider.getStatus(),
    provider:
      provider.constructor.name === "BaileysProvider" ? "baileys" : "meta",
    phoneNumber: provider.getPhoneNumber(),
    active: id === activeWhatsAppId,
  }));
}

/**
 * Status agregado para a UI (bolinha / overview).
 * Com múltiplas conexões, o indicador global fica "connected" se
 * QUALQUER sessão estiver online — evita bolinha vermelha quando
 * só a última sessão emitiu connecting/disconnected.
 */
function getAggregateWhatsAppStatus() {
  const connections = listWhatsAppConnections();
  const anyConnected = connections.some((c) => c.status === "connected");
  const active = activeWhatsAppId
    ? whatsappProviders.get(activeWhatsAppId)
    : null;
  const activeStatus = active?.getStatus?.() || "disconnected";

  let status = "disconnected";
  if (anyConnected) {
    status = "connected";
  } else if (connections.some((c) => c.status === "qr_ready")) {
    status = "qr_ready";
  } else if (connections.some((c) => c.status === "connecting")) {
    status = "connecting";
  } else if (connections.some((c) => c.status === "error")) {
    status = "error";
  }

  const connectedEntry =
    connections.find((c) => c.active && c.connected) ||
    connections.find((c) => c.connected) ||
    null;

  return {
    connected: anyConnected,
    status,
    activeStatus,
    activeConnectionId: activeWhatsAppId,
    phoneNumber:
      active?.getPhoneNumber?.() || connectedEntry?.phoneNumber || null,
    provider: active
      ? active.constructor.name === "BaileysProvider"
        ? "baileys"
        : "meta"
      : null,
    connections,
  };
}

async function sendWaStatus(status, data) {
  const payloadData = { ...(data || {}) };
  // Snapshot de todas as conexões em todo evento — a UI multi-session
  // precisa disso para não sobrescrever o estado global com o status
  // de uma única sessão.
  const aggregate = getAggregateWhatsAppStatus();
  // Se ainda não há ninguém online, propaga o estado transitório do
  // evento atual (connecting / qr_ready) para a bolinha global.
  let aggregateStatus = aggregate.status;
  if (aggregate.connected) {
    aggregateStatus = "connected";
  } else if (status === "qr_ready" || status === "connecting" || status === "error") {
    aggregateStatus = status;
  }
  payloadData.connections = aggregate.connections;
  payloadData.aggregateStatus = aggregateStatus;
  payloadData.anyConnected = aggregate.connected;
  payloadData.activeConnectionId = aggregate.activeConnectionId;

  const envelope = {
    status,
    aggregateStatus,
    anyConnected: aggregate.connected,
    connectionId: payloadData.connectionId || null,
    data: payloadData,
  };

  if (status === "qr_ready" && data?.qrData) {
    try {
      const qrDataURL = await QRCode.toDataURL(data.qrData, {
        width: 200,
        margin: 1,
      });
      safeSend("whatsapp-status-changed", {
        ...envelope,
        data: { ...payloadData, qrDataURL },
      });
      return;
    } catch (e) {
      safeSend("whatsapp-status-changed", envelope);
      return;
    }
  }
  safeSend("whatsapp-status-changed", envelope);
  updateTray();
}

function onChatEvent(event) {
  if (event.type === "chat-update") {
    safeSend("whatsapp-chat-update", {
      connectionId: event.connectionId,
    });
  } else if (event.type === "message-received") {
    recordIncomingReply(event);
    if (campaignManager) {
      campaignManager.trackIncomingMessage(
        event.phoneJid || event.jid,
        event.message,
        event.connectionId
      );
    }
    safeSend("whatsapp-message-received", {
      jid: event.jid,
      message: event.message,
      connectionId: event.connectionId,
    });
  } else if (
    event.type === "sync-start" ||
    event.type === "sync-progress" ||
    event.type === "sync-done"
  ) {
    safeSend("whatsapp-sync", {
      type: event.type,
      stats: event.stats,
      connectionId: event.connectionId,
    });
    if (event.type === "sync-done") scheduleContactHistorySync(5000);
  } else if (event.type === "history-update") {
    scheduleContactHistorySync(5000);
  } else if (event.type === "message-status") {
    contactStatus?.recordReceipt(event.messageId, event.status);
    if (campaignManager) {
      campaignManager.trackMessageStatus(event.messageId, event.status);
    }
  } else if (event.type === "conversation-open") {
    if (campaignManager) {
      campaignManager.trackConversationOpen(
        event.phoneJid || event.jid,
        event.connectionId
      );
    }
  }
}

ipcMain.handle("whatsapp-connect", async (_, { provider: type, config }) => {
  let connectionId = null;
  let provider = null;
  try {
    connectionId =
      config?.connectionId ? assertConnectionId(config.connectionId) : createConnectionId();
    const connectionPath = resolveSessionPath(connectionId);
    fs.mkdirSync(connectionPath, { recursive: true });

    const existing = whatsappProviders.get(connectionId);
    if (existing) await existing.disconnect().catch(() => {});

    provider = WhatsAppProviderFactory(
      type,
      config,
      (status, data) => sendWaStatus(status, { ...(data || {}), connectionId }),
      (event) => onChatEvent({ ...event, connectionId }),
      connectionPath,
    );
    whatsappProviders.set(connectionId, provider);
    activeWhatsAppId = connectionId;
    await provider.connect();
    if (provider.getStatus && provider.getStatus() === "error") {
      throw new Error("Provider failed to connect");
    }

    const phoneNumber = provider.getPhoneNumber();
    return { success: true, phoneNumber, connectionId, connections: listWhatsAppConnections() };
  } catch (err) {
    if (provider) await provider.disconnect?.().catch(() => {});
    if (connectionId) {
      whatsappProviders.delete(connectionId);
      if (activeWhatsAppId === connectionId) {
        activeWhatsAppId = whatsappProviders.keys().next().value || null;
      }
    }
    return { success: false, error: err.message };
  }
});

ipcMain.handle("whatsapp-disconnect", async (_, { connectionId } = {}) => {
  try {
    const id = connectionId ? assertConnectionId(connectionId) : activeWhatsAppId;
    const provider = id ? whatsappProviders.get(id) : null;
    if (provider) {
      await provider.disconnect();
      whatsappProviders.delete(id);
    }
    if (activeWhatsAppId === id) {
      activeWhatsAppId = whatsappProviders.keys().next().value || null;
    }
    const activeProvider = getActiveWhatsAppProvider();
    if (campaignManager) {
      // no-op, providersMap is already kept by reference
    }
    return { success: true, activeConnectionId: activeWhatsAppId, connections: listWhatsAppConnections() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("whatsapp-remove-connection", async (_, { connectionId }) => {
  try {
    if (!connectionId) throw new Error("Connection ID is required");
    const safeConnectionId = assertConnectionId(connectionId);
    
    // 1. Disconnect and remove from active map
    const provider = whatsappProviders.get(safeConnectionId);
    if (provider) {
      try { await provider.disconnect(); } catch (e) {}
      whatsappProviders.delete(safeConnectionId);
    }
    if (activeWhatsAppId === safeConnectionId) {
      activeWhatsAppId = whatsappProviders.keys().next().value || null;
    }

    // 2. Delete the session folder
    const connectionPath = resolveSessionPath(safeConnectionId);
    if (fs.existsSync(connectionPath)) {
      fs.rmSync(connectionPath, { recursive: true, force: true });
    }

    // 3. Update campaign manager if active changed
    const activeProvider = getActiveWhatsAppProvider();
    if (campaignManager) {
      // no-op
    }

    return { success: true, activeConnectionId: activeWhatsAppId, connections: listWhatsAppConnections() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("whatsapp-status", async () => {
  return getAggregateWhatsAppStatus();
});

ipcMain.handle("whatsapp-list-connections", async () => ({
  activeConnectionId: activeWhatsAppId,
  connections: listWhatsAppConnections(),
}));

ipcMain.handle("whatsapp-switch-connection", async (_, { connectionId }) => {
  try {
    const safeConnectionId = assertConnectionId(connectionId);
    if (!whatsappProviders.has(safeConnectionId)) {
      return { success: false, error: "Conexão não encontrada" };
    }
    activeWhatsAppId = safeConnectionId;
    if (campaignManager) {
      // no-op
    }
    return { success: true, activeConnectionId: activeWhatsAppId, connections: listWhatsAppConnections() };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ─── FORCE RESYNC ─────────────────────────
ipcMain.handle("whatsapp-force-resync", async (_, { connectionId } = {}) => {
  try {
    const id = connectionId ? assertConnectionId(connectionId) : activeWhatsAppId;
    const provider = id ? whatsappProviders.get(id) : getActiveWhatsAppProvider();
    if (provider) await provider.disconnect().catch(() => {});
    const { AuthStore } = require("./whatsapp/auth-store");
    const sessionPath = id
      ? resolveSessionPath(id)
      : app.getPath("userData");
    const store = new AuthStore(sessionPath);
    await store.clearBaileysAuth();
    try {
      fs.unlinkSync(path.join(sessionPath, "sigma-chats.json"));
    } catch (e) {}
    if (id) whatsappProviders.delete(id);
    activeWhatsAppId = whatsappProviders.keys().next().value || null;
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ─── CHAT MANAGEMENT ───────────────────────
ipcMain.handle("whatsapp-get-chats", async (_, { connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider) return { chats: [] };
  return { chats: provider.getChats() };
});

ipcMain.handle("whatsapp-get-contacts", async (_, { connectionId } = {}) => {
  try {
    const provider = resolveChatProvider(connectionId);
    if (!provider) return { success: true, contacts: [], groups: [] };
    const contacts = typeof provider.getContacts === "function" ? provider.getContacts() : [];
    const groups = typeof provider.getGroups === "function"
      ? provider.getGroups()
      : contacts.filter((c) => c.isGroup);
    return {
      success: true,
      contacts: contacts.filter((c) => !c.isGroup),
      groups,
      all: contacts,
    };
  } catch (err) {
    return { success: false, error: err.message, contacts: [], groups: [], all: [] };
  }
});

ipcMain.handle("whatsapp-get-messages", async (_, { jid, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider) return { messages: [] };
  return { messages: provider.getMessages(jid) };
});

ipcMain.handle("whatsapp-load-messages", async (_, { jid, limit, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider) return { messages: [] };
  const messages = await provider.loadMessages(jid, limit || 50);
  return { messages };
});

ipcMain.handle("whatsapp-mark-read", async (_, { jid, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider) return;
  await provider.markRead(jid);
});

ipcMain.handle("whatsapp-get-profile-pic", async (_, { jid, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider || !provider.getProfilePicture)
    return { url: null };
  const url = await provider.getProfilePicture(jid);
  return { url };
});

ipcMain.handle("whatsapp-get-group-metadata", async (_, { jid, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider || !provider.getGroupMetadata) return null;
  return await provider.getGroupMetadata(jid);
});

ipcMain.handle("whatsapp-get-contact-info", async (_, { jid, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider || !provider.getContactInfo)
    return { jid, phone: jid, name: null, business: null };
  return await provider.getContactInfo(jid);
});

ipcMain.handle("whatsapp-send-message", async (_, { to, content, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider) return { success: false, error: "Not connected" };
  const result = await provider.sendMessage(to, content);
  if (result?.success && result.messageId) {
    const jid = String(result.jid || to || "");
    const phoneJid = jid.endsWith("@lid")
      ? (await provider.resolvePhoneJid?.(jid).catch(() => null)) || provider._getPhoneJid?.(jid) || ""
      : jid;
    // Só conta como prospecção se for lead da base; conversa comum não vira "contatado".
    if (phoneJid && !phoneJid.endsWith("@g.us") && (contactStatus?.get(phoneJid) || knownLeadPhones().has(phoneKey(phoneJid)))) {
      contactStatus?.recordSent(phoneJid, { messageId: result.messageId, source: "chat" });
    }
  }
  return result;
});

// ─── STATUS DE CONTATO (tempo real para Scraper, Base e Kanban) ───
function recordCampaignContact(campaignId, leadId) {
  try {
    const campaign = campaignManager?.get?.(campaignId);
    const lead = campaign?.leads?.find((item) => String(item.leadId) === String(leadId));
    if (!lead || lead.isGroup) return;
    const meta = { source: "campanha", campaignId, name: lead.name || "" };
    if (lead.messageId) contactStatus?.recordSent(lead.phone, { ...meta, messageId: lead.messageId, at: lead.sentAt });
    if (lead.followUpMessageId) contactStatus?.recordSent(lead.phone, { ...meta, messageId: lead.followUpMessageId, at: lead.followUpSentAt });
  } catch (error) {
    console.warn("[CONTACT-STATUS] campanha:", error.message);
  }
}

// ─── COBERTURA DA EXTRAÇÃO (bairros, grade, variações) ───
let areaCache = null;
function getAreaCache() {
  if (!areaCache) areaCache = new AreaCache(app.getPath("userData"));
  return areaCache;
}

/** Chaves (placeId e nome) de todos os leads da base: a extração não os repete. */
/** Telefones (chave única) dos leads da base. */
function knownLeadPhones() {
  const phones = new Set();
  try {
    const raw = getLeadsFileStore().load();
    const leads = raw ? JSON.parse(raw) : [];
    for (const lead of Array.isArray(leads) ? leads : []) {
      const key = phoneKey(lead?.phone || lead?.tel || lead?.telefone || lead?.whatsapp);
      if (key.length >= 10) phones.add(key);
    }
  } catch (error) {
    console.warn("[CONTACT-STATUS] base de leads:", error.message);
  }
  return phones;
}

function knownLeadKeys() {
  const keys = new Set();
  try {
    const raw = getLeadsFileStore().load();
    const leads = raw ? JSON.parse(raw) : [];
    for (const lead of Array.isArray(leads) ? leads : []) {
      const pid = lead?.placeId || placeIdFromUrl(lead?.googleMapsUrl);
      if (pid) keys.add(`pid:${pid}`);
      const name = nameKey(lead?.name);
      if (name) keys.add(`name:${name}`);
    }
  } catch (error) {
    console.warn("[SCRAPE] base para pular:", error.message);
  }
  return keys;
}

ipcMain.handle("extraction-neighborhoods", async (_, { city, uf } = {}) => {
  try {
    const names = await fetchNeighborhoods(limitString(city, 120, ""), limitString(uf, 2, ""), { cache: getAreaCache() });
    return { success: true, neighborhoods: names };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("extraction-grid", async (_, { city, uf, size } = {}) => {
  try {
    const points = await cityGrid(limitString(city, 120, ""), limitString(uf, 2, ""), { size: clampInteger(size, 2, 8, 4), cache: getAreaCache() });
    return { success: true, points };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("extraction-variations", async (_, { niche } = {}) => {
  try {
    const runAi = agentAi("pesquisador");
    const terms = await nicheVariations(limitString(niche, 80, ""), { runAi, cache: getAreaCache() });
    return { success: true, terms };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("contact-status-get-all", async () => {
  return { success: true, contacts: contactStatus?.getAll() || {}, waCheck: contactStatus?.getWaCheck() || {} };
});

async function recordIncomingReply(event) {
  try {
    let phone = event.phoneJid || event.jid;
    if (String(phone || "").endsWith("@lid")) {
      const provider = event.connectionId ? whatsappProviders.get(event.connectionId) : null;
      phone = (await provider?.resolvePhoneJid?.(phone).catch(() => null)) || phone;
    }
    // Horário real da mensagem: respostas recuperadas após reconectar não viram "agora".
    const rawTs = event.message?.messageTimestamp;
    const ts = Number(typeof rawTs === "object" && rawTs ? rawTs.low : rawTs) || 0;
    const at = ts ? Math.min(Date.now(), ts * 1000) : Date.now();
    const text = messageText(event.message);
    const prev = contactStatus?.get(phone);
    const auto = isAutoReply(text, prev?.sentAt ? at - prev.sentAt : Infinity);
    contactStatus?.recordReply(phone, { optOut: isOptOutMessage(text), auto, at });
  } catch (error) {
    console.warn("[CONTACT-STATUS] resposta:", error.message);
  }
}

/**
 * Traz para o status de contato tudo o que você já conversou no WhatsApp,
 * inclusive pelo celular: é isso que tira do "Disponíveis" quem já foi chamado.
 */
let contactSyncTimer = null;
let contactSyncRunning = null;
async function syncContactHistory() {
  if (contactSyncRunning) return contactSyncRunning;
  contactSyncRunning = (async () => {
    let changed = 0;
    let found = 0;
    let removed = 0;
    const errors = [];
    const leadPhones = knownLeadPhones();
    const all = contactStatus?.getAll() || {};
    const keep = new Set();
    let historyLoaded = false;
    for (const [connectionId, provider] of whatsappProviders.entries()) {
      if (typeof provider.getOutreachHistory !== "function") continue;
      try {
        const history = await provider.getOutreachHistory();
        if (history.length) historyLoaded = true;
        // Só prospecção: lead da base, envio feito pelo app ou conversa que você
        // começou com texto comercial. Conversa pessoal fica de fora.
        const prospecting = history.filter((entry) => {
          const key = phoneKey(entry.phone);
          const prev = all[key];
          const ok = isProspectingConversation(entry, {
            isKnownLead: leadPhones.has(key),
            sentByApp: !!prev && (prev.manual || prev.source === "fila" || prev.source === "campanha"),
          });
          if (ok) keep.add(key);
          return ok;
        });
        found += prospecting.length;
        changed += contactStatus?.importHistory(prospecting) || 0;
      } catch (error) {
        errors.push(`${connectionId}: ${error.message}`);
      }
    }
    // Limpa o que entrou antes do filtro (conversas pessoais).
    if (historyLoaded && !errors.length) removed = contactStatus?.pruneHistory(keep) || 0;
    contactStatus?.flush();
    return { success: true, found, changed, removed, errors };
  })();
  try {
    return await contactSyncRunning;
  } finally {
    contactSyncRunning = null;
  }
}

function scheduleContactHistorySync(delayMs = 5000) {
  if (contactSyncTimer) clearTimeout(contactSyncTimer);
  contactSyncTimer = setTimeout(() => {
    contactSyncTimer = null;
    syncContactHistory().catch((error) => console.warn("[CONTACT-STATUS] sync:", error.message));
  }, delayMs);
}

/**
 * "Atualizar WhatsApp": confere cada conexão (reconecta a que caiu, sem
 * deslogar), deixa as mensagens pendentes chegarem, recalcula quem
 * respondeu e diz o que mudou. Roda também sozinho a cada 15 min.
 */
let waRefreshState = { lastAt: 0, running: false, result: null };
let waRefreshRunning = null;

function savedSessionIds() {
  try {
    const root = getSessionsRoot();
    return fs.readdirSync(root).filter((d) => {
      try {
        assertConnectionId(d);
        return fs.existsSync(path.join(root, d, "whatsapp-auth", "creds.json"));
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

async function refreshWhatsApp({ auto = false } = {}) {
  if (waRefreshRunning) return waRefreshRunning;
  waRefreshRunning = (async () => {
    const replyKey = (c) => `${c?.status}|${c?.lastReplyAt || 0}`;
    const before = new Map(Object.entries(contactStatus?.getAll() || {}).map(([p, c]) => [p, c]));
    waRefreshState = { ...waRefreshState, running: true };
    safeSend("whatsapp-refresh-state", waRefreshState);

    // Sessão salva que não está carregada (falhou ao abrir): tenta de novo.
    if (savedSessionIds().some((id) => !whatsappProviders.has(id))) {
      await Promise.race([autoReconnectSessions(), new Promise((r) => setTimeout(r, 30000))]).catch(() => {});
    }
    const connections = [];
    for (const [connectionId, provider] of whatsappProviders.entries()) {
      if (typeof provider.refresh !== "function") continue;
      const entry = { connectionId, phone: provider.getPhoneNumber?.() || null };
      try {
        Object.assign(entry, await provider.refresh(), { ok: true });
      } catch (error) {
        Object.assign(entry, { ok: false, error: error.message });
      }
      entry.status = provider.getStatus?.() || "disconnected";
      connections.push(entry);
    }

    const sync = await syncContactHistory();
    const newReplies = [];
    for (const [phone, c] of Object.entries(contactStatus?.getAll() || {})) {
      if (c?.status !== "respondeu" && c?.status !== "descadastrado") continue;
      const prev = before.get(phone);
      // Novo = virou "respondeu" agora, ou respondeu de novo depois da última vez conhecida.
      const isNew = prev?.status !== c.status || (prev?.lastReplyAt && replyKey(prev) !== replyKey(c));
      if (isNew) newReplies.push({ phone, name: c.name || "", at: c.lastReplyAt || c.repliedAt || 0 });
    }
    const loaded = new Set(whatsappProviders.keys());
    const result = {
      at: Date.now(),
      auto,
      connections,
      newReplies: newReplies.sort((a, b) => b.at - a.at),
      synced: sync.found,
      offlineSessions: savedSessionIds().filter((id) => !loaded.has(id) || whatsappProviders.get(id)?.getStatus?.() !== "connected").length,
    };
    waRefreshState = { lastAt: result.at, running: false, result };
    safeSend("whatsapp-refresh-state", waRefreshState);
    // As de agora já avisaram na hora; aqui só as que estavam perdidas.
    const recovered = newReplies.filter((r) => Date.now() - r.at >= 120000);
    if (auto && recovered.length) {
      notifyUser({
        title: `${recovered.length} resposta(s) recuperada(s)`,
        body: recovered.slice(0, 3).map((r) => r.name || r.phone).join(", ") + " responderam. Abra o WhatsApp do P4J3 para responder.",
      });
    }
    return { success: true, ...result };
  })();
  try {
    return await waRefreshRunning;
  } catch (error) {
    waRefreshState = { ...waRefreshState, running: false };
    safeSend("whatsapp-refresh-state", waRefreshState);
    return { success: false, error: error.message };
  } finally {
    waRefreshRunning = null;
  }
}

ipcMain.handle("whatsapp-refresh", async () => refreshWhatsApp());
ipcMain.handle("whatsapp-refresh-state", async () => waRefreshState);

ipcMain.handle("contact-status-sync", async () => {
  try {
    return await syncContactHistory();
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("contact-status-mark", async (_, { phone, mode, name } = {}) => {
  try {
    const entry = contactStatus.setManual(limitString(phone, 40, ""), String(mode || ""), { name: limitString(name, 120, "") });
    // "Não contatar" vale também para as campanhas (lista global de descadastro).
    const dnc = campaignManager?.doNotContact;
    if (dnc && mode === "nao_contatar") dnc.add(phone, "marcado manualmente");
    if (dnc && mode === "limpar") dnc.remove(phone);
    return { success: true, entry };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

let waCheckRunning = false;
ipcMain.handle("whatsapp-check-numbers", async (_, { phones } = {}) => {
  if (waCheckRunning) return { success: false, error: "Já existe uma checagem em andamento." };
  const provider = getActiveWhatsAppProvider();
  if (!provider || provider.getStatus?.() !== "connected" || typeof provider.checkWhatsAppNumbers !== "function") {
    return { success: false, error: "Conecte o WhatsApp para checar os números." };
  }
  const list = (Array.isArray(phones) ? phones : []).slice(0, 2000).map((p) => limitString(String(p || ""), 40, "")).filter(Boolean);
  waCheckRunning = true;
  try {
    let done = 0;
    let withWhatsapp = 0;
    for (let i = 0; i < list.length; i += 40) {
      const result = await provider.checkWhatsAppNumbers(list.slice(i, i + 40));
      const changed = contactStatus.recordWaCheck(result);
      withWhatsapp += Object.values(result).filter(Boolean).length;
      done += Object.keys(result).length;
      safeSend("wa-check-changed", { changed, done, total: list.length });
      // Ritmo leve: a checagem usa a mesma sessão do seu número.
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    return { success: true, checked: done, withWhatsapp };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    waCheckRunning = false;
  }
});

ipcMain.handle("whatsapp-chat-action", async (_, { jid, action, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider || !provider.chatAction)
    return { success: false, error: "Not connected" };
  return await provider.chatAction(jid, action);
});

ipcMain.handle("whatsapp-clear-history", async () => {
  const results = [];
  for (const [connectionId, provider] of whatsappProviders.entries()) {
    if (typeof provider.clearHistory !== "function") continue;
    try {
      results.push({ connectionId, ...(await provider.clearHistory()) });
    } catch (error) {
      results.push({ connectionId, success: false, error: error.message });
    }
  }
  return { success: results.every((item) => item.success !== false), results };
});

ipcMain.handle("whatsapp-delete-message", async (_, { jid, key, forEveryone, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider || !provider.deleteMessage)
    return { success: false, error: "Not connected" };
  return await provider.deleteMessage(jid, key, {
    forEveryone: forEveryone !== false,
  });
});

// ─── Etiquetas de contatos (persistidas em userData) ───
function getContactLabelsPath() {
  return path.join(app.getPath("userData"), "contact-labels.json");
}

function loadContactLabelsStore() {
  try {
    const p = getContactLabelsPath();
    if (!fs.existsSync(p)) {
      return {
        catalog: [
          { id: "tag_cliente", name: "Cliente", color: "#00b894" },
          { id: "tag_lead", name: "Lead", color: "#6c5ce7" },
          { id: "tag_quente", name: "Quente", color: "#e17055" },
          { id: "tag_follow", name: "Follow-up", color: "#fdcb6e" },
        ],
        byJid: {},
      };
    }
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    return {
      catalog: Array.isArray(raw.catalog) ? raw.catalog : [],
      byJid: raw.byJid && typeof raw.byJid === "object" ? raw.byJid : {},
    };
  } catch {
    return { catalog: [], byJid: {} };
  }
}

function saveContactLabelsStore(store) {
  fs.writeFileSync(getContactLabelsPath(), JSON.stringify(store, null, 2), { mode: 0o600 });
}

ipcMain.handle("whatsapp-labels-get", async () => {
  return { success: true, ...loadContactLabelsStore() };
});

ipcMain.handle("whatsapp-labels-save-catalog", async (_, { catalog } = {}) => {
  try {
    const store = loadContactLabelsStore();
    store.catalog = (Array.isArray(catalog) ? catalog : store.catalog)
      .slice(0, 40)
      .map((t, i) => ({
        id: limitString(t.id || `tag_${Date.now()}_${i}`, 40),
        name: limitString(t.name || "Etiqueta", 32),
        color: limitString(t.color || "#6c5ce7", 20),
      }));
    saveContactLabelsStore(store);
    return { success: true, ...store };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("whatsapp-labels-set-contact", async (_, { jid, tagIds } = {}) => {
  try {
    if (!jid) throw new Error("Contato inválido");
    const store = loadContactLabelsStore();
    const ids = (Array.isArray(tagIds) ? tagIds : [])
      .map((id) => String(id))
      .filter((id) => store.catalog.some((t) => t.id === id))
      .slice(0, 12);
    // Sempre individual: grava só neste jid (sem aplicar em massa)
    const key = String(jid);
    if (!ids.length) delete store.byJid[key];
    else store.byJid[key] = ids;
    saveContactLabelsStore(store);
    return { success: true, jid: key, tagIds: ids, catalog: store.catalog, byJid: store.byJid };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("whatsapp-send-media", async (_, { to, filePath, caption, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider) return { success: false, error: "Not connected" };
  try {
    const mediaPath = resolveSelectedMediaPath(filePath, MAX_MEDIA_BYTES, "Media file");
    const buffer = fs.readFileSync(mediaPath);
    const ext = path.extname(mediaPath).toLowerCase();
    const mimeMap = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".mp4": "video/mp4",
      ".m4v": "video/x-m4v",
      ".mov": "video/quicktime",
      ".avi": "video/x-msvideo",
      ".mkv": "video/x-matroska",
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".ogg": "audio/ogg",
      ".opus": "audio/ogg",
      ".webm": "audio/webm",
      ".pdf": "application/pdf",
      ".doc": "application/msword",
      ".docx":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xls": "application/vnd.ms-excel",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".ppt": "application/vnd.ms-powerpoint",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ".txt": "text/plain",
      ".csv": "text/csv",
      ".zip": "application/zip",
      ".rar": "application/vnd.rar",
      ".7z": "application/x-7z-compressed",
      ".tar": "application/x-tar",
      ".gz": "application/gzip",
    };
    const mimetype = mimeMap[ext] || "application/octet-stream";
    const isImage = mimetype.startsWith("image/");
    const isVideo = mimetype.startsWith("video/");
    const isAudio = mimetype.startsWith("audio/");

    const content = {};
    if (caption) content.caption = caption;
    if (isImage) { content.image = buffer; content.mimetype = mimetype; }
    else if (isVideo) { content.video = buffer; content.mimetype = mimetype; }
    else if (isAudio) {
      content.audio = buffer;
      content.mimetype = mimetype;
      // .ogg/.opus e clips de gatilho em userData/trigger-audio → mensagem de voz (PTT)
      const isTriggerClip = /[\\/]trigger-audio[\\/]/i.test(mediaPath);
      content.ptt = isTriggerClip || /audio\/(ogg|opus)/i.test(mimetype) || ext === ".ogg" || ext === ".opus";
    }
    else {
      content.document = buffer;
      content.fileName = path.basename(mediaPath);
      content.mimetype = mimetype;
    }

    return await provider.sendMedia(to, content);
  } catch (e) {
    return { success: false, error: e.message };
  }
});

function convertAudioToOggOpus(buffer, mimetype) {
  const type = String(mimetype || "").toLowerCase();
  // CUIDADO: "audio/webm;codecs=opus" contém "opus" mas NÃO é OGG — precisa converter!
  // Só pular conversão se já for container ogg (ou pure audio/opus).
  const alreadyOgg =
    (type.includes("ogg") && !type.includes("webm")) ||
    type === "audio/opus" ||
    type.startsWith("audio/ogg");
  if (alreadyOgg && Buffer.isBuffer(buffer) && buffer.length > 64) {
    return Promise.resolve({ buffer, mimetype: "audio/ogg; codecs=opus" });
  }
  if (!Buffer.isBuffer(buffer) || buffer.length < 64) {
    return Promise.resolve({ buffer: buffer || Buffer.alloc(0), mimetype: type || "audio/webm", error: "buffer_vazio" });
  }
  return new Promise((resolve) => {
    let ext = ".webm";
    if (type.includes("mp4") || type.includes("m4a") || type.includes("aac")) ext = ".m4a";
    else if (type.includes("mpeg") || type.includes("mp3")) ext = ".mp3";
    else if (type.includes("wav")) ext = ".wav";
    else if (type.includes("ogg")) ext = ".ogg";
    else ext = ".webm";

    const base = path.join(
      os.tmpdir(),
      `sigma_audio_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    );
    const input = `${base}${ext}`;
    const output = `${base}.ogg`;
    try {
      fs.writeFileSync(input, buffer);
      // Força mono 48k opus em container ogg (formato PTT do WhatsApp)
      execFile(
        ffmpegPath,
        [
          "-y",
          "-i", input,
          "-vn",
          "-ac", "1",
          "-ar", "48000",
          "-c:a", "libopus",
          "-b:a", "24k",
          "-application", "voip",
          output,
        ],
        { windowsHide: true, timeout: 45000 },
        (err, _stdout, stderr) => {
          try {
            fs.unlinkSync(input);
          } catch (e) {}
          if (err) {
            console.error("[AUDIO] ffmpeg falhou:", err.message, String(stderr || "").slice(0, 200));
            try {
              fs.unlinkSync(output);
            } catch (e) {}
            // Fallback: tenta enviar original (melhor que silêncio)
            resolve({ buffer, mimetype: mimetype || "audio/webm", converted: false, error: err.message });
            return;
          }
          try {
            const converted = fs.readFileSync(output);
            try { fs.unlinkSync(output); } catch (e) {}
            if (!converted || converted.length < 64) {
              console.error("[AUDIO] ffmpeg gerou arquivo vazio");
              resolve({ buffer, mimetype: mimetype || "audio/webm", converted: false, error: "output_vazio" });
              return;
            }
            resolve({
              buffer: converted,
              mimetype: "audio/ogg; codecs=opus",
              converted: true,
              bytes: converted.length,
            });
          } catch (e) {
            resolve({ buffer, mimetype: mimetype || "audio/webm", converted: false, error: e.message });
          }
        },
      );
    } catch (e) {
      resolve({ buffer, mimetype: mimetype || "audio/webm", converted: false, error: e.message });
    }
  });
}

function parseAudioPayload(audioData) {
  if (audioData == null) throw new Error("Áudio vazio");
  if (Buffer.isBuffer(audioData)) return audioData;
  if (typeof audioData === "string") return Buffer.from(audioData, "base64");
  if (Array.isArray(audioData) || ArrayBuffer.isView(audioData)) return Buffer.from(audioData);
  if (audioData?.type === "Buffer" && Array.isArray(audioData.data)) {
    return Buffer.from(audioData.data);
  }
  throw new Error("Formato de áudio inválido");
}

function getTriggerAudioDir() {
  const dir = path.join(app.getPath("userData"), "trigger-audio");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

ipcMain.handle(
  "whatsapp-send-audio",
  async (_, { to, audioData, mimetype, connectionId } = {}) => {
    const provider = resolveChatProvider(connectionId);
    if (!provider) return { success: false, error: "Not connected" };
    try {
      const rawBuffer = parseAudioPayload(audioData);
      if (!rawBuffer.length) throw new Error("Áudio vazio");
      if (rawBuffer.length > MAX_AUDIO_BYTES) {
        throw new Error("Áudio excede o tamanho máximo (15 MB)");
      }
      const audio = await convertAudioToOggOpus(rawBuffer, mimetype);
      if (!audio.buffer || audio.buffer.length < 64) {
        return { success: false, error: "Áudio inválido ou vazio após conversão. Grave de novo." };
      }
      if (audio.error && !audio.converted) {
        console.warn("[AUDIO] conversão incompleta:", audio.error, "mime=", audio.mimetype);
      }
      // Estima segundos pelo bitrate ~24kbps se não informado
      const approxSec = Math.max(1, Math.round((audio.buffer.length * 8) / 24000));
      return await provider.sendAudio(to, audio.buffer, audio.mimetype, approxSec);
    } catch (e) {
      return { success: false, error: e.message };
    }
  },
);

/** Salva gravação/anexo como clipe reutilizável de gatilho (ogg/opus, estilo PTT). */
ipcMain.handle(
  "whatsapp-save-trigger-audio",
  async (_, { audioData, mimetype, label, durationSec, sourcePath } = {}) => {
    try {
      let rawBuffer;
      let srcMime = mimetype;
      if (sourcePath && typeof sourcePath === "string") {
        // Anexar arquivo do disco
        const resolved = resolveSelectedMediaPath(sourcePath, MAX_AUDIO_BYTES, "Áudio");
        rawBuffer = fs.readFileSync(resolved);
        const ext = path.extname(resolved).toLowerCase();
        const mimeMap = {
          ".mp3": "audio/mpeg",
          ".wav": "audio/wav",
          ".ogg": "audio/ogg",
          ".opus": "audio/ogg",
          ".webm": "audio/webm",
          ".m4a": "audio/mp4",
        };
        srcMime = srcMime || mimeMap[ext] || "audio/webm";
      } else {
        rawBuffer = parseAudioPayload(audioData);
      }
      if (!rawBuffer.length) throw new Error("Áudio vazio");
      if (rawBuffer.length > MAX_AUDIO_BYTES) {
        throw new Error("Áudio excede o tamanho máximo (15 MB)");
      }
      const audio = await convertAudioToOggOpus(rawBuffer, srcMime);
      const id = `aud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const filePath = path.join(getTriggerAudioDir(), `${id}.ogg`);
      fs.writeFileSync(filePath, audio.buffer);
      rememberAllowedMediaPath(filePath);
      return {
        success: true,
        id,
        filePath,
        mimetype: "audio/ogg; codecs=opus",
        label: limitString(String(label || "Áudio"), 80) || "Áudio",
        durationSec: Math.max(1, Math.round(Number(durationSec) || 1)),
        bytes: audio.buffer.length,
      };
    } catch (e) {
      console.error("[WHATSAPP] save-trigger-audio:", e.message);
      return { success: false, error: e.message };
    }
  },
);

ipcMain.handle("whatsapp-delete-trigger-audio", async (_, { filePath } = {}) => {
  try {
    if (!filePath || typeof filePath !== "string") {
      return { success: false, error: "Caminho inválido" };
    }
    const root = path.resolve(getTriggerAudioDir());
    const resolved = path.resolve(filePath);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      return { success: false, error: "Caminho fora da área permitida" };
    }
    if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

/** Lê clipe de gatilho em base64 para prévia no player. */
ipcMain.handle("whatsapp-read-trigger-audio", async (_, { filePath } = {}) => {
  try {
    if (!filePath || typeof filePath !== "string") {
      return { success: false, error: "Caminho inválido" };
    }
    const root = path.resolve(getTriggerAudioDir());
    const resolved = path.resolve(filePath);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      return { success: false, error: "Caminho fora da área permitida" };
    }
    if (!fs.existsSync(resolved)) {
      return { success: false, error: "Arquivo não encontrado" };
    }
    const buf = fs.readFileSync(resolved);
    return {
      success: true,
      data: buf.toString("base64"),
      mimetype: "audio/ogg",
      filePath: resolved,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

/**
 * Envia áudio de gatilho como mensagem de voz (PTT).
 * Não depende da lista de paths do diálogo — só arquivos em trigger-audio.
 */
ipcMain.handle(
  "whatsapp-send-trigger-audio",
  async (_, { to, filePath, connectionId } = {}) => {
    const provider = resolveChatProvider(connectionId);
    if (!provider) return { success: false, error: "WhatsApp não conectado" };
    try {
      if (!to) throw new Error("Destinatário inválido");
      if (!filePath || typeof filePath !== "string") throw new Error("Áudio inválido");
      const root = path.resolve(getTriggerAudioDir());
      const resolved = path.resolve(filePath);
      if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        // Também aceita se estiver na lista de permitidos (anexo importado copiado)
        try {
          resolveSelectedMediaPath(resolved, MAX_AUDIO_BYTES, "Áudio do gatilho");
        } catch {
          throw new Error("Arquivo de áudio do gatilho não autorizado");
        }
      }
      if (!fs.existsSync(resolved)) {
        throw new Error("Arquivo de áudio não encontrado — recrie o gatilho");
      }
      const raw = fs.readFileSync(resolved);
      if (!raw.length) throw new Error("Áudio vazio");
      const audio = await convertAudioToOggOpus(raw, "audio/ogg");
      if (!audio.buffer || audio.buffer.length < 64) {
        return { success: false, error: "Arquivo de áudio do gatilho está vazio ou corrompido" };
      }
      rememberAllowedMediaPath(resolved);
      const approxSec = Math.max(1, Math.round((audio.buffer.length * 8) / 24000));
      const result = await provider.sendAudio(
        to,
        audio.buffer,
        "audio/ogg; codecs=opus",
        approxSec,
      );
      if (!result?.success) {
        console.error("[WHATSAPP] send-trigger-audio failed:", result?.error);
      }
      return result;
    } catch (e) {
      console.error("[WHATSAPP] send-trigger-audio:", e.message);
      return { success: false, error: e.message };
    }
  },
);

ipcMain.handle("whatsapp-send-sticker", async (_, { to, filePath, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider || !provider.sendSticker)
    return { success: false, error: "Not connected" };
  try {
    const stickerPath = resolveSelectedMediaPath(filePath, MAX_STICKER_BYTES, "Sticker file");
    const buffer = fs.readFileSync(stickerPath);
    return await provider.sendSticker(to, buffer);
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("whatsapp-react-message", async (_, { jid, key, emoji, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider || !provider.reactMessage)
    return { success: false, error: "Not connected" };
  return await provider.reactMessage(jid, key, emoji);
});

ipcMain.handle(
  "whatsapp-forward-message",
  async (_, { fromJid, messageId, toJid, connectionId } = {}) => {
    const provider = resolveChatProvider(connectionId);
    if (!provider || !provider.forwardMessage)
      return { success: false, error: "Not connected" };
    return await provider.forwardMessage(fromJid, messageId, toJid);
  },
);

ipcMain.handle("whatsapp-download-media", async (_, { jid, messageId, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider || !provider.downloadMedia)
    return { success: false, error: "Not connected" };
  return await provider.downloadMedia(jid, messageId);
});

// Open a previously downloaded media file in the OS default viewer.
// Path must resolve inside the provider's media cache root to prevent traversal.
ipcMain.handle("whatsapp-open-media", async (_, { filePath, connectionId } = {}) => {
  try {
    if (!filePath || typeof filePath !== "string") {
      return { success: false, error: "Caminho inválido" };
    }
    const id = connectionId || activeWhatsAppId;
    if (!id) return { success: false, error: "Sem conexão ativa" };
    const provider = whatsappProviders.get(id);
    if (!provider) return { success: false, error: "Conexão não encontrada" };
    const roots = [
      provider.getMediaCacheRoot ? provider.getMediaCacheRoot() : null,
      provider.getStickerCacheRoot ? provider.getStickerCacheRoot() : null,
    ].filter(Boolean).map((root) => path.resolve(root));
    const resolved = path.resolve(filePath);
    const allowed = roots.some(
      (root) => resolved === root || resolved.startsWith(root + path.sep),
    );
    if (!roots.length || !allowed) {
      return { success: false, error: "Caminho fora da área permitida" };
    }
    if (!fs.existsSync(resolved)) {
      return { success: false, error: "Arquivo não encontrado" };
    }
    await shell.openPath(resolved);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("whatsapp-get-archived-chats", async (_, { connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider || !provider.getArchivedChats)
    return { chats: [] };
  return { chats: provider.getArchivedChats() };
});

ipcMain.handle("whatsapp-get-settings", async () => {
  const settings = loadWhatsAppSettings();
  const usage = campaignManager?.dailyQuota?.getAllUsage?.() || {
    date: null,
    byConnection: {},
  };
  return {
    settings,
    dailyQuota: usage,
    limitTiers: LIMIT_TIERS,
  };
});

ipcMain.handle("whatsapp-update-settings", async (_, { patch }) => {
  const current = loadWhatsAppSettings();
  const next = mergeWhatsAppSettingsPatch(current, patch);
  const settings = saveWhatsAppSettings(next);
  const usage = campaignManager?.dailyQuota?.getAllUsage?.() || {
    date: null,
    byConnection: {},
  };
  return { success: true, settings, dailyQuota: usage, limitTiers: LIMIT_TIERS };
});

ipcMain.handle("whatsapp-start-chat", async (_, { phone, name }) => {
  try {
    if (typeof phone === "string" && phone.includes("@")) {
      const jid = phone.trim();
      return {
        success: true,
        jid,
        phone: jid.replace(/@.*$/, ""),
        name: limitString(name || "", 80),
      };
    }
    const normalized = normalizePhone(phone);
    if (!normalized.valid) {
      return { success: false, error: "Número inválido" };
    }
    return {
      success: true,
      jid: `${normalized.number}@s.whatsapp.net`,
      phone: normalized.number,
      name: limitString(name || "", 80),
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("whatsapp-get-link-preview", async (_, { url }) => {
  try {
    return await fetchLinkPreview(url);
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("whatsapp-save-sticker", async (_, { jid, messageId, name, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider || !provider.saveStickerMedia)
    return { success: false, error: "Not connected" };
  const result = await provider.saveStickerMedia(jid, messageId, name);
  if (result?.success && result.sticker) {
    const stickers = loadStickerStore();
    const next = [
      {
        ...result.sticker,
        name: limitString(name || result.sticker.name || "Figurinha", 80),
        lastUsedAt: Date.now(),
        favorite: false,
      },
      ...stickers.filter((item) => item.id !== result.sticker.id),
    ].slice(0, 500);
    saveStickerStore(next);
  }
  return result;
});

ipcMain.handle("whatsapp-list-stickers", async () => {
  return { stickers: loadStickerStore() };
});

ipcMain.handle("whatsapp-send-saved-sticker", async (_, { to, stickerId, connectionId } = {}) => {
  const provider = resolveChatProvider(connectionId);
  if (!provider || !provider.sendSticker)
    return { success: false, error: "Not connected" };
  try {
    const stickers = loadStickerStore();
    const sticker = stickers.find((item) => item.id === stickerId);
    if (!sticker || !sticker.filePath || !fs.existsSync(sticker.filePath)) {
      return { success: false, error: "Figurinha não encontrada" };
    }
    const buffer = fs.readFileSync(sticker.filePath);
    const result = await provider.sendSticker(to, buffer);
    if (result?.success) {
      sticker.lastUsedAt = Date.now();
      saveStickerStore(stickers);
    }
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle("dialog-open-file", async (_, { filters } = {}) => {
  if (!mainWindow) return { success: false, canceled: true };
  const options =
    Array.isArray(filters)
      ? { filters }
      : filters && typeof filters === "object"
        ? {
            title: filters.title,
            filters: Array.isArray(filters.filters) ? filters.filters : undefined,
          }
        : {};
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: options.filters || [{ name: "Todos os arquivos", extensions: ["*"] }],
    title: options.title || "Selecionar arquivo",
  });
  if (canceled || !filePaths[0]) {
    return { success: false, canceled: true };
  }
  const chosen = filePaths[0];
  rememberAllowedMediaPath(chosen);
  return {
    success: true,
    canceled: false,
    path: chosen,
    filePath: chosen,
    name: path.basename(chosen),
  };
});

// ─── LEAD SCORING ──────────────────────────
ipcMain.handle("lead-scoring-get-settings", async () => {
  return { success: true, settings: leadScoringService.getSettings() };
});

ipcMain.handle("lead-scoring-update-settings", async (_, { patch }) => {
  try {
    return { success: true, settings: leadScoringService.updateSettings(patch || {}) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IA: agentes (triagem, pesquisa, copy, respostas, analista) ─────
function currentAiSettings() {
  return leadScoringService?.store?.getSettings?.() || {};
}

function currentInsights() {
  try {
    return computeInsights(campaignManager?.getAll?.() || []);
  } catch {
    return null;
  }
}

function hasAiConfigured(settings) {
  const ai = settings?.ai || {};
  return !!(ai.enabled && ai.apiKey);
}

/**
 * Porta única de IA para os agentes: respeita "ligado" e o limite diário,
 * registra o uso e injeta o playbook do Analista (auto-aperfeiçoamento).
 * Devolve null quando o agente não pode usar IA agora (segue só com regras).
 */
function agentAi(agentId) {
  const settings = currentAiSettings();
  if (!hasAiConfigured(settings) || !agentStore || agentStore.remaining(agentId) <= 0) return null;
  // O Analista já recebe o playbook anterior completo (playbook_anterior); não repetir.
  const playbook = agentId === "analista" ? "" : agentStore.playbookText();
  return async (task) => {
    const payload = playbook ? { ...task.payload, playbook_do_analista: playbook } : task.payload;
    const result = await runAiTask(settings, { ...task, payload });
    agentStore.consume(agentId, 1);
    agentStore.addTokens(agentId, result.usage);
    return result;
  };
}

function cleanLeadInput(input = {}) {
  const lead = input && typeof input === "object" ? input : {};
  return {
    name: limitString(normalizeText(lead.name || lead.company), 160, ""),
    category: limitString(normalizeText(lead.category), 120, ""),
    address: limitString(lead.address, 300, ""),
    city: limitString(lead.city, 120, ""),
    phone: limitString(lead.phone || lead.tel, 40, ""),
    website: limitString(lead.website || lead.site, 300, ""),
    instagram: limitString(lead.instagram, 160, ""),
    rating: limitString(String(lead.rating ?? ""), 10, ""),
    totalReviews: limitString(String(lead.reviewCount ?? lead.reviews ?? lead.totalReviews ?? ""), 12, ""),
    saudacao: limitString(lead.saudacao, 80, ""),
    decisor: limitString(typeof lead.decisor === "object" ? lead.decisor?.nome : lead.decisor, 120, ""),
  };
}

let triageRunning = false;

/** Agente de Triagem: sites em paralelo + IA em lotes, dentro do limite diário. */
async function runTriageAgent(rawLeads, { auto = false, force = false } = {}) {
  if (triageRunning) return { success: false, error: "A triagem já está rodando. Aguarde terminar." };
  const settings = currentAiSettings();
  if (!agentStore.settings("triagem").enabled) return { success: false, error: "O Agente de Triagem está desligado em Agentes." };
  const leads = (Array.isArray(rawLeads) ? rawLeads : [])
    .slice(0, 2000)
    .map(cleanLeadInput)
    .filter((lead) => lead.name && (!auto || lead.phone))
    .filter((lead) => force || !triageStore.has(triageKey(lead)));
  if (!leads.length) return { success: true, triaged: 0, aiUsed: 0, hot: 0 };

  triageRunning = true;
  const budget = hasAiConfigured(settings) ? agentStore.remaining("triagem") : 0;
  agentStore.log("triagem", `${auto ? "Automático" : "Manual"}: triando ${leads.length} lead(s)${budget ? "" : " só com regras (IA indisponível ou limite do dia)"}.`);
  try {
    const { results, aiUsed, aiError } = await triageLeads(leads, {
      settings,
      runAi: budget
        ? (task) => runAiTask(settings, task).then((r) => { agentStore.addTokens("triagem", r.usage); return r; })
        : null,
      playbook: agentStore.playbookText(),
      aiBudget: budget,
      onProgress: (progress) => safeSend("agent-progress", { agent: "triagem", ...progress }),
    });
    agentStore.consume("triagem", aiUsed);
    triageStore.putMany(results);
    const hot = results.filter((r) => r.level === "alto").length;
    if (auto && hot) {
      const hotLeads = leads.filter((lead) => results.find((r) => r.key === triageKey(lead))?.level === "alto");
      prepareQueueDrafts(hotLeads, { source: "triagem automática" })
        .then((res) => res.added && agentStore.log("triagem", `${res.added} lead(s) de alto potencial foram para a fila (aguardando sua aprovação).`))
        .catch(() => {});
    }
    agentStore.log("triagem", `${results.length} lead(s) triados · ${hot} de alto potencial · ${aiUsed} com IA.${aiError ? ` IA falhou: ${aiError}` : ""}`, !aiError);
    return { success: true, triaged: results.length, aiUsed, hot, aiError };
  } catch (error) {
    agentStore.log("triagem", `Falhou: ${error.message}`, false);
    return { success: false, error: error.message };
  } finally {
    triageRunning = false;
  }
}

let analystRunning = false;

/** Agente Analista: reescreve o playbook a partir dos resultados reais. */
async function runAnalystAgent({ auto = false } = {}) {
  if (analystRunning) return { success: false, error: "O analista já está trabalhando." };
  const insights = currentInsights();
  const previous = agentStore.getPlaybook();
  if (auto) {
    const s = agentStore.settings("analista");
    const newSends = Number(insights?.sent || 0) - Number(previous?.basedOnSent || 0);
    if (!s.auto || newSends < 25) return { success: true, skipped: true };
  }
  const runAi = agentAi("analista");
  if (!runAi) return { success: false, error: "Configure a IA e confira o limite do Agente Analista." };
  analystRunning = true;
  try {
    const settings = currentAiSettings();
    const playbook = await runAnalyst({ insights, commercial: settings.commercial, previous }, runAi);
    agentStore.setPlaybook(playbook);
    agentStore.log("analista", `Playbook atualizado com ${playbook.basedOnSent} envio(s) (resposta ${playbook.replyRate}%).`);
    return { success: true, playbook };
  } catch (error) {
    agentStore.log("analista", `Falhou: ${error.message}`, false);
    return { success: false, error: error.message };
  } finally {
    analystRunning = false;
  }
}

// ─── FILA DE ENVIO (aprovação + ritmo seguro + recontato) ───
function leadPeers(lead) {
  try {
    const raw = getLeadsFileStore().load();
    const all = raw ? JSON.parse(raw) : [];
    const cat = String(lead.category || "").toLowerCase();
    const hood = String(lead.neighborhood || "").toLowerCase();
    const sameCat = all.filter((l) => String(l?.category || "").toLowerCase() === cat);
    const sameHood = hood ? sameCat.filter((l) => String(l?.neighborhood || "").toLowerCase() === hood) : [];
    return sameHood.length >= 3 ? sameHood : sameCat;
  } catch {
    return [];
  }
}

/**
 * Transforma leads em rascunhos na fila: oferta de entrada pela triagem,
 * problemas encontrados (inclui diagnóstico de imagem) e mensagem pronta.
 */
async function prepareQueueDrafts(rawLeads, { limit = 200 } = {}) {
  const skipped = { contatado: 0, na_fila: 0, sem_whatsapp: 0, sem_telefone: 0 };
  const waCheck = contactStatus?.getWaCheck() || {};
  const items = [];
  for (const raw of (Array.isArray(rawLeads) ? rawLeads : []).slice(0, 2000)) {
    if (items.length >= limit) break;
    const lead = {
      ...cleanLeadInput(raw),
      neighborhood: limitString(raw?.neighborhood || raw?.bairro, 120, ""),
      placeId: limitString(raw?.placeId, 80, ""),
      photos: { count: Number(raw?.photos?.count) || 0 },
    };
    if (!lead.phone) { skipped.sem_telefone += 1; continue; }
    if (contactStatus?.get(lead.phone)) { skipped.contatado += 1; continue; }
    if (sendQueue.activeFor(lead.phone)) { skipped.na_fila += 1; continue; }
    const core = phoneKey(lead.phone);
    if (waCheck[core]?.exists === false) { skipped.sem_whatsapp += 1; continue; }
    const triage = triageStore.getAll()[triageKey(lead)] || computeTriage(lead, null);
    const offer = entryOffer(triage);
    const image = imageDiagnosis(lead, leadPeers(lead));
    const findings = [...(triage.findings || []), ...(offer === "imagem" ? image.findings : [])];
    items.push({ key: `k${items.length}`, kind: "primeiro", offer, lead, findings, triage });
  }
  if (!items.length) return { success: true, added: 0, skipped };
  const composed = await composeMessages(items, {
    runAi: agentAi("copywriter"),
    commercial: commercialForAgents(),
  });
  // Playbook: todo 1º contato é a abertura curta ("oi, é da X?"); o
  // diagnóstico vira argumento depois, quando o lead já está conversando.
  for (const item of items) item.variant = "A";
  const added = sendQueue.add(items.map((item) => ({
    phone: item.lead.phone,
    kind: "primeiro",
    offer: item.offer,
    name: item.lead.name,
    lead: item.lead,
    message: item.variant === "B" ? item.triage.presente.mensagem : composed.get(item.key)?.mensagem || "",
    ai: item.variant === "B" ? !!item.triage.aiApplied : composed.get(item.key)?.ai,
    variant: item.variant,
    opener: composed.get(item.key)?.opener,
    reason: `${item.variant === "B" ? "[B: diagnóstico grátis] " : item.variant === "A" ? "[A: pergunta] " : ""}${OFFERS[item.offer].label}: ${item.findings.slice(0, 2).join("; ") || "potencial " + (item.triage.score ?? "")}`,
  })));
  return { success: true, added: added.length, skipped };
}

async function planQueueRecontacts() {
  if (!sendQueue || !contactStatus) return 0;
  const plans = sendQueue.planRecontacts((phone) => contactStatus.get(phone));
  if (!plans.length) return 0;
  const items = [];
  for (const plan of plans) {
    const base = plan.base;
    const lead = base.lead || { name: base.name, phone: base.phone };
    if (plan.kind === "follow_up") {
      items.push({ key: `r${items.length}`, kind: "follow_up", offer: base.offer, lead, base });
    } else {
      const entry = sendQueue.historyFor(base.phone).find((i) => i.kind === "primeiro")?.offer || base.offer;
      const offer = nextOffer(entry, plan.tried);
      if (!offer) continue;
      items.push({ key: `r${items.length}`, kind: "nova_oferta", offer, previousOffer: base.offer, lead, base });
    }
  }
  if (!items.length) return 0;
  const composed = await composeMessages(items, { runAi: agentAi("copywriter"), commercial: currentAiSettings().commercial || {} });
  const added = sendQueue.add(items.map((item) => ({
    phone: item.base.phone,
    kind: item.kind,
    offer: item.offer,
    previousOffer: item.previousOffer,
    name: item.base.name,
    lead: item.lead,
    message: composed.get(item.key)?.mensagem || "",
    ai: composed.get(item.key)?.ai,
    reason: item.kind === "follow_up"
      ? `Sem resposta há ${sendQueue.settings.followUpDays} dia(s)`
      : `Sem resposta ao follow-up: nova oferta (${OFFERS[item.offer].label})`,
  })));
  return added.length;
}

let queueSending = false;
let queueWait = "";
async function queueTick() {
  if (queueSending || !sendQueue) return;
  const next = sendQueue.nextToSend();
  if (!next.item) {
    if (next.wait !== queueWait) {
      queueWait = next.wait;
      safeSend("queue-status", { wait: next.wait });
    }
    return;
  }
  // Rodízio: todos os números conectados, cada um com o seu teto diário.
  const quota = campaignManager?.dailyQuota;
  const limitCfg = DailyQuota.resolveLimitConfig(campaignManager?.getCampaignSettings?.() || {});
  const connected = [...whatsappProviders.entries()]
    .filter(([id, p]) => p?.getStatus?.() === "connected" && (!quota || quota.check(id, limitCfg).allowed))
    .map(([id]) => id);
  if (!connected.length) {
    const anyOnline = [...whatsappProviders.values()].some((p) => p?.getStatus?.() === "connected");
    const wait = anyOnline ? "limite_diario" : "sem_whatsapp";
    if (queueWait !== wait) safeSend("queue-status", { wait: (queueWait = wait) });
    return;
  }
  const item = next.item;
  const contact = contactStatus?.get(item.phone);
  const senderId = sendQueue.pickSender(connected, contact?.connectionId || "");
  if (!senderId) {
    if (queueWait !== "limite_diario") safeSend("queue-status", { wait: (queueWait = "limite_diario") });
    return;
  }
  const provider = whatsappProviders.get(senderId);
  if (item.kind === "primeiro" && contact) {
    sendQueue.markResult(item.id, { skipReason: "Já contatado por outro caminho" });
    return;
  }
  if (contact && ["respondeu", "descadastrado", "nao_contatar"].includes(contact.status)) {
    sendQueue.markResult(item.id, { skipReason: contact.status === "respondeu" ? "Já respondeu" : "Não contatar" });
    return;
  }
  if (campaignManager?.doNotContact?.has(item.phone)) {
    sendQueue.markResult(item.id, { skipReason: "Pediu para não receber mensagens" });
    return;
  }
  queueSending = true;
  queueWait = "enviando";
  sendQueue.markSending(item.id);
  try {
    const result = await provider.sendMessage(item.phone, { text: item.message });
    if (result?.success && result.messageId) {
      contactStatus?.recordSent(item.phone, { messageId: result.messageId, source: "fila", name: item.name, connectionId: senderId });
      if (quota) quota.recordSend(senderId, 1);
      sendQueue.markResult(item.id, { ok: true, messageId: result.messageId, connectionId: senderId });
    } else {
      const error = result?.error || "Envio sem confirmação do WhatsApp";
      if (/não tem WhatsApp|sem WhatsApp/i.test(error)) contactStatus?.recordWaCheck({ [item.phone]: false });
      sendQueue.markResult(item.id, { ok: false, error });
    }
  } catch (error) {
    sendQueue.markResult(item.id, { ok: false, error: error.message });
  } finally {
    queueSending = false;
  }
}

/**
 * Campanhas + a fila de envio como uma "campanha" a mais, para o Kanban mover
 * sozinho os leads da fila (enviado → respondeu) com as mesmas regras.
 */
function campaignsForKanban() {
  const campaigns = campaignManager?.getAll?.() || [];
  if (!sendQueue) return campaigns;
  const latest = new Map();
  for (const item of sendQueue.items) {
    if (item.status !== "enviado") continue;
    const prev = latest.get(item.phoneCore);
    if (!prev || (item.sentAt || 0) > (prev.sentAt || 0)) latest.set(item.phoneCore, item);
  }
  if (!latest.size) return campaigns;
  const leads = [...latest.values()].map((item) => ({
    leadId: `fila_${item.phoneCore}`,
    name: item.name,
    phone: item.phone,
    status: contactStatus?.get(item.phoneCore)?.status === "respondeu" ? "replied" : "sent",
    sentAt: item.sentAt,
  }));
  return [...campaigns, { id: "fila", name: "Fila de envio", status: "running", leads }];
}

let kanbanQueueSyncTimer = null;
function scheduleKanbanQueueSync() {
  if (kanbanQueueSyncTimer) clearTimeout(kanbanQueueSyncTimer);
  kanbanQueueSyncTimer = setTimeout(() => {
    kanbanQueueSyncTimer = null;
    try { kanbanStore?.syncCampaigns(campaignsForKanban(), { replace: true, existingOnly: true }); } catch { /* Kanban indisponível */ }
  }, 1500);
}

/** Kit de venda do lead: oferta atual, roteiro de objeções e argumento de imagem. */
function leadSalesKit(phone) {
  const core = phoneKey(phone);
  if (core.length < 10) return null;
  let lead = null;
  try {
    const raw = getLeadsFileStore().load();
    const all = raw ? JSON.parse(raw) : [];
    lead = all.find((l) => phoneKey(l?.phone || l?.tel) === core) || null;
  } catch { /* base indisponível */ }
  const history = sendQueue?.historyFor(core) || [];
  const lastOffer = [...history].reverse().find((i) => i.offer)?.offer;
  const triage = lead ? triageStore?.getAll()?.[triageKey(lead)] || computeTriage(lead, null) : null;
  const offer = lastOffer || (triage ? entryOffer(triage) : "imagem");
  const image = lead ? imageDiagnosis(lead, leadPeers(lead)) : { findings: [], comparacao: null };
  return {
    offer,
    offerLabel: OFFERS[offer]?.label || offer,
    objections: objectionsFor(offer),
    image,
    contact: contactStatus?.get(core) || null,
  };
}

ipcMain.handle("lead-sales-kit", async (_, { phone } = {}) => {
  const kit = leadSalesKit(limitString(phone, 60, ""));
  return kit ? { success: true, kit } : { success: false, error: "Número inválido." };
});

ipcMain.handle("backup-status", async () => {
  return { success: true, backups: listBackups(app.getPath("userData")) };
});

ipcMain.handle("backup-now", async () => {
  try {
    leadsFileStore?.flush();
    contactStatus?.flush();
    const result = runBackup(app.getPath("userData"));
    return { success: true, ...result, backups: listBackups(app.getPath("userData")) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("backup-open-folder", async () => {
  const root = backupRoot(app.getPath("userData"));
  fs.mkdirSync(root, { recursive: true });
  const error = await shell.openPath(root);
  return error ? { success: false, error } : { success: true };
});

ipcMain.handle("queue-get", async () => ({
  success: true,
  ...sendQueue.snapshot(),
  wait: queueWait,
  ab: sendQueue.abStats((phone) => contactStatus?.get(phone)),
  numbers: senderNumbers(),
}));

/** Números no rodízio da fila: quem está online e quanto já enviou hoje. */
function senderNumbers() {
  const cap = sendQueue?.settings?.perNumberDaily || 40;
  return [...whatsappProviders.entries()].map(([id, p]) => ({
    id,
    phone: p?.getPhoneNumber?.() || "",
    connected: p?.getStatus?.() === "connected",
    sentToday: sendQueue?.sentTodayBy(id) || 0,
    cap,
  }));
}

ipcMain.handle("lead-memory-all", async () => {
  const out = {};
  const contacts = contactStatus?.getAll() || {};
  const memory = leadMemory?.getAll() || {};
  for (const phone of new Set([...Object.keys(contacts), ...Object.keys(memory)])) {
    const temperature = temperatureOf(contacts[phone], memory[phone]);
    if (temperature && (contacts[phone]?.status === "respondeu" || memory[phone])) {
      out[phone] = { temperatura: temperature, momento: memory[phone]?.momento || "", objecoes: memory[phone]?.objecoes || [] };
    }
  }
  return { success: true, memory: out };
});

ipcMain.handle("ai-proposal", async (_, { phone, messages } = {}) => {
  try {
    return { success: true, ...(await proposalFor(limitString(phone, 60, ""), messages)) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

/** Dados do vendedor para os agentes, com a tabela de ofertas e preços. */
function commercialForAgents() {
  const c = currentAiSettings().commercial || {};
  return { ...c, ofertas: String(c.offers || "").trim() || DEFAULT_OFFERS };
}

/** Agente de Proposta: proposta com o problema real do lead e a oferta certa. */
async function proposalFor(phone, messages) {
  {
    const runAi = agentAi("proposta");
    if (!runAi) throw new Error("Configure a IA e confira o limite do Agente de Proposta.");
    const kit = leadSalesKit(phone);
    if (!kit) throw new Error("Lead sem telefone válido.");
    const lead = cleanLeadInput(leadByPhone(phone) || {});
    const triage = triageStore.getAll()[triageKey(lead)] || computeTriage(lead, null);
    const conversation = (Array.isArray(messages) ? messages : []).slice(-12).map((m) => ({
      de: m?.fromMe ? "vendedor" : "lead",
      texto: limitString(String(m?.text || ""), 600, ""),
    })).filter((m) => m.texto);
    const result = await writeProposal({
      lead: { ...lead, saudacao: lead.saudacao || undefined },
      offer: kit.offerLabel,
      findings: [...(triage.findings || []), ...(kit.image?.findings || [])],
      conversation,
      commercial: commercialForAgents(),
    }, runAi);
    agentStore.log("proposta", `Proposta de ${kit.offerLabel} para ${lead.name || "lead"}.`);
    return result;
  }
}

ipcMain.handle("queue-prepare", async (_, { leads, limit } = {}) => {
  try {
    return await prepareQueueDrafts(leads, { limit: clampInteger(limit, 1, 500, 50) });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("queue-update", async (_, { id, patch } = {}) => {
  try {
    const item = sendQueue.update(String(id || ""), patch || {});
    setImmediate(() => queueTick().catch(() => {}));
    return { success: true, item };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("queue-approve", async (_, { ids } = {}) => {
  const approved = sendQueue.approveAll(Array.isArray(ids) ? ids.map(String) : null);
  setImmediate(() => queueTick().catch(() => {}));
  return { success: true, approved };
});

ipcMain.handle("queue-settings", async (_, { patch } = {}) => {
  return { success: true, settings: sendQueue.updateSettings(patch || {}) };
});

// ─── PILOTO AUTOMÁTICO (agentes trabalhando sozinhos, ao vivo) ───
function allLeads() {
  try {
    const raw = getLeadsFileStore().load();
    const leads = raw ? JSON.parse(raw) : [];
    return Array.isArray(leads) ? leads : [];
  } catch {
    return [];
  }
}

function leadByPhone(phone) {
  const key = phoneKey(phone);
  return allLeads().find((lead) => phoneKey(lead?.phone || lead?.tel) === key) || null;
}

/** Lead ainda não abordado, com telefone, fora da fila e sem "não tem WhatsApp". */
function isAvailableLead(lead, waCheck) {
  const phone = lead?.phone || lead?.tel;
  if (!phone || phoneKey(phone).length < 10) return false;
  if (contactStatus?.get(phone)) return false;
  if (sendQueue?.activeFor(phone)) return false;
  if (sendQueue?.historyFor(phone)?.length) return false;
  return waCheck?.[phoneKey(phone)]?.exists !== false;
}

/** Junta ao lead o que o Pesquisador achou (saudação e decisor melhoram a mensagem). */
function withIntel(lead) {
  const intel = autopilot?.intel?.[phoneKey(lead?.phone || lead?.tel)];
  if (!intel) return lead;
  return { ...lead, saudacao: lead.saudacao || intel.saudacao || "", decisor: lead.decisor || intel.decisor?.nome || "" };
}

const pendingHunts = new Map();

/** Dispara uma caçada no Maps (a janela executa) e registra o resultado. */
function startHunt(mission, goal = autopilot.settings.huntGoal || 40) {
  const MIN = 60 * 1000;
  const id = `hunt_${Date.now()}`;
  const done = new Promise((resolve) => {
    const timer = setTimeout(() => { pendingHunts.delete(id); resolve({ error: "Tempo esgotado" }); }, 45 * MIN);
    pendingHunts.set(id, (result) => { clearTimeout(timer); pendingHunts.delete(id); resolve(result || {}); });
  });
  safeSend("autopilot-hunt", { id, niche: mission.niche, city: mission.city, neighborhoods: mission.neighborhoods || [], goal });
  autopilot.setLive("cacador", { status: "working", task: `Caçando ${mission.niche} em ${mission.city} (meta ${goal} novos)` });
  done.then((result) => {
    const text = result.error
      ? `Caçada de ${mission.niche} em ${mission.city} falhou: ${result.error}`
      : `Caçada de ${mission.niche} em ${mission.city}: ${result.added || 0} lead(s) novos na base.`;
    if (!result.error) autopilot.countStage("cacador", result.added || 0);
    autopilot.log("cacador", text, result.error ? "error" : "ok");
    autopilot.setLive("cacador", { status: result.error ? "error" : "done", task: text, finishedAt: Date.now() });
    autopilot.emit();
    safeSend("jarvis-say", { text: result.error ? `A caçada de ${mission.niche} falhou.` : `Caçada concluída, senhor: ${result.added || 0} leads novos de ${mission.niche}.` });
  });
  return goal;
}

/** Nichos que mais respondem de verdade (mín. 8 contatos), para o Caçador priorizar. */
function bestNiches() {
  const groups = {};
  for (const lead of allLeads()) {
    const contact = contactStatus?.get(lead?.phone || lead?.tel || "");
    if (!contact || contact.status === "nao_contatar" || !lead.category) continue;
    const g = (groups[lead.category] ||= { sent: 0, replied: 0 });
    g.sent += 1;
    if (contact.status === "respondeu") g.replied += 1;
  }
  return Object.entries(groups)
    .filter(([, g]) => g.sent >= 8 && g.replied > 0)
    .sort((a, b) => b[1].replied / b[1].sent - a[1].replied / a[1].sent)
    .slice(0, 4)
    .map(([category]) => category.toLowerCase());
}

/** Avança o card do lead no Kanban (nunca volta, nunca mexe em vendido/recusado). */
function moveLeadInKanban(phone, toColumnId) {
  try {
    const store = requireKanbanStore();
    const key = phoneKey(phone);
    const entity = Object.values(store.state?.entities || {}).find((e) => phoneKey(e?.profile?.phone) === key);
    if (!entity) return false;
    const columns = store.state?.board?.columns || [];
    const card = store.state.cards?.[entity.entityKey];
    const from = columns.find((col) => col.id === card?.columnId);
    const to = columns.find((col) => col.id === toColumnId);
    if (!card || !to || from?.terminal || (from && from.position >= to.position)) return false;
    store.moveCard({ entityKey: entity.entityKey, toColumnId, manual: false });
    scheduleKanbanQueueSync();
    return true;
  } catch (error) {
    console.warn("[KANBAN] mover lead:", error.message);
    return false;
  }
}

function setupAutopilot() {
  const MIN = 60 * 1000;
  const stages = [
    {
      id: "respostas",
      agent: "respostas",
      label: "Lendo conversas que esperam você",
      everyMs: 2 * MIN,
      run: async (ctx) => {
        const provider = getActiveWhatsAppProvider();
        if (!provider?.conversationFor) return { idle: true, status: "WhatsApp desconectado." };
        const drafts = autopilot.replyDrafts;
        const waiting = Object.entries(contactStatus?.getAll() || {})
          .filter(([, c]) => c?.status === "respondeu" && (c.lastReplyAt || 0) > (c.sentAt || 0))
          .filter(([key, c]) => (drafts[key]?.lastReplyAt || 0) < c.lastReplyAt)
          .slice(0, 5);
        if (!waiting.length) return { idle: true, status: "Nenhuma conversa esperando você." };
        if (!agentAi("respostas")) return { idle: true, status: "IA indisponível ou limite do dia do Agente de Respostas." };
        let done = 0;
        for (const [key, c] of waiting) {
          ctx.progress(done, waiting.length, `Lendo a conversa com ${c.name || key}`);
          const messages = provider.conversationFor(key, 16);
          if (!messages.length) continue;
          const lead = leadByPhone(key) || { name: c.name || "", phone: key };
          const r = await suggestReplyFor(messages, lead);
          // Interessado: proposta pronta ao lado das respostas e card avança no Kanban.
          const hot = r.momento === "interessado" || ["oferta", "contraproposta", "fechamento"].includes(r.etapa);
          let proposta = null;
          if (hot) {
            try {
              proposta = await proposalFor(key, messages);
            } catch (error) {
              ctx.log(`Proposta para ${c.name || key} não saiu: ${error.message}`, "error");
            }
            moveLeadInKanban(key, proposta ? "proposal" : "qualified");
          }
          autopilot.setReplyDraft(key, {
            etapa: r.etapa,
            time: r.time,
            proposta,
            name: c.name || lead.name || "",
            lastReplyAt: c.lastReplyAt,
            ultimaMensagem: String([...messages].reverse().find((m) => !m.fromMe)?.text || "").slice(0, 300),
            momento: r.momento,
            leitura: r.leitura,
            objecao: r.objecao,
            sugestoes: r.sugestoes,
            proximoPasso: r.proximoPasso,
            temperatura: r.temperatura,
          });
          done += 1;
          notifyUser({ title: `Resposta pronta: ${c.name || key}`, body: "O agente leu a conversa e preparou 3 respostas. Revise e envie você." });
        }
        return { count: done, text: done ? `${done} resposta(s) preparada(s) para você revisar e enviar.` : "", idle: !done };
      },
    },
    {
      id: "verificador",
      agent: "verificador",
      label: "Conferindo quem tem WhatsApp",
      everyMs: 10 * MIN,
      run: async (ctx) => {
        const provider = getActiveWhatsAppProvider();
        if (!provider || provider.getStatus?.() !== "connected" || typeof provider.checkWhatsAppNumbers !== "function") {
          return { idle: true, status: "WhatsApp desconectado." };
        }
        if (waCheckRunning) return { idle: true, status: "Checagem manual em andamento." };
        const waCheck = contactStatus?.getWaCheck() || {};
        const pending = [...new Set(allLeads()
          .map((lead) => lead?.phone || lead?.tel)
          .filter((phone) => phone && phoneKey(phone).length >= 10 && !waCheck[phoneKey(phone)] && !contactStatus?.get(phone)))]
          .slice(0, 40);
        if (!pending.length) return { idle: true, status: "Todos os números da base já foram conferidos." };
        ctx.progress(0, pending.length, `Conferindo ${pending.length} número(s) no WhatsApp`);
        waCheckRunning = true;
        try {
          const result = await provider.checkWhatsAppNumbers(pending);
          const changed = contactStatus.recordWaCheck(result);
          safeSend("wa-check-changed", { changed, done: pending.length, total: pending.length });
          const yes = Object.values(result).filter(Boolean).length;
          return { count: pending.length, text: `${pending.length} número(s) conferidos: ${yes} com WhatsApp, ${pending.length - yes} sem (ficam fora da fila).` };
        } finally {
          waCheckRunning = false;
        }
      },
    },
    {
      id: "enriquecedor",
      agent: "enriquecedor",
      label: "Achando o WhatsApp verdadeiro no site",
      everyMs: 15 * MIN,
      run: async (ctx) => {
        if (pendingHunts.size) return { idle: true, status: "Esperando a caçada no Maps terminar." };
        const waCheck = contactStatus?.getWaCheck() || {};
        // Prioridade: quem não tem WhatsApp no número do Maps (fixo) ou está sem telefone.
        const candidates = allLeads()
          .filter((lead) => lead?.id && lead.website && !isSocialUrl(lead.website) && !isAggregatorUrl(lead.website))
          .filter((lead) => !autopilot.intel[`site:${hostOf(lead.website)}`])
          .filter((lead) => !contactStatus?.get(lead.phone || ""))
          .map((lead) => {
            const wa = waCheck[phoneKey(lead.phone || "")];
            return { lead, rank: !lead.phone ? 0 : wa?.exists === false ? 1 : wa ? 3 : 2 };
          })
          .filter((c) => c.rank < 3)
          .sort((a, b) => a.rank - b.rank)
          .slice(0, 5);
        if (!candidates.length) return { idle: true, status: "Nenhum lead sem WhatsApp com site para investigar." };
        let browser = null;
        const patches = [];
        try {
          try { browser = await chromium.launch({ headless: true, channel: "chrome" }); } catch { browser = await chromium.launch({ headless: true }); }
          for (let i = 0; i < candidates.length; i += 1) {
            const { lead } = candidates[i];
            const host = hostOf(lead.website);
            ctx.progress(i, candidates.length, `Abrindo o site de ${lead.name || host}`);
            const audit = await auditSite(browser, lead.website);
            const found = (audit.wa || []).map((w) => (String(w).match(/(?:wa\.me\/|phone=)(\d{10,13})/) || [])[1]).find(Boolean) || "";
            const diagnosis = diagnose(audit);
            autopilot.setIntel(`site:${host}`, { wa: found, issues: diagnosis.issues, score: diagnosis.score });
            const patch = { webAudit: { at: Date.now(), score: diagnosis.score, issues: diagnosis.issues, loadMs: audit.loadMs, https: audit.https, mobile: audit.viewport, whatsapp: audit.whatsapp } };
            if (found && phoneKey(found) !== phoneKey(lead.phone || "")) {
              Object.assign(patch, { phone: `+55 ${phoneKey(found)}`, whatsapp: `+55 ${phoneKey(found)}`, phoneOriginal: lead.phone || "", phoneSource: "site" });
            }
            patches.push({ id: lead.id, patch });
          }
        } finally {
          await browser?.close().catch(() => {});
        }
        if (patches.length) safeSend("autopilot-patch-leads", { patches });
        const newWa = patches.filter((p) => p.patch.phoneSource === "site").length;
        return { count: patches.length, text: `${patches.length} site(s) investigados · ${newWa} WhatsApp novo(s) achado(s) no próprio site${newWa ? " (o número do Maps fica guardado)" : ""}.` };
      },
    },
    {
      id: "triagem",
      agent: "triagem",
      label: "Triando leads novos",
      everyMs: 5 * MIN,
      run: async (ctx) => {
        const pending = allLeads()
          .filter((lead) => lead?.phone || lead?.tel)
          .filter((lead) => !triageStore.has(triageKey(cleanLeadInput(lead))))
          .slice(0, 60);
        if (!pending.length) return { idle: true, status: "Todos os leads com telefone já estão triados." };
        ctx.progress(0, pending.length, `Triando ${pending.length} lead(s)`);
        const res = await runTriageAgent(pending, { auto: true });
        if (!res.success) throw new Error(res.error || "Triagem falhou");
        return { count: res.triaged, text: `${res.triaged} lead(s) triados · ${res.hot} de alto potencial.` };
      },
    },
    {
      id: "pesquisador",
      agent: "pesquisador",
      label: "Pesquisando dono e empresa dos melhores leads",
      everyMs: 10 * MIN,
      run: async (ctx) => {
        const waCheck = contactStatus?.getWaCheck() || {};
        const triage = triageStore.getAll();
        const candidates = allLeads()
          .filter((lead) => isAvailableLead(lead, waCheck))
          .map((lead) => ({ lead, t: triage[triageKey(cleanLeadInput(lead))] }))
          .filter(({ lead, t }) => t && (t.level === "alto" || (t.score || 0) >= 60) && !autopilot.intel[phoneKey(lead.phone || lead.tel)])
          .sort((a, b) => (b.t.score || 0) - (a.t.score || 0))
          .slice(0, Math.max(1, autopilot.settings.researchPerRun || 3));
        if (!candidates.length) return { idle: true, status: "Nenhum lead quente sem pesquisa." };
        let done = 0;
        for (const { lead } of candidates) {
          const clean = cleanLeadInput(lead);
          ctx.progress(done, candidates.length, `Pesquisando ${clean.name}`);
          const runAi = agentAi("pesquisador");
          const intel = await researchLead(clean, currentAiSettings(), { runAi, insights: currentInsights() });
          autopilot.setIntel(phoneKey(clean.phone), {
            decisor: intel.decisor || null,
            saudacao: intel.saudacao || "",
            abordagem: intel.abordagem || "",
            chance: intel.chance ?? null,
            proximosPassos: intel.proximosPassos || [],
            company: intel.company || null,
          });
          agentStore.log("pesquisador", `Pesquisou ${clean.name}${intel.decisor?.nome ? ` · decisor: ${intel.decisor.nome}` : ""}.`, !intel.aiError);
          done += 1;
        }
        return { count: done, text: `${done} lead(s) pesquisados (dono, CNPJ e melhor abordagem).` };
      },
    },
    {
      id: "copywriter",
      agent: "copywriter",
      label: "Escrevendo mensagens para a fila",
      everyMs: 10 * MIN,
      run: async (ctx) => {
        const drafts = sendQueue.items.filter((i) => i.status === "rascunho").length;
        const target = autopilot.settings.draftTarget || 20;
        if (drafts >= target) return { idle: true, status: `${drafts} mensagens esperando sua aprovação (meta ${target}).` };
        const waCheck = contactStatus?.getWaCheck() || {};
        const triage = triageStore.getAll();
        const candidates = allLeads()
          .filter((lead) => isAvailableLead(lead, waCheck))
          .map((lead) => ({ lead, t: triage[triageKey(cleanLeadInput(lead))] }))
          .filter(({ t }) => t)
          .sort((a, b) => (b.t.score || 0) - (a.t.score || 0))
          .map(({ lead }) => withIntel(lead));
        if (!candidates.length) return { idle: true, status: "Sem leads triados disponíveis: o Caçador vai buscar mais." };
        const want = Math.min(target - drafts, 10);
        ctx.progress(0, want, `Escrevendo ${want} mensagem(ns)`);
        const res = await prepareQueueDrafts(candidates, { limit: want });
        return { count: res.added || 0, text: res.added ? `${res.added} mensagem(ns) na fila esperando sua aprovação.` : "", idle: !res.added };
      },
    },
    {
      id: "cacador",
      agent: "cacador",
      label: "Caçando leads novos no Google Maps",
      everyMs: 15 * MIN,
      run: async () => {
        if (pendingHunts.size) return { idle: true, status: "Caçada em andamento…" };
        const waCheck = contactStatus?.getWaCheck() || {};
        const available = allLeads().filter((lead) => isAvailableLead(lead, waCheck)).length;
        const reserve = autopilot.settings.reserveLeads || 40;
        if (available >= reserve) return { idle: true, status: `Estoque bom: ${available} leads disponíveis (mínimo ${reserve}).` };
        const mission = autopilot.nextMission("cacador");
        if (!mission) return { idle: true, status: "Cadastre uma missão (nicho + cidade) para o Caçador." };
        if (!mainWindow || mainWindow.isDestroyed()) return { idle: true, status: "Janela do app fechada." };
        const goal = startHunt(mission);
        return { working: true, status: `Caçando ${mission.niche} em ${mission.city} (meta ${goal} novos)…`, text: `Estoque baixo (${available}). Saiu para caçar ${mission.niche} em ${mission.city}.` };
      },
    },
    {
      id: "radar",
      agent: "radar",
      label: "Procurando na web negócios com site fraco",
      everyMs: 30 * MIN,
      run: async (ctx) => {
        if (pendingHunts.size) return { idle: true, status: "Esperando a caçada no Maps terminar." };
        const mission = autopilot.nextMission("radar");
        if (!mission) return { idle: true, status: "Cadastre uma missão (nicho + cidade)." };
        if (!mainWindow || mainWindow.isDestroyed()) return { idle: true, status: "Janela do app fechada." };
        const base = allLeads();
        const knownHosts = new Set(base.map((l) => hostOf(l?.website || l?.site)).filter(Boolean));
        const knownPhones = new Set(base.map((l) => phoneKey(l?.phone || l?.tel)).filter((k) => k.length >= 10));
        ctx.progress(0, 1, `Buscando ${mission.niche} em ${mission.city} na web`);
        const result = await runRadar(mission, {
          search: (q) => webSearch(q, { limit: 10 }),
          launchBrowser: async () => {
            try { return await chromium.launch({ headless: true, channel: "chrome" }); } catch { return chromium.launch({ headless: true }); }
          },
          knownHosts,
          knownPhones,
          phoneKey,
          maxSites: 8,
          onProgress: (i, n, task) => ctx.progress(i, n, task),
        });
        if (result.leads.length) safeSend("autopilot-add-leads", { id: `radar_${Date.now()}`, leads: result.leads, mission });
        const weakNoPhone = result.checked.filter((c) => c.score >= 30 && !c.phone).length;
        return {
          count: result.leads.length,
          text: `Radar: ${result.checked.length} site(s) de ${mission.niche} em ${mission.city} auditados · ${result.leads.length} fraco(s) com telefone foram para a base${weakNoPhone ? ` · ${weakNoPhone} fraco(s) sem telefone ignorados` : ""}.`,
          idle: !result.checked.length,
          status: result.checked.length ? undefined : "A busca não trouxe sites novos desta missão.",
        };
      },
    },
    {
      id: "analista",
      agent: "analista",
      label: "Estudando resultados e atualizando o playbook",
      everyMs: 6 * 60 * MIN,
      run: async () => {
        const res = await runAnalystAgent({ auto: true });
        if (res.skipped) return { idle: true, status: "Aguardando 25 envios novos para reestudar." };
        if (!res.success) throw new Error(res.error || "Analista falhou");
        return { count: 1, text: "Playbook atualizado com os resultados mais recentes." };
      },
    },
  ];
  autopilot = new Autopilot(app.getPath("userData"), {
    stages,
    onEvent: (event) => safeSend("autopilot-event", event),
  });
  // Nichos que o Analista viu responder mais entram no plano com prioridade.
  autopilot.favoriteNiches = () => [...new Set([...bestNiches(), ...(agentStore?.getPlaybook()?.nichos || [])])].slice(0, 6);
  autopilot.start();
}

ipcMain.handle("autopilot-state", async () => ({ success: true, ...(autopilot?.snapshot() || {}) }));

ipcMain.handle("whatsapp-xray", async () => ({
  success: true,
  ...whatsappXray({ items: sendQueue?.items || [], contacts: contactStatus?.getAll() || {} }),
}));

// ─── J.A.R.V.I.S.: ordens em português → ações dos agentes ───
/** Retrato compacto dos dados reais para o Jarvis responder sem inventar. */
function jarvisData() {
  const contacts = Object.values(contactStatus?.getAll() || {});
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const t0 = start.getTime();
  const count = (fn) => contacts.filter(fn).length;
  const queueCounts = {};
  for (const i of sendQueue?.items || []) queueCounts[i.status] = (queueCounts[i.status] || 0) + 1;
  const waCheck = contactStatus?.getWaCheck() || {};
  const leads = allLeads();
  return {
    agora: new Date().toLocaleString("pt-BR"),
    base: { leads: leads.length, disponiveis: leads.filter((l) => isAvailableLead(l, waCheck)).length },
    hoje: {
      enviados: count((c) => (c.sentAt || 0) >= t0),
      responderam: count((c) => c.status === "respondeu" && (c.lastReplyAt || 0) >= t0),
    },
    total: { contatados: contacts.length, responderam: count((c) => c.status === "respondeu"), sairam: count((c) => c.status === "descadastrado") },
    esperando_voce: contacts.filter((c) => c.status === "respondeu" && (c.lastReplyAt || 0) > (c.sentAt || 0)).map((c) => c.name).filter(Boolean).slice(0, 8),
    fila: queueCounts,
    numeros: senderNumbers().map((n) => ({ numero: n.phone, online: n.connected, enviados_hoje: n.sentToday, teto: n.cap })),
    piloto_ligado: !!autopilot?.settings?.enabled,
    nichos_que_respondem: bestNiches(),
    ultimas_atividades: (autopilot?.feed || []).slice(-8).map((f) => `${f.agent}: ${f.text}`),
  };
}

/** Aprova os N rascunhos de maior potencial, sem link. */
function approveBest(quantity = 20) {
  const triage = triageStore?.getAll() || {};
  const ids = (sendQueue?.items || [])
    .filter((i) => i.status === "rascunho" && !/https?:\/\/|www\./i.test(i.message || ""))
    .map((i) => ({ id: i.id, score: triage[triageKey(cleanLeadInput(i.lead || {}))]?.score ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(200, Number(quantity) || 20)))
    .map((x) => x.id);
  const approved = ids.length ? sendQueue.approveAll(ids) : 0;
  setImmediate(() => queueTick().catch(() => {}));
  return approved;
}

ipcMain.handle("jarvis-command", async (_, { text } = {}) => {
  const order = limitString(text, 500, "").trim();
  if (!order) return { success: false, error: "Diga o que fazer." };
  try {
    const dados = jarvisData();
    const plan = await understand(order, { runAi: agentAi("jarvis"), dados });
    const p = plan.parametros || {};
    let reply = plan.resposta;
    let navigate = "";
    if (plan.acao === "cacar" || plan.acao === "radar") {
      const niche = limitString(p.nicho, 80, "").trim();
      const city = limitString(p.cidade, 80, "").trim();
      if (!niche || !city) return { success: true, reply: "Preciso do nicho e da cidade, senhor. Ex.: caçar barbearia em Taguatinga, DF." };
      if (plan.acao === "cacar") {
        if (pendingHunts.size) {
          autopilot.pinMission("cacador", { niche, city });
          return { success: true, reply: "Já há uma caçada no Maps em andamento. Coloquei esta como a próxima, senhor." };
        }
        startHunt({ niche, city });
        reply ||= `Caçando ${niche} em ${city}. Aviso quando terminar.`;
      } else {
        autopilot.pinMission("radar", { niche, city });
        autopilot.runNow("radar").catch(() => {});
        reply ||= `Radar ligado: auditando sites de ${niche} em ${city}.`;
      }
      autopilot.log("jarvis", `Ordem: ${order}`, "info");
    } else if (plan.acao === "aprovar") {
      const approved = approveBest(p.quantidade);
      reply = `${approved} mensagem(ns) de maior potencial aprovada(s). Saindo no ritmo seguro, senhor.`;
      autopilot.log("jarvis", reply, "ok");
    } else if (plan.acao === "responder") {
      autopilot.runNow("respostas").catch(() => {});
      reply ||= "Lendo as conversas e preparando as respostas.";
    } else if (plan.acao === "piloto") {
      autopilot.updateSettings({ enabled: p.ligar !== false });
      reply ||= p.ligar !== false ? "Piloto automático ligado. Os agentes estão em campo." : "Piloto automático pausado.";
    } else if (plan.acao === "abrir") {
      navigate = SCREENS[p.tela] ? p.tela : "";
      reply ||= navigate ? `Abrindo ${SCREENS[navigate]}.` : "Não achei essa tela.";
    } else {
      // Pergunta: sem IA, responde com o essencial dos dados.
      reply ||= `Hoje: ${dados.hoje.enviados} envio(s) e ${dados.hoje.responderam} resposta(s). ${dados.esperando_voce.length} esperando você. Fila: ${dados.fila.rascunho || 0} para aprovar, ${dados.fila.aprovado || 0} aprovadas. ${dados.base.disponiveis} leads disponíveis.`;
    }
    return { success: true, acao: plan.acao, reply, navigate, ai: plan.ai };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("autopilot-settings", async (_, { patch } = {}) => {
  try {
    return { success: true, settings: autopilot.updateSettings(patch || {}), ...autopilot.snapshot() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("autopilot-run", async (_, { stageId } = {}) => {
  try {
    const result = await autopilot.runNow(String(stageId || ""));
    return { success: !result?.error, error: result?.error, ...autopilot.snapshot() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("autopilot-dismiss-reply", async (_, { phone } = {}) => {
  autopilot?.dismissReplyDraft(phoneKey(phone));
  return { success: true };
});

ipcMain.handle("autopilot-intel", async (_, { phone } = {}) => ({ success: true, intel: autopilot?.intel?.[phoneKey(phone)] || null }));

ipcMain.on("autopilot-hunt-done", (_, { id, added, error } = {}) => {
  const resolve = pendingHunts.get(String(id || ""));
  if (resolve) resolve({ added: Number(added) || 0, error: error ? String(error).slice(0, 200) : "" });
});

ipcMain.handle("agents-state", async () => {
  return { success: true, ...agentStore.snapshot(), aiConfigured: hasAiConfigured(currentAiSettings()), insights: currentInsights() };
});

ipcMain.handle("agents-update", async (_, { id, patch } = {}) => {
  try {
    const settings = agentStore.update(String(id || ""), patch || {});
    return { success: true, settings, ...agentStore.snapshot() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("agents-run", async (_, { id, leads, force } = {}) => {
  if (id === "triagem") return runTriageAgent(leads, { auto: false, force: force === true });
  if (id === "analista") return runAnalystAgent({ auto: false });
  return { success: false, error: "Este agente roda pelo botão na própria tela." };
});

ipcMain.handle("triage-get-all", async () => {
  return { success: true, triage: triageStore?.getAll() || {} };
});

ipcMain.handle("ai-research-lead", async (_, { lead } = {}) => {
  try {
    const clean = cleanLeadInput(lead);
    if (!isHttpUrl(clean.website)) clean.website = "";
    if (!clean.name) return { success: false, error: "Lead sem nome para pesquisar." };
    const settings = currentAiSettings();
    const runAi = agentAi("pesquisador");
    const intel = await researchLead(clean, settings, { runAi, insights: currentInsights() });
    agentStore.log("pesquisador", `Pesquisou ${clean.name}${intel.decisor ? ` · decisor: ${intel.decisor.nome}` : ""}${runAi ? "" : " (sem IA)"}.`, !intel.aiError);
    return { success: true, intel, aiConfigured: !!runAi };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("ai-gift", async (_, { lead } = {}) => {
  try {
    const clean = cleanLeadInput(lead);
    if (!clean.name) return { success: false, error: "Lead sem nome." };
    const settings = currentAiSettings();
    const runAi = agentAi("triagem");
    // A triagem só manda para a IA leads com telefone; o presente é sob demanda.
    const { results, aiError } = await triageLeads([{ ...clean, phone: clean.phone || "0000000000" }], {
      settings,
      runAi,
      playbook: agentStore.playbookText(),
      aiBudget: runAi ? 1 : 0,
    });
    const result = { ...results[0], key: triageKey(clean), hasPhone: !!clean.phone };
    triageStore.putMany([result]);
    agentStore.log("triagem", `Presente de valor para ${clean.name}${result.aiApplied ? "" : " (por regras)"}.`, !aiError);
    return { success: true, triage: result, aiError };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("ai-insights", async () => {
  return { success: true, insights: currentInsights() };
});

ipcMain.handle("ai-optimize-message", async (_, { template, followUp } = {}) => {
  try {
    const runAi = agentAi("copywriter");
    if (!runAi) {
      return { success: false, error: "Configure a IA em Inteligência Artificial e confira o limite do Agente Copywriter." };
    }
    const result = await optimizeCampaignMessage({
      template: limitString(template, 2000, ""),
      followUp: limitString(followUp, 1000, ""),
      insights: currentInsights(),
      commercial: commercialForAgents(),
    }, runAi);
    agentStore.log("copywriter", "Mensagem de campanha reescrita com base nos resultados.");
    return { success: true, ...result };
  } catch (error) {
    agentStore.log("copywriter", `Falhou: ${error.message}`, false);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("ai-suggest-reply", async (_, { messages, lead, etapa } = {}) => {
  try {
    return { success: true, ...(await suggestReplyFor(messages, lead, limitString(etapa, 30, ""))) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

/** Agente de Respostas: lê a conversa e devolve 3 respostas + o momento do lead. */
async function suggestReplyFor(messages, lead, etapa = "") {
  {
    const runAi = agentAi("respostas");
    if (!runAi) throw new Error("Configure a IA e confira o limite do Agente de Respostas.");
    const list = (Array.isArray(messages) ? messages : []).slice(-16).map((m) => ({
      fromMe: !!m?.fromMe,
      text: limitString(String(m?.text || ""), 600, ""),
    }));
    const clean = cleanLeadInput(lead);
    const triage = triageStore?.getAll()?.[triageKey(clean)] || null;
    const result = await suggestReplies({
      messages: list,
      lead: (() => {
        const kit = leadSalesKit(clean.phone);
        return {
          ...clean,
          triagem: triage ? { segmentos: triage.segmentLabels, problemas: triage.findings } : null,
          diagnostico_pronto: triage?.presente?.mensagem || "",
          oferta_atual: kit?.offerLabel,
          roteiro_objecoes: kit?.objections?.slice(0, 6),
          memoria: (() => {
            const history = sendQueue?.historyFor(clean.phone) || [];
            const mem = leadMemory?.get(clean.phone);
            return {
              ofertas_feitas: [...new Set(history.map((i) => OFFERS[i.offer]?.label).filter(Boolean))],
              mensagens_enviadas: history.filter((i) => i.status === "enviado").slice(-3).map((i) => i.message),
              objecoes_anteriores: mem?.objecoes || [],
              momento_anterior: mem?.momento || "",
            };
          })(),
        };
      })(),
      commercial: commercialForAgents(),
      etapa,
    }, runAi);
    agentStore.log("respostas", `Sugestões para ${clean.name || "conversa"} (lead ${result.momento.replace(/_/g, " ")}).`);
    const memory = leadMemory?.recordReading(clean.phone, { momento: result.momento, leitura: result.leitura, objecao: result.objecao });
    return { ...result, temperatura: temperatureOf(contactStatus?.get(clean.phone), memory) };
  }
}

ipcMain.handle("lead-scoring-test-connection", async (_, { ai } = {}) => {
  try {
    const result = await leadScoringService.testConnection(ai && typeof ai === "object" ? ai : {});
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("lead-scoring-get-all", async (_, { filters } = {}) => {
  try {
    return { success: true, ...leadScoringService.getAll(filters || {}) };
  } catch (err) {
    return { success: false, error: err.message, leads: [], stats: {} };
  }
});

ipcMain.handle("lead-scoring-get-lead", async (_, { id }) => {
  return { success: true, lead: leadScoringService.getLead(limitString(id, 140, "")) };
});

ipcMain.handle("lead-scoring-analyze-lead", async (_, { lead, options } = {}) => {
  try {
    if (!lead || typeof lead !== "object") throw new Error("Lead invalido");
    const result = await leadScoringService.analyzeLead(lead, options || {});
    return { success: true, lead: result };
  } catch (err) {
    if (err?.code === "NO_WEBSITE") return { success: false, skipped: true, error: err.message };
    return { success: false, error: err.message };
  }
});

ipcMain.handle("lead-scoring-analyze-batch", async (_, { leads, options } = {}) => {
  try {
    const input = Array.isArray(leads) ? leads.slice(0, 1000) : [];
    if (!input.length) throw new Error("Nenhum lead para analisar");
    const result = await leadScoringService.analyzeBatch(input, options || {});
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("lead-scoring-cancel", async (_, { jobId } = {}) => {
  return { success: true, cancelled: leadScoringService.cancel(limitString(jobId, 120, "")) };
});

ipcMain.handle("lead-scoring-clear", async (_, { ids, all } = {}) => {
  try {
    const safeIds = Array.isArray(ids)
      ? ids.map((id) => limitString(id, 140, "")).filter(Boolean).slice(0, 2000)
      : [];
    const result = leadScoringService.clearAnalyses({ ids: safeIds, all: !!all });
    return { success: true, ...result, stats: leadScoringService.getAll({}).stats };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("lead-scoring-list-groups", async () => {
  try {
    return { success: true, groups: leadScoringService.listGroups() };
  } catch (err) {
    return { success: false, error: err.message, groups: [] };
  }
});

ipcMain.handle("lead-scoring-sync-groups", async (_, { groups } = {}) => {
  try {
    const safeGroups = (Array.isArray(groups) ? groups : []).slice(0, 500).map((group) => ({
      id: limitString(group?.id, 80, ""),
      name: limitString(group?.name, 80, ""),
      description: limitString(group?.description, 240, ""),
      color: limitString(group?.color, 20, ""),
      leadIds: Array.isArray(group?.leadIds)
        ? group.leadIds.map((id) => limitString(id, 140, "")).filter(Boolean).slice(0, 5000)
        : [],
      segment: group?.segment && typeof group.segment === "object" ? group.segment : null,
      createdAt: Number(group?.createdAt) || Date.now(),
      updatedAt: Number(group?.updatedAt) || Date.now(),
    })).filter((group) => group.id && group.name);
    return { success: true, groups: leadScoringService.syncGroups(safeGroups) };
  } catch (err) {
    return { success: false, error: err.message, groups: [] };
  }
});

ipcMain.handle("lead-scoring-create-group", async (_, { name, description, color, leadIds, segment } = {}) => {
  try {
    const group = leadScoringService.createGroup({
      name: limitString(name, 80, ""),
      description: limitString(description, 240, ""),
      color: limitString(color, 20, ""),
      leadIds: Array.isArray(leadIds) ? leadIds.map((id) => limitString(id, 140, "")).filter(Boolean).slice(0, 5000) : [],
      segment: segment && typeof segment === "object" ? segment : null,
    });
    return { success: true, group };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("lead-scoring-update-group", async (_, { id, patch } = {}) => {
  try {
    const safePatch = patch && typeof patch === "object" ? { ...patch } : {};
    if (safePatch.name != null) safePatch.name = limitString(safePatch.name, 80, "");
    if (safePatch.description != null) safePatch.description = limitString(safePatch.description, 240, "");
    if (safePatch.color != null) safePatch.color = limitString(safePatch.color, 20, "");
    if (Array.isArray(safePatch.leadIds)) {
      safePatch.leadIds = safePatch.leadIds.map((x) => limitString(x, 140, "")).filter(Boolean).slice(0, 5000);
    }
    const group = leadScoringService.updateGroup(limitString(id, 80, ""), safePatch);
    return { success: true, group };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("lead-scoring-delete-group", async (_, { id, removeLeads } = {}) => {
  try {
    const result = leadScoringService.deleteGroup(limitString(id, 80, ""), { removeLeads: !!removeLeads });
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("lead-scoring-add-to-group", async (_, { groupId, leadIds } = {}) => {
  try {
    const group = leadScoringService.addLeadsToGroup(
      limitString(groupId, 80, ""),
      Array.isArray(leadIds) ? leadIds.map((id) => limitString(id, 140, "")).filter(Boolean).slice(0, 5000) : [],
    );
    return { success: true, group };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("lead-scoring-remove-from-group", async (_, { groupId, leadIds } = {}) => {
  try {
    const group = leadScoringService.removeLeadsFromGroup(
      limitString(groupId, 80, ""),
      Array.isArray(leadIds) ? leadIds.map((id) => limitString(id, 140, "")).filter(Boolean).slice(0, 5000) : [],
    );
    return { success: true, group };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("lead-scoring-create-group-from-filters", async (_, { name, filters, description, color } = {}) => {
  try {
    const group = leadScoringService.createGroupFromFilters(
      limitString(name, 80, "Grupo de análises"),
      filters && typeof filters === "object" ? filters : {},
      {
        description: limitString(description, 240, ""),
        color: limitString(color, 20, ""),
      },
    );
    return { success: true, group };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("lead-scoring-update-outcome", async (_, { id, outcome } = {}) => {
  try {
    const lead = leadScoringService.updateOutcome(limitString(id, 140, ""), sanitizeOutcome(outcome));
    return { success: true, lead };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("lead-scoring-export", async (_, { filters, format } = {}) => {
  try {
    const { leads } = leadScoringService.getAll(filters || {});
    if (!leads.length) return { success: false, message: "Nenhum lead para exportar" };
    const timestamp = Date.now();
    const fmt = format === "json" ? "json" : "csv";
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: "Exportar Lead Scoring",
      defaultPath: `sigma_lead_scoring_${timestamp}.${fmt}`,
    });
    if (canceled || !filePath) return { success: false, message: "Exportacao cancelada" };
    if (fmt === "json") fs.writeFileSync(filePath, JSON.stringify(leads, null, 2), "utf-8");
    else saveProspectingCSV(leads, filePath);
    return { success: true, savedTo: filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("lead-scoring-open-screenshot", async (_, { filePath } = {}) => {
  try {
    const resolved = path.resolve(String(filePath || ""));
    const root = path.join(app.getPath("userData"), "lead-scoring", "screenshots");
    if (!resolved.startsWith(path.resolve(root)) || !fs.existsSync(resolved)) {
      throw new Error("Screenshot nao encontrado");
    }
    await shell.openPath(resolved);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("lead-scoring-create-campaign", async (_, { ids, name, connectionId } = {}) => {
  try {
    const selected = (Array.isArray(ids) ? ids : [])
      .map((id) => leadScoringService.getLead(String(id)))
      .filter(Boolean)
      .filter((lead) => lead.company?.phone || lead.company?.whatsapp);
    if (!selected.length) throw new Error("Nenhum lead com telefone para campanha");
    const leadIds = selected.map((lead) => ({
      leadId: lead.id,
      name: lead.company.name,
      phone: lead.company.whatsapp || lead.company.phone,
      company: lead.company.name,
      category: lead.company.category || "",
      website: lead.company.website || "",
      instagram: lead.company.instagram || "",
      email: lead.company.email || "",
      address: lead.company.address || "",
      rating: lead.company.rating || "",
      totalReviews: lead.company.totalReviews || "",
      score: lead.score?.value || "",
      prioridade: lead.score?.classification || "",
      dor_principal: lead.aiAnalysis?.principais_dores?.[0] || "",
      oportunidade_principal: lead.aiAnalysis?.principais_oportunidades?.[0] || "",
      argumento_principal: lead.aiAnalysis?.argumento_principal_venda || "",
      mensagem_whatsapp_ia: lead.aiAnalysis?.mensagem_whatsapp || "",
      ticket_estimado: lead.aiAnalysis?.ticket_estimado || "",
      chance_resposta: lead.aiAnalysis?.chance_resposta || "",
    }));
    const template = {
      text: "{{mensagem_whatsapp_ia}}",
      variables: [
        "empresa",
        "score",
        "prioridade",
        "dor_principal",
        "oportunidade_principal",
        "mensagem_whatsapp_ia",
      ],
    };
    const campaign = campaignManager.create(sanitizeCampaignData({
      name: limitString(name, 160, "Lead Scoring - Alta prioridade"),
      provider: "baileys",
      connectionId: connectionId ? assertConnectionId(connectionId) : activeWhatsAppId,
      template,
      leadIds,
      schedule: { mode: "interval", intervalMs: 30000 },
    }));
    return { success: true, campaign };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

function sanitizeOutcome(outcome) {
  const input = outcome && typeof outcome === "object" ? outcome : {};
  const status = limitString(input.status, 40, "not_contacted");
  const closedValueRaw = input.closedValue ?? input.dealValue ?? input.value ?? 0;
  const closedValue = Number(closedValueRaw);
  return {
    status,
    channel: limitString(input.channel, 40, ""),
    responded: input.responded != null
      ? !!input.responded
      : ["responded", "meeting", "proposal", "closed", "qualified"].includes(status),
    meetingBooked: input.meetingBooked != null ? !!input.meetingBooked : status === "meeting",
    proposalSent: input.proposalSent != null
      ? !!input.proposalSent
      : status === "proposal" || status === "closed",
    closed: input.closed != null ? !!input.closed : status === "closed",
    closedValue: Number.isFinite(closedValue) ? closedValue : 0,
    serviceSold: limitString(input.serviceSold, 120, ""),
    lostReason: limitString(input.lostReason, 240, ""),
    notes: limitString(input.notes, 2000, ""),
    lastContactAt: Number(input.lastContactAt || 0) || null,
    nextFollowUpAt: Number(input.nextFollowUpAt || 0) || null,
  };
}

// ─── CAMPAIGN MANAGEMENT ───────────────────
ipcMain.handle("campaign-create", async (_, data) => {
  try {
    if (!campaignManager) throw new Error("Gerenciador de campanhas ainda não iniciou");
    const sanitized = sanitizeCampaignData(data);
    const activeProvider = activeWhatsAppId
      ? whatsappProviders.get(activeWhatsAppId)
      : null;
    const activeProviderReady = !!activeProvider && (
      activeProvider?.getStatus?.() === "connected" || activeProvider?.isReady?.()
    );

    // Se a UI não mandou connectionId, usa o ativo / primeiro conectado.
    // Não associe uma sessão desconectada: ela faria o rascunho parecer pronto
    // para disparar e esconderia a instrução de conectar o WhatsApp.
    if (!sanitized.connectionId) {
      const connectedId =
        (activeProviderReady && activeWhatsAppId) ||
        [...whatsappProviders.entries()].find(
          ([, p]) => p?.getStatus?.() === "connected" || p?.isReady?.(),
        )?.[0] ||
        null;
      if (connectedId) {
        sanitized.connectionId = connectedId;
        if (!sanitized.connectionIds?.length) {
          sanitized.connectionIds = [connectedId];
        }
      }
    }
    // Uma campanha pode nascer como rascunho. Isso permite organizar lista,
    // mensagem e agenda mesmo quando o WhatsApp ainda está desconectado.
    // O bloqueio correto acontece apenas ao iniciar os disparos.
    // Se o id pedido não está no mapa, tenta somente o ativo que esteja pronto.
    if (!whatsappProviders.has(sanitized.connectionId) && activeProviderReady && activeWhatsAppId) {
      console.warn(
        `[CAMPAIGN] connectionId ${sanitized.connectionId} não está no mapa; usando ${activeWhatsAppId}`,
      );
      sanitized.connectionId = activeWhatsAppId;
      if (!sanitized.connectionIds?.includes(activeWhatsAppId)) {
        sanitized.connectionIds = [activeWhatsAppId, ...(sanitized.connectionIds || [])];
      }
    }
    if (sanitized.connectionId && (!Array.isArray(sanitized.connectionIds) || !sanitized.connectionIds.length)) {
      sanitized.connectionIds = [sanitized.connectionId];
    }
    const campaign = campaignManager.create(sanitized);
    return { success: true, campaign, savedAsDraft: !campaign.connectionId };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("campaign-update", async (_, { id, updates }) => {
  try {
    const campaign = campaignManager.update(id, sanitizeCampaignUpdates(updates));
    try { kanbanStore?.syncCampaigns(campaignsForKanban(), { replace: true, existingOnly: true }); } catch {}
    safeSend("campaign-progress", { campaignId: id, event: "updated", data: { campaign } });
    updateTray();
    return { success: true, campaign };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("campaign-delete", async (_, { id }) => {
  try {
    campaignManager.delete(id);
    refreshBackgroundHolds();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("campaign-start", async (_, { id, connectionId, confirmRecovery = false, forceNow = false } = {}) => {
  try {
    if (!campaignManager) throw new Error("Campaign manager não inicializado");
    // Garante mapa de providers atualizado
    campaignManager.setProvidersMap(whatsappProviders);

    const campaign = campaignManager.get(id);
    if (!campaign) throw new Error("Campanha não encontrada");

    // Preferência: connectionId do pedido (UI) > da campanha > ativo
    const preferred =
      (connectionId && whatsappProviders.has(connectionId) && connectionId) ||
      (campaign.connectionId && whatsappProviders.has(campaign.connectionId) && campaign.connectionId) ||
      activeWhatsAppId ||
      null;

    // Se a campanha não tem connectionId ou o salvo não está no mapa, grava um válido antes do start
    if (
      !campaign.connectionId ||
      !whatsappProviders.has(campaign.connectionId)
    ) {
      const fallbackId =
        preferred ||
        [...whatsappProviders.entries()].find(
          ([, p]) => p?.getStatus?.() === "connected" || p?.isReady?.(),
        )?.[0] ||
        null;
      if (fallbackId) {
        campaignManager.update(id, { connectionId: fallbackId });
        console.log(`[CAMPAIGN] connectionId preenchido no start: ${fallbackId}`);
      }
    }

    const result = campaignManager.start(id, {
      activeConnectionId: preferred,
      confirmRecovery: confirmRecovery === true,
      forceNow: forceNow === true,
    });
    if (result?.connectionId) {
      activeWhatsAppId = result.connectionId;
    }
    refreshBackgroundHolds();
    return { success: true, connectionId: result?.connectionId || campaign.connectionId };
  } catch (err) {
    console.error("[CAMPAIGN] start falhou:", err.message);
    const online = listWhatsAppConnections()
      .map((c) => `${c.phoneNumber || c.id}:${c.status}`)
      .join(", ");
    return {
      success: false,
      error: err.message + (online ? ` | online agora: ${online || "nenhum"}` : ""),
    };
  }
});

ipcMain.handle("campaign-pause", async (_, { id }) => {
  try {
    campaignManager.pause(id);
    try { kanbanStore?.syncCampaigns(campaignsForKanban(), { replace: true, existingOnly: true }); } catch {}
    refreshBackgroundHolds();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("campaign-recovery-list", async () => {
  try {
    if (!campaignManager) return { success: true, missed: [] };
    return { success: true, missed: campaignManager.getMissedSchedules() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("campaign-recovery-resolve", async (_, { id, choice, connectionId } = {}) => {
  try {
    if (!campaignManager) throw new Error("Campaign manager não inicializado");
    campaignManager.setProvidersMap(whatsappProviders);
    const preferred =
      (connectionId && whatsappProviders.has(connectionId) && connectionId) ||
      activeWhatsAppId ||
      null;
    const result = campaignManager.resolveMissedSchedule(id, choice, {
      activeConnectionId: preferred,
      confirmRecovery: true,
    });
    if (result?.connectionId) activeWhatsAppId = result.connectionId;
    try { kanbanStore?.syncCampaigns(campaignsForKanban(), { replace: true, existingOnly: true }); } catch {}
    updateTray();
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("campaign-resume", async (_, { id, connectionId, forceNow = false } = {}) => {
  try {
    if (!campaignManager) throw new Error("Campaign manager não inicializado");
    campaignManager.setProvidersMap(whatsappProviders);
    const preferred =
      (connectionId && whatsappProviders.has(connectionId) && connectionId) ||
      activeWhatsAppId ||
      null;
    const result = campaignManager.resume(id, { activeConnectionId: preferred, forceNow: forceNow === true });
    if (result?.connectionId) activeWhatsAppId = result.connectionId;
    refreshBackgroundHolds();
    return { success: true, connectionId: result?.connectionId || null };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("campaign-retry-failed", async (_, { id, connectionId } = {}) => {
  try {
    if (!campaignManager) throw new Error("Campaign manager não inicializado");
    campaignManager.setProvidersMap(whatsappProviders);
    const preferred =
      (connectionId && whatsappProviders.has(connectionId) && connectionId) ||
      activeWhatsAppId ||
      null;
    const count = campaignManager.retryFailed(id, { activeConnectionId: preferred });
    return { success: true, count };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("campaign-get-all", async () => {
  return { campaigns: campaignManager.getAll() };
});

ipcMain.handle("campaign-get", async (_, { id }) => {
  const campaign = campaignManager.get(id);
  return { campaign: campaign || null };
});

ipcMain.handle("campaign-export", async (_, { id, format }) => {
  try {
    const campaign = campaignManager.get(id);
    if (!campaign) return { success: false, message: "Campaign not found" };

    const timestamp = Date.now();
    const safeName = campaign.name
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_]/g, "");

    if (format === "json") {
      const { filePath, canceled } = await dialog.showSaveDialog({
        title: "Export Campaign JSON",
        defaultPath: `campaign_${safeName}_${timestamp}.json`,
      });
      if (canceled || !filePath)
        return { success: false, message: "Save cancelled." };
      fs.writeFileSync(filePath, JSON.stringify(campaign, null, 2));
      return { success: true, savedTo: filePath };
    }

    if (format === "csv") {
      const rows = campaign.leads.map((l) => ({
        name: l.name,
        phone: l.phone,
        company: l.company,
        category: l.category,
        status: l.status,
        errorMessage: l.errorMessage || "",
      }));
      const { filePath, canceled } = await dialog.showSaveDialog({
        title: "Export Campaign CSV",
        defaultPath: `campaign_${safeName}_${timestamp}.csv`,
      });
      if (canceled || !filePath)
        return { success: false, message: "Save cancelled." };
      saveToCSV(rows, filePath);
      return { success: true, savedTo: filePath };
    }

    return { success: false, message: "Invalid format." };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── TEMPLATE PREVIEW ──────────────────────
ipcMain.handle("template-preview", async (_, { template, leadId }) => {
  try {
    const lead = campaignManager
      ?.getAll()
      ?.flatMap((c) => c.leads)
      ?.find((l) => l.leadId === leadId);
    const preview = lead ? interpolateTemplate(template, lead) : template;
    return { preview };
  } catch (err) {
    return { preview: template };
  }
});

// ─── PHONE NORMALIZE ───────────────────────
ipcMain.handle("phone-normalize", async (_, { phone, countryCode }) => {
  return normalizePhone(phone, countryCode);
});
