// The wallpapers the desktop comes with, XP's own, in the order XP listed
// them. tools/make_wallpapers.py builds them into img/wallpapers/<id>.jpg,
// and files/credits.txt credits them.
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

export const WALLPAPER_DIR = "/img/wallpapers";

export const WALLPAPERS = [
  { id: "ascent", name: "Ascent" },
  { id: "autumn", name: "Autumn" },
  { id: "azul", name: "Azul" },
  { id: "bliss", name: "Bliss" },
  { id: "crystal", name: "Crystal" },
  { id: "follow", name: "Follow" },
  { id: "friend", name: "Friend" },
  { id: "home", name: "Home" },
  { id: "moon-flower", name: "Moon flower" },
  { id: "peace", name: "Peace" },
  { id: "power", name: "Power" },
  { id: "purple-flower", name: "Purple flower" },
  { id: "radiance", name: "Radiance" },
  { id: "red-moon-desert", name: "Red moon desert" },
  { id: "ripple", name: "Ripple" },
  { id: "stonehenge", name: "Stonehenge" },
  { id: "tulips", name: "Tulips" },
  { id: "vortec-space", name: "Vortec space" },
  { id: "wind", name: "Wind" },
  { id: "windows-xp", name: "Windows XP" },
];

export const findWallpaper = (id) => WALLPAPERS.find((wallpaper) => wallpaper.id === id);

export const POSITIONS = ["stretch", "center", "tile"];

// A new desktop starts with XP's Bliss, stretched over the screen.
export const FIRST_WALLPAPER = { image: "xp:bliss", position: "stretch", color: "" };
