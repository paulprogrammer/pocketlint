const PocketUploader = require('../../src/services/uploader');

describe('PocketUploader', () => {
  let mockStorage;
  let mockFetch;
  let mockFs;
  let onUpdateCallback;
  let uploader;

  beforeEach(() => {
    mockStorage = {
      config: { apiKey: 'test-api-key' },
      queue: [
        {
          id: 'rec-1',
          title: 'Recording 1',
          fileName: 'recording_1.ogg',
          filePath: '/path/to/recording_1.ogg',
          recordingAt: '2026-06-03T12:00:00Z',
          duration: 30,
          status: 'RECORDED',
          error: null,
          pocketId: null
        }
      ],
      saveQueue: jest.fn()
    };
    mockFetch = jest.fn();
    mockFs = {
      existsSync: jest.fn().mockReturnValue(true),
      readFileSync: jest.fn().mockReturnValue(Buffer.from('mock-audio-bytes'))
    };
    onUpdateCallback = jest.fn();
    uploader = new PocketUploader(mockStorage, onUpdateCallback, mockFetch, mockFs);
  });

  it('should successfully request presigned URL and upload file content to S3', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({
        success: true,
        data: {
          upload_url: 'https://s3.amazonaws.com/pocket-bucket/recording_1.ogg',
          id: 'pocket-id-999'
        }
      })
    });

    mockFetch.mockResolvedValueOnce({
      ok: true
    });

    await uploader.uploadRecording('rec-1');

    expect(mockFetch).toHaveBeenNthCalledWith(1, 'https://public.heypocketai.com/api/v1/public/recordings/upload-url', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer test-api-key',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content_type: 'audio/ogg',
        duration: 30,
        file_name: 'recording_1.ogg',
        recording_at: '2026-06-03T12:00:00Z',
        title: 'Recording 1'
      })
    });

    expect(mockFetch).toHaveBeenNthCalledWith(2, 'https://s3.amazonaws.com/pocket-bucket/recording_1.ogg', {
      method: 'PUT',
      headers: {
        'Content-Type': 'audio/ogg'
      },
      body: Buffer.from('mock-audio-bytes')
    });

    const item = mockStorage.queue[0];
    expect(item.status).toBe('UPLOADED');
    expect(item.pocketId).toBe('pocket-id-999');
    expect(item.error).toBeNull();
    expect(mockStorage.saveQueue).toHaveBeenCalled();
    expect(onUpdateCallback).toHaveBeenCalled();
  });

  it('should set status to FAILED and record error when API key is missing', async () => {
    mockStorage.config.apiKey = '';

    await expect(uploader.uploadRecording('rec-1')).rejects.toThrow('Pocket API Key is not set');

    const item = mockStorage.queue[0];
    expect(item.status).toBe('FAILED');
    expect(item.error).toBe('Pocket API Key is not set');
    expect(onUpdateCallback).toHaveBeenCalled();
  });

  it('should set status to FAILED and record error when file does not exist', async () => {
    mockFs.existsSync.mockReturnValue(false);

    await expect(uploader.uploadRecording('rec-1')).rejects.toThrow('Local recording file was not found');

    const item = mockStorage.queue[0];
    expect(item.status).toBe('FAILED');
    expect(item.error).toContain('Local recording file was not found');
  });

  it('should set status to FAILED and record error when API request fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: jest.fn().mockResolvedValue(JSON.stringify({ error: 'Unauthorized key' }))
    });

    await expect(uploader.uploadRecording('rec-1')).rejects.toThrow('Unauthorized key');

    const item = mockStorage.queue[0];
    expect(item.status).toBe('FAILED');
    expect(item.error).toBe('Unauthorized key');
  });
});
