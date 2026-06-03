const fs = require('fs');
const path = require('path');
const os = require('os');
const StorageService = require('../../src/services/storage');

describe('StorageService', () => {
  let tempDir;
  let storage;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `pocketlint_test_${Date.now()}_${Math.floor(Math.random() * 1000)}`);
    storage = new StorageService(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should initialize with default config and empty queue, and create recordingsDir', () => {
    expect(fs.existsSync(storage.recordingsDir)).toBe(true);
    expect(storage.config).toEqual({ apiKey: '', targetSinkName: '', targetSourceName: '' });
    expect(storage.queue).toEqual([]);
  });

  it('should save and load config', () => {
    storage.config.apiKey = 'test-key-123';
    storage.config.targetSinkName = 'test-sink';
    storage.saveConfig();

    const anotherStorage = new StorageService(tempDir);
    anotherStorage.load();
    expect(anotherStorage.config.apiKey).toBe('test-key-123');
    expect(anotherStorage.config.targetSinkName).toBe('test-sink');
  });

  it('should save and load queue', () => {
    const item = { id: '1', title: 'Test Rec' };
    storage.queue.push(item);
    storage.saveQueue();

    const anotherStorage = new StorageService(tempDir);
    anotherStorage.load();
    expect(anotherStorage.queue).toHaveLength(1);
    expect(anotherStorage.queue[0]).toEqual(item);
  });
});
