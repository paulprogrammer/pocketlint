const fs = require('fs');

class AudioProcessor {
  constructor(shellClient, fsClient = fs) {
    this.shell = shellClient;
    this.fs = fsClient;
  }

  analyzeLoudness(filePath, channel) {
    return new Promise((resolve) => {
      let filter;
      if (channel === 'left') {
        filter = `[0:a]pan=mono|c0=c0[mono_chan]; [mono_chan]afftdn[denoised]; [denoised]loudnorm=I=-16:TP=-1.5:print_format=json`;
      } else if (channel === 'right') {
        filter = `[0:a]pan=mono|c0=c1[mono_chan]; [mono_chan]afftdn[denoised]; [denoised]loudnorm=I=-16:TP=-1.5:print_format=json`;
      } else {
        filter = `[0:a]pan=mono|c0=0.5*c0+0.5*c1[mixed]; [mixed]afftdn[denoised]; [denoised]loudnorm=I=-16:TP=-1.5:print_format=json`;
      }
      const cmd = `ffmpeg -threads 1 -i "${filePath}" -filter_complex "${filter}" -f null -`;
      
      this.shell.execWithCallback(cmd, (error, stdout, stderr) => {
        const output = stderr || stdout || '';
        
        // Parse the loudnorm JSON measurement block from stderr
        const match = output.match(/\{\s*"input_i"[\s\S]*?\}/);
        if (match) {
          try {
            const stats = JSON.parse(match[0]);
            return resolve(stats);
          } catch (e) {
            console.error(`[AudioProcessor] Failed to parse loudnorm JSON:`, e);
          }
        }
        
        console.warn(`[AudioProcessor] Analysis failed, using fallbacks.`);
        resolve({
          input_i: '-24.0',
          input_tp: '-2.0',
          input_lra: '5.0',
          input_thresh: '-35.0',
          target_offset: '0.0'
        });
      });
    });
  }

  async normalizeAndTagRecording(tempWavPath, finalOutputPath, speakerName) {
    console.log(`[AudioProcessor] Analyzing channels for loudness: ${tempWavPath}`);
    // Left channel = remote/system audio, Right channel = local mic.
    const leftStats = await this.analyzeLoudness(tempWavPath, 'left');
    const rightStats = await this.analyzeLoudness(tempWavPath, 'right');

    const leftLoudness = parseFloat(leftStats.input_i);
    const rightLoudness = parseFloat(rightStats.input_i);
    console.log(`[AudioProcessor] Channel integrated loudness: left/remote=${leftLoudness} LUFS, right/local=${rightLoudness} LUFS`);

    const SILENCE_THRESHOLD = -45.0;
    const isLeftSilent = leftLoudness <= SILENCE_THRESHOLD;
    const isRightSilent = rightLoudness <= SILENCE_THRESHOLD;

    // Build an independent processing chain per channel, then recombine to a
    // stereo file so the remote (system) and local (mic) speakers stay on
    // separate channels instead of being downmixed to mono.
    const buildChain = (srcChannel, label, stats, isSilent, outLabel) => {
      const chain = `[0:a]pan=mono|c0=${srcChannel}[${label}]; [${label}]afftdn`;
      if (isSilent) {
        // Silent channel: denoise only, skip loudnorm so we don't amplify the noise floor.
        console.log(`[AudioProcessor] Channel ${srcChannel} is silent (${stats.input_i} LUFS). Skipping loudness normalization for it.`);
        return `${chain}${outLabel}`;
      }
      return `${chain}[${label}_dn]; [${label}_dn]loudnorm=I=-16:TP=-1.5:LRA=11:` +
        `measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:` +
        `measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:` +
        `offset=${stats.target_offset}${outLabel}`;
    };

    const leftChain = buildChain('c0', 'l', leftStats, isLeftSilent, '[l_out]');
    const rightChain = buildChain('c1', 'r', rightStats, isRightSilent, '[r_out]');

    // Recombine: remote/system -> front-left, local/mic -> front-right.
    const filterComplex = `${leftChain}; ${rightChain}; ` +
      `[l_out][r_out]join=inputs=2:channel_layout=stereo[out]`;

    return new Promise((resolve, reject) => {
      const args = [
        '-threads', '1',
        '-y',
        '-i', tempWavPath,
        '-filter_complex', filterComplex,
        '-map', '[out]',
        '-metadata', `title=${speakerName || 'Local Speaker'}`,
        '-c:a', 'libopus',
        '-b:a', '96k',
        finalOutputPath
      ];

      console.log(`[AudioProcessor] Rendering stereo Ogg/Opus package: ${finalOutputPath}`);
      this.shell.execFileWithCallback('ffmpeg', args, (error, stdout, stderr) => {
        if (error) {
          console.error('[AudioProcessor] FFmpeg rendering error:', stderr || error.message);
          return reject(error);
        }

        try {
          if (this.fs.existsSync(finalOutputPath)) {
            console.log(`[AudioProcessor] Successfully created stereo Ogg/Opus at ${finalOutputPath}`);
            // Clean up temp WAV
            if (this.fs.existsSync(tempWavPath)) {
              this.fs.unlinkSync(tempWavPath);
              console.log(`[AudioProcessor] Cleaned up temporary WAV file: ${tempWavPath}`);
            }
            resolve();
          } else {
            reject(new Error('Ogg/Opus output file was not created by FFmpeg'));
          }
        } catch (err) {
          console.error('[AudioProcessor] Cleanup or validation error:', err);
          reject(err);
        }
      });
    });
  }
}

module.exports = AudioProcessor;
