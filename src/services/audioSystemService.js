class AudioSystemService {
  constructor(shellClient, parser) {
    this.shell = shellClient;
    this.parser = parser;
    this.recordProcess = null;
    this.playbackProcess = null;
  }

  async findLoadedModules() {
    try {
      const { stdout } = await this.shell.exec('pactl list modules short');
      return this.parser.parseModules(stdout);
    } catch (err) {
      console.error('[AudioSystemService] findLoadedModules error:', err);
      return { isSplitEnabled: false };
    }
  }

  async listSinks() {
    const { stdout } = await this.shell.exec('pactl list sinks');
    return this.parser.parseSinks(stdout);
  }

  async listSources() {
    const { stdout } = await this.shell.exec('pactl list sources');
    return this.parser.parseSources(stdout);
  }

  async teardownLoopback() {
    try {
      const { stdout } = await this.shell.exec('pactl list modules short');
      const idsToUnload = this.parser.parseIdsToUnload(stdout);
      
      // Unload in reverse order
      for (const id of idsToUnload.reverse()) {
        await this.shell.exec(`pactl unload-module ${id}`);
      }
    } catch (e) {
      console.error('[AudioSystemService] Error during teardownLoopback:', e);
    }
  }

  async setupLoopback(sinkName, sourceName) {
    // Teardown existing first
    await this.teardownLoopback();

    // 1. Create virtual null sink for system audio (PocketLoopback)
    await this.shell.exec('pactl load-module module-null-sink sink_name=PocketLoopback sink_properties=device.description="PocketLoopback"');

    // 2. Route PocketLoopback monitor back to physical output speakers so user can hear system audio
    await this.shell.exec(`pactl load-module module-loopback source=PocketLoopback.monitor sink="${sinkName}" latency_msec=20 adjust_time=0`);

    // 3. Create virtual null sink for recording mixer (PocketRecordMix)
    await this.shell.exec('pactl load-module module-null-sink sink_name=PocketRecordMix sink_properties=device.description="PocketRecordMix"');

    // 4. Route system audio from PocketLoopback monitor to PocketRecordMix (Left channel only)
    await this.shell.exec('pactl load-module module-loopback source=PocketLoopback.monitor sink=PocketRecordMix latency_msec=20 adjust_time=0 channel_map=left');

    // 5. Route physical microphone source to PocketRecordMix (Right channel only, without looping back to physical speakers)
    await this.shell.exec(`pactl load-module module-loopback source="${sourceName}" sink=PocketRecordMix latency_msec=20 adjust_time=0 channel_map=right`);
  }

  isRecording() {
    return !!this.recordProcess;
  }

  isPlaying() {
    return !!this.playbackProcess;
  }

  async startRecording(tempWavPath) {
    if (this.recordProcess) {
      throw new Error('Recording is already in progress.');
    }
    this.recordProcess = this.shell.spawn('pw-record', [
      '--target=PocketRecordMix',
      '--properties=stream.capture.sink=true',
      tempWavPath
    ]);
    this.recordProcess.on('exit', () => {
      this.recordProcess = null;
    });
  }

  async stopRecording() {
    return new Promise((resolve) => {
      if (!this.recordProcess) {
        return resolve();
      }
      this.recordProcess.kill('SIGINT');
      const checkInterval = setInterval(() => {
        if (!this.recordProcess) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);
    });
  }

  async playRecording(filePath, targetSink, onExit) {
    if (this.playbackProcess) {
      this.playbackProcess.kill();
      this.playbackProcess = null;
    }
    const target = targetSink || 'auto';
    this.playbackProcess = this.shell.spawn('pw-play', [`--target=${target}`, filePath]);
    this.playbackProcess.on('exit', () => {
      this.playbackProcess = null;
      if (onExit) onExit();
    });
  }

  async stopPlayback() {
    if (this.playbackProcess) {
      this.playbackProcess.kill();
      this.playbackProcess = null;
    }
  }

  async playTestTone(tempWavPath) {
    // Generate 1-second sine wave tone
    await this.shell.exec(`ffmpeg -y -f lavfi -i "sine=frequency=800:duration=1" "${tempWavPath}"`);
    // Play to the PocketLoopback sink
    await this.shell.exec(`pw-play --target=PocketLoopback "${tempWavPath}"`);
  }
}

module.exports = AudioSystemService;
