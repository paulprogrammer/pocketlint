/**
 * Pure functions for parsing pactl CLI outputs.
 */

function parseModules(stdout) {
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
  return { isSplitEnabled: hasLoopbackSink && hasRecordMixSink };
}

function parseSinks(stdout) {
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
}

function parseSources(stdout) {
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
}

function parseIdsToUnload(stdout) {
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
  return idsToUnload;
}

module.exports = {
  parseModules,
  parseSinks,
  parseSources,
  parseIdsToUnload
};
