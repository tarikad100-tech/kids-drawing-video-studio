import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { exportDrawingVideo, type ExportQuality } from "./video/exportVideo";
import { LessonPreview } from "./components/LessonPreview";
import { ProcessingPanel } from "./components/ProcessingPanel";
import { PartsPanel } from "./components/PartsPanel";
import { DEFAULT_LAYOUT, parseLayout, type LayoutPlan } from "./drawing/layout";
import { useImageUrl, useLoadedImage } from "./hooks/useLoadedImage";
import { DEFAULT_PROFILE_PICTURE } from "./branding/defaultProfile";
import { MAX_CAPTION_LENGTH } from "./drawing/captions";
import { createThumbnail, downloadCanvasPng } from "./drawing/thumbnail";
import {
  BADGE_POSITIONS,
  MAX_BADGE_NAME,
  isBadgePosition,
} from "./drawing/badge";
import { useMusicBuffer, type MusicChoice } from "./hooks/useMusicBuffer";
import {
  GENERATED_TRACKS,
  LIBRARY_TRACKS,
  MAX_AUDIO_FILE_BYTES,
  isLibraryTrackId,
} from "./audio/music";
import {
  BACKGROUND_OPTIONS,
  isBackgroundPreset,
  type BackgroundPreset,
} from "./drawing/background";
import {
  defaultProcessingSettings,
  processImage,
} from "./drawing/processImage";
import {
  MAX_STEPS,
  MAX_WEIGHT,
  MIN_STEPS,
  MIN_WEIGHT,
  adjustStepCount,
  buildSteps,
  clearStrokes,
  mergeStep,
  moveStepTo,
  moveStrokeAcross,
  splitStep,
  type StepText,
} from "./drawing/steps";
import { stepDurationsMs } from "./drawing/timeline";
import {
  HAND_OPTIONS,
  TOOL_OPTIONS,
  isHandStyle,
  isToolStyle,
} from "./drawing/pencil";
import type { AnimationSettings } from "./drawing/lessonFrame";
import type {
  DrawingStep,
  ProcessedImage,
  ProcessingSettings,
} from "./drawing/types";
import "./App.css";
import "./studio.css";

type AspectRatio = "9:16" | "16:9";

type ProjectSettings = {
  ratio: AspectRatio;
  narration: boolean;
  language: string;
  narrationRate: number;
  style: string;
  duration: number;
  quality: ExportQuality;
  background: BackgroundPreset;
  music: { track: MusicChoice; volume: number };
  processing: ProcessingSettings;
  animation: AnimationSettings;
  layout: LayoutPlan;
};

type Analysis =
  | {
      status: "ready";
      file: File;
      run: number;
      settings: ProcessingSettings;
      result: ProcessedImage;
    }
  | {
      status: "error";
      file: File;
      run: number;
      settings: ProcessingSettings;
      message: string;
    };

type Snapshot = { steps: DrawingStep[]; hidden: number[] };

const STORAGE_KEY = "drawsy-studio-project-v3";
// Steps are stored under their own key (titles, descriptions and durations only).
const STEPS_STORAGE_KEY = "drawsy-studio-steps-v2";
const DEFAULT_STEP_COUNT = 5;
const HISTORY_LIMIT = 30;
const LANGUAGES = ["English", "French", "Arabic", "Spanish"];
const MUSIC_CHOICES: readonly MusicChoice[] = [
  "none",
  "file",
  ...GENERATED_TRACKS.map(([id]) => id),
  ...LIBRARY_TRACKS.map((track) => track.id),
];

const initialAnimation: AnimationSettings = {
  showPencil: true,
  showGuide: false,
  autoColors: false,
  strokePauseMs: 160,
  tool: "pencil",
  hand: "light",
  showBadge: true,
  badgeName: "Story & Info",
  badgePosition: "top-left",
  showTeaser: true,
  showTitle: true,
  titleText: "Let's draw together!",
  showOutro: true,
  outroText: "Thanks for watching! Subscribe for more drawings",
};

const initialSettings: ProjectSettings = {
  ratio: "9:16",
  narration: false,
  language: "English",
  narrationRate: 1,
  style: "Simple black-and-white line art",
  duration: 45,
  quality: "1080",
  background: "meadow",
  music: { track: "bouncy", volume: 0.5 },
  processing: defaultProcessingSettings,
  animation: initialAnimation,
  layout: DEFAULT_LAYOUT,
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function readNumber(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function readSavedProject(): ProjectSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return initialSettings;

    const parsed = asRecord(JSON.parse(saved));
    const processing = asRecord(parsed.processing);
    const animation = asRecord(parsed.animation);
    const music = asRecord(parsed.music);
    const defaults = defaultProcessingSettings;
    const track = MUSIC_CHOICES.find((choice) => choice === music.track);

    return {
      layout: parseLayout(parsed.layout),
      ratio: parsed.ratio === "16:9" ? "16:9" : "9:16",
      narration: parsed.narration === true,
      language:
        typeof parsed.language === "string" && LANGUAGES.includes(parsed.language)
          ? parsed.language
          : initialSettings.language,
      narrationRate: readNumber(parsed.narrationRate, 0.6, 1.4, 1),
      style:
        typeof parsed.style === "string" ? parsed.style : initialSettings.style,
      duration: readNumber(parsed.duration, 10, 120, initialSettings.duration),
      quality: parsed.quality === "720" ? "720" : "1080",
      background: isBackgroundPreset(parsed.background)
        ? parsed.background
        : initialSettings.background,
      music: {
        track: track ?? initialSettings.music.track,
        volume: readNumber(music.volume, 0, 1, initialSettings.music.volume),
      },
      processing: {
        mode: processing.mode === "line-art" ? "line-art" : "edges",
        contrast: readNumber(processing.contrast, 50, 250, defaults.contrast),
        threshold: readNumber(processing.threshold, 40, 230, defaults.threshold),
        edgeSensitivity: readNumber(
          processing.edgeSensitivity,
          0,
          100,
          defaults.edgeSensitivity,
        ),
        cleanup: readNumber(processing.cleanup, 2, 60, defaults.cleanup),
        flatten: readBoolean(processing.flatten, defaults.flatten),
      },
      animation: {
        showPencil: readBoolean(animation.showPencil, initialAnimation.showPencil),
        showGuide: readBoolean(animation.showGuide, initialAnimation.showGuide),
        autoColors: readBoolean(animation.autoColors, initialAnimation.autoColors),
        strokePauseMs: readNumber(
          animation.strokePauseMs,
          0,
          400,
          initialAnimation.strokePauseMs,
        ),
        tool: isToolStyle(animation.tool) ? animation.tool : initialAnimation.tool,
        hand: isHandStyle(animation.hand) ? animation.hand : initialAnimation.hand,
        showBadge: readBoolean(animation.showBadge, initialAnimation.showBadge),
        badgeName:
          typeof animation.badgeName === "string"
            ? animation.badgeName.slice(0, MAX_BADGE_NAME)
            : initialAnimation.badgeName,
        badgePosition: isBadgePosition(animation.badgePosition)
          ? animation.badgePosition
          : initialAnimation.badgePosition,
        showTeaser: readBoolean(animation.showTeaser, initialAnimation.showTeaser),
        showTitle: readBoolean(animation.showTitle, initialAnimation.showTitle),
        titleText:
          typeof animation.titleText === "string"
            ? animation.titleText.slice(0, MAX_CAPTION_LENGTH)
            : initialAnimation.titleText,
        showOutro: readBoolean(animation.showOutro, initialAnimation.showOutro),
        outroText:
          typeof animation.outroText === "string"
            ? animation.outroText.slice(0, MAX_CAPTION_LENGTH)
            : initialAnimation.outroText,
      },
    };
  } catch {
    return initialSettings;
  }
}

function readSavedStepTexts(): StepText[] | null {
  try {
    const saved = localStorage.getItem(STEPS_STORAGE_KEY);
    if (!saved) return null;

    const parsed: unknown = JSON.parse(saved);

    if (
      !Array.isArray(parsed) ||
      parsed.length < MIN_STEPS ||
      parsed.length > MAX_STEPS
    ) {
      return null;
    }

    const restored: StepText[] = [];

    for (const item of parsed) {
      const { title, description, weight } = asRecord(item);

      if (typeof title !== "string" || typeof description !== "string") {
        return null;
      }

      restored.push({
        title: title.slice(0, 100),
        description: description.slice(0, 500),
        weight: readNumber(weight, MIN_WEIGHT, MAX_WEIGHT, 1),
      });
    }

    return restored;
  } catch {
    return null;
  }
}

function createInitialSteps(): DrawingStep[] {
  const texts = readSavedStepTexts();

  return buildSteps(null, texts ? texts.length : DEFAULT_STEP_COUNT, texts ?? []);
}

const PROFILE_STORAGE_KEY = "drawsy-studio-profile-v1";

function readSavedProfile(): string {
  try {
    const saved = localStorage.getItem(PROFILE_STORAGE_KEY);
    return saved && saved.startsWith("data:image/") ? saved : DEFAULT_PROFILE_PICTURE;
  } catch {
    return DEFAULT_PROFILE_PICTURE;
  }
}

/** Crops the picture to a centered square (never stretched) and shrinks it to 256 px. */
function squareThumbnail(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);

      const side = Math.min(image.naturalWidth, image.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext("2d");

      if (!ctx || side === 0) {
        reject(new Error("The picture could not be read."));
        return;
      }

      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(
        image,
        (image.naturalWidth - side) / 2,
        (image.naturalHeight - side) / 2,
        side,
        side,
        0,
        0,
        256,
        256,
      );
      resolve(canvas.toDataURL("image/png"));
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The picture could not be read."));
    };

    image.src = url;
  });
}

function isStorageAvailable(): boolean {
  try {
    const probe = "drawsy-storage-probe";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** Returns a message when the image cannot be used, or an empty string. */
function imageProblem(file: File): string {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    return "Please select a PNG, JPG, or WebP image.";
  }

  if (file.size > 15 * 1024 * 1024) {
    return "Image size must be under 15 MB.";
  }

  return "";
}

function LocalImagePreview({ file }: { file: File }) {
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const image = imageRef.current;

    if (image) image.src = url;

    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <img ref={imageRef} alt="Selected drawing reference" className="reference-image" />
  );
}

function App() {
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const exportAbort = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const coloredInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [coloredFile, setColoredFile] = useState<File | null>(null);
  const [coloredError, setColoredError] = useState("");
  const [musicFile, setMusicFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [musicError, setMusicError] = useState("");
  const [settings, setSettings] = useState<ProjectSettings>(readSavedProject);
  const [steps, setSteps] = useState<DrawingStep[]>(createInitialSteps);
  const [hidden, setHidden] = useState<number[]>([]);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [selectedStep, setSelectedStep] = useState(0);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisRun, setAnalysisRun] = useState(0);
  const [jump, setJump] = useState<{
    step: number;
    token: number;
    only: boolean;
  } | null>(null);
  const [storageAvailable] = useState(isStorageAvailable);

  const guideImage = useLoadedImage(file);
  const finalImage = useLoadedImage(coloredFile);
  const [profileSrc, setProfileSrc] = useState<string>(readSavedProfile);
  const [profileError, setProfileError] = useState("");
  const profileInputRef = useRef<HTMLInputElement>(null);
  const badgeImage = useImageUrl(profileSrc);
  const music = useMusicBuffer(settings.music.track, musicFile);
  const processingSettings = settings.processing;
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const layoutRef = useRef<LayoutPlan>(settings.layout);

  // Analysis for the current file only; the last result stays visible while a new one is computed.
  const analysisForFile = analysis && analysis.file === file ? analysis : null;
  const result =
    analysisForFile?.status === "ready" ? analysisForFile.result : null;
  const analysisError =
    analysisForFile?.status === "error" ? analysisForFile.message : "";
  const isProcessing =
    file !== null &&
    (analysisForFile === null ||
      analysisForFile.settings !== processingSettings ||
      analysisForFile.run !== analysisRun);
  const drawing = result ? result.drawing : null;
  const colorLayer = result ? result.colorLayer : null;
  const lineArt = result ? result.lineArt : null;
  const maskWidth = result ? result.maskWidth : 3;
  const strokeCount = drawing ? drawing.strokes.length - hidden.length : 0;
  const hasColorRegions = colorLayer !== null && colorLayer.regionCount > 0;
  // A colored image wins; otherwise the experimental auto colors, if enabled and possible.
  const hasFinal =
    coloredFile !== null || (settings.animation.autoColors && hasColorRegions);
  const animation = settings.animation;

  const stageMs = useMemo(
    () => stepDurationsMs(steps, settings.duration * 1000, hasFinal),
    [steps, settings.duration, hasFinal],
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Storage can be full or blocked; the app keeps working without it.
    }
  }, [settings]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STEPS_STORAGE_KEY,
        JSON.stringify(
          steps.map(({ id, title, description, weight }) => ({
            id,
            title,
            description,
            weight,
          })),
        ),
      );
    } catch {
      // Storage can be full or blocked; the app keeps working without it.
    }
  }, [steps]);

  // Local image analysis, debounced so dragging a slider does not run it on every tick.
  useEffect(() => {
    if (!file) return;

    let cancelled = false;

    const timer = window.setTimeout(() => {
      processImage(file, processingSettings)
        .then((processed) => {
          if (cancelled) return;

          setAnalysis({
            status: "ready",
            file,
            run: analysisRun,
            settings: processingSettings,
            result: processed,
          });
          setSteps((current) =>
            buildSteps(processed.drawing, current.length, current, layoutRef.current),
          );
          setHidden([]);
          setHistory([]);
          setFuture([]);
        })
        .catch((failure: unknown) => {
          if (cancelled) return;

          setAnalysis({
            status: "error",
            file,
            run: analysisRun,
            settings: processingSettings,
            message:
              failure instanceof Error
                ? failure.message
                : "The image could not be analyzed.",
          });
          setSteps((current) => clearStrokes(current));
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [file, processingSettings, analysisRun]);

  useEffect(
    () => () => {
      exportAbort.current?.abort();
    },
    [],
  );

  function updateSettings(patch: Partial<ProjectSettings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  function updateProcessing(patch: Partial<ProcessingSettings>) {
    setSettings((current) => ({
      ...current,
      processing: { ...current.processing, ...patch },
    }));
  }

  function updateAnimation(patch: Partial<AnimationSettings>) {
    setSettings((current) => ({
      ...current,
      animation: { ...current.animation, ...patch },
    }));
  }

  function chooseFile(next?: File) {
    setError("");
    if (!next) return;

    const problem = imageProblem(next);

    if (problem) {
      setError(problem);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setFile(next);
  }

  function chooseColored(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0];
    setColoredError("");

    if (next) {
      const problem = imageProblem(next);

      if (problem) setColoredError(problem);
      else setColoredFile(next);
    }

    event.target.value = "";
  }

  function removeColored() {
    setColoredFile(null);
    setColoredError("");
  }

  function removeFile() {
    setFile(null);
    setAnalysis(null);
    setSteps((current) => clearStrokes(current));
    setHidden([]);
    setHistory([]);
    setFuture([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function chooseMusic(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0];
    setMusicError("");
    if (!next) return;

    if (!next.type.startsWith("audio/")) {
      setMusicError("Please choose an audio file (MP3, WAV, OGG, or M4A).");
    } else if (next.size > MAX_AUDIO_FILE_BYTES) {
      setMusicError("Audio files must be under 25 MB.");
    } else {
      setMusicFile(next);
      setSettings((current) => ({
        ...current,
        music: { ...current.music, track: "file" },
      }));
    }

    event.target.value = "";
  }

  /** Structural edits go through here so they can be undone and redone. */
  function commit(next: Snapshot) {
    setHistory((current) => [...current.slice(-(HISTORY_LIMIT - 1)), { steps, hidden }]);
    setFuture([]);
    setSteps(next.steps);
    setHidden(next.hidden);
  }

  function undo() {
    const previous = history[history.length - 1];
    if (!previous) return;

    setFuture((current) => [{ steps, hidden }, ...current]);
    setHistory((current) => current.slice(0, -1));
    setSteps(previous.steps);
    setHidden(previous.hidden);
    setSelectedStep((current) => Math.min(current, previous.steps.length - 1));
  }

  function redo() {
    const next = future[0];
    if (!next) return;

    setHistory((current) => [...current, { steps, hidden }]);
    setFuture((current) => current.slice(1));
    setSteps(next.steps);
    setHidden(next.hidden);
    setSelectedStep((current) => Math.min(current, next.steps.length - 1));
  }

  function changeLayout(next: LayoutPlan) {
    layoutRef.current = next;
    setSettings((current) => ({ ...current, layout: next }));

    if (drawing) {
      commit({ steps: buildSteps(drawing, steps.length, steps, next), hidden });
      setSelectedStep(0);
    }
  }

  function resetSteps() {
    commit({ steps: buildSteps(drawing, steps.length, steps, settings.layout), hidden });
    setSelectedStep(0);
  }

  function toggleStroke(id: number) {
    commit({
      steps,
      hidden: hidden.includes(id)
        ? hidden.filter((value) => value !== id)
        : [...hidden, id],
    });
  }

  function changeStepCount(count: number) {
    const next = adjustStepCount(steps, count);

    commit({ steps: next, hidden });
    setSelectedStep((current) => Math.min(current, next.length - 1));
  }

  function updateStep(id: number, patch: Partial<DrawingStep>) {
    setSteps((current) =>
      current.map((step) => (step.id === id ? { ...step, ...patch } : step)),
    );
  }

  function addStep() {
    if (steps.length >= MAX_STEPS) return;

    commit({ steps: splitStep(steps, selectedStep), hidden });
    setSelectedStep(selectedStep + 1);
  }

  function removeStep() {
    if (steps.length <= MIN_STEPS) return;

    commit({ steps: mergeStep(steps, selectedStep), hidden });
    setSelectedStep(Math.max(0, selectedStep - 1));
  }

  function moveStep(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;

    commit({ steps: moveStepTo(steps, index, target), hidden });
    setSelectedStep(target);
  }

  function moveStroke(direction: -1 | 1) {
    commit({ steps: moveStrokeAcross(steps, selectedStep, direction), hidden });
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    chooseFile(event.dataTransfer.files[0]);
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0]);
  }

  async function chooseProfile(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    event.target.value = "";
    if (!picked) return;

    const problem = imageProblem(picked);
    if (problem) {
      setProfileError(problem);
      return;
    }

    try {
      const thumbnail = await squareThumbnail(picked);
      setProfileSrc(thumbnail);
      setProfileError("");

      try {
        localStorage.setItem(PROFILE_STORAGE_KEY, thumbnail);
      } catch {
        // The picture still works for this session.
      }
    } catch (failure) {
      setProfileError(
        failure instanceof Error ? failure.message : "The picture could not be used.",
      );
    }
  }

  function resetProfile() {
    setProfileSrc(DEFAULT_PROFILE_PICTURE);
    setProfileError("");

    try {
      localStorage.removeItem(PROFILE_STORAGE_KEY);
    } catch {
      // Nothing was saved.
    }
  }

  async function handleThumbnail() {
    const picture = finalImage ?? lineArt;
    if (!picture) return;

    try {
      const canvas = createThumbnail({
        picture,
        pictureWidth: finalImage ? finalImage.naturalWidth : picture.width,
        pictureHeight: finalImage ? finalImage.naturalHeight : picture.height,
        background: settings.background,
        title: animation.showTitle ? animation.titleText : "",
        showBadge: animation.showBadge,
        badgeName: animation.badgeName,
        badgeImage,
        badgePosition: animation.badgePosition,
      });

      await downloadCanvasPng(canvas, `drawsy-thumbnail-${Date.now()}.png`);
      setExportMessage("Thumbnail saved (1280×720 PNG). Check your downloads.");
    } catch (failure) {
      setExportMessage(
        failure instanceof Error ? failure.message : "The thumbnail could not be created.",
      );
    }
  }

  async function handleExport() {
    if (!drawing || !lineArt || isExporting) return;

    const controller = new AbortController();
    exportAbort.current = controller;
    setIsExporting(true);
    setExportMessage("Preparing your video. Keep this tab open and visible until it finishes.");

    try {
      const exported = await exportDrawingVideo({
        drawing,
        lineArt,
        maskWidth,
        finalImage,
        colorLayer,
        steps,
        guide: guideImage,
        badgeImage,
        duration: settings.duration,
        ratio: settings.ratio,
        quality: settings.quality,
        animation,
        background: settings.background,
        hiddenStrokeIds: hiddenSet,
        music: { buffer: music.buffer, volume: settings.music.volume },
        signal: controller.signal,
        onProgress: (fraction) =>
          setExportMessage(`Recording your video... ${Math.round(fraction * 100)}%`),
      });

      const sizeMb = (exported.sizeBytes / (1024 * 1024)).toFixed(1);
      const audioNote = exported.hasAudio
        ? "Background music is included."
        : music.buffer
          ? "The browser could not record audio, so this video has no music."
          : "No music was selected.";

      setExportMessage(
        `Video created as WebM (${exported.width}×${exported.height}, ${sizeMb} MB). ${audioNote} Narration is never included in the file. Check your downloads.`,
      );
    } catch (failure) {
      setExportMessage(
        failure instanceof Error ? failure.message : "Video export failed.",
      );
    } finally {
      exportAbort.current = null;
      setIsExporting(false);
    }
  }

  const activeStep = steps[selectedStep];
  const reached = [true, drawing !== null, drawing !== null, drawing !== null, drawing !== null];
  const musicWaiting = settings.music.track !== "none" && music.status === "loading";
  const missingMusicFile = settings.music.track === "file" && musicFile === null;

  return (
    <main className="studio">
      <header className="header">
        <div className="logo">✎</div>
        <div>
          <strong>Drawsy Studio</strong>
          <p>Kids Drawing Video Studio</p>
        </div>
        <span className="privacy">● Private & local</span>
      </header>

      <section className="hero">
        <span className="eyebrow">YOUR CREATIVE WORKSPACE</span>
        <h1>
          Turn a simple picture into a <span>drawing lesson.</span>
        </h1>
        <p>
          Prepare a friendly, step-by-step drawing video for young artists aged
          7–10. The video has no text on screen: just the pencil, the drawing,
          and a colorful finish.
        </p>
      </section>

      <section className="workflow">
        {["Upload Image", "Analyze Drawing", "Edit Stages", "Preview", "Export"].map(
          (item, index) => (
            <div
              className={reached[index] ? "workflow-item active" : "workflow-item"}
              key={item}
            >
              <b>{String(index + 1).padStart(2, "0")}</b>
              <span>{item}</span>
            </div>
          ),
        )}
      </section>

      <div className="columns">
        <section className="panel">
          <h2>① Add your reference</h2>
          <p>Upload a picture you want to teach children to draw.</p>

          {!file ? (
            <div
              className="dropzone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  inputRef.current?.click();
                }
              }}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                hidden
                onChange={handleInputChange}
              />
              <div className="upload-icon">↑</div>
              <h3>Drop your image here</h3>
              <p>or click to browse files</p>
              <small>PNG · JPG · WEBP · MAX 15 MB</small>
              <button
                type="button"
                className="primary"
                onClick={(event) => {
                  event.stopPropagation();
                  inputRef.current?.click();
                }}
              >
                Choose an image ↗
              </button>
            </div>
          ) : (
            <div className="preview-area">
              <LocalImagePreview file={file} />
              <p className="filename">{file.name}</p>
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  onClick={() => inputRef.current?.click()}
                >
                  Replace image
                </button>
                <button type="button" onClick={removeFile}>
                  Remove
                </button>
              </div>
              <input
                ref={inputRef}
                hidden
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleInputChange}
              />
            </div>
          )}

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          <div className="colored-slot">
            <strong>Colored version (optional)</strong>
            <p className="editor-help">
              Upload the same drawing in color. It appears at the end of the
              video, after the black-and-white lines are drawn. Use the same
              picture so the two match.
            </p>
            {coloredFile ? (
              <div className="colored-preview">
                <LocalImagePreview file={coloredFile} />
                <p className="filename">{coloredFile.name}</p>
                <div className="actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => coloredInputRef.current?.click()}
                  >
                    Replace
                  </button>
                  <button type="button" onClick={removeColored}>
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="ghost-button"
                onClick={() => coloredInputRef.current?.click()}
              >
                Choose the colored image ↗
              </button>
            )}
            <input
              ref={coloredInputRef}
              hidden
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={chooseColored}
            />
            {coloredError ? (
              <p className="error" role="alert">
                {coloredError}
              </p>
            ) : null}
          </div>

          <div className="notice">
            🔒 Your image stays in this browser. It is not uploaded to a server.
          </div>
        </section>

        <section className="panel">
          <h2>⚙ Project settings</h2>
          <p>Customize the lesson for your young artists.</p>

          <label>Video format</label>
          <div className="ratio-buttons">
            <button
              type="button"
              className={settings.ratio === "9:16" ? "ratio selected" : "ratio"}
              onClick={() => updateSettings({ ratio: "9:16" })}
            >
              ▯ Vertical <small>9:16 · Reels & Shorts</small>
            </button>
            <button
              type="button"
              className={settings.ratio === "16:9" ? "ratio selected" : "ratio"}
              onClick={() => updateSettings({ ratio: "16:9" })}
            >
              ▭ Landscape <small>16:9 · YouTube</small>
            </button>
          </div>

          <div className="settings-row">
            <div>
              <label htmlFor="duration">Duration</label>
              <select
                id="duration"
                className="select"
                value={settings.duration}
                onChange={(event) =>
                  updateSettings({ duration: Number(event.target.value) })
                }
              >
                <option value={15}>15 seconds</option>
                <option value={30}>30 seconds</option>
                <option value={45}>45 seconds</option>
                <option value={60}>60 seconds</option>
                <option value={90}>90 seconds</option>
                <option value={120}>120 seconds</option>
              </select>
            </div>
            <div>
              <label htmlFor="quality">Export resolution</label>
              <select
                id="quality"
                className="select"
                value={settings.quality}
                onChange={(event) =>
                  updateSettings({
                    quality: event.target.value === "720" ? "720" : "1080",
                  })
                }
              >
                <option value="1080">
                  {settings.ratio === "9:16" ? "1080 × 1920" : "1920 × 1080"}
                </option>
                <option value="720">
                  {settings.ratio === "9:16" ? "720 × 1280 (lighter)" : "1280 × 720 (lighter)"}
                </option>
              </select>
            </div>
          </div>

          <label htmlFor="background">Video background</label>
          <select
            id="background"
            className="select"
            value={settings.background}
            onChange={(event) => {
              const value = event.target.value;
              if (isBackgroundPreset(value)) updateSettings({ background: value });
            }}
          >
            {BACKGROUND_OPTIONS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>

          <label htmlFor="style">Drawing style</label>
          <select
            id="style"
            className="select"
            value={settings.style}
            onChange={(event) => updateSettings({ style: event.target.value })}
          >
            <option>Simple black-and-white line art</option>
            <option>Simple outline</option>
            <option>Bold cartoon outline</option>
          </select>
          <p className="editor-help">
            The style label is a note for your project. It does not change how
            lines are detected; use the analysis settings for that.
          </p>

          <div className="steps-heading">
            <label htmlFor="steps">Number of drawing stages</label>
            <b>{steps.length} stages</b>
          </div>
          <input
            id="steps"
            className="slider"
            type="range"
            min={MIN_STEPS}
            max={MAX_STEPS}
            value={steps.length}
            onChange={(event) => changeStepCount(Number(event.target.value))}
          />
          <div className="range-labels">
            <span>{MIN_STEPS} · Simple</span>
            <span>{MAX_STEPS} · Detailed</span>
          </div>

          <div className="settings-row">
            <div>
              <label htmlFor="tool">Drawing tool</label>
              <select
                id="tool"
                className="select"
                value={settings.animation.tool}
                onChange={(event) => {
                  const value = event.target.value;
                  if (isToolStyle(value)) updateAnimation({ tool: value });
                }}
              >
                {TOOL_OPTIONS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="hand">Hand holding the tool</label>
              <select
                id="hand"
                className="select"
                value={settings.animation.hand}
                onChange={(event) => {
                  const value = event.target.value;
                  if (isHandStyle(value)) updateAnimation({ hand: value });
                }}
              >
                {HAND_OPTIONS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="editor-help">
            Lines keep the exact shape and thickness of your picture. The tool
            only follows them.
          </p>

          <div className="steps-heading">
            <label htmlFor="pause">Pause between strokes</label>
            <b>{settings.animation.strokePauseMs} ms</b>
          </div>
          <input
            id="pause"
            className="slider"
            type="range"
            min={0}
            max={400}
            step={20}
            value={settings.animation.strokePauseMs}
            onChange={(event) =>
              updateAnimation({ strokePauseMs: Number(event.target.value) })
            }
          />
          <p className="editor-help">
            Drawing speed follows the duration and each stage's length: a longer
            video draws more slowly.
          </p>

          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.animation.showPencil}
              onChange={(event) =>
                updateAnimation({ showPencil: event.target.checked })
              }
            />
            Show the pencil while drawing
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.animation.autoColors}
              disabled={coloredFile !== null}
              onChange={(event) =>
                updateAnimation({ autoColors: event.target.checked })
              }
            />
            Experimental auto colors (only when no colored image is uploaded)
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.animation.showGuide}
              onChange={(event) =>
                updateAnimation({ showGuide: event.target.checked })
              }
            />
            Show the original as a faint guide
          </label>

          <div className="music-box">
            <strong>Video text (English)</strong>
            <label className="check-row">
              <input
                type="checkbox"
                checked={settings.animation.showTitle}
                onChange={(event) => updateAnimation({ showTitle: event.target.checked })}
              />
              Title at the start
            </label>
            <input
              className="select"
              type="text"
              maxLength={MAX_CAPTION_LENGTH}
              placeholder="How to draw a cute cat"
              aria-label="Video title"
              disabled={!settings.animation.showTitle}
              value={settings.animation.titleText}
              onChange={(event) => updateAnimation({ titleText: event.target.value })}
            />
            <label className="check-row">
              <input
                type="checkbox"
                checked={settings.animation.showTeaser}
                disabled={coloredFile === null}
                onChange={(event) => updateAnimation({ showTeaser: event.target.checked })}
              />
              Show the finished colored picture for a moment at the start
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={settings.animation.showOutro}
                disabled={coloredFile === null}
                onChange={(event) => updateAnimation({ showOutro: event.target.checked })}
              />
              Thank-you message at the end
            </label>
            <input
              className="select"
              type="text"
              maxLength={MAX_CAPTION_LENGTH}
              aria-label="Ending message"
              disabled={!settings.animation.showOutro || coloredFile === null}
              value={settings.animation.outroText}
              onChange={(event) => updateAnimation({ outroText: event.target.value })}
            />
            <p className="editor-help">
              The teaser and the ending message need the colored image, because
              they appear around the colored reveal.
            </p>
          </div>

          <div className="music-box">
            <label className="check-row badge-toggle">
              <input
                type="checkbox"
                checked={settings.animation.showBadge}
                onChange={(event) =>
                  updateAnimation({ showBadge: event.target.checked })
                }
              />
              Show my account (name and profile picture) in the video
            </label>

            <div className="badge-fields" hidden={!settings.animation.showBadge}>
              <div className="badge-preview">
                <img src={profileSrc} alt="Profile picture" />
                <div className="actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => profileInputRef.current?.click()}
                  >
                    Change picture
                  </button>
                  <button type="button" className="ghost-button" onClick={resetProfile}>
                    Use default
                  </button>
                </div>
              </div>
              <input
                ref={profileInputRef}
                hidden
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={chooseProfile}
              />
              {profileError ? (
                <p className="error" role="alert">
                  {profileError}
                </p>
              ) : null}

              <div className="settings-row">
                <div>
                  <label htmlFor="badge-name">Account name</label>
                  <input
                    id="badge-name"
                    className="select"
                    type="text"
                    maxLength={MAX_BADGE_NAME}
                    value={settings.animation.badgeName}
                    onChange={(event) =>
                      updateAnimation({ badgeName: event.target.value })
                    }
                  />
                </div>
                <div>
                  <label htmlFor="badge-position">Position</label>
                  <select
                    id="badge-position"
                    className="select"
                    value={settings.animation.badgePosition}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (isBadgePosition(value)) updateAnimation({ badgePosition: value });
                    }}
                  >
                    {BADGE_POSITIONS.map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div className="music-box">
            <label htmlFor="music">Background music</label>
            <select
              id="music"
              className="select"
              value={settings.music.track}
              onChange={(event) => {
                const choice = MUSIC_CHOICES.find((item) => item === event.target.value);
                if (choice) {
                  setSettings((current) => ({
                    ...current,
                    music: { ...current.music, track: choice },
                  }));
                }
              }}
            >
              <option value="none">No music</option>
              {GENERATED_TRACKS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
              <optgroup label="Library: recorded tracks">
                {LIBRARY_TRACKS.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.label}
                  </option>
                ))}
              </optgroup>
              <option value="file" disabled={musicFile === null}>
                {musicFile ? `Imported: ${musicFile.name}` : "Imported file (none yet)"}
              </option>
            </select>

            <div className="actions">
              <button
                type="button"
                className="ghost-button"
                onClick={() => musicInputRef.current?.click()}
              >
                Import an audio file…
              </button>
              <input
                ref={musicInputRef}
                hidden
                type="file"
                accept="audio/*"
                onChange={chooseMusic}
              />
            </div>

            <div className="steps-heading">
              <label htmlFor="volume">Music volume</label>
              <b>{Math.round(settings.music.volume * 100)}%</b>
            </div>
            <input
              id="volume"
              className="slider"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.music.volume}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  music: { ...current.music, volume: Number(event.target.value) },
                }))
              }
            />

            <p className="editor-help" role="status">
              {music.status === "loading" ? "Preparing the music…" : null}
              {music.status === "ready"
                ? "Music is ready. It fades in and out and loops to the video length."
                : null}
              {missingMusicFile
                ? "Your imported file is not saved between visits. Import it again or choose another track."
                : null}
            </p>
            {music.status === "error" || musicError ? (
              <p className="error" role="alert">
                {musicError || music.message}
              </p>
            ) : null}
            {isLibraryTrackId(settings.music.track) ? (
              <p className="editor-help">
                Credit in your video description:{" "}
                {LIBRARY_TRACKS.find((track) => track.id === settings.music.track)?.credit}. Check the license terms
                of the track before you publish.
              </p>
            ) : null}
            <p className="editor-help">
              The built-in tunes are simple generated music. For a richer sound,
              import a royalty-free track you have the rights to use.
            </p>
          </div>

          <div className="voice-row">
            <div>
              <strong>♫ Voice narration (preview only)</strong>
              <small>
                Read aloud by your browser. It is not recorded into the exported video.
              </small>
            </div>
            <input
              type="checkbox"
              checked={settings.narration}
              onChange={(event) =>
                updateSettings({ narration: event.target.checked })
              }
              aria-label="Enable voice narration in the preview"
            />
          </div>

          {settings.narration && (
            <div className="language">
              <label htmlFor="language">Narration language</label>
              <select
                id="language"
                className="select"
                value={settings.language}
                onChange={(event) =>
                  updateSettings({ language: event.target.value })
                }
              >
                {LANGUAGES.map((language) => (
                  <option key={language}>{language}</option>
                ))}
              </select>

              <label htmlFor="rate">
                Narration speed: {settings.narrationRate.toFixed(1)}×
              </label>
              <input
                id="rate"
                className="slider"
                type="range"
                min={0.6}
                max={1.4}
                step={0.1}
                value={settings.narrationRate}
                onChange={(event) =>
                  updateSettings({ narrationRate: Number(event.target.value) })
                }
              />
              <small>
                Uses voices installed in your browser. The music is lowered while
                narration is on.
              </small>
            </div>
          )}

          <p className="save-status" role="status">
            {storageAvailable
              ? "Saved in this browser"
              : "Browser storage is unavailable"}
          </p>
        </section>
      </div>

      <ProcessingPanel
        hasFile={file !== null}
        image={guideImage}
        result={result}
        isProcessing={isProcessing}
        error={analysisError}
        settings={processingSettings}
        hidden={hiddenSet}
        onChange={updateProcessing}
        onReset={() => updateProcessing(defaultProcessingSettings)}
        onRetry={() => setAnalysisRun((current) => current + 1)}
        onToggleStroke={toggleStroke}
        onShowAll={() => commit({ steps, hidden: [] })}
      />

      <PartsPanel drawing={drawing} layout={settings.layout} onChange={changeLayout} />

      <section className="panel editor-panel">
        <div className="editor-heading">
          <div>
            <span className="eyebrow">STAGE EDITOR</span>
            <h2>③ Edit your drawing stages</h2>
            <p>
              Stages are groups of strokes: big shapes first, details later. This
              is an automatic guess that does not understand what the picture
              shows, so rearrange it as you like. Stage names are for you only;
              they never appear in the video.
            </p>
          </div>
          <div className="editor-heading-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={undo}
              disabled={history.length === 0}
            >
              ↶ Undo
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={redo}
              disabled={future.length === 0}
            >
              ↷ Redo
            </button>
            <button type="button" className="ghost-button" onClick={resetSteps}>
              Reset stages
            </button>
            <button
              type="button"
              className="primary"
              onClick={addStep}
              disabled={steps.length >= MAX_STEPS}
              title={steps.length >= MAX_STEPS ? "Maximum 15 stages" : "Split this stage in two"}
            >
              + Split stage
            </button>
          </div>
        </div>

        <div className="editor-layout">
          <div className="step-list">
            {steps.map((step, index) => (
              <button
                type="button"
                key={step.id}
                className={
                  selectedStep === index ? "step-card selected" : "step-card"
                }
                onClick={() => setSelectedStep(index)}
              >
                <span className="step-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="step-card-copy">
                  <strong>{step.title || `Stage ${index + 1}`}</strong>
                  <small>
                    {step.strokeIds.length} strokes · {(stageMs[index] / 1000).toFixed(1)}s
                  </small>
                </span>
                <span aria-hidden="true">›</span>
              </button>
            ))}
          </div>

          {activeStep && (
            <div className="step-editor">
              <div className="step-editor-top">
                <span className="eyebrow">
                  STAGE {String(selectedStep + 1).padStart(2, "0")} OF{" "}
                  {String(steps.length).padStart(2, "0")}
                </span>
                <span className="step-badge">
                  {activeStep.strokeIds.length} strokes
                </span>
              </div>

              <label htmlFor="step-title">Stage name (editor only)</label>
              <input
                id="step-title"
                className="select"
                value={activeStep.title}
                maxLength={100}
                onChange={(event) =>
                  updateStep(activeStep.id, { title: event.target.value })
                }
              />

              <label htmlFor="step-description">
                Narration text (preview only, never shown in the video)
              </label>
              <textarea
                id="step-description"
                className="select step-description"
                rows={4}
                maxLength={500}
                value={activeStep.description}
                onChange={(event) =>
                  updateStep(activeStep.id, { description: event.target.value })
                }
              />

              <label htmlFor="step-weight">
                Stage duration: about {(stageMs[selectedStep] / 1000).toFixed(1)}s
              </label>
              <input
                id="step-weight"
                className="slider"
                type="range"
                min={MIN_WEIGHT}
                max={MAX_WEIGHT}
                step={0.25}
                value={activeStep.weight}
                onChange={(event) =>
                  updateStep(activeStep.id, { weight: Number(event.target.value) })
                }
              />
              <div className="range-labels">
                <span>Shorter</span>
                <span>Longer</span>
              </div>

              <div className="step-actions">
                <button
                  type="button"
                  onClick={() => moveStep(selectedStep, -1)}
                  disabled={selectedStep === 0}
                >
                  ↑ Move up
                </button>
                <button
                  type="button"
                  onClick={() => moveStep(selectedStep, 1)}
                  disabled={selectedStep === steps.length - 1}
                >
                  ↓ Move down
                </button>
                <button
                  type="button"
                  onClick={removeStep}
                  disabled={steps.length <= MIN_STEPS}
                  title={
                    steps.length <= MIN_STEPS
                      ? "Keep at least 8 stages"
                      : "Combine with the previous stage (its strokes move there)"
                  }
                >
                  Combine with previous
                </button>
              </div>

              <div className="step-actions">
                <button
                  type="button"
                  onClick={() => moveStroke(-1)}
                  disabled={selectedStep === 0 || activeStep.strokeIds.length === 0}
                >
                  ⇡ First stroke to previous stage
                </button>
                <button
                  type="button"
                  onClick={() => moveStroke(1)}
                  disabled={
                    selectedStep === steps.length - 1 ||
                    activeStep.strokeIds.length === 0
                  }
                >
                  ⇣ Last stroke to next stage
                </button>
              </div>

              <div className="step-actions">
                <button
                  type="button"
                  onClick={() =>
                    setJump((current) => ({
                      step: selectedStep,
                      token: (current?.token ?? 0) + 1,
                      only: true,
                    }))
                  }
                  disabled={!drawing}
                >
                  ▶ Preview only this stage
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setJump((current) => ({
                      step: selectedStep,
                      token: (current?.token ?? 0) + 1,
                      only: false,
                    }))
                  }
                  disabled={!drawing}
                >
                  ▶ Preview from this stage
                </button>
              </div>

              <p className="editor-help">
                To hide an unwanted line, click it in the Outlines view above.
                Undo and redo cover adding, combining, reordering, moving strokes
                and hiding lines. Typing is saved automatically.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="panel lesson-preview">
        <div className="editor-heading">
          <div>
            <span className="eyebrow">LIVE PREVIEW</span>
            <h2>④ Preview your drawing lesson</h2>
            <p>
              The lines are built stroke by stroke and earlier stages stay on the
              page. The exported video is made by the very same drawing code.
            </p>
          </div>
        </div>

        <LessonPreview
          drawing={drawing}
          lineArt={lineArt}
          maskWidth={maskWidth}
          finalImage={finalImage}
          colorLayer={colorLayer}
          steps={steps}
          guide={guideImage}
          badgeImage={badgeImage}
          ratio={settings.ratio}
          duration={settings.duration}
          animation={animation}
          background={settings.background}
          hidden={hiddenSet}
          narration={settings.narration}
          language={settings.language}
          narrationRate={settings.narrationRate}
          music={{ buffer: music.buffer, volume: settings.music.volume }}
          jump={jump}
        />

        <p className="editor-help">
          The pencil follows the detected lines in an automatic order, with small
          pauses and a lifted move between strokes. It is an approximation of
          hand drawing, not a recording of a real artist.
        </p>
      </section>

      <section className="next-panel">
        <div>
          <span className="eyebrow">YOUR PROJECT</span>
          <h2>⑤ Export your lesson</h2>
          <p>
            {drawing
              ? `${strokeCount} strokes · ${steps.length} stages · ${settings.duration} seconds · ${settings.ratio} · WebM`
              : file
                ? isProcessing
                  ? "Analyzing your image…"
                  : "No outlines available yet. Check the analysis settings."
                : "Upload a reference image to prepare your drawing lesson."}
          </p>
        </div>
        <div className="export-actions">
          <button
            type="button"
            className="primary"
            disabled={
              !drawing ||
              !lineArt ||
              strokeCount === 0 ||
              isExporting ||
              isProcessing ||
              musicWaiting
            }
            onClick={handleExport}
          >
            {isExporting ? "Creating video..." : "Export video (WebM)"}
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={(!finalImage && !lineArt) || isExporting}
            onClick={handleThumbnail}
          >
            Download thumbnail (PNG)
          </button>
          {isExporting ? (
            <button
              type="button"
              className="ghost-button"
              onClick={() => exportAbort.current?.abort()}
            >
              Cancel
            </button>
          ) : null}
        </div>

        <p role="status">{exportMessage}</p>
      </section>

      <footer>
        Drawsy Studio <span>Made for little artists, one line at a time.</span>
      </footer>
    </main>
  );
}

export default App;
