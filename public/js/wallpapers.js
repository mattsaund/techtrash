// XP's own wallpapers, in XP's order. Built into img/wallpapers/ by
// tools/make_wallpapers.py (WebP for the big ones) and credited in files/credits.txt.
// The setting is shared. server/disk.js checks it's one of these or a disk picture.
//
// A setting is { image, position, color }.
//   image     "xp:<id>", "file:<item id>" or "" for none
//   position  "stretch", "center" or "tile"
//   color     "#rrggbb" around a centered picture or with none, or "" for --desktop

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

// The picture URL for a setting's image, or "". item is the disk item for "file:", if known.
export function wallpaperUrl(image = "", item = null) {
  if (image.startsWith("xp:")) {
    const wallpaper = findWallpaper(image.slice(3));
    return wallpaper ? `${WALLPAPER_DIR}/${wallpaper.file}` : "";
  }
  return image.startsWith("file:") && item ? fileUrl(item) : "";
}

export const POSITIONS = ["stretch", "center", "tile"];

export const FIRST_WALLPAPER = { image: "xp:bliss", position: "stretch", color: "" };
