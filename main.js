const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');

// Set application details for taskbar integration
app.setName('PocketLint');
if (process.platform === 'linux') {
  app.setDesktopName('pocketlint');
}

// Utilities and Services
const pactlParser = require('./src/utils/pactlParser');
const shell = require('./src/utils/shell');
const StorageService = require('./src/services/storage');
const AudioSystemService = require('./src/services/audioSystemService');
const AudioProcessor = require('./src/services/audioProcessor');
const PocketUploader = require('./src/services/uploader');

// Initialize Services
const userDataPath = app.getPath('userData');
const storage = new StorageService(userDataPath);
storage.load();

const audioSystem = new AudioSystemService(shell, pactlParser);
const audioProcessor = new AudioProcessor(shell);

// In-memory Electron process/window state
let recordingStartTime = 0;
let currentRecordingId = null;
let mainWindow = null;

// Setup Uploader with callbacks for IPC window notifications
const uploader = new PocketUploader(storage, sendQueueUpdate);

function sendQueueUpdate() {
  if (mainWindow) {
    mainWindow.webContents.send('queue-updated', storage.queue);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 750,
    icon: path.join(__dirname, 'src', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    backgroundColor: '#0d0e12',
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  // Clean up virtual devices when app exits
  await audioSystem.teardownLoopback();
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handler Registrations

// 1. Sinks list
ipcMain.handle('list-sinks', async () => {
  try {
    return await audioSystem.listSinks();
  } catch (e) {
    console.error('Failed to list sinks', e);
    return [];
  }
});

// 1b. Sources (Microphones) list
ipcMain.handle('list-sources', async () => {
  try {
    return await audioSystem.listSources();
  } catch (e) {
    console.error('Failed to list sources', e);
    return [];
  }
});

// 2. Status check
ipcMain.handle('get-status', async () => {
  const { isSplitEnabled } = await audioSystem.findLoadedModules();
  return {
    isSplitEnabled,
    isRecording: audioSystem.isRecording(),
    recordingStartTime: audioSystem.isRecording() ? recordingStartTime : 0,
    currentRecordingId
  };
});

// 3. Setup Loopback Y-split
ipcMain.handle('setup-loopback', async (event, sinkName, sourceName) => {
  try {
    await audioSystem.setupLoopback(sinkName, sourceName);
    storage.config.targetSinkName = sinkName;
    storage.config.targetSourceName = sourceName;
    storage.saveConfig();
    return { success: true };
  } catch (e) {
    console.error('Failed to setup loopback:', e);
    await audioSystem.teardownLoopback(); // rollback on failure
    return { success: false, error: e.message };
  }
});

// 4. Teardown Loopback
ipcMain.handle('teardown-loopback', async () => {
  try {
    await audioSystem.teardownLoopback();
    return { success: true };
  } catch (e) {
    console.error('Failed to teardown loopback:', e);
    return { success: false, error: e.message };
  }
});

// 5. Play test sound
ipcMain.handle('play-test-sound', async () => {
  try {
    const tempWav = path.join(os.tmpdir(), 'pocketlint_test_beep.wav');
    await audioSystem.playTestTone(tempWav);
    return { success: true };
  } catch (e) {
    console.error('Failed to play test sound:', e);
    return { success: false, error: e.message };
  }
});

// 5b. Play recording
ipcMain.handle('play-recording', async (event, id) => {
  try {
    const item = storage.queue.find(x => x.id === id);
    if (!item) throw new Error('Recording not found');

    if (!fs.existsSync(item.filePath)) {
      throw new Error('Recording file not found');
    }

    const target = storage.config.targetSinkName || 'auto';
    await audioSystem.playRecording(item.filePath, target, () => {
      if (mainWindow) {
        mainWindow.webContents.send('playback-ended', id);
      }
    });

    return { success: true };
  } catch (e) {
    console.error('Failed to play recording:', e);
    return { success: false, error: e.message };
  }
});

// 5c. Stop playback
ipcMain.handle('stop-playback', async () => {
  await audioSystem.stopPlayback();
  return { success: true };
});

// 6. Start recording
ipcMain.handle('start-recording', async (event, title, speakerName) => {
  try {
    const { isSplitEnabled } = await audioSystem.findLoadedModules();
    if (!isSplitEnabled) {
      throw new Error('Logical Y-Split is not enabled. Please enable it before recording.');
    }

    if (audioSystem.isRecording()) {
      throw new Error('Recording is already in progress.');
    }

    const id = Date.now().toString();
    const fileName = `recording_${id}.mp3`;
    const filePath = path.join(storage.recordingsDir, fileName);
    const tempWavPath = filePath + '.tmp.wav';

    recordingStartTime = Date.now();
    currentRecordingId = id;

    await audioSystem.startRecording(tempWavPath);

    const item = {
      id,
      title: title || `Recording ${new Date().toLocaleString()}`,
      fileName,
      filePath,
      recordingAt: new Date().toISOString(),
      duration: 0,
      status: 'RECORDED',
      error: null,
      pocketId: null,
      speakerName: speakerName || 'Local Speaker',
      tempWavPath
    };

    storage.queue.unshift(item); // Add to the top
    storage.saveQueue();
    sendQueueUpdate();

    return { success: true, item };
  } catch (e) {
    console.error('Failed to start recording:', e);
    return { success: false, error: e.message };
  }
});

// 7. Stop recording
ipcMain.handle('stop-recording', async () => {
  try {
    if (!audioSystem.isRecording()) {
      return { success: false, error: 'No active recording to stop.' };
    }

    const duration = Math.round((Date.now() - recordingStartTime) / 1000);
    const item = storage.queue.find(x => x.id === currentRecordingId);
    if (item) {
      item.duration = duration;
      storage.saveQueue();
    }

    await audioSystem.stopRecording();

    if (item) {
      item.status = 'PROCESSING';
      storage.saveQueue();
      sendQueueUpdate();

      // Normalize and tag recording in the background, then trigger upload
      audioProcessor.normalizeAndTagRecording(item.tempWavPath, item.filePath, item.speakerName)
        .catch((err) => {
          console.error('[AudioNormalizer] Error during normalization:', err);
          item.status = 'FAILED';
          item.error = err.message;
          storage.saveQueue();
        })
        .finally(() => {
          sendQueueUpdate();
          if (item.status === 'FAILED') {
            return;
          }
          if (storage.config.apiKey) {
            uploader.uploadRecording(item.id).catch((err) => {
              console.error('Background upload failure:', err);
            });
          } else {
            item.status = 'RECORDED';
            storage.saveQueue();
            sendQueueUpdate();
          }
        });
    } else {
      sendQueueUpdate();
    }

    return { success: true, item };
  } catch (e) {
    console.error('Failed to stop recording:', e);
    return { success: false, error: e.message };
  }
});

// 8. Queue control
ipcMain.handle('get-queue', () => {
  return storage.queue;
});

// 9. Delete recording
ipcMain.handle('delete-recording', async (event, id) => {
  try {
    const index = storage.queue.findIndex(x => x.id === id);
    if (index !== -1) {
      const item = storage.queue[index];
      // Delete file
      if (fs.existsSync(item.filePath)) {
        fs.unlinkSync(item.filePath);
      }
      storage.queue.splice(index, 1);
      storage.saveQueue();
      sendQueueUpdate();
    }
    return { success: true };
  } catch (e) {
    console.error('Failed to delete recording:', e);
    return { success: false, error: e.message };
  }
});

// 10. Retry upload
ipcMain.handle('retry-upload', async (event, id) => {
  try {
    await uploader.uploadRecording(id);
    return { success: true };
  } catch (e) {
    console.error('Manual retry upload failed:', e);
    return { success: false, error: e.message };
  }
});

// 11. Config accessors
ipcMain.handle('get-config', () => {
  return storage.config;
});

ipcMain.handle('save-api-key', async (event, key) => {
  const trimmedKey = key.trim();
  try {
    const testUrl = 'https://public.heypocketai.com/api/v1/public/recordings';
    const response = await fetch(testUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${trimmedKey}`
      }
    });

    if (!response.ok) {
      let errMsg = `API key verification failed (HTTP ${response.status})`;
      try {
        const errJson = await response.json();
        if (errJson.error) errMsg = errJson.error;
      } catch (e) {}
      return { success: false, error: errMsg };
    }

    const resJson = await response.json();
    if (resJson.success === false) {
      return { success: false, error: resJson.error || 'Invalid API key' };
    }

    storage.config.apiKey = trimmedKey;
    storage.saveConfig();
    return { success: true };
  } catch (err) {
    console.error('API key verification error:', err);
    return { success: false, error: `Verification request failed: ${err.message}` };
  }
});

let isShuttingDown = false;

async function gracefulShutdown(reason = 'Signal') {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`[PocketLint] Graceful shutdown initiated (${reason})...`);

  // 1. Close out any open recordings
  if (audioSystem.isRecording()) {
    console.log('[PocketLint] Stopping active recording process...');
    const duration = Math.round((Date.now() - recordingStartTime) / 1000);
    const item = storage.queue.find(x => x.id === currentRecordingId);
    if (item) {
      item.duration = duration;
      item.status = 'FAILED';
      item.error = 'Recording interrupted by application shutdown';
      storage.saveQueue();
    }

    try {
      await audioSystem.stopRecording();
      console.log('[PocketLint] Recording process stopped.');
    } catch (e) {
      console.error('[PocketLint] Error stopping recording process:', e);
    }
  }

  // 2. Kill playback if active
  if (audioSystem.isPlaying()) {
    console.log('[PocketLint] Stopping active playback process...');
    try {
      await audioSystem.stopPlayback();
    } catch (e) {
      console.error('[PocketLint] Error stopping playback process:', e);
    }
  }

  // 3. Destroy the Y-split virtual loopback
  console.log('[PocketLint] Tearing down Y-split loopbacks...');
  try {
    await audioSystem.teardownLoopback();
    console.log('[PocketLint] Loopbacks torn down.');
  } catch (e) {
    console.error('[PocketLint] Error during loopback teardown:', e);
  }

  console.log('[PocketLint] Graceful shutdown complete. Exiting.');
  process.exit(0);
}

// Register signal handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Hook into Electron's before-quit event
app.on('before-quit', (event) => {
  if (!isShuttingDown) {
    event.preventDefault();
    gracefulShutdown('before-quit');
  }
});

