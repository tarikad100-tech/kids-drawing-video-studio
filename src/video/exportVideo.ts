import { handSpritesReady } from "../drawing/handSprites";
import { startMusic, type MusicPlayback } from "../audio/music";
import { exportOffline } from "./offlineExport";
import type { BackgroundPreset } from "../drawing/background";
import {
  createLessonRenderer,
  type AnimationSettings,
  type FrameStep,
} from "../drawing/lessonFrame";
import type { ColorLayer, DrawingData } from "../drawing/types";

export type ExportQuality = "720" | "1080";

export type VideoOptions = {
  drawing: DrawingData;
  lineArt: HTMLCanvasElement;
  maskWidth: number;
  /** The colored picture shown at the end, if provided. */
  finalImage: HTMLImageElement | null;
  colorLayer: ColorLayer | null;
  steps: readonly FrameStep[];
  /** Original picture, used only when the faint guide is enabled. */
  guide: HTMLImageElement | null;
  /** Profile picture for the channel badge. */
  badgeImage: HTMLImageElement | null;
  duration: number;
  ratio: "9:16" | "16:9";
  quality: ExportQuality;
  animation: AnimationSettings;
  background: BackgroundPreset;
  hiddenStrokeIds: ReadonlySet<number>;
  music: { buffer: AudioBuffer | null; volume: number };
  signal?: AbortSignal;
  /** Real elapsed-time progress of the recording, from 0 to 1. */
  onProgress?: (fraction: number) => void;
};

export type ExportResult = {
  fileName: string;
  sizeBytes: number;
  width: number;
  height: number;
  requestedDurationSeconds: number;
  mimeType: string;
  hasAudio: boolean;
};

const FPS = 30;
const VIDEO_MIME = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
const VIDEO_AUDIO_MIME = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

// Prevents two exports from running at the same time.
let exportInProgress = false;

function wait(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, Math.max(0, ms));
  });
}

function downloadBlob(blob: Blob, fileName: string) {
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = downloadUrl;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 60_000);
}

