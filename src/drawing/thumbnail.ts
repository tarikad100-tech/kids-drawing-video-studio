import { createBackground, type BackgroundPreset } from "./background";
import { createBadge, type BadgePosition } from "./badge";
import { createCaption } from "./captions";

/*
 * A 1280x720 cover picture (the size YouTube expects for thumbnails): the
 * chosen background, the finished colored drawing big and clear, the title and
 * the channel badge. It is made in the browser and downloaded as a PNG.
 */

export const THUMBNAIL_WIDTH = 1280;
export const THUMBNAIL_HEIGHT = 720;

export type ThumbnailOptions = {
  /** The colored picture if there is one, otherwise the black-and-white line art. */
  picture: CanvasImageSource;
  pictureWidth: number;
  pictureHeight: number;
  background: BackgroundPreset;
  title: string;
  showBadge: boolean;
  badgeName: string;
  badgeImage: HTMLImageElement | null;
  badgePosition: BadgePosition;
};

export function createThumbnail(options: ThumbnailOptions): HTMLCanvasElement {
  const { pictureWidth, pictureHeight } = options;
  const { canvas, sheet } = createBackground(
    THUMBNAIL_WIDTH,
    THUMBNAIL_HEIGHT,
    options.background,
  );
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create the thumbnail.");

  const base = Math.min(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
  const hasTitle = options.title.trim().length > 0;

  // The picture uses the lower part of the paper; the title sits on top.
  const top = hasTitle ? sheet.y + sheet.h * 0.2 : sheet.y;
  const area = {
    x: sheet.x,
    y: top,
    w: sheet.w,
    h: sheet.y + sheet.h - top,
  };
  const inset = base * 0.02;
  const scale = Math.min(
    (area.w - inset * 2) / pictureWidth,
    (area.h - inset * 2) / pictureHeight,
  );
  const drawW = pictureWidth * scale;
  const drawH = pictureHeight * scale;

  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    options.picture,
    area.x + (area.w - drawW) / 2,
    area.y + (area.h - drawH) / 2,
    drawW,
    drawH,
  );
  ctx.restore();

  const title = hasTitle
    ? createCaption(
        options.title,
        sheet.x + sheet.w / 2,
        sheet.y + sheet.h * 0.1,
        sheet.w * 0.92,
        base,
        0.085,
        "#ffb703",
      )
    : null;

  if (title) ctx.drawImage(title.canvas, title.x, title.y);

  if (options.showBadge) {
    const badge = createBadge(
      THUMBNAIL_WIDTH,
      THUMBNAIL_HEIGHT,
      options.badgeName,
      options.badgeImage,
      options.badgePosition,
    );

    if (badge) ctx.drawImage(badge.canvas, badge.x, badge.y);
  }

  return canvas;
}

export function downloadCanvasPng(canvas: HTMLCanvasElement, fileName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("The thumbnail could not be saved."));
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = fileName;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      resolve();
    }, "image/png");
  });
}
