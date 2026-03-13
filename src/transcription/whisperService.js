/**
 * Whisper.cpp Transcription Service
 *
 * Spawns whisper.cpp as a child process for local audio transcription.
 * Handles binary/model auto-download, MP3→WAV conversion via ffmpeg,
 * and produces plain text + timestamped output files.
 */

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { spawn } = require('child_process');
const { app } = require('electron');
const https = require('https');
const http = require('http');

const WHISPER_RELEASE_URL = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.3/whisper-cublas-12.4.0-bin-x64.zip';
const WHISPER_BUILD_VARIANT = 'cublas-12.4.0';
const WHISPER_BUILD_VERSION = 'v1.8.3';
const BUILD_INFO_FILE = 'whisper-build-info.json';
const HUGGINGFACE_MODEL_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

const MODEL_FILES = {
  tiny: 'ggml-tiny.bin',
  base: 'ggml-base.bin',
  small: 'ggml-small.bin',
  medium: 'ggml-medium.bin',
  'large-v3': 'ggml-large-v3.bin'
};

let activeProcess = null;
let cancelled = false;

/**
 * Get the whisper data directory inside userData
 */
function getWhisperDir() {
  return path.join(app.getPath('userData'), 'whisper');
}

/**
 * Get the default path to whisper-cli.exe
 */
function getDefaultBinaryPath() {
  return path.join(getWhisperDir(), 'whisper-whisper-cli.exe');
}

/**
 * Get the default model directory
 */
function getModelsDir() {
  return path.join(getWhisperDir(), 'models');
}

/**
 * Validate that whisper binary and model exist
 * @param {Object} config - transcription config from configService
 * @returns {{ ready: boolean, binaryExists: boolean, modelExists: boolean, binaryPath: string, modelPath: string }}
 */
async function validate(config = {}) {
  let binaryPath = config.whisperPath || '';
  const modelName = config.modelName || 'medium';
  const modelPath = config.modelPath || path.join(getModelsDir(), MODEL_FILES[modelName] || `ggml-${modelName}.bin`);

  let binaryExists = false;
  let needsRedownload = false;
  let modelExists = false;

  // If no custom path configured, search for the binary in the whisper directory
  if (!binaryPath) {
    const whisperDir = getWhisperDir();
    try {
      const found = await findExecutable(whisperDir);
      if (found) {
        binaryPath = found;
        binaryExists = true;

        // Check if installed build matches expected CUDA variant
        const buildInfoPath = path.join(whisperDir, BUILD_INFO_FILE);
        try {
          const infoRaw = await fs.readFile(buildInfoPath, 'utf-8');
          const info = JSON.parse(infoRaw);
          if (info.variant !== WHISPER_BUILD_VARIANT) {
            console.log('[WhisperService] Build variant mismatch: installed=', info.variant, 'expected=', WHISPER_BUILD_VARIANT);
            needsRedownload = true;
            binaryExists = false;
          }
        } catch {
          // No build info file = old CPU build, needs re-download
          console.log('[WhisperService] No build info found, assuming old CPU build - will re-download CUDA build');
          needsRedownload = true;
          binaryExists = false;
        }
      }
    } catch {}
  } else {
    try {
      await fs.access(binaryPath);
      binaryExists = true;
    } catch {}
  }

  try {
    await fs.access(modelPath);
    modelExists = true;
  } catch {}

  return {
    ready: binaryExists && modelExists,
    binaryExists,
    needsRedownload,
    modelExists,
    binaryPath,
    modelPath
  };
}

/**
 * Download a file with progress reporting, following redirects
 * @param {string} url - URL to download
 * @param {string} destPath - Local destination path
 * @param {Function} onProgress - Progress callback ({ percent, downloaded, total })
 */
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;

    const request = proto.get(url, { headers: { 'User-Agent': 'AzureWikiEdit/1.0' } }, (response) => {
      // Follow redirects (301, 302, 303, 307, 308)
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const redirectUrl = response.headers.location;
        response.resume(); // consume response to free up memory
        return downloadFile(redirectUrl, destPath, onProgress).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`Download failed: HTTP ${response.statusCode}`));
      }

      const totalBytes = parseInt(response.headers['content-length'], 10) || 0;
      let downloaded = 0;

      const fileStream = fsSync.createWriteStream(destPath);
      response.on('data', (chunk) => {
        downloaded += chunk.length;
        if (onProgress && totalBytes > 0) {
          onProgress({
            percent: Math.round((downloaded / totalBytes) * 100),
            downloaded,
            total: totalBytes
          });
        }
      });

      response.pipe(fileStream);
      fileStream.on('finish', () => fileStream.close(resolve));
      fileStream.on('error', (err) => {
        fsSync.unlink(destPath, () => {});
        reject(err);
      });
    });

    request.on('error', reject);
    request.setTimeout(30000, () => {
      request.destroy();
      reject(new Error('Download timed out'));
    });
  });
}