function pickMimeType(withAudio: boolean): string | null {
  const candidates = withAudio ? VIDEO_AUDIO_MIME : VIDEO_MIME;

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

export async function exportDrawingVideo({
  drawing,
  lineArt,
  maskWidth,
  finalImage,
  colorLayer,
  steps,
  guide,
  badgeImage,
  duration,
  ratio,
  quality,
  animation,
  background,
  hiddenStrokeIds,
  music,
  signal,
  onProgress,
}: VideoOptions): Promise<ExportResult> {
  if (exportInProgress) {
    throw new Error("An export is already running. Please wait for it to finish.");
  }

  await handSpritesReady();

  if (drawing.strokes.length === 0) {
    throw new Error(
      "No drawing outlines were found. Adjust the analysis settings first.",
    );
  }

  if (!steps.length) {
    throw new Error("Add at least one drawing step.");
  }

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Choose a valid video duration.");
  }

  if (typeof MediaRecorder === "undefined") {
    throw new Error("Video recording is not supported by this browser.");
  }

  const long = quality === "1080" ? 1920 : 1280;
  const short = quality === "1080" ? 1080 : 720;
  const width = ratio === "9:16" ? short : long;
  const height = ratio === "9:16" ? long : short;
  const canvas = document.createElement("canvas");

  canvas.width = width;
  canvas.height = height;

  if (typeof canvas.captureStream !== "function") {
    throw new Error("This browser cannot record canvas video. Try Chrome, Edge, or Firefox.");
  }

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create the video canvas.");

  exportInProgress = true;

  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let audioContext: AudioContext | null = null;
  let playback: MusicPlayback | null = null;

  try {
    // Same renderer as the live preview. The frame contains no text.
    const renderer = createLessonRenderer({
      width,
      height,
      steps,
      drawing,
      lineArt,
      maskWidth,
      finalImage,
      colorLayer,
      guide,
      badgeImage,
      animation,
      background,
      hiddenStrokeIds,
      totalMs: duration * 1000,
    });

    // Draw the first frame before capturing so the video never starts blank.
    renderer.drawFrame(context, 0);

    // Preferred path: draw and encode frame by frame, so the video is smooth on any computer.
    const offline = await exportOffline({
      renderer,
      canvas,
      context,
      durationSec: duration,
      bitrate: quality === "1080" ? 8_000_000 : 4_000_000,
      music,
      signal,
      onProgress,
    });

    if (offline) {
      if (offline.blob.size === 0) {
        throw new Error("The export produced no data. Please try again.");
      }

      const offlineName = `drawsy-lesson-${Date.now()}.webm`;
      downloadBlob(offline.blob, offlineName);
      onProgress?.(1);

      return {
        fileName: offlineName,
        sizeBytes: offline.blob.size,
        width,
        height,
        requestedDurationSeconds: duration,
        mimeType: `video/webm; codecs=${offline.codec.toLowerCase()}`,
        hasAudio: offline.hasAudio,
      };
    }

    // Fallback for browsers without WebCodecs: real-time recording.
    const videoStream = canvas.captureStream(FPS);
    const videoTrack = videoStream.getVideoTracks()[0] as
      | CanvasCaptureMediaStreamTrack
      | undefined;

    // Optional music: played into a stream destination that is recorded with the video.
    let audioDestination: MediaStreamAudioDestinationNode | null = null;

    if (music.buffer && typeof AudioContext !== "undefined") {
      try {
        audioContext = new AudioContext();
        await audioContext.resume();

        if (audioContext.state === "running") {
          audioDestination = audioContext.createMediaStreamDestination();
        }
      } catch {
        audioDestination = null;
      }
    }

    const hasAudio = audioDestination !== null;
    const mediaStream = audioDestination
      ? new MediaStream([
          ...videoStream.getVideoTracks(),
          ...audioDestination.stream.getAudioTracks(),
        ])
      : videoStream;
    stream = mediaStream;

    const mimeType = pickMimeType(hasAudio);
    if (!mimeType) {
      throw new Error("This browser does not support WebM video recording.");
    }

    const activeRecorder = new MediaRecorder(mediaStream, {
      mimeType,
      videoBitsPerSecond: quality === "1080" ? 8_000_000 : 4_000_000,
    });
    recorder = activeRecorder;

    const chunks: Blob[] = [];
    const failure: { error: Error | null } = { error: null };

    activeRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    activeRecorder.onerror = (event) => {
      const detail = (event as Event & { error?: DOMException }).error;
      failure.error = new Error(
        detail?.message
          ? `Video recording failed: ${detail.message}`
          : "Video recording failed.",
      );
    };

    const stopped = new Promise<void>((resolve) => {
      activeRecorder.onstop = () => resolve();
    });

    let lastPercent = -1;
    const report = (fraction: number) => {
      const percent = Math.floor(Math.min(1, Math.max(0, fraction)) * 100);

      if (percent !== lastPercent) {
        lastPercent = percent;
        onProgress?.(percent / 100);
      }
    };

    const totalMs = duration * 1000;

    report(0);
    activeRecorder.start(250);

    if (audioContext && audioDestination && music.buffer) {
      playback = startMusic(audioContext, audioDestination, music.buffer, {
        volume: music.volume,
        durationSec: duration,
        offsetSec: 0,
      });
    }

    // Timing follows the real clock, so small delays do not add up.
    // The frame is redrawn on every tick so the recorder keeps receiving frames.
    const startTime = performance.now();
    let frameNumber = 0;

    while (true) {
      if (signal?.aborted) throw new Error("Export cancelled.");
      if (failure.error) throw failure.error;

      if (activeRecorder.state !== "recording") {
        throw new Error("Recording stopped unexpectedly.");
      }

      const elapsed = performance.now() - startTime;
      if (elapsed >= totalMs) break;

      renderer.drawFrame(context, elapsed);
      videoTrack?.requestFrame?.();
      report(elapsed / totalMs);

      // Frames are scheduled on a fixed 30 fps grid, so the time spent drawing a
      // frame is not added to the wait and the video does not slow down.
      frameNumber += 1;
      const nextAt = frameNumber * (1000 / FPS);
      const sinceStart = performance.now() - startTime;

      await wait(Math.min(Math.max(0, nextAt - sinceStart), totalMs - elapsed));
    }

    renderer.drawFrame(context, totalMs);
    videoTrack?.requestFrame?.();
    await wait(100);

    activeRecorder.stop();

    const finished = await Promise.race([
      stopped.then(() => true),
      wait(10_000).then(() => false),
    ]);

    if (!finished) throw new Error("The recorder did not finish in time.");
    if (failure.error) throw failure.error;

    const blob = new Blob(chunks, { type: mimeType.split(";")[0] });

    if (blob.size === 0) {
      throw new Error("The recording produced no data. Please try again or use another browser.");
    }

    const fileName = `drawsy-lesson-${Date.now()}.webm`;
    downloadBlob(blob, fileName);
    report(1);

    return {
      fileName,
      sizeBytes: blob.size,
      width,
      height,
      requestedDurationSeconds: duration,
      mimeType,
      hasAudio,
    };
  } finally {
    // Always clean up, whether the export succeeded, failed or was cancelled.
    playback?.stop();

    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // The recorder was already stopped.
      }
    }

    stream?.getTracks().forEach((track) => track.stop());

    if (audioContext) {
      try {
        await audioContext.close();
      } catch {
        // Already closed.
      }
    }

    exportInProgress = false;
  }
}
