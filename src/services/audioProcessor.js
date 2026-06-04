const fs = require('fs');

class AudioProcessor {
  constructor(shellClient, fsClient = fs) {
    this.shell = shellClient;
    this.fs = fsClient;
  }

  analyzeLoudness(filePath, channel) {
    return new Promise((resolve) => {
      const inputChan = channel === 'left' ? 'c0' : 'c1';
      const filter = `[0:a]pan=mono|c0=${inputChan}[mono_chan]; [mono_chan]afftdn[denoised]; [denoised]loudnorm=I=-16:TP=-1.5:print_format=json`;
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
            console.error(`[AudioProcessor] Failed to parse loudnorm JSON for channel ${channel}:`, e);
          }
        }
        
        console.warn(`[AudioProcessor] Analysis failed for channel ${channel}, using fallbacks.`);
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
    console.log(`[AudioProcessor] Starting single-pass mono mixdown for: ${tempWavPath}`);

    return new Promise((resolve, reject) => {
      // Downmix stereo to mono, apply noise reduction, and perform loudnorm
      const filterComplex = `[0:a]pan=mono|c0=0.5*c0+0.5*c1[mixed]; [mixed]afftdn[denoised]; [denoised]loudnorm=I=-16:TP=-1.5[out]`;
      
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
