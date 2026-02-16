'use client';

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpeg: FFmpeg | null = null;
let ffmpegLoaded = false;

async function getFFmpeg(onProgress?: (p: number) => void) {
  if (!ffmpeg) {
    ffmpeg = new FFmpeg();
    if (onProgress) {
      ffmpeg.on('progress', ({ progress }) => {
        onProgress(Math.max(0, Math.min(1, progress)));
      });
    }
  }

  if (!ffmpegLoaded) {
    // Load ffmpeg core in the browser (from CDN). Versions must match the @ffmpeg/core build.
    const coreBase = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';

    const coreURL = await toBlobURL(`${coreBase}/ffmpeg-core.js`, 'text/javascript');
    const wasmURL = await toBlobURL(`${coreBase}/ffmpeg-core.wasm`, 'application/wasm');

    await ffmpeg.load({ coreURL, wasmURL });
    ffmpegLoaded = true;
  }

  return ffmpeg;
}

export async function exportMp4(opts: {
  images: Blob[];        // ordered frames
  audioBlob?: Blob;      // optional audio (mp3/wav)
  fps: number;
  onProgress?: (p: number) => void;
}): Promise<Blob> {
  const { images, audioBlob, fps, onProgress } = opts;

  const inst = await getFFmpeg(onProgress);

  // Clean any previous run files (best-effort)
  try { await inst.deleteFile('out.mp4'); } catch {}
  try { await inst.deleteFile('audio.mp3'); } catch {}

  // Write frames
  for (let i = 0; i < images.length; i++) {
    const name = `frame_${String(i).padStart(4, '0')}.png`;
    const data = await fetchFile(images[i]);
    await inst.writeFile(name, data);
  }

  // Optional audio
  if (audioBlob) {
    await inst.writeFile('audio.mp3', await fetchFile(audioBlob));
  }

  const inputPattern = 'frame_%04d.png';

  const args: string[] = [
    '-framerate', String(fps),
    '-i', inputPattern,
  ];

  if (audioBlob) {
    args.push('-i', 'audio.mp3', '-shortest');
  }

  args.push(
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-movflags', 'faststart',
    'out.mp4'
  );

  await inst.exec(args);

  const out = await inst.readFile('out.mp4');
  const blob = new Blob([out], { type: 'video/mp4' });

  // Cleanup frames (best-effort)
  for (let i = 0; i < images.length; i++) {
    const name = `frame_${String(i).padStart(4, '0')}.png`;
    try { await inst.deleteFile(name); } catch {}
  }

  return blob;
}
