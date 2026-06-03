const AudioSystemService = require('../../src/services/audioSystemService');

describe('AudioSystemService', () => {
  let mockShell;
  let mockParser;
  let service;

  beforeEach(() => {
    mockShell = {
      exec: jest.fn()
    };
    mockParser = {
      parseModules: jest.fn(),
      parseSinks: jest.fn(),
      parseSources: jest.fn(),
      parseIdsToUnload: jest.fn()
    };
    service = new AudioSystemService(mockShell, mockParser);
  });

  describe('findLoadedModules', () => {
    it('should exec pactl list modules short and return parsed results', async () => {
      mockShell.exec.mockResolvedValue({ stdout: 'module_stdout' });
      mockParser.parseModules.mockReturnValue({ isSplitEnabled: true });

      const res = await service.findLoadedModules();
      expect(mockShell.exec).toHaveBeenCalledWith('pactl list modules short');
      expect(mockParser.parseModules).toHaveBeenCalledWith('module_stdout');
      expect(res).toEqual({ isSplitEnabled: true });
    });

    it('should fallback to isSplitEnabled: false on shell error', async () => {
      mockShell.exec.mockRejectedValue(new Error('pactl command failed'));

      const res = await service.findLoadedModules();
      expect(res).toEqual({ isSplitEnabled: false });
    });
  });

  describe('listSinks', () => {
    it('should exec pactl list sinks and return parsed sinks', async () => {
      mockShell.exec.mockResolvedValue({ stdout: 'sinks_stdout' });
      mockParser.parseSinks.mockReturnValue([{ name: 'sink1' }]);

      const res = await service.listSinks();
      expect(mockShell.exec).toHaveBeenCalledWith('pactl list sinks');
      expect(mockParser.parseSinks).toHaveBeenCalledWith('sinks_stdout');
      expect(res).toEqual([{ name: 'sink1' }]);
    });
  });

  describe('teardownLoopback', () => {
    it('should unload modules returned by parseIdsToUnload in reverse order', async () => {
      mockShell.exec.mockResolvedValue({ stdout: 'modules_stdout' });
      mockParser.parseIdsToUnload.mockReturnValue(['10', '11']);

      await service.teardownLoopback();

      expect(mockShell.exec).toHaveBeenCalledWith('pactl list modules short');
      expect(mockParser.parseIdsToUnload).toHaveBeenCalledWith('modules_stdout');
      expect(mockShell.exec).toHaveBeenNthCalledWith(2, 'pactl unload-module 11');
      expect(mockShell.exec).toHaveBeenNthCalledWith(3, 'pactl unload-module 10');
    });
  });

  describe('setupLoopback', () => {
    it('should setup the null sinks and loopback routes sequentially', async () => {
      mockShell.exec.mockResolvedValue({ stdout: '' });
      mockParser.parseIdsToUnload.mockReturnValue([]);

      await service.setupLoopback('my-sink', 'my-source');

      // Verify teardown is called first
      expect(mockShell.exec).toHaveBeenNthCalledWith(1, 'pactl list modules short');
      // Verify null sinks/loopbacks are created
      expect(mockShell.exec).toHaveBeenNthCalledWith(2, 'pactl load-module module-null-sink sink_name=PocketLoopback sink_properties=device.description="PocketLoopback"');
      expect(mockShell.exec).toHaveBeenNthCalledWith(3, 'pactl load-module module-loopback source=PocketLoopback.monitor sink="my-sink" latency_msec=20 adjust_time=0');
      expect(mockShell.exec).toHaveBeenNthCalledWith(4, 'pactl load-module module-null-sink sink_name=PocketRecordMix sink_properties=device.description="PocketRecordMix"');
      expect(mockShell.exec).toHaveBeenNthCalledWith(5, 'pactl load-module module-loopback source=PocketLoopback.monitor sink=PocketRecordMix latency_msec=20 adjust_time=0 channel_map=left');
      expect(mockShell.exec).toHaveBeenNthCalledWith(6, 'pactl load-module module-loopback source="my-source" sink=PocketRecordMix latency_msec=20 adjust_time=0 channel_map=right');
    });
  });
});
