// Electron shell for Air Riders Stat Tracker.
//
// The app itself is the same single-file build the browser version uses
// (dist-single/index.html); Electron just gives it its own window, icon and
// installer. There is no server and no Node access from the page: the window
// is sandboxed and only the File System Access API (for the auto-save file)
// and clipboard writes are allowed.

const { app, BrowserWindow, Menu, session, shell } = require("electron");
const path = require("node:path");

const APP_NAME = "Air Riders Stat Tracker";
const INDEX = path.join(__dirname, "..", "dist-single", "index.html");

app.setName(APP_NAME);

// One window at a time: two copies would fight over the same saved data.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/** @type {BrowserWindow | null} */
let mainWindow = null;

function isExternal(url) {
  return /^https?:\/\//i.test(url);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: "#070b18",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow && mainWindow.show());
  mainWindow.loadFile(INDEX);

  // Links to websites open in the normal browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternal(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file://")) return; // in-app hash routes
    event.preventDefault();
    if (isExternal(url)) shell.openExternal(url);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => {
  // Allow only what the app uses: the save-file picker (File System Access)
  // and copying summaries to the clipboard. Everything else is refused.
  const allowed = new Set(["fileSystem", "clipboard-sanitized-write"]);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  if (process.platform !== "darwin") Menu.setApplicationMenu(null);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
