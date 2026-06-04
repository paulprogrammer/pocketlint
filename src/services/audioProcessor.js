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

  async normalizeAndTagRecording(tempWavPath, finalMp3Path, speakerName) {
    console.log(`[AudioProcessor] Starting channel checks for silence: ${tempWavPath}`);
    const leftStats = await this.analyzeLoudness(tempWavPath, 'left');
    const rightStats = await this.analyzeLoudness(tempWavPath, 'right');
    
    const leftLoudness = parseFloat(leftStats.input_i);
    const rightLoudness = parseFloat(rightStats.input_i);
    console.log(`[AudioProcessor] Channel integrated loudness: left=${leftLoudness} LUFS, right=${rightLoudness} LUFS`);

    const SILENCE_THRESHOLD = -45.0;
    const isLeftSilent = leftLoudness <= SILENCE_THRESHOLD;
    const isRightSilent = rightLoudness <= SILENCE_THRESHOLD;
    const skipLoudness = isLeftSilent || isRightSilent;

    return new Promise(async (resolve, reject) => {
      let filterComplex;
      if (skipLoudness) {
        console.log(`[AudioProcessor] One or both streams are silent (left: ${leftLoudness} LUFS, right: ${rightLoudness} LUFS). Skipping loudness normalization.`);
        filterComplex = `[0:a]pan=mono|c0=0.5*c0+0.5*c1[mixed]; [mixed]afftdn[out]`;
      } else {
        const stats = await this.analyzeLoudness(tempWavPath);
        filterComplex = `[0:a]pan=mono|c0=0.5*c0+0.5*c1[mixed]; [mixed]afftdn[denoised]; ` +
          `[denoised]loudnorm=I=-16:TP=-1.5:LRA=11:` +
          `measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:` +
          `measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:` +
          `offset=${stats.target_offset}[out]`;
      }
      
      const args = [
        '-threads', '1',
        '-y',
        '-i', tempWavPath,
        '-filter_complex', filterComplex,
        '-map', '[out]',
        '-metadata', `title=${speakerName || 'Local Speaker'}`,
        '-c:a', 'libmp3lame',
        '-q:a', '5',
        finalMp3Path
      ];
      
      console.log(`[AudioProcessor] Rendering MP3 package: ${finalMp3Path}`);
      this.shell.execFileWithCallback('ffmpeg', args, (error, stdout, stderr) => {
        if (error) {
          console.error('[AudioProcessor] FFmpeg rendering error:', stderr || error.message);
          return reject(error);
        }
        
        try {
          if (this.fs.existsSync(finalMp3Path)) {
            console.log(`[AudioProcessor] Successfully created mono MP3 at ${finalMp3Path}`);
            // Clean up temp WAV
            if (this.fs.existsSync(tempWavPath)) {
              this.fs.unlinkSync(tempWavPath);
              console.log(`[AudioProcessor] Cleaned up temporary WAV file: ${tempWavPath}`);
            }
            resolve();
          } else {
            reject(new Error('MP3 output file was not created by FFmpeg'));
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
