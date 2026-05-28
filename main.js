const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const util = require('util');
const os = require('os');

const execPromise = util.promisify(exec);

// Path configuration
const userDataPath = app.getPath('userData');
const recordingsDir = path.join(userDataPath, 'recordings');
const configFilePath = path.join(userDataPath, 'config.json');
const queueFilePath = path.join(userDataPath, 'queue.json');

// Ensure directories exist
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
}

// In-memory state
let config = { apiKey: '', targetSinkName: '' };
let queue = [];
let recordProcess = null;
let recordingStartTime = 0;
let currentRecordingId = null;
let mainWindow = null;

// Load configuration
if (fs.existsSync(configFilePath)) {
  try {
    config = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'));
  } catch (e) {
    console.error('Failed to load config, resetting', e);
  }
}

// Load queue
if (fs.existsSync(queueFilePath)) {
  try {
    queue = JSON.parse(fs.readFileSync(queueFilePath, 'utf-8'));
  } catch (e) {
    console.error('Failed to load queue, resetting', e);
  }
}

function saveConfig() {
  fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2), 'utf-8');
}

function saveQueue() {
  fs.writeFileSync(queueFilePath, JSON.stringify(queue, null, 2), 'utf-8');
}

function sendQueueUpdate() {
  if (mainWindow) {
    mainWindow.webContents.send('queue-updated', queue);
  }
}

// Helper to look up active virtual routing devices
function findLoadedModules() {
  return new Promise((resolve) => {
    exec('pactl list modules short', (err, stdout) => {
      if (err) return resolve({ isSplitEnabled: false });
      let hasLoopbackSink = false;
      let hasRecordMixSink = false;
      const lines = stdout.split('\n');
      for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length >= 3) {
          const name = parts[1].trim();
          const args = parts[2].trim();
          if (name === 'module-null-sink' && args.includes('sink_name=PocketLoopback')) {
            hasLoopbackSink = true;
          }
          if (name === 'module-null-sink' && args.includes('sink_name=PocketRecordMix')) {
            hasRecordMixSink = true;
          }
        }
      }
      resolve({ isSplitEnabled: hasLoopbackSink && hasRecordMixSink });
    });
  });
}

