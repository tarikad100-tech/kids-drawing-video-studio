import { useEffect, useMemo, useRef, useState } from "react";
import { startMusic } from "../audio/music";
import { onHandSpritesLoaded } from "../drawing/handSprites";
import type { BackgroundPreset } from "../drawing/background";
import {
  createLessonRenderer,
  type AnimationSettings,
} from "../drawing/lessonFrame";
import type { ColorLayer, DrawingData, DrawingStep } from "../drawing/types";

const LANGUAGE_TAGS: Record<string, string> = {
  English: "en-US",
  French: "fr-FR",
  Arabic: "ar-SA",
  Spanish: "es-ES",
};

const SPEEDS = [0.5, 1, 2] as const;

function findVoice(language: string): SpeechSynthesisVoice | undefined {
  const prefix = (LANGUAGE_TAGS[language] ?? "en-US").slice(0, 2).toLowerCase();

  return window.speechSynthesis
    .getVoices()
    .find((voice) => voice.lang.toLowerCase().startsWith(prefix));
}

function describeNarration(narration: boolean, language: string): string {
  if (!narration) return "";

  if (typeof window.speechSynthesis === "undefined") {
    return "This browser has no speech synthesis, so narration is unavailable.";
  }

  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0 && !findVoice(language)) {
    return `No ${language} voice is installed in this browser. The default voice will be used.`;
  }

  return "";
}

type Props = {
  drawing: DrawingData | null;
  lineArt: HTMLCanvasElement | null;
  maskWidth: number;
  finalImage: HTMLImageElement | null;
  colorLayer: ColorLayer | null;
  steps: DrawingStep[];
  guide: HTMLImageElement | null;
  badgeImage: HTMLImageElement | null;
  ratio: "9:16" | "16:9";
  duration: number;
  animation: AnimationSettings;
  background: BackgroundPreset;
  hidden: ReadonlySet<number>;
  narration: boolean;
  language: string;
  narrationRate: number;
  music: { buffer: AudioBuffer | null; volume: number };
  /** Changing `token` jumps to `step` and starts playing (only that stage if `only`). */
  jump: { step: number; token: number; only: boolean } | null;
};

