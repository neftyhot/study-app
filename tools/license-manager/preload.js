/**
 * The bridge for the License Authority window.
 *
 * The renderer never touches the signing key, the ledger, or the filesystem —
 * it asks the main process, which is the only place that can sign anything.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("authority", {
  state: () => ipcRenderer.invoke("state"),
  mint: (options) => ipcRenderer.invoke("mint", options),
  setStatus: (id, status) => ipcRenderer.invoke("set-status", id, status),
  remove: (id) => ipcRenderer.invoke("delete", id),
  copy: (text) => ipcRenderer.invoke("copy", text),
  reveal: () => ipcRenderer.invoke("reveal"),
  chooseFolder: () => ipcRenderer.invoke("choose-folder"),
});
