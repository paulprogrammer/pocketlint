const fs = require('fs');

class PocketUploader {
  constructor(storageService, onUpdateCallback, fetchClient = globalThis.fetch, fsClient = fs) {
    this.storage = storageService;
    this.onUpdate = onUpdateCallback || (() => {});
    this.fetch = fetchClient;
    this.fs = fsClient;
  }

  async uploadRecording(id) {
    const item = this.storage.queue.find(x => x.id === id);
    if (!item) throw new Error('Recording not found in queue');

    item.status = 'UPLOADING';
    item.error = null;
    this.storage.saveQueue();
    this.onUpdate();

    try {
      if (!this.storage.config.apiKey) {
        throw new Error('Pocket API Key is not set');
      }

      if (!this.fs.existsSync(item.filePath)) {
        throw new Error(`Local recording file was not found at ${item.filePath}`);
      }

      // Step 1: Get presigned S3 url from Pocket API
      const uploadUrlEndpoint = 'https://public.heypocketai.com/api/v1/public/recordings/upload-url';
      const response = await this.fetch(uploadUrlEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.storage.config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          content_type: 'audio/ogg',
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
      const audioData = this.fs.readFileSync(item.filePath);

      // Step 3: PUT raw audio binary to the pre-signed S3 URL
      const s3Response = await this.fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'audio/ogg'
        },
        body: audioData
      });

      if (!s3Response.ok) {
        throw new Error(`S3 server returned status ${s3Response.status}`);
      }

      // Upload succeeded!
      item.status = 'UPLOADED';
      item.pocketId = pocketRecordingId;
      this.storage.saveQueue();
      this.onUpdate();
    } catch (err) {
      console.error(`Recording upload failed [id: ${id}]:`, err);
      item.status = 'FAILED';
      item.error = err.message;
      this.storage.saveQueue();
      this.onUpdate();
      throw err;
    }
  }
}

module.exports = PocketUploader;
