const AudioProcessor = require('../../src/services/audioProcessor');

describe('AudioProcessor', () => {
  let mockShell;
  let mockFs;
  let processor;

  beforeEach(() => {
    mockShell = {
      execWithCallback: jest.fn(),
      execFileWithCallback: jest.fn()
    };
    mockFs = {
      existsSync: jest.fn(),
      unlinkSync: jest.fn()
    };
    processor = new AudioProcessor(mockShell, mockFs);
  });

  describe('analyzeLoudness', () => {
    it('should run ffmpeg with pan filter for mixed channels and parse output JSON', async () => {
      const mockStderr = `
Some ffmpeg startup messages
[Parsed_loudnorm_2 @ 0x7f270000d9c0]
{
        "input_i" : "-15.2",
        "input_tp" : "-1.1",
        "input_lra" : "10.0",
        "input_thresh" : "-25.0",
        "normalization_type" : "dynamic",
        "target_offset" : "0.5"
}
Output message
`;
      mockShell.execWithCallback.mockImplementation((cmd, cb) => {
        cb(null, '', mockStderr);
      });

      const res = await processor.analyzeLoudness('temp.wav');
      expect(mockShell.execWithCallback).toHaveBeenCalledTimes(1);
      expect(mockShell.execWithCallback.mock.calls[0][0]).toContain('pan=mono|c0=0.5*c0+0.5*c1');
      expect(res).toEqual({
        input_i: '-15.2',
        input_tp: '-1.1',
        input_lra: '10.0',
        input_thresh: '-25.0',
        normalization_type: 'dynamic',
        target_offset: '0.5'
      });
    });

    it('should return default stats if parsing fails', async () => {
      mockShell.execWithCallback.mockImplementation((cmd, cb) => {
        cb(new Error('command failed'), '', 'invalid output');
      });

      const res = await processor.analyzeLoudness('temp.wav');
      expect(res).toEqual({
        input_i: '-24.0',
        input_tp: '-2.0',
        input_lra: '5.0',
        input_thresh: '-35.0',
        target_offset: '0.0'
      });
    });
  });

  describe('normalizeAndTagRecording', () => {
    it('should execute ffmpeg file conversion and delete temporary wav', async () => {
      mockShell.execWithCallback.mockImplementation((cmd, cb) => {
        const stats = '{ "input_i": "-12.0", "input_tp": "-1.0", "input_lra": "8.0", "input_thresh": "-22.0", "target_offset": "2.0" }';
        cb(null, '', stats);
      });

      mockShell.execFileWithCallback.mockImplementation((file, args, cb) => {
        cb(null, 'stdout', 'stderr');
      });

      mockFs.existsSync.mockReturnValue(true);

      await processor.normalizeAndTagRecording('temp.wav', 'final.mp3', 'Paul Williams');

      expect(mockShell.execWithCallback).toHaveBeenCalledTimes(1);
      expect(mockShell.execFileWithCallback).toHaveBeenCalledTimes(1);

      const [file, args] = mockShell.execFileWithCallback.mock.calls[0];
      expect(file).toBe('ffmpeg');
      expect(args).toContain('temp.wav');
      expect(args).toContain('final.mp3');
      expect(args).toContain('title=Paul Williams');
      
      const filterComplexIdx = args.indexOf('-filter_complex');
      expect(filterComplexIdx).not.toBe(-1);
      const filterComplex = args[filterComplexIdx + 1];
      expect(filterComplex).toContain('pan=mono|c0=0.5*c0+0.5*c1');
      expect(filterComplex).toContain('afftdn');
      expect(filterComplex).toContain('measured_I=-12.0:measured_TP=-1.0:measured_LRA=8.0:measured_thresh=-22.0:offset=2.0');

      expect(mockFs.existsSync).toHaveBeenCalledWith('final.mp3');
      expect(mockFs.existsSync).toHaveBeenCalledWith('temp.wav');
      expect(mockFs.unlinkSync).toHaveBeenCalledWith('temp.wav');
    });
  });
});
