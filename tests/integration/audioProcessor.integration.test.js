const AudioProcessor = require('../../src/services/audioProcessor');
const shell = require('../../src/utils/shell');
const fs = require('fs');
const path = require('path');

// Goertzel algorithm to detect the magnitude of a specific frequency in PCM audio
function goertzel(samples, targetFrequency, sampleRate) {
  const numSamples = samples.length;
  const omega = (2 * Math.PI * targetFrequency) / sampleRate;
  const sine = Math.sin(omega);
  const cosine = Math.cos(omega);
  const coeff = 2 * cosine;

  let q0 = 0, q1 = 0, q2 = 0;
  for (let i = 0; i < numSamples; i++) {
    q0 = coeff * q1 - q2 + samples[i];
    q2 = q1;
    q1 = q0;
  }

  const power = q1 * q1 + q2 * q2 - coeff * q1 * q2;
  return Math.sqrt(Math.max(0, power)) / (numSamples / 2); // Return normalized magnitude
}

describe('AudioProcessor Integration Test (Frequency Verification)', () => {
  const tempWavPath = path.join(__dirname, 'temp_input_stereo.wav');
  const tempMp3Path = path.join(__dirname, 'temp_output_mono.mp3');
  const tempRawPath = path.join(__dirname, 'temp_output.raw');

  let processor;

  beforeEach(() => {
    processor = new AudioProcessor(shell, fs);
  });

  afterEach(() => {
    // Clean up temporary files
    [tempWavPath, tempMp3Path, tempRawPath].forEach((file) => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
  });

  it('should downmix and preserve Left (440Hz) and Right (880Hz) source tones in mixed mono MP3', async () => {
    // 1. Generate 2-second stereo WAV with 440Hz Left (system) and 880Hz Right (mic)
    const generateCmd = `ffmpeg -y -f lavfi -i "sine=frequency=440:duration=2:sample_rate=44100" ` +
      `-f lavfi -i "sine=frequency=880:duration=2:sample_rate=44100" ` +
      `-filter_complex "[0:a][1:a]join=inputs=2:channel_layout=stereo[a]" ` +
      `-map "[a]" "${tempWavPath}"`;

    await shell.exec(generateCmd);
    expect(fs.existsSync(tempWavPath)).toBe(true);

    // 2. Perform normalizeAndTagRecording (dual-pass downmix, denoise, normalize, tag)
    await processor.normalizeAndTagRecording(tempWavPath, tempMp3Path, 'Tester');
    expect(fs.existsSync(tempMp3Path)).toBe(true);

    // 3. Convert MP3 output back to raw s16le PCM for spectral analysis
    const pcmCmd = `ffmpeg -y -i "${tempMp3Path}" -f s16le -acodec pcm_s16le "${tempRawPath}"`;
    await shell.exec(pcmCmd);
    expect(fs.existsSync(tempRawPath)).toBe(true);

    // 4. Load PCM samples and slice a 2048-sample window from the middle
    const buffer = fs.readFileSync(tempRawPath);
    const allSamples = [];
    for (let i = 0; i < buffer.length; i += 2) {
      allSamples.push(buffer.readInt16LE(i) / 32768); // Convert to [-1.0, 1.0] range
    }

    const startSample = Math.floor(allSamples.length / 2);
    const windowSize = 2048;
    const samples = allSamples.slice(startSample, startSample + windowSize);

    // 5. Run Goertzel to verify target frequencies (440Hz, 880Hz) and control (600Hz)
    const sampleRate = 44100;
    const magnitude440 = goertzel(samples, 440, sampleRate);
    const magnitude880 = goertzel(samples, 880, sampleRate);
    const magnitude600 = goertzel(samples, 600, sampleRate);

    console.log('[Integration Test] Goertzel Magnitudes:', {
      '440Hz (Left - System)': magnitude440,
      '880Hz (Right - Mic)': magnitude880,
      '600Hz (Control)': magnitude600
    });

    // 6. Assertions
    expect(magnitude440).toBeGreaterThan(0.01); // Left channel tone is present
    expect(magnitude880).toBeGreaterThan(0.01); // Right channel tone is present
    expect(magnitude600).toBeLessThan(0.008);    // Control frequency is absent

    // Relative assertions (target tones should be noticeably louder than control)
    expect(magnitude440).toBeGreaterThan(magnitude600 * 2);
    expect(magnitude880).toBeGreaterThan(magnitude600 * 1.5);
  });
});