// Clean up all virtual loopback and null sink modules
async function teardownLoopbackInternal() {
  try {
    const { stdout } = await execPromise('pactl list modules short');
    const lines = stdout.split('\n');
    const idsToUnload = [];
    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length >= 3) {
        const id = parts[0].trim();
        const name = parts[1].trim();
        const args = parts[2].trim();
        
        if (name === 'module-null-sink' && (args.includes('sink_name=PocketLoopback') || args.includes('sink_name=PocketRecordMix'))) {
          idsToUnload.push(id);
        }
        if (name === 'module-loopback' && (args.includes('source=PocketLoopback.monitor') || args.includes('sink=PocketRecordMix') || args.includes('sink=PocketLoopback'))) {
          idsToUnload.push(id);
        }
      }
    }
    
    // Unload in reverse order
    for (const id of idsToUnload.reverse()) {
      await execPromise(`pactl unload-module ${id}`);
    }
  } catch (e) {
    console.error('Error during internal teardown:', e);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 750,
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
  await teardownLoopbackInternal();
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handler Registrations

// 1. Sinks list
ipcMain.handle('list-sinks', async () => {
  try {
    const { stdout } = await execPromise('pactl list sinks');
    const blocks = stdout.split(/Sink #\d+/);
    const sinks = [];
    for (const block of blocks) {
      const nameMatch = block.match(/Name:\s+(.+)/);
      const descMatch = block.match(/Description:\s+(.+)/);
      if (nameMatch && descMatch) {
        const name = nameMatch[1].trim();
        const description = descMatch[1].trim();
        // Skip our own virtual sinks from the available outputs list
        if (name !== 'PocketLoopback' && name !== 'PocketRecordMix') {
          sinks.push({ name, description });
        }
      }
    }
    return sinks;
  } catch (e) {
    console.error('Failed to list sinks', e);
    return [];
  }
});

// 1b. Sources (Microphones) list
ipcMain.handle('list-sources', async () => {
  try {
    const { stdout } = await execPromise('pactl list sources');
    const blocks = stdout.split(/Source #\d+/);
    const sources = [];
    for (const block of blocks) {
      const nameMatch = block.match(/Name:\s+(.+)/);
      const descMatch = block.match(/Description:\s+(.+)/);
      if (nameMatch && descMatch) {
        const name = nameMatch[1].trim();
        const description = descMatch[1].trim();
        // Skip monitors of virtual sinks, and virtual sinks themselves
        if (!name.includes('.monitor') && name !== 'PocketLoopback' && name !== 'PocketRecordMix') {
          sources.push({ name, description });
        }
      }
    }
    return sources;
  } catch (e) {
    console.error('Failed to list sources', e);
    return [];
  }
});

// 2. Status check
ipcMain.handle('get-status', async () => {
  const { isSplitEnabled } = await findLoadedModules();
  return {
    isSplitEnabled,
    isRecording: !!recordProcess,
    recordingStartTime: recordProcess ? recordingStartTime : 0,
    currentRecordingId
  };
});

// 3. Setup Loopback Y-split
ipcMain.handle('setup-loopback', async (event, sinkName, sourceName) => {
  try {
    // Teardown existing first
    await teardownLoopbackInternal();

    // 1. Create virtual null sink for system audio (PocketLoopback)
    await execPromise('pactl load-module module-null-sink sink_name=PocketLoopback sink_properties=device.description="PocketLoopback"');

    // 2. Route PocketLoopback monitor back to physical output speakers so user can hear system audio
    await execPromise(`pactl load-module module-loopback source=PocketLoopback.monitor sink="${sinkName}"`);

    // 3. Create virtual null sink for recording mixer (PocketRecordMix)
    await execPromise('pactl load-module module-null-sink sink_name=PocketRecordMix sink_properties=device.description="PocketRecordMix"');

    // 4. Route system audio from PocketLoopback monitor to PocketRecordMix
    await execPromise('pactl load-module module-loopback source=PocketLoopback.monitor sink=PocketRecordMix');

    // 5. Route physical microphone source to PocketRecordMix (without looping back to physical speakers)
    await execPromise(`pactl load-module module-loopback source="${sourceName}" sink=PocketRecordMix`);

    config.targetSinkName = sinkName;
    config.targetSourceName = sourceName;
    saveConfig();

    return { success: true };
  } catch (e) {
    console.error('Failed to setup loopback:', e);
    await teardownLoopbackInternal(); // rollback on failure
    return { success: false, error: e.message };
  }
});

// 4. Teardown Loopback
ipcMain.handle('teardown-loopback', async () => {
  try {
    await teardownLoopbackInternal();
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
    // Generate 1-second sine wave tone
    await execPromise(`ffmpeg -y -f lavfi -i "sine=frequency=800:duration=1" "${tempWav}"`);
    // Play to the PocketLoopback sink
    await execPromise(`pw-play --target=PocketLoopback "${tempWav}"`);
    return { success: true };
  } catch (e) {
    console.error('Failed to play test sound:', e);
    return { success: false, error: e.message };
  }
});

let playbackProcess = null;

// 5b. Play recording
ipcMain.handle('play-recording', async (event, id) => {
  try {
    if (playbackProcess) {
      playbackProcess.kill();
      playbackProcess = null;
    }

    const item = queue.find(x => x.id === id);
    if (!item) throw new Error('Recording not found');

    if (!fs.existsSync(item.filePath)) {
      throw new Error('Recording file not found');
    }

    // Play recording to target physical device if loopback is on, or default output
    const target = config.targetSinkName || 'auto';
    playbackProcess = spawn('pw-play', [`--target=${target}`, item.filePath]);

    playbackProcess.on('exit', () => {
      playbackProcess = null;
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
  if (playbackProcess) {
    playbackProcess.kill();
    playbackProcess = null;
  }
  return { success: true };
});

// 6. Start recording
ipcMain.handle('start-recording', async (event, title) => {
  try {
    const { isSplitEnabled } = await findLoadedModules();
    if (!isSplitEnabled) {
      throw new Error('Logical Y-Split is not enabled. Please enable it before recording.');
    }

    if (recordProcess) {
      throw new Error('Recording is already in progress.');
    }

    const id = Date.now().toString();
    const fileName = `recording_${id}.wav`;
    const filePath = path.join(recordingsDir, fileName);

    recordingStartTime = Date.now();
    currentRecordingId = id;

    // Start pw-record targetting our virtual monitor
    recordProcess = spawn('pw-record', ['--target=PocketRecordMix', filePath]);

    const item = {
      id,
      title: title || `Recording ${new Date().toLocaleString()}`,
      fileName,
      filePath,
      recordingAt: new Date().toISOString(),
      duration: 0,
      status: 'RECORDED',
      error: null,
      pocketId: null
    };

    queue.unshift(item); // Add to the top
    saveQueue();
    sendQueueUpdate();

    recordProcess.on('exit', (code) => {
      recordProcess = null;
    });

    return { success: true, item };
  } catch (e) {
    console.error('Failed to start recording:', e);
    return { success: false, error: e.message };
  }
});

// 7. Stop recording
ipcMain.handle('stop-recording', async () => {
  return new Promise((resolve) => {
    if (!recordProcess) {
      return resolve({ success: false, error: 'No active recording to stop.' });
    }

    const duration = Math.round((Date.now() - recordingStartTime) / 1000);
    const item = queue.find(x => x.id === currentRecordingId);
    if (item) {
      item.duration = duration;
      saveQueue();
    }

    // Stop cleanly using SIGINT so the WAV header is written
    recordProcess.kill('SIGINT');

    const checkInterval = setInterval(() => {
      if (!recordProcess) {
        clearInterval(checkInterval);
        sendQueueUpdate();

        // Proactively start background upload if API key is set
        if (item && config.apiKey) {
          uploadRecording(item.id).catch((err) => {
            console.error('Background upload failure:', err);
          });
        }

        resolve({ success: true, item });
      }
    }, 50);
  });
});

// 8. Queue control
ipcMain.handle('get-queue', () => {
  return queue;
});

// 9. Delete recording
ipcMain.handle('delete-recording', async (event, id) => {
  try {
    const index = queue.findIndex(x => x.id === id);
    if (index !== -1) {
      const item = queue[index];
      // Delete file
      if (fs.existsSync(item.filePath)) {
        fs.unlinkSync(item.filePath);
      }
      queue.splice(index, 1);
      saveQueue();
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
    await uploadRecording(id);
    return { success: true };
  } catch (e) {
    console.error('Manual retry upload failed:', e);
    return { success: false, error: e.message };
  }
});

// 11. Config accessors
ipcMain.handle('get-config', () => {
  return config;
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

    config.apiKey = trimmedKey;
    saveConfig();
    return { success: true };
  } catch (err) {
    console.error('API key verification error:', err);
    return { success: false, error: `Verification request failed: ${err.message}` };
  }
});

// Actual Upload implementation (shared by auto-upload & manual retry)
async function uploadRecording(id) {
  const item = queue.find(x => x.id === id);
  if (!item) throw new Error('Recording not found in queue');

  item.status = 'UPLOADING';
  item.error = null;
  saveQueue();
  sendQueueUpdate();

  try {
    if (!config.apiKey) {
      throw new Error('Pocket API Key is not set');
    }

    if (!fs.existsSync(item.filePath)) {
      throw new Error(`Local recording file was not found at ${item.filePath}`);
    }

    // Step 1: Get presigned S3 url from Pocket API
    const uploadUrlEndpoint = 'https://public.heypocketai.com/api/v1/public/recordings/upload-url';
    const response = await fetch(uploadUrlEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content_type: 'audio/wav',
        duration: item.duration,
        file_name: item.fileName,
        recording_at: item.recordingAt,
        title: item.title
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      let errMsg = `Pocket API returned status ${response.status}`;
      try {
        const errJson = JSON.parse(errText);
        if (errJson.error) errMsg = errJson.error;
      } catch (e) {}
      throw new Error(errMsg);
    }

    const resData = await response.json();
    if (!resData.success || !resData.data) {
      throw new Error(resData.error || 'Pocket API request failed');
    }

    const uploadUrl = resData.data.upload_url || resData.data.url;
    const pocketRecordingId = resData.data.id || resData.data.recording_id;

    if (!uploadUrl) {
      throw new Error('Response did not contain a valid upload URL');
    }

    // Step 2: Read binary audio content
    const audioData = fs.readFileSync(item.filePath);

    // Step 3: PUT raw audio binary to the pre-signed S3 URL
    const s3Response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'audio/wav'
      },
      body: audioData
    });

    if (!s3Response.ok) {
      throw new Error(`S3 server returned status ${s3Response.status}`);
    }

    // Upload succeeded!
    item.status = 'UPLOADED';
    item.pocketId = pocketRecordingId;
    saveQueue();
    sendQueueUpdate();
  } catch (err) {
    console.error(`Recording upload failed [id: ${id}]:`, err);
    item.status = 'FAILED';
    item.error = err.message;
    saveQueue();
    sendQueueUpdate();
    throw err;
  }
}
