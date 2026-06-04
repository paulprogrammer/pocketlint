# PocketLint

PocketLint is an Electron-based desktop application for Linux that manages an audio logical Y-split using PipeWire's virtual loopback devices. It allows you to record system audio while simultaneously routing it to physical outputs (e.g., speakers or headphones). Once recorded, the app post-processes the split channels, mixing them into a single-channel mono MP3 file, and uploads the audio to HeyPocketAI via their public API for transcription and processing.

## Features

- **PipeWire Logical Y-Split Management**: Dynamically creates a virtual null sink (`PocketLoopback`) and loops its monitor output back to your choice of physical playback devices using PipeWire's Pulse compatibility layer.
- **Audio Output Verification**: Includes a "Test Output Sound" function to generate and play a 1-second synthesized tone through the loopback device to confirm physical audio routing before recording.
- **Background Recorder**: Captures raw system audio cleanly to temporary WAV files using native PipeWire tools (`pw-record`).
- **Post-processing Pipeline**: Uses FFmpeg to perform an FFT noise-reduction pass (`afftdn`) on each input stream, downmixes them to mono, and executes a dual-pass loudness normalization (`loudnorm`) before encoding to MP3. If either the microphone or system stream is silent, the loudness normalization is safely skipped to preserve dynamic range.
- **Pocket AI Upload Pipeline**: Connects with the HeyPocketAI API to request pre-signed S3 upload URLs and uploads the completed MP3 recording.
- **Local Persistence & Retry Queue**: Stores all recordings locally in `~/.config/pocketlint` until they are successfully uploaded. Displays status indicators (`Ready to sync`, `Processing`, `Syncing...`, `Synced`, `Failed`) and allows manual retry for failed uploads.

## Prerequisites

Ensure the following tools are installed on your Linux system:
- **PipeWire** (with `pipewire-pulse` compatibility)
- **pactl** (PulseAudio client controller)
- **pw-record** / **pw-play** (native PipeWire capture and playback tools)
- **ffmpeg** (used for generating test tones, noise reduction, loudness normalization, and MP3 encoding)

On Fedora/RHEL:
```bash
sudo dnf install pipewire-utils pulseaudio-utils ffmpeg
```

On Ubuntu/Debian:
```bash
sudo apt install pipewire-utils pulseaudio-utils ffmpeg
```

## Getting Started

1. Clone the repository and navigate to the project directory:
   ```bash
   cd pocketlint
   ```
2. Install the Node.js dependencies:
   ```bash
   pnpm install
   ```
3. Start the application:
   ```bash
   pnpm start
   ```

## Meeting App Setup

To record calls and meetings successfully without creating audio feedback loops or echo:
* **Speaker / Output**: In Zoom, Google Meet, Slack, or other meeting apps, select **`PocketLoopback`** as the speaker output.
* **Microphone / Input**: Select your **Physical Microphone** (do not select `PocketRecordMix` to avoid echo).

## Local Storage Layout

The application saves configuration, the upload queue, and audio files in the Electron application user data folder:
- **Config file**: `~/.config/pocketlint/config.json`
- **Metadata Database**: `~/.config/pocketlint/queue.json`
- **Audio Files**: `~/.config/pocketlint/recordings/` (saved as `.mp3` files after post-processing)
