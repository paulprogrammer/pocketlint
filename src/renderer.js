// DOM Elements
const apiKeyInput = document.getElementById('apiKeyInput');
const toggleApiKeyVisibility = document.getElementById('toggleApiKeyVisibility');
const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
const apiKeyStatus = document.getElementById('apiKeyStatus');

const sinkSelect = document.getElementById('sinkSelect');
const sourceSelect = document.getElementById('sourceSelect');
const refreshSinksBtn = document.getElementById('refreshSinksBtn');
const toggleSplitBtn = document.getElementById('toggleSplitBtn');
const testOutputBtn = document.getElementById('testOutputBtn');
const splitStatusBadge = document.getElementById('splitStatusBadge');

const waveformContainer = document.getElementById('waveformContainer');
const recordingTimer = document.getElementById('recordingTimer');
const recordingTitleInput = document.getElementById('recordingTitleInput');
const recordingStateDesc = document.getElementById('recordingStateDesc');
const recordBtn = document.getElementById('recordBtn');

const queueList = document.getElementById('queueList');
const queueStatsText = document.getElementById('queueStatsText');

const toastNotification = document.getElementById('toastNotification');
const toastMessage = document.getElementById('toastMessage');

// State
let config = { apiKey: '', targetSinkName: '', targetSourceName: '' };
let appStatus = { isSplitEnabled: false, isRecording: false };
let recordingTimerInterval = null;
let recordingSeconds = 0;
let playingRecordingId = null;

// Initialize App
async function init() {
  try {
    // 1. Load config
    config = await window.pocketlintAPI.getConfig();
    if (config.apiKey) {
      apiKeyInput.value = config.apiKey;
      updateApiKeyStatus(true);
    } else {
      updateApiKeyStatus(false);
    }

    // 2. Load sinks & sources
    await refreshSinks();
    await refreshSources();

    // 3. Get loopback & recording status
    await updateStatus();

    // 4. Load initial queue
    const queue = await window.pocketlintAPI.getQueue();
    renderQueue(queue);

    // 5. Register IPC listeners
    window.pocketlintAPI.onQueueUpdated((updatedQueue) => {
      renderQueue(updatedQueue);
    });

    window.pocketlintAPI.onPlaybackEnded((endedId) => {
      if (playingRecordingId === endedId) {
        playingRecordingId = null;
        // Re-render queue to update play/pause buttons
        window.pocketlintAPI.getQueue().then(renderQueue);
      }
    });

  } catch (err) {
    console.error('Failed to initialize app:', err);
    showToast('Failed to load initial application state: ' + err.message, 'error');
  }
}

// Update API Key Status Indicator
function updateApiKeyStatus(isSet) {
  if (isSet) {
    apiKeyStatus.innerHTML = '<span class="status-dot active"></span> Key Configured';
    apiKeyStatus.classList.remove('warning');
  } else {
    apiKeyStatus.innerHTML = '<span class="status-dot warning"></span> Key not set';
    apiKeyStatus.classList.add('warning');
  }
}

// Save API Key
saveApiKeyBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    showToast('Please enter an API key', 'error');
    return;
  }
  
  saveApiKeyBtn.disabled = true;
  saveApiKeyBtn.innerText = 'Saving...';
  
  try {
    const res = await window.pocketlintAPI.saveApiKey(key);
    if (res.success) {
      config.apiKey = key;
      updateApiKeyStatus(true);
      showToast('Pocket API Key updated successfully', 'success');
    } else {
      showToast(res.error || 'Failed to save API key', 'error');
    }
  } catch (err) {
    showToast('Error saving API key: ' + err.message, 'error');
  } finally {
    saveApiKeyBtn.disabled = false;
    saveApiKeyBtn.innerText = 'Save';
  }
});

// Toggle API Key Input Mask
toggleApiKeyVisibility.addEventListener('click', () => {
  if (apiKeyInput.type === 'password') {
    apiKeyInput.type = 'text';
    toggleApiKeyVisibility.innerHTML = `
      <svg class="eye-closed" viewBox="0 0 24 24" width="16" height="16">
        <path fill="currentColor" d="M12,17a5,5,0,0,1-5-5,5,5,0,0,1,5-5,5,5,0,0,1,5,5A5,5,0,0,1,12,17Zm0-12A10,10,0,0,0,2,12a10,10,0,0,0,20,0A10,10,0,0,0,12,5Zm0,10a3,3,0,1,0-3-3A3,3,0,0,0,12,15Z" opacity="0.3"/>
        <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="2" />
      </svg>
    `;
  } else {
    apiKeyInput.type = 'password';
    toggleApiKeyVisibility.innerHTML = `
      <svg class="eye-open" viewBox="0 0 24 24" width="16" height="16">
        <path fill="currentColor" d="M12,9A3,3,0,1,0,15,12,3,3,0,0,0,12,9Zm0,8a5,5,0,1,1,5-5A5,5,0,0,1,12,17Zm0-12A10,10,0,0,0,2,12a10,10,0,0,0,20,0A10,10,0,0,0,12,5Z"/>
      </svg>
    `;
  }
});