/**
 * Extract a zip file (using PowerShell on Windows)
 * @param {string} zipPath - Path to the zip file
 * @param {string} destDir - Destination directory
 */
function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell', [
      '-NoProfile', '-Command',
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`
    ]);

    let stderr = '';
    ps.stderr.on('data', (data) => { stderr += data.toString(); });
    ps.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Zip extraction failed (code ${code}): ${stderr}`));
    });
    ps.on('error', reject);
  });
}

/**
 * Download and extract whisper.cpp binary
 * @param {Function} onProgress - Progress callback
 */
async function downloadBinary(onProgress) {
  const whisperDir = getWhisperDir();

  // Clear old binaries if present (e.g. switching from CPU to CUDA build)
  try {
    const existing = await fs.readdir(whisperDir);
    for (const entry of existing) {
      if (entry === 'models') continue; // preserve downloaded models
      const fullPath = path.join(whisperDir, entry);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        await fs.rm(fullPath, { recursive: true, force: true });
      } else {
        await fs.unlink(fullPath);
      }
    }
  } catch {
    // Directory may not exist yet
  }

  await fs.mkdir(whisperDir, { recursive: true });

  const zipPath = path.join(whisperDir, 'whisper-cublas-bin-x64.zip');

  if (onProgress) onProgress({ stage: 'downloading-binary', percent: 0 });
  await downloadFile(WHISPER_RELEASE_URL, zipPath, (p) => {
    if (onProgress) onProgress({ stage: 'downloading-binary', ...p });
  });

  if (onProgress) onProgress({ stage: 'extracting-binary', percent: 0 });
  await extractZip(zipPath, whisperDir);

  // Clean up zip
  try { await fs.unlink(zipPath); } catch {}

  // Find the real binary in extracted files (may be in a subdirectory like Release/)
  const foundExe = await findExecutable(whisperDir);
  if (!foundExe) {
    throw new Error('whisper executable not found in downloaded archive. Please download manually and configure the path in Settings.');
  }

  // Write build info so we can detect variant changes later
  const buildInfoPath = path.join(whisperDir, BUILD_INFO_FILE);
  await fs.writeFile(buildInfoPath, JSON.stringify({
    variant: WHISPER_BUILD_VARIANT,
    version: WHISPER_BUILD_VERSION
  }, null, 2), 'utf-8');

  console.log('[WhisperService] Found whisper binary at:', foundExe, '(CUDA build:', WHISPER_BUILD_VARIANT, ')');
  return foundExe;
}

/**
 * Recursively collect all .exe files in a directory
 */
async function collectExeFiles(dir) {
  const results = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await collectExeFiles(fullPath);
      results.push(...sub);
    } else if (entry.name.toLowerCase().endsWith('.exe')) {
      results.push({ name: entry.name.toLowerCase(), path: fullPath });
    }
  }
  return results;
}

/**
 * Find the real whisper executable (not the deprecation wrapper).
 * The release zip extracts into a subdirectory (e.g. Release/) containing the real
 * binaries alongside their DLLs. Root-level exes are deprecation wrappers.
 * We prefer binaries found next to whisper.dll (the real ones).
 */
async function findExecutable(dir) {
  const exeFiles = await collectExeFiles(dir);
  const names = ['whisper-cli.exe', 'whisper-whisper-cli.exe', 'main.exe', 'whisper.exe'];

  // Prefer binaries that are next to whisper.dll (= real binaries, not deprecation wrappers)
  const hasDll = exeFiles.some(f => f.name === 'whisper.dll');
  for (const name of names) {
    // First pass: look for binaries in subdirectories (where DLLs live)
    const match = exeFiles.find(f => f.name === name && path.dirname(f.path) !== dir);
    if (match) return match.path;
  }
  // Second pass: look anywhere (fallback for flat extraction)
  for (const name of names) {
    const match = exeFiles.find(f => f.name === name);
    if (match) return match.path;
  }
  return null;
}

/**
 * Download a GGML model from HuggingFace
 * @param {string} modelName - Model name (tiny, base, small, medium, large-v3)
 * @param {Function} onProgress - Progress callback
 */
