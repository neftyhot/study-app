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
  importKey: (token) => ipcRenderer.invoke("import", token),
  setStatus: (id, status) => ipcRenderer.invoke("set-status", id, status),
  remove: (id) => ipcRenderer.invoke("delete", id),
  syncRevocations: () => ipcRenderer.invoke("sync-revocations"),
  copy: (text) => ipcRenderer.invoke("copy", text),
  reveal: () => ipcRenderer.invoke("reveal"),
  chooseFolder: () => ipcRenderer.invoke("choose-folder"),
  insights: {
    config: () => ipcRenderer.invoke("insights:config"),
    setConfig: (config) => ipcRenderer.invoke("insights:set-config", config),
    stats: () => ipcRenderer.invoke("insights:stats"),
    feedback: () => ipcRenderer.invoke("insights:feedback"),
    deleteFeedback: (key) => ipcRenderer.invoke("insights:delete-feedback", key),
    exportFeedback: () => ipcRenderer.invoke("insights:export-feedback"),
  },
});