// Refresh Audio Sinks List
async function refreshSinks() {
  try {
    const sinks = await window.pocketlintAPI.listSinks();
    
    // Clear select
    sinkSelect.innerHTML = '';
    
    if (sinks.length === 0) {
      const opt = document.createElement('option');
      opt.text = 'No audio output devices found';
      opt.disabled = true;
      sinkSelect.appendChild(opt);
      return;
    }
    
    sinks.forEach((sink) => {
      const opt = document.createElement('option');
      opt.value = sink.name;
      opt.text = sink.description || sink.name;
      if (sink.name === config.targetSinkName) {
        opt.selected = true;
      }
      sinkSelect.appendChild(opt);
    });
    
  } catch (err) {
    showToast('Failed to fetch output devices: ' + err.message, 'error');
  }
}

// Refresh Audio Sources (Microphones) List
async function refreshSources() {
  try {
    const sources = await window.pocketlintAPI.listSources();
    
    // Clear select
    sourceSelect.innerHTML = '';
    
    if (sources.length === 0) {
      const opt = document.createElement('option');
      opt.text = 'No microphones found';
      opt.disabled = true;
      sourceSelect.appendChild(opt);
      return;
    }
    
    sources.forEach((source) => {
      const opt = document.createElement('option');
      opt.value = source.name;
      opt.text = source.description || source.name;
      if (source.name === config.targetSourceName) {
        opt.selected = true;
      }
      sourceSelect.appendChild(opt);
    });
    
  } catch (err) {
    showToast('Failed to fetch microphones: ' + err.message, 'error');
  }
}

refreshSinksBtn.addEventListener('click', async () => {
  refreshSinksBtn.disabled = true;
  await refreshSinks();
  await refreshSources();
  showToast('Audio devices list updated', 'success');
  refreshSinksBtn.disabled = false;
});

// Update Status indicators
async function updateStatus() {
  appStatus = await window.pocketlintAPI.getStatus();
  
  // Update Split indicator
  if (appStatus.isSplitEnabled) {
    splitStatusBadge.innerHTML = '<span class="status-dot active"></span> <span class="status-text">Active (Logical Y-Split)</span>';
    toggleSplitBtn.innerText = 'Destroy Y-Split';
    toggleSplitBtn.classList.remove('btn-accent');
    toggleSplitBtn.classList.add('btn-outline');
    testOutputBtn.disabled = false;
    recordBtn.disabled = false;
    document.querySelector('.card-glow').classList.add('active');
  } else {
    splitStatusBadge.innerHTML = '<span class="status-dot"></span> <span class="status-text">Inactive</span>';
    toggleSplitBtn.innerText = 'Create Y-Split';
    toggleSplitBtn.classList.remove('btn-outline');
    toggleSplitBtn.classList.add('btn-accent');
    testOutputBtn.disabled = true;
    recordBtn.disabled = true;
    document.querySelector('.card-glow').classList.remove('active');
  }
  
  // Restore recording state if main crashed or restarted
  if (appStatus.isRecording) {
    recordingSeconds = Math.round((Date.now() - appStatus.recordingStartTime) / 1000);
    startTimer();
    setRecordingUI(true);
  } else {
    setRecordingUI(false);
  }
}

// Toggle logical split setup/teardown
toggleSplitBtn.addEventListener('click', async () => {
  toggleSplitBtn.disabled = true;
  
  if (appStatus.isSplitEnabled) {
    // Teardown
    try {
      const res = await window.pocketlintAPI.teardownLoopback();
      if (res.success) {
        showToast('Logical Y-Split disabled', 'success');
      } else {
        showToast(res.error || 'Failed to disable Y-split', 'error');
      }
    } catch (e) {
      showToast('Error disabling split: ' + e.message, 'error');
    }
  } else {
    // Setup
    const selectedSink = sinkSelect.value;
    const selectedSource = sourceSelect.value;
    if (!selectedSink || !selectedSource) {
      showToast('Please select both target physical output and input microphone', 'error');
      toggleSplitBtn.disabled = false;
      return;
    }
    
    try {
      const res = await window.pocketlintAPI.setupLoopback(selectedSink, selectedSource);
      if (res.success) {
        showToast('Logical Y-Split activated successfully', 'success');
      } else {
        showToast(res.error || 'Failed to load virtual devices', 'error');
      }
    } catch (e) {
      showToast('Error enabling split: ' + e.message, 'error');
    }
  }
  
  await updateStatus();
  toggleSplitBtn.disabled = false;
});