async function downloadModel(modelName = 'medium', onProgress) {
  const modelsDir = getModelsDir();
  await fs.mkdir(modelsDir, { recursive: true });

  const filename = MODEL_FILES[modelName];
  if (!filename) {
    throw new Error(`Unknown model: ${modelName}. Valid: ${Object.keys(MODEL_FILES).join(', ')}`);
  }

  const modelPath = path.join(modelsDir, filename);

  // Check if already exists
  try {
    await fs.access(modelPath);
    return modelPath; // Already downloaded
  } catch {}

  const url = `${HUGGINGFACE_MODEL_BASE}/${filename}`;

  if (onProgress) onProgress({ stage: 'downloading-model', modelName, percent: 0 });
  await downloadFile(url, modelPath, (p) => {
    if (onProgress) onProgress({ stage: 'downloading-model', modelName, ...p });
  });

  return modelPath;
}

/**
 * Convert audio file to 16-bit 16kHz mono WAV using ffmpeg
 * @param {string} inputPath - Input audio file path
 * @returns {string} Path to the temporary WAV file
 */
async function convertToWav(inputPath) {
  let ffmpegPath;
  try {
    ffmpegPath = require('ffmpeg-static');
  } catch (err) {
    throw new Error('ffmpeg-static not installed. Run: npm install ffmpeg-static');
  }

  const dir = path.dirname(inputPath);
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const wavPath = path.join(dir, `${baseName}_temp_whisper.wav`);

  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-acodec', 'pcm_s16le',
      '-ar', '16000',
      '-ac', '1',
      '-y', // overwrite
      wavPath
    ];

    const proc = spawn(ffmpegPath, args);
    let stderr = '';

    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve(wavPath);
      else reject(new Error(`ffmpeg conversion failed (code ${code}): ${stderr.slice(-500)}`));
    });
    proc.on('error', (err) => reject(new Error(`ffmpeg not found: ${err.message}`)));
  });
}

/**
 * Run whisper.cpp transcription
 * @param {Object} options
 * @param {string} options.filePath - Path to the audio file (MP3, WAV, etc.)
 * @param {Object} options.config - Transcription config from configService
 * @param {Function} options.onProgress - Progress callback ({ percent, stage })
 * @returns {{ success: boolean, textFile: string, timedFile: string, error?: string }}
 */
async function transcribe({ filePath, config = {}, onProgress, onText }) {
  if (activeProcess) {
    return { success: false, error: 'A transcription is already in progress' };
  }

  cancelled = false;
  const ext = path.extname(filePath).toLowerCase();
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath, ext);

  try {
    // Step 1: Validate setup, auto-download if needed
    if (onProgress) onProgress({ stage: 'validating', percent: 0 });
    let status = await validate(config);

    if (!status.binaryExists) {
      if (onProgress) onProgress({ stage: 'downloading-binary', percent: 0 });
      await downloadBinary(onProgress);
      status = await validate(config);
    }

    if (!status.modelExists) {
      if (onProgress) onProgress({ stage: 'downloading-model', percent: 0 });
      await downloadModel(config.modelName || 'medium', onProgress);
      status = await validate(config);
    }

    if (!status.ready) {
      return { success: false, error: 'Whisper binary or model not found after download attempt' };
    }

    if (cancelled) return { success: false, error: 'Cancelled' };

    // Step 2: Convert to WAV if not already WAV
    let wavPath = filePath;
    let needsCleanup = false;

    if (ext !== '.wav') {
      if (onProgress) onProgress({ stage: 'converting', percent: 0 });
      wavPath = await convertToWav(filePath);
      needsCleanup = true;
    }

    if (cancelled) {
      if (needsCleanup) try { await fs.unlink(wavPath); } catch {}
      return { success: false, error: 'Cancelled' };
    }

    // Step 3: Run whisper.cpp
    const outputPrefix = path.join(dir, baseName);
    const language = config.language || 'en';

    if (onProgress) onProgress({ stage: 'transcribing', percent: 0 });

    await runWhisper({
      binaryPath: status.binaryPath,
      modelPath: status.modelPath,
      wavPath,
      outputPrefix,
      language,
      flashAttention: config.flashAttention !== false,
      beamSize: config.beamSize || 1,
      threads: config.threads || 0,
      onProgress,
      onText
    });

    // Step 4: Post-process outputs
    // whisper.cpp with -otxt creates {prefix}.txt
    // whisper.cpp with -oj creates {prefix}.json
    const txtFile = `${outputPrefix}.txt`;
    const jsonFile = `${outputPrefix}.json`;
    const timedFile = path.join(dir, `${baseName}_timed.txt`);

    // Parse JSON output to create timestamped text file
    try {
      const jsonContent = await fs.readFile(jsonFile, 'utf-8');
      const jsonData = JSON.parse(jsonContent);
      const timedLines = formatTimestampedOutput(jsonData);
      await fs.writeFile(timedFile, timedLines, 'utf-8');
    } catch (err) {
      console.warn('[WhisperService] Could not create timed output:', err.message);
    }

    // Clean up JSON file
    try { await fs.unlink(jsonFile); } catch {}

    // Clean up temp WAV
    if (needsCleanup) {
      try { await fs.unlink(wavPath); } catch {}
    }

    return {
      success: true,
      textFile: txtFile,
      timedFile
    };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    activeProcess = null;
  }
}

