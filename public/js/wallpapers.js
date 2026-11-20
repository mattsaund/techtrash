// The wallpapers the desktop comes with, XP's own, in the order XP listed
// them. tools/make_wallpapers.py builds them into img/wallpapers/ (WebP for
// the big ones, a third smaller than JPEGs that look the same, and XP's own
// JPEGs as they were for the rest), and files/credits.txt credits them.
//
// Anyone can change the wallpaper for everyone (Display Properties, Paint, or
// a picture's Set as Desktop Background), to one of these or any picture on
// the disk. server/disk.js checks it's one of the two.
//
// A wallpaper setting is { image, position, color }.
//   image     "xp:<id>" (one of these), "file:<id>" (a picture on the disk)
//             or "" for none
//   position  "stretch", "center" or "tile", as on XP
//   color     "#rrggbb" around a centered picture or behind no picture, or ""
//             for the desktop's own blue (--desktop)

import { fileUrl } from "./items.js";

export const WALLPAPER_DIR = "/img/wallpapers";

export const WALLPAPERS = [
  { id: "ascent", name: "Ascent", file: "ascent.webp" },
  { id: "autumn", name: "Autumn", file: "autumn.webp" },
  { id: "azul", name: "Azul", file: "azul.webp" },
  { id: "bliss", name: "Bliss", file: "bliss.webp" },
  { id: "crystal", name: "Crystal", file: "crystal.jpg" },
  { id: "follow", name: "Follow", file: "follow.webp" },
  { id: "friend", name: "Friend", file: "friend.webp" },
  { id: "home", name: "Home", file: "home.jpg" },
  { id: "moon-flower", name: "Moon flower", file: "moon-flower.jpg" },
  { id: "peace", name: "Peace", file: "peace.jpg" },
  { id: "power", name: "Power", file: "power.jpg" },
  { id: "purple-flower", name: "Purple flower", file: "purple-flower.jpg" },
  { id: "radiance", name: "Radiance", file: "radiance.webp" },
  { id: "red-moon-desert", name: "Red moon desert", file: "red-moon-desert.webp" },
  { id: "ripple", name: "Ripple", file: "ripple.jpg" },
  { id: "stonehenge", name: "Stonehenge", file: "stonehenge.webp" },
  { id: "tulips", name: "Tulips", file: "tulips.webp" },
  { id: "vortec-space", name: "Vortec space", file: "vortec-space.webp" },
  { id: "wind", name: "Wind", file: "wind.webp" },
  { id: "windows-xp", name: "Windows XP", file: "windows-xp.jpg" },
];

export const findWallpaper = (id) => WALLPAPERS.find((wallpaper) => wallpaper.id === id);

// Where a wallpaper setting's picture is, or "" for none. item is the disk's
// item for a picture on the disk, if it's known.
export function wallpaperUrl(image = "", item = null) {
  if (image.startsWith("xp:")) {
    const wallpaper = findWallpaper(image.slice(3));
    return wallpaper ? `${WALLPAPER_DIR}/${wallpaper.file}` : "";
  }
  return image.startsWith("file:") && item ? fileUrl(item) : "";
}

export const POSITIONS = ["stretch", "center", "tile"];

// A new desktop starts with XP's Bliss, stretched over the screen.
export const FIRST_WALLPAPER = { image: "xp:bliss", position: "stretch", color: "" };
