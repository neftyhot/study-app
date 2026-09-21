/**
 * The bridge between the app window and the main process.
 *
 * Context isolation stays on and Node stays out of the renderer. Three
 * functions cross, for "Sign in with Google", and none of them returns a
 * token: the window learns only whether someone is signed in, and as whom.
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
});