// Run Test Tone Sound
testOutputBtn.addEventListener('click', async () => {
  testOutputBtn.disabled = true;
  testOutputBtn.innerText = 'Playing tone...';
  
  try {
    const res = await window.pocketlintAPI.playTestSound();
    if (!res.success) {
      showToast('Test tone failure: ' + res.error, 'error');
    } else {
      showToast('Test tone played. Verify physical sound output!', 'success');
    }
  } catch (err) {
    showToast('Failed to play test sound: ' + err.message, 'error');
  } finally {
    testOutputBtn.disabled = false;
    testOutputBtn.innerText = 'Test Output Sound';
  }
});

// Recording Controls
recordBtn.addEventListener('click', async () => {
  recordBtn.disabled = true;
  
  if (appStatus.isRecording) {
    // Stop recording
    try {
      const res = await window.pocketlintAPI.stopRecording();
      if (res.success) {
        showToast('Recording saved. Syncing to pocket...', 'success');
        recordingTitleInput.value = ''; // Reset title input
      } else {
        showToast(res.error || 'Failed to stop recording cleanly', 'error');
      }
    } catch (e) {
      showToast('Error stopping recording: ' + e.message, 'error');
    }
  } else {
    // Start recording
    const title = recordingTitleInput.value.trim();
    try {
      const res = await window.pocketlintAPI.startRecording(title);
      if (res.success) {
        showToast('Recording started', 'success');
      } else {
        showToast(res.error || 'Failed to start recording process', 'error');
      }
    } catch (e) {
      showToast('Error starting recording: ' + e.message, 'error');
    }
  }
  
  await updateStatus();
  recordBtn.disabled = false;
});

