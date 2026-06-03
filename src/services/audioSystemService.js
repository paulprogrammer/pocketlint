class AudioSystemService {
  constructor(shellClient, parser) {
    this.shell = shellClient;
    this.parser = parser;
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
}

module.exports = AudioSystemService;
