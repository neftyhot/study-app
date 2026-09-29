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
  pullPurchases: () => ipcRenderer.invoke("pull-purchases"),
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
    status: () => ipcRenderer.invoke("insights:status"),
    setStatus: (status) => ipcRenderer.invoke("insights:set-status", status),
  },
  scaling: {
    list: () => ipcRenderer.invoke("scaling:list"),
    metrics: () => ipcRenderer.invoke("scaling:metrics"),
    setSite: (site) => ipcRenderer.invoke("scaling:set-site", site),
    check: (ids) => ipcRenderer.invoke("scaling:check", ids),
    mark: (id, done) => ipcRenderer.invoke("scaling:mark", id, done),
  },
  devstats: () => ipcRenderer.invoke("devstats:get"),
});