export function LessonPreview({
  drawing,
  lineArt,
  maskWidth,
  finalImage,
  colorLayer,
  steps,
  guide,
  badgeImage,
  ratio,
  duration,
  animation,
  background,
  hidden,
  narration,
  language,
  narrationRate,
  music,
  jump,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elapsedRef = useRef(0);
  const audioRef = useRef<AudioContext | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [stopAt, setStopAt] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [handledJump, setHandledJump] = useState(0);

  const width = ratio === "9:16" ? 720 : 1280;
  const height = ratio === "9:16" ? 1280 : 720;
  const totalMs = duration * 1000;

  const renderer = useMemo(() => {
    try {
      return createLessonRenderer({
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
        hiddenStrokeIds: hidden,
        totalMs,
      });
    } catch {
      return null;
    }
  }, [
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
    hidden,
    totalMs,
  ]);

  const stepStarts = renderer?.timeline.stepStarts;

  // Jump requests from the stage editor ("Preview from this stage").
  if (jump && jump.token !== handledJump) {
    const startMs = stepStarts?.[jump.step] ?? 0;
    const endMs = stepStarts?.[jump.step + 1];

    setHandledJump(jump.token);
    setElapsed(Math.min(totalMs, startMs + 1));
    setStopAt(jump.only && endMs !== undefined ? endMs : null);
    setPlaying(true);
  }

  const shown = Math.min(elapsed, totalMs);
  const stepIndex = renderer ? renderer.stepAt(shown) : 0;
  const activeStep = steps[stepIndex];

  const [spritesTick, setSpritesTick] = useState(0);
  useEffect(() => onHandSpritesLoaded(() => setSpritesTick((n) => n + 1)), []);

  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!renderer || !ctx) return;

    renderer.drawFrame(ctx, shown);
  }, [renderer, shown, spritesTick]);

  useEffect(() => {
    if (!playing) return;

    let frame = 0;
    let last = performance.now();
    let position = elapsedRef.current;
    const limit = stopAt ?? totalMs;

    const tick = (now: number) => {
      position = Math.min(limit, position + (now - last) * speed);
      last = now;
      setElapsed(position);

      if (position >= limit) {
        setPlaying(false);
        setStopAt(null);
        return;
      }

      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(frame);
  }, [playing, speed, totalMs, stopAt]);

  // Background music in the preview (normal speed only, so it stays in sync).
  useEffect(() => {
    if (!playing || !music.buffer || speed !== 1) return;

    let context = audioRef.current;

    if (!context) {
      try {
        context = new AudioContext();
      } catch {
        return;
      }

      audioRef.current = context;
    }

    const audio = context;
    void audio.resume();

    const playback = startMusic(audio, audio.destination, music.buffer, {
      volume: music.volume * (narration ? 0.45 : 1),
      durationSec: duration,
      offsetSec: elapsedRef.current / 1000,
    });

    return () => playback.stop();
  }, [playing, music.buffer, music.volume, narration, speed, duration]);

  useEffect(
    () => () => {
      void audioRef.current?.close();
      audioRef.current = null;
    },
    [],
  );

  // Optional browser speech. Preview only; it is not recorded into the video.
  useEffect(() => {
    if (!playing || !narration || typeof window.speechSynthesis === "undefined") {
      return;
    }

    const step = steps[stepIndex];
    if (!step) return;

    const utterance = new SpeechSynthesisUtterance(
      `${step.title}. ${step.description}`,
    );
    utterance.lang = LANGUAGE_TAGS[language] ?? "en-US";
    utterance.rate = narrationRate;

    const voice = findVoice(language);
    if (voice) utterance.voice = voice;

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);

    return () => window.speechSynthesis.cancel();
  }, [playing, narration, language, narrationRate, stepIndex, steps]);

  function goToStep(index: number) {
    const clamped = Math.min(Math.max(0, index), steps.length - 1);
    const start = stepStarts?.[clamped] ?? 0;

    setPlaying(false);
    setStopAt(null);
    setElapsed(start + 1);
  }

  function togglePlay() {
    if (playing) {
      setPlaying(false);
      return;
    }

    if (shown >= totalMs) setElapsed(0);
    setStopAt(null);
    setNote(describeNarration(narration, language));
    setPlaying(true);
  }

  const currentStart = stepStarts?.[stepIndex] ?? 0;

  return (
    <div>
      <canvas
        ref={canvasRef}
        className={`lesson-canvas ${ratio === "9:16" ? "canvas-vertical" : "canvas-landscape"}`}
        width={width}
        height={height}
        role="img"
        aria-label={`Lesson preview, stage ${stepIndex + 1} of ${steps.length}`}
      />

      {!renderer ? (
        <p className="error" role="alert">
          The preview could not be created in this browser.
        </p>
      ) : null}

      {!drawing ? (
        <p className="editor-help">
          Upload a drawing to see the strokes being drawn here.
        </p>
      ) : null}

      {activeStep ? (
        <p className="stage-caption">
          Stage {stepIndex + 1} of {steps.length}: {activeStep.title}{" "}
          <small>(editor only, this text is not in the video)</small>
        </p>
      ) : null}

      <div className="lesson-progress-info">
        <label htmlFor="timeline">Lesson timeline</label>
        <span>
          {(shown / 1000).toFixed(1)}s / {duration}s
        </span>
      </div>

      <input
        id="timeline"
        className="slider"
        type="range"
        min={0}
        max={totalMs}
        step={10}
        value={shown}
        onChange={(event) => {
          setPlaying(false);
          setStopAt(null);
          setElapsed(Number(event.target.value));
        }}
      />

      <div className="timeline-chips" role="group" aria-label="Jump to stage">
        {steps.map((step, index) => (
          <button
            key={step.id}
            type="button"
            className={
              index === stepIndex
                ? "timeline-chip selected"
                : index < stepIndex
                  ? "timeline-chip done"
                  : "timeline-chip"
            }
            aria-label={`Go to stage ${index + 1}`}
            aria-current={index === stepIndex ? "step" : undefined}
            onClick={() => goToStep(index)}
          >
            {index + 1}
          </button>
        ))}
      </div>

      <div className="lesson-controls">
        <button
          type="button"
          onClick={() => goToStep(shown - currentStart > 600 ? stepIndex : stepIndex - 1)}
          disabled={stepIndex === 0 && shown - currentStart <= 600}
        >
          ← Previous
        </button>

        <button type="button" className="primary" onClick={togglePlay}>
          {playing ? "Ⅱ Pause" : shown >= totalMs ? "↻ Play again" : "▶ Play preview"}
        </button>

        <button
          type="button"
          onClick={() => goToStep(stepIndex + 1)}
          disabled={stepIndex >= steps.length - 1}
        >
          Next →
        </button>

        <button
          type="button"
          onClick={() => {
            setStopAt(null);
            setElapsed(0);
            setPlaying(true);
          }}
        >
          ⟲ Restart
        </button>

        <label className="speed-label">
          Speed{" "}
          <select
            className="select speed-select"
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
          >
            {SPEEDS.map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </label>
      </div>

      {speed !== 1 && music.buffer ? (
        <p className="editor-help">Music is muted in the preview unless speed is 1×.</p>
      ) : null}

      {note ? (
        <p className="warning-line" role="status">
          {note}
        </p>
      ) : null}
    </div>
  );
}
