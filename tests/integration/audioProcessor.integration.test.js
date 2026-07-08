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
  const tempOggPath = path.join(__dirname, 'temp_output_stereo.ogg');
  const tempRawPath = path.join(__dirname, 'temp_output.raw');

  let processor;

  beforeEach(() => {
    processor = new AudioProcessor(shell, fs);
  });

  afterEach(() => {
    // Clean up temporary files
    [tempWavPath, tempOggPath, tempRawPath].forEach((file) => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
  });

  it('should keep Left (440Hz, remote) and Right (880Hz, local) tones on separate channels in stereo Ogg/Opus', async () => {
    // 1. Generate 2-second stereo WAV with 440Hz Left (system/remote) and 880Hz Right (mic/local)
    const generateCmd = `ffmpeg -y -f lavfi -i "sine=frequency=440:duration=2:sample_rate=44100" ` +
      `-f lavfi -i "sine=frequency=880:duration=2:sample_rate=44100" ` +
      `-filter_complex "[0:a][1:a]join=inputs=2:channel_layout=stereo[a]" ` +
      `-map "[a]" "${tempWavPath}"`;

    await shell.exec(generateCmd);
    expect(fs.existsSync(tempWavPath)).toBe(true);

    // 2. Perform normalizeAndTagRecording (per-channel denoise + normalize, stereo Opus, tag)
    await processor.normalizeAndTagRecording(tempWavPath, tempOggPath, 'Tester');
    expect(fs.existsSync(tempOggPath)).toBe(true);

    // 3. Decode Ogg/Opus back to interleaved stereo s16le PCM (force 44100 for deterministic analysis;
    //    Opus operates at 48kHz internally so we resample on decode)
    const pcmCmd = `ffmpeg -y -i "${tempOggPath}" -ar 44100 -f s16le -acodec pcm_s16le "${tempRawPath}"`;
    await shell.exec(pcmCmd);
    expect(fs.existsSync(tempRawPath)).toBe(true);

    // 4. Deinterleave stereo PCM into separate left and right sample arrays
    const buffer = fs.readFileSync(tempRawPath);
    const left = [];
    const right = [];
    for (let i = 0; i + 3 < buffer.length; i += 4) {
      left.push(buffer.readInt16LE(i) / 32768);      // Convert to [-1.0, 1.0] range
      right.push(buffer.readInt16LE(i + 2) / 32768);
    }

    // 5. Slice a 2048-sample window from the middle of each channel
    const windowSize = 2048;
    const startSample = Math.floor(left.length / 2);
    const leftWindow = left.slice(startSample, startSample + windowSize);
    const rightWindow = right.slice(startSample, startSample + windowSize);

    // 6. Run Goertzel per channel to verify the tones stayed separated
    const sampleRate = 44100;
    const left440 = goertzel(leftWindow, 440, sampleRate);
    const left880 = goertzel(leftWindow, 880, sampleRate);
    const right440 = goertzel(rightWindow, 440, sampleRate);
    const right880 = goertzel(rightWindow, 880, sampleRate);

    console.log('[Integration Test] Goertzel Magnitudes:', {
      'Left ch 440Hz (remote tone)': left440,
      'Left ch 880Hz (crosstalk)': left880,
      'Right ch 880Hz (local tone)': right880,
      'Right ch 440Hz (crosstalk)': right440
    });

    // 7. Assertions: each channel carries its own tone, with minimal bleed from the other
    expect(left440).toBeGreaterThan(0.01);   // Remote tone present on left channel
    expect(right880).toBeGreaterThan(0.01);  // Local tone present on right channel

    // The tone should dominate its own channel versus the other channel's tone
    expect(left440).toBeGreaterThan(left880 * 4);
    expect(right880).toBeGreaterThan(right440 * 4);
  });
});
