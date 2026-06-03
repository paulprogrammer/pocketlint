const { parseModules, parseSinks, parseSources, parseIdsToUnload } = require('../../src/utils/pactlParser');

describe('pactlParser', () => {
  describe('parseModules', () => {
    it('should detect both virtual sinks when active', () => {
      const mockStdout = 
        `0\tmodule-always-sink\t\n` +
        `14\tmodule-null-sink\tsink_name=PocketLoopback sink_properties=device.description="PocketLoopback"\n` +
        `15\tmodule-null-sink\tsink_name=PocketRecordMix sink_properties=device.description="PocketRecordMix"\n`;
      
      const result = parseModules(mockStdout);
      expect(result.isSplitEnabled).toBe(true);
    });

    it('should return false if one virtual sink is missing', () => {
      const mockStdout = 
        `0\tmodule-always-sink\t\n` +
        `14\tmodule-null-sink\tsink_name=PocketLoopback sink_properties=device.description="PocketLoopback"\n`;
      
      const result = parseModules(mockStdout);
      expect(result.isSplitEnabled).toBe(false);
    });
  });

  describe('parseSinks', () => {
    it('should parse physical sinks and filter out virtual ones', () => {
      const mockStdout = `
Sink #0
\tState: RUNNING
\tName: alsa_output.pci-0000_00_1f.3.analog-stereo
\tDescription: Built-in Audio Analog Stereo
Sink #1
\tState: IDLE
\tName: PocketLoopback
\tDescription: PocketLoopback Monitor
`;
      const result = parseSinks(mockStdout);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'alsa_output.pci-0000_00_1f.3.analog-stereo',
        description: 'Built-in Audio Analog Stereo'
      });
    });
  });

  describe('parseSources', () => {
    it('should parse microphones and filter out monitors and virtual sinks', () => {
      const mockStdout = `
Source #0
\tState: RUNNING
\tName: alsa_input.pci-0000_00_1f.3.analog-stereo
\tDescription: Built-in Audio Analog Stereo Mic
Source #1
\tState: IDLE
\tName: PocketLoopback.monitor
\tDescription: PocketLoopback Monitor
Source #2
\tState: IDLE
\tName: PocketRecordMix
\tDescription: PocketRecordMix Null Sink
`;
      const result = parseSources(mockStdout);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'alsa_input.pci-0000_00_1f.3.analog-stereo',
        description: 'Built-in Audio Analog Stereo Mic'
      });
    });
  });

  describe('parseIdsToUnload', () => {
    it('should extract correct module IDs for null sinks and loopbacks', () => {
      const mockStdout = `
0\tmodule-always-sink\t
11\tmodule-null-sink\tsink_name=PocketLoopback
12\tmodule-loopback\tsource=PocketLoopback.monitor sink=PocketRecordMix
13\tmodule-null-sink\tsink_name=PocketRecordMix
14\tmodule-loopback\tsource=alsa_input.pci-0000_00_1f.3.analog-stereo sink=PocketRecordMix
`;
      const result = parseIdsToUnload(mockStdout);
      expect(result).toEqual(['11', '12', '13', '14']);
    });
  });
});
