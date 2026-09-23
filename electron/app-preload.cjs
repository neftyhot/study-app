/**
 * The bridge between the app window and the main process.
 *
 * Context isolation stays on and Node stays out of the renderer. Three
 * functions cross for "Sign in with Google", none of which returns a token,
 * two for buying a license during the trial, which can only open the
 * checkout page and ask whether the purchase has arrived, and one that
 * installs the latest release.
 *
 * Channel names and shapes are defined in src/main/auth/ipc.ts; a sandboxed
 * preload cannot load TypeScript, so the names are repeated here.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("studyApp", {
  googleAuth: {
    status: () => ipcRenderer.invoke("google-auth:status"),
    signIn: () => ipcRenderer.invoke("google-auth:sign-in"),
    signOut: () => ipcRenderer.invoke("google-auth:sign-out"),
  },
  license: {
    purchase: () => ipcRenderer.invoke("license:purchase"),
    checkPurchase: () => ipcRenderer.invoke("license:check-purchase"),
  },
  // Installs GitHub's latest release in place and restarts; see updater.cjs.
  update: {
    install: () => ipcRenderer.invoke("update:install"),
  },
});
