const fs = require('fs');
const path = require('path');

class StorageService {
  constructor(userDataPath, fsClient = fs) {
    this.userDataPath = userDataPath;
    this.fs = fsClient;
    this.recordingsDir = path.join(userDataPath, 'recordings');
    this.configFilePath = path.join(userDataPath, 'config.json');
    this.queueFilePath = path.join(userDataPath, 'queue.json');

    // Ensure recordings directory exists
    if (!this.fs.existsSync(this.recordingsDir)) {
      this.fs.mkdirSync(this.recordingsDir, { recursive: true });
    }

    this.config = { apiKey: '', targetSinkName: '', targetSourceName: '' };
    this.queue = [];
  }

  load() {
    if (this.fs.existsSync(this.configFilePath)) {
      try {
        this.config = JSON.parse(this.fs.readFileSync(this.configFilePath, 'utf-8'));
      } catch (e) {
        console.error('Failed to load config, resetting', e);
      }
    }

    if (this.fs.existsSync(this.queueFilePath)) {
      try {
        this.queue = JSON.parse(this.fs.readFileSync(this.queueFilePath, 'utf-8'));
      } catch (e) {
        console.error('Failed to load queue, resetting', e);
      }
    }
  }

  saveConfig() {
    this.fs.writeFileSync(this.configFilePath, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  saveQueue() {
    this.fs.writeFileSync(this.queueFilePath, JSON.stringify(this.queue, null, 2), 'utf-8');
  }
}

module.exports = StorageService;
