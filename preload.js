const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pocketlintAPI', {
  listSinks: () => ipcRenderer.invoke('list-sinks'),
  listSources: () => ipcRenderer.invoke('list-sources'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  setupLoopback: (sinkName, sourceName) => ipcRenderer.invoke('setup-loopback', sinkName, sourceName),
  teardownLoopback: () => ipcRenderer.invoke('teardown-loopback'),
  playTestSound: () => ipcRenderer.invoke('play-test-sound'),
  playRecording: (id) => ipcRenderer.invoke('play-recording', id),
  stopPlayback: () => ipcRenderer.invoke('stop-playback'),
  startRecording: (title, speakerName) => ipcRenderer.invoke('start-recording', title, speakerName),
  stopRecording: () => ipcRenderer.invoke('stop-recording'),
  getQueue: () => ipcRenderer.invoke('get-queue'),
  deleteRecording: (id) => ipcRenderer.invoke('delete-recording', id),
  retryUpload: (id) => ipcRenderer.invoke('retry-upload', id),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveApiKey: (key) => ipcRenderer.invoke('save-api-key', key),
  
  onQueueUpdated: (callback) => {
    ipcRenderer.on('queue-updated', (event, data) => callback(data));
  },
  onPlaybackEnded: (callback) => {
    ipcRenderer.on('playback-ended', (event, id) => callback(id));
  }
});
