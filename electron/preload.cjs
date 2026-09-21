/**
 * The only bridge between the activation screen and the main process.
 *
 * Context isolation stays on and Node stays out of the renderer; six named
 * functions cross, and nothing else. The renderer cannot read the license
 * file or the verifier, and cannot choose where checkout goes — it can only
 * ask.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("license", {
  getMachineId: () => ipcRenderer.invoke("get-machine-id"),
  validate: (token) => ipcRenderer.invoke("validate-license", token),
  activate: (token) => ipcRenderer.invoke("activate-license", token),
  status: () => ipcRenderer.invoke("get-gate-status"),
  purchase: () => ipcRenderer.invoke("open-purchase"),
  checkPurchase: () => ipcRenderer.invoke("check-purchase"),
});
