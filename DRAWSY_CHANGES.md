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

## Round 5 — logical drawing order + music library

1. **Parts.** New panel "Parts: what is drawn first" (`components/PartsPanel.tsx`,
   `drawing/layout.ts`). The pencil finishes one part before the next.
   - Writing is detected automatically (a row of big shapes near the top/bottom)
     and drawn letter by letter, **right to left for Arabic, left to right for
     Latin** (choose in "Direction of the writing"; default Arabic).
   - Press "+ Add a part", drag a box over the mother, then another over the girl.
     Order = the list order (↑ ↓). The smaller box wins where boxes overlap.
   - Everything else ("Drawing") is drawn piece by piece (each heart, cloud,
     flower finished before the next), big outline first.
   - Each part gets its own stages (at least one each), so stages follow the story.
2. Construction lines (cross + oval) now follow the first stage only, not the
   whole picture.
3. **Music library:** 3 recorded tracks in `public/music/` (Little Fish, Brand New
   Baby Girl, The Creepy Clown), compressed to 128 kbps MP3. They appear in the
   music list under "Library". Credit line shown under the list.

Files: NEW `drawing/layout.ts`, `components/PartsPanel.tsx`, `public/music/*.mp3`;
changed `drawing/steps.ts`, `drawing/lessonFrame.ts`, `audio/music.ts`,
`hooks/useMusicBuffer.ts`, `App.tsx`, `studio.css`.

Tested (headless Chromium, built from these files + older App.css/main.tsx):
the sample "I love you mom" picture, boxes drawn by mouse, music from the library,
a 15 s and a 30 s export (VP9 + Opus). Not tested: other pictures (the text
detector is a heuristic and can be wrong; delete the "Writing" part to turn it
off), landscape, 1080p, your real full project (I only have the changed files).
Automatic mother/girl separation is NOT possible (they touch each other): you
draw the boxes.
Music licenses: check the terms of each track and credit the artist.

## Round 6 — natural hand
`drawing/pencil.ts` only: new hand with a relaxed writing grip (thumb and index
finger pinch the pencil, the middle finger supports it, ring/little fingers
curled, tapered fingers, nails, soft highlights, forearm and sleeve). Same skin
tones and glove. Also removed a duplicate `ferrule: false` line that strict
TypeScript rejects. Checked visually (all skins) and inside an exported video.

## Round 7 — Realistic hands
- The hand is now a **real illustrated hand** (5 sprites cut from your reference picture: light, tan, brown, dark skin, and the white glove). The pencil is part of each picture; the forearm and sleeve are continued by code so the arm can leave the frame at any size.
- New: `src/drawing/handSprites.ts` (loader + metadata), `public/hands/hand-*.png`. `pencil.ts` uses the sprite and falls back to the old vector hand if an image fails to load. `exportVideo.ts` waits for the images before exporting; `LessonPreview.tsx` redraws when they load.
- The **Tool** selector (pencil/pen/crayon) now only affects the "No hand" option, because the pencil colour comes from the picture.