// Timer formatting helper
function formatSeconds(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function startTimer() {
  if (recordingTimerInterval) clearInterval(recordingTimerInterval);
  recordingTimer.innerText = formatSeconds(recordingSeconds);
  recordingTimerInterval = setInterval(() => {
    recordingSeconds++;
    recordingTimer.innerText = formatSeconds(recordingSeconds);
  }, 1000);
}

function stopTimer() {
  if (recordingTimerInterval) {
    clearInterval(recordingTimerInterval);
    recordingTimerInterval = null;
  }
  recordingSeconds = 0;
  recordingTimer.innerText = '00:00';
}

function setRecordingUI(active) {
  if (active) {
    recordBtn.classList.add('recording');
    recordBtn.querySelector('#recordBtnText').innerText = 'Stop Recording';
    waveformContainer.classList.add('active');
    recordingStateDesc.innerHTML = '<span class="status-dot danger active"></span> Recording active system audio...';
  } else {
    recordBtn.classList.remove('recording');
    recordBtn.querySelector('#recordBtnText').innerText = 'Start Recording';
    waveformContainer.classList.remove('active');
    recordingStateDesc.innerText = 'Ready to record system audio';
    stopTimer();
  }
}

// Render Recording Queue and History Table
function renderQueue(queue) {
  const pendingCount = queue.filter(x => x.status !== 'UPLOADED').length;
  queueStatsText.innerText = `${queue.length} items (${pendingCount} pending upload)`;
  
  if (queue.length === 0) {
    queueList.innerHTML = `
      <tr class="empty-state">
        <td colspan="4">
          <div class="empty-state-container">
            <svg viewBox="0 0 24 24" width="48" height="48">
              <path fill="currentColor" d="M19,15H15A3,3,0,0,1,9,15H5V5H19M19,3H5A2,2,0,0,0,3,5V19a2,2,0,0,0,2,2H19a2,2,0,0,0,2-2V5A2,2,0,0,0,19,3Z"/>
            </svg>
            <p>No recordings captured yet.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }
  
  queueList.innerHTML = '';
  
  queue.forEach((item) => {
    const tr = document.createElement('tr');
    
    // Title & Date cell
    const dateStr = new Date(item.recordingAt).toLocaleString();
    const titleCell = document.createElement('td');
    titleCell.className = 'rec-title-cell';
    titleCell.innerHTML = `
      <span class="rec-title">${item.title}</span>
      <span class="rec-date">${dateStr}</span>
    `;
    tr.appendChild(titleCell);
    
    // Duration cell
    const durationCell = document.createElement('td');
    durationCell.className = 'duration-cell';
    durationCell.innerText = formatSeconds(item.duration);
    tr.appendChild(durationCell);
    
    // Upload status cell
    const statusCell = document.createElement('td');
    let statusBadge = '';
    
    switch (item.status) {
      case 'RECORDED':
        statusBadge = '<span class="badge badge-recorded">Ready to sync</span>';
        break;
      case 'UPLOADING':
        statusBadge = '<span class="badge badge-uploading"><div class="spinner"></div> Syncing...</span>';
        break;
      case 'UPLOADED':
        statusBadge = '<span class="badge badge-uploaded">Synced</span>';
        break;
      case 'FAILED':
        statusBadge = `<span class="badge badge-failed" title="${item.error || 'Unknown error'}">Failed (Hover)</span>`;
        break;
    }
    
    statusCell.innerHTML = statusBadge;
    tr.appendChild(statusCell);
    
    // Action cell
    const actionCell = document.createElement('td');
    actionCell.className = 'action-cell';
    
    // 1. Play Button
    const playBtn = document.createElement('button');
    playBtn.className = 'icon-btn btn-play-state';
    if (playingRecordingId === item.id) {
      playBtn.classList.add('playing');
      playBtn.title = 'Stop Playback';
      playBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16">
          <path fill="currentColor" d="M6,19H10V5H6ZM14,5V19h4V5Z"/>
        </svg>
      `;
      playBtn.addEventListener('click', async () => {
        await window.pocketlintAPI.stopPlayback();
        playingRecordingId = null;
        renderQueue(queue); // Re-render to update icon
      });
    } else {
      playBtn.title = 'Play Audio';
      playBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16">
          <path fill="currentColor" d="M8,5.14V19.14L19,12.14Z"/>
        </svg>
      `;
      playBtn.addEventListener('click', async () => {
        // Stop current playing
        if (playingRecordingId) {
          await window.pocketlintAPI.stopPlayback();
        }
        playingRecordingId = item.id;
        renderQueue(queue); // Re-render to show playing active
        const res = await window.pocketlintAPI.playRecording(item.id);
        if (!res.success) {
          showToast('Playback failed: ' + res.error, 'error');
          playingRecordingId = null;
          renderQueue(queue);
        }
      });
    }
    actionCell.appendChild(playBtn);
    
    // 2. Retry upload button (only if not successfully uploaded and not actively uploading)
    if (item.status === 'FAILED' || item.status === 'RECORDED') {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'icon-btn';
      retryBtn.title = 'Sync to Pocket';
      retryBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16">
          <path fill="currentColor" d="M19,12A7,7,0,0,1,7.24,16.58L8.85,15H4v4.85l1.62-1.62A9,9,0,1,0,19,12Z"/>
        </svg>
      `;
      retryBtn.addEventListener('click', async () => {
        retryBtn.disabled = true;
        showToast('Initiating sync to Pocket...', 'info');
        try {
          const res = await window.pocketlintAPI.retryUpload(item.id);
          if (res.success) {
            showToast('Audio synced successfully', 'success');
          } else {
            showToast('Sync failed: ' + res.error, 'error');
          }
        } catch (err) {
          showToast('Sync error: ' + err.message, 'error');
        }
      });
      actionCell.appendChild(retryBtn);
    }
    
    // 3. Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'icon-btn';
    deleteBtn.title = 'Delete Recording';
    deleteBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16">
        <path fill="currentColor" d="M6,19A2,2,0,0,0,8,21H16a2,2,0,0,0,2-2V7H6V19M8,9h8v10H8V9M15.5,4l-1-1h-5l-1,1H5V6H19V4H15.5Z"/>
      </svg>
    `;
    deleteBtn.addEventListener('click', async () => {
      if (confirm(`Are you sure you want to delete "${item.title}"?`)) {
        deleteBtn.disabled = true;
        const res = await window.pocketlintAPI.deleteRecording(item.id);
        if (res.success) {
          showToast('Recording deleted', 'success');
        } else {
          showToast('Failed to delete: ' + res.error, 'error');
          deleteBtn.disabled = false;
        }
      }
    });
    actionCell.appendChild(deleteBtn);
    
    tr.appendChild(actionCell);
    queueList.appendChild(tr);
  });
}

// Toast Notification Manager
let toastTimeout = null;
function showToast(message, type = 'info') {
  if (toastTimeout) clearTimeout(toastTimeout);
  
  toastMessage.innerText = message;
  toastNotification.className = 'toast-notification show';
  
  if (type === 'error') {
    toastNotification.classList.add('error');
  } else if (type === 'success') {
    toastNotification.classList.add('success');
  }
  
  toastTimeout = setTimeout(() => {
    toastNotification.classList.remove('show');
  }, 4000);
}

// Initialize on load
window.addEventListener('DOMContentLoaded', init);
