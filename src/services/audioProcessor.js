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
      const cmd = `ffmpeg -i "${filePath}" -filter_complex "${filter}" -f null -`;
      
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

  async normalizeAndTagRecording(tempWavPath, finalM4aPath, speakerName) {
    console.log(`[AudioProcessor] Starting channel analysis for: ${tempWavPath}`);
    const leftStats = await this.analyzeLoudness(tempWavPath, 'left');
    const rightStats = await this.analyzeLoudness(tempWavPath, 'right');
    console.log('[AudioProcessor] Channel analysis complete.', { leftStats, rightStats });

    return new Promise((resolve, reject) => {
      // Split stereo L (system) and R (mic), apply noise reduction (afftdn),
      // perform second-pass linear loudnorm, force mono layout (aac compatibility), and map them to separate tracks with metadata.
      const filterComplex = `[0:a]channelsplit=channel_layout=stereo[left][right]; ` +
        `[left]afftdn[denoised_left]; ` +
        `[denoised_left]loudnorm=I=-16:TP=-1.5:LRA=11:` +
        `measured_I=${leftStats.input_i}:measured_TP=${leftStats.input_tp}:` +
        `measured_LRA=${leftStats.input_lra}:measured_thresh=${leftStats.input_thresh}:` +
        `offset=${leftStats.target_offset},aformat=channel_layouts=mono[nleft]; ` +
        `[right]afftdn[denoised_right]; ` +
        `[denoised_right]loudnorm=I=-16:TP=-1.5:LRA=11:` +
        `measured_I=${rightStats.input_i}:measured_TP=${rightStats.input_tp}:` +
        `measured_LRA=${rightStats.input_lra}:measured_thresh=${rightStats.input_thresh}:` +
        `offset=${rightStats.target_offset},aformat=channel_layouts=mono[nright]`;
      
      const args = [
        '-y',
        '-i', tempWavPath,
        '-filter_complex', filterComplex,
        '-map', '[nleft]',
        '-metadata:s:a:0', 'title=group audio',
        '-map', '[nright]',
        '-metadata:s:a:1', `title=${speakerName || 'Local Speaker'}`,
        '-c:a', 'aac',
        '-b:a', '128k',
        finalM4aPath
      ];
      
      console.log(`[AudioProcessor] Rendering M4A package: ${finalM4aPath}`);
      this.shell.execFileWithCallback('ffmpeg', args, (error, stdout, stderr) => {
        if (error) {
          console.error('[AudioProcessor] FFmpeg rendering error:', stderr || error.message);
          return reject(error);
        }
        
        try {
          if (this.fs.existsSync(finalM4aPath)) {
            console.log(`[AudioProcessor] Successfully created multi-track M4A at ${finalM4aPath}`);
            // Clean up temp WAV
            if (this.fs.existsSync(tempWavPath)) {
              this.fs.unlinkSync(tempWavPath);
              console.log(`[AudioProcessor] Cleaned up temporary WAV file: ${tempWavPath}`);
            }
            resolve();
          } else {
            reject(new Error('M4A output file was not created by FFmpeg'));
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
