/**
 * The bridge between the app window and the main process.
 *
 * Context isolation stays on and Node stays out of the renderer. Three
 * functions cross for "Sign in with Google", none of which returns a token,
 * two for buying a license during the trial, which can only open the
 * checkout page and ask whether the purchase has arrived, one that
 * installs the latest release, and one that captures this window for the tutor.
 *
 * The Lectures tab adds its own: downloading a Whisper model, choosing
 * recordings, and transcribing them. It names files by path and gets back
 * progress. The one time audio passes through here is a lecture recorded in
 * the app, whose sound goes to the main process a few seconds at a time to be
 * written to disk. See lectures.cjs.
 *
 * Channel names and shapes are defined in src/main/auth/ipc.ts; a sandboxed
 * preload cannot load TypeScript, so the names are repeated here.
 */
const { contextBridge, ipcRenderer, webUtils } = require("electron");

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
  // A picture of this window for the tutor; returns a data URL or null.
  tutor: {
    captureScreen: () => ipcRenderer.invoke("tutor:capture-screen"),
  },
  // Lecture transcription, which runs in the main process; see lectures.cjs.
  lectures: {
    state: () => ipcRenderer.invoke("lectures:state"),
    downloadModel: (modelId) => ipcRenderer.invoke("lectures:download-model", modelId),
    cancelDownload: (modelId) => ipcRenderer.invoke("lectures:cancel-download", modelId),
    deleteModel: (modelId) => ipcRenderer.invoke("lectures:delete-model", modelId),
    pickFiles: () => ipcRenderer.invoke("lectures:pick-files"),
    // Where a file dropped on the window lives; "" if it is not on disk.
    pathForFile: (file) => webUtils.getPathForFile(file),
    transcribe: (request) => ipcRenderer.invoke("lectures:transcribe", request),
    transcribeLecture: (request) => ipcRenderer.invoke("lectures:transcribe-lecture", request),
    startRecording: (request) => ipcRenderer.invoke("lectures:record-start", request),
    appendRecording: (request) => ipcRenderer.invoke("lectures:record-chunk", request),
    updateRecording: (request) => ipcRenderer.invoke("lectures:record-update", request),
    finishRecording: (request) => ipcRenderer.invoke("lectures:record-finish", request),
    dismissNotice: () => ipcRenderer.invoke("lectures:dismiss-notice"),
    micAccess: () => ipcRenderer.invoke("lectures:mic-access"),
    openMicSettings: () => ipcRenderer.invoke("lectures:open-mic-settings"),
    cancelJob: (jobId) => ipcRenderer.invoke("lectures:cancel-job", jobId),
    dismissJob: (jobId) => ipcRenderer.invoke("lectures:dismiss-job", jobId),
    onChange: (listener) => {
      const forward = (_event, snapshot) => listener(snapshot);
      ipcRenderer.on("lectures:changed", forward);
      return () => ipcRenderer.removeListener("lectures:changed", forward);
    },
  },
});
