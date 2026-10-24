import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/types'
import type {
  ShellerApi, SessionConnectRequest, ProfileDraft, ConnectionProfile,
  ProfileActionResult, SessionStatusEvent, SessionDataEvent,
  TunnelsUpdatedEvent, FileTransferProgressEvent, ZmodemEvent, RemoteFile
} from '../shared/types'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_e: Electron.IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: ShellerApi = {
  profiles: {
    list: () => ipcRenderer.invoke(IPC.profilesList),
    save: (id, draft) => ipcRenderer.invoke(IPC.profilesSave, id, draft),
    remove: (id) => ipcRenderer.invoke(IPC.profilesRemove, id),
    duplicate: (id) => ipcRenderer.invoke(IPC.profilesDuplicate, id),
    pickPrivateKey: () => ipcRenderer.invoke(IPC.profilesPickKey),
    export: () => ipcRenderer.invoke(IPC.profilesExport),
    import: () => ipcRenderer.invoke(IPC.profilesImport)
  },
  sessions: {
    connect: (req: SessionConnectRequest) => ipcRenderer.invoke(IPC.sessionConnect, req),
    disconnect: (id) => ipcRenderer.invoke(IPC.sessionDisconnect, id),
    detach: (sessionId, profileId) => ipcRenderer.invoke(IPC.sessionDetach, sessionId, profileId),
    write: (id, data) => ipcRenderer.send(IPC.sessionWrite, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(IPC.sessionResize, id, cols, rows),
    startTunnel: (sid, tid) => ipcRenderer.invoke(IPC.sessionStartTunnel, sid, tid),
    stopTunnel: (sid, tid) => ipcRenderer.invoke(IPC.sessionStopTunnel, sid, tid),
    providePassword: (sid, pwd) => { ipcRenderer.send(IPC.sessionRequestPassword, sid, pwd); return Promise.resolve() },
    provideHostKey: (sid, accept) => { ipcRenderer.send(IPC.sessionRequestHostKey, sid, accept); return Promise.resolve() },    
    attach: (sessionId, profileId) => ipcRenderer.send(IPC.sessionAttach, sessionId, profileId),
  },
  events: {
    onData: (fn) => subscribe<SessionDataEvent>(IPC.eventData, fn),
    onStatus: (fn) => subscribe<SessionStatusEvent>(IPC.eventStatus, fn),
    onTunnels: (fn) => subscribe<TunnelsUpdatedEvent>(IPC.eventTunnels, fn),
    onTransfer: (fn) => subscribe<FileTransferProgressEvent>(IPC.eventTransfer, fn),
    onZmodem: (fn) => subscribe<ZmodemEvent>(IPC.eventZmodem, fn),
    onHostKeyVerify: (fn) => subscribe<{ sessionId: string; hostKey: string }>(IPC.eventHostKeyVerify, fn),
    onRequestPassword: (fn) => subscribe<{ sessionId: string }>(IPC.eventRequestPassword, fn),
    onAttach: (fn) => subscribe<{ sessionId: string; profileId: string }>(IPC.eventAttach, fn),
  },
  files: {
    pickUpload: (type) => ipcRenderer.invoke(IPC.sessionPickUpload, type),
    pickDownload: () => ipcRenderer.invoke(IPC.sessionPickDownload),
    listRemote: (sid, path) => ipcRenderer.invoke(IPC.sessionListRemote, sid, path),
    deleteRemote: (sid, path) => ipcRenderer.invoke(IPC.sessionDeleteRemote, sid, path),
    mkdirRemote: (sid, path) => ipcRenderer.invoke(IPC.sessionMkdirRemote, sid, path),
    renameRemote: (sid, oldPath, newPath) => ipcRenderer.invoke(IPC.sessionRenameRemote, sid, oldPath, newPath),
    getPathForFile: (file) => webUtils.getPathForFile(file),
    upload: (sid, lp, rp, tid) => ipcRenderer.invoke(IPC.sessionUpload, sid, lp, rp, tid),
    download: (sid, rp, lp, tid) => ipcRenderer.invoke(IPC.sessionDownload, sid, rp, lp, tid),
    cancel: (tid) => ipcRenderer.invoke(IPC.sessionCancelTransfer, tid)
  },
  clipboard: {
    readText: () => ipcRenderer.sendSync(IPC.clipboardRead),
    writeText: (text) => ipcRenderer.send(IPC.clipboardWrite, text)
  }
}

contextBridge.exposeInMainWorld('sheller', api)