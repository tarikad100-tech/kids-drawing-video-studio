# Drawsy Studio — Round 3 changes (untested code)

The code was written without running npm, lint, build or the browser.
Run `npm run lint` and `npm run build` once, then `npm run dev`.

## What changed

1. **Two images.** Upload the black-and-white drawing (drawn in the video) and,
   optionally, the same picture in color (shown at the end, faded over the lines).
2. **Faithful lines.** In "Line art" mode the video reveals the real pixels of
   your drawing along the pencil path instead of redrawing a simplified copy.
3. **Better order.** Broken fragments are merged (`mergeStrokes.ts`), then drawn
   as continuous paths from the top, longest and most important first.
4. **Kids music.** Three original tunes (Bouncy, Marimba, Music box).
   They are original melodies in a playful style, not the copyrighted "Baby
   Shark" tune. You can also import your own audio file (up to 25 MB).
5. **Nicer background.** New default "meadow" (sky, hills, flowers, paper sheet).
6. **Hand holding the tool.** Choose the tool (pencil, felt-tip, crayon) and the
   hand (4 skin tones, cartoon glove, or none).

## Files (keep the same folders under `src/`)

- NEW `drawing/mergeStrokes.ts`
- `drawing/types.ts`, `processImage.ts`, `steps.ts`, `pencil.ts`,
  `background.ts`, `lessonFrame.ts`, `timeline.ts`
- `audio/music.ts`
- `hooks/useLoadedImage.ts`, `hooks/useMusicBuffer.ts` (must be in `hooks/`)
- `video/exportVideo.ts`
- `components/LessonPreview.tsx`, `components/ProcessingPanel.tsx`
- `App.tsx`, `studio.css`

## Honest limits

- Export is WebM only (no MP4). Narration is heard in the preview, not recorded.
- Stroke order is a heuristic, not object understanding. Use the stage editor.
- The hand is a stylized cartoon, not a photo-real hand.
- Auto colors (without a colored image) are experimental.
- If your saved settings still use mode "Edges", press "Reset analysis" or
  choose "Line art" for black-and-white drawings.

## Round 4 — professional drawing workflow

1. **Construction lines first.** Before the real lines, the pencil draws a light
   blue center cross and a loose oval around the main shape (plus ovals around
   other big parts). New file `drawing/guides.ts`.
2. **Big to small order.** Strokes are ordered in three levels: the long lines
   that form the structure, then medium parts, then small details. The pen moves
   continuously inside each level (`drawing/steps.ts`).
3. **Cleanup.** After the last real line, the construction lines fade out, and
   only then does the colored image appear (`timeline.ts`, `lessonFrame.ts`).
4. Stage titles now follow this workflow (outer shape, main parts, secondary
   parts, inner details, fine details, final lines, cleanup).

Limits: the guides are geometric (center cross and ovals around the shapes found
in the picture). The app does not know what the picture shows (face, body), so
it cannot build a real skeleton. Existing saved stage titles stay as they are;
press the stage reset in the editor to get the new titles. Type-checked with
`tsc --strict` on the drawing modules only; not run in a browser.