/**
 * Spawn whisper.cpp process
 */
function runWhisper({ binaryPath, modelPath, wavPath, outputPrefix, language, flashAttention, beamSize, threads, onProgress, onText }) {
  return new Promise((resolve, reject) => {
    const args = [
      '-m', modelPath,
      '-f', wavPath,
      '-otxt',         // plain text output
      '-oj',           // JSON output (for timestamps)
      '-of', outputPrefix,
      '-l', language
    ];

    // Performance flags
    if (flashAttention) {
      args.push('-fa');
    }
    if (beamSize && beamSize > 0) {
      args.push('-bs', String(beamSize));
    }
    if (threads && threads > 0) {
      args.push('-t', String(threads));
    }

    // Set cwd to the binary's directory so it can find companion DLLs (ggml.dll, whisper.dll, etc.)
    const binaryDir = path.dirname(binaryPath);
    console.log('[WhisperService] Spawning:', binaryPath, args.join(' '), 'cwd:', binaryDir);
    const proc = spawn(binaryPath, args, { cwd: binaryDir });
    activeProcess = proc;

    let stderr = '';
    let stdout = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;

      // Parse timestamped text segments from stdout
      if (onText) {
        const lines = text.split('\n');
        for (const line of lines) {
          const segMatch = line.match(/\[(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.*)/);
          if (segMatch) {
            onText({ startTime: segMatch[1], endTime: segMatch[2], text: segMatch[3].trim() });
          }
        }
      }
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;

      // Parse progress from whisper.cpp stderr
      const progressMatch = text.match(/progress\s*=\s*(\d+)%/);
      if (progressMatch && onProgress) {
        onProgress({ stage: 'transcribing', percent: parseInt(progressMatch[1], 10) });
      }

    });

    proc.on('close', (code) => {
      activeProcess = null;
      if (cancelled) {
        reject(new Error('Cancelled'));
      } else if (code === 0) {
        resolve();
      } else {
        const output = (stderr + '\n' + stdout).trim().slice(-500);
        reject(new Error(`whisper.cpp failed (code ${code}): ${output}`));
      }
    });

    proc.on('error', (err) => {
      activeProcess = null;
      reject(new Error(`Failed to start whisper.cpp: ${err.message}`));
    });
  });
}

/**
 * Format JSON output from whisper.cpp into timestamped text
 * @param {Object} jsonData - Parsed JSON from whisper.cpp -oj output
 * @returns {string} Timestamped text in [0.00s -> 10.44s] format
 */
function formatTimestampedOutput(jsonData) {
  const lines = [];

  if (jsonData.transcription) {
    for (const segment of jsonData.transcription) {
      const startTime = formatTimestamp(segment.timestamps?.from || segment.offsets?.from || 0);
      const endTime = formatTimestamp(segment.timestamps?.to || segment.offsets?.to || 0);
      const text = (segment.text || '').trim();
      if (text) {
        lines.push(`[${startTime} -> ${endTime}] ${text}`);
      }
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Format milliseconds or time string to seconds format (e.g., "10.44s")
 */
function formatTimestamp(value) {
  if (typeof value === 'string') {
    // Already formatted like "00:00:10,440" - convert to seconds
    const match = value.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
    if (match) {
      const hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const seconds = parseInt(match[3], 10);
      const ms = parseInt(match[4], 10);
      const totalSeconds = hours * 3600 + minutes * 60 + seconds + ms / 1000;
      return `${totalSeconds.toFixed(2)}s`;
    }
    return value;
  }

  // Numeric value - assume milliseconds
  const seconds = value / 1000;
  return `${seconds.toFixed(2)}s`;
}

/**
 * Cancel active transcription
 */
function cancel() {
  cancelled = true;
  if (activeProcess) {
    try {
      activeProcess.kill('SIGTERM');
    } catch (err) {
      console.warn('[WhisperService] Error killing process:', err.message);
    }
    activeProcess = null;
  }
}

/**
 * Check if a transcription is currently running
 */
function isRunning() {
  return activeProcess !== null;
}

module.exports = {
  validate,
  downloadBinary,
  downloadModel,
  transcribe,
  cancel,
  isRunning
};
