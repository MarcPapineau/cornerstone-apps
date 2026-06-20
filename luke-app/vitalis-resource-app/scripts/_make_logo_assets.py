"""
One-shot logo asset exporter for the Vitalis brand re-skin.

Reads the SUPPLIED artwork only (cobalt stacked lockup on a white/transparent field),
finds the tight content bounding box, and exports:
  - vitalis-logo.png  : trimmed full lockup (V-mark + VITALIS / HEALTH CO. wordmark)
  - vitalis-mark.png   : the V-mark alone (top region), trimmed
  - favicon.png        : 64px V-mark for the browser tab

It does NOT redraw, recolor, stylize, or add effects. Trim + crop + scale only.
The artwork's own cobalt pixels and proportions are preserved; background is made
transparent so the mark sits cleanly on a white/platinum chip.
"""
import sys
from PIL import Image
import numpy as np

SRC = sys.argv[1]
OUT_DIR = sys.argv[2]

img = Image.open(SRC).convert("RGBA")
arr = np.asarray(img).astype(np.int16)
r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]

# "Content" = visible (alpha>20) AND not near-white (the cobalt ink + any antialiasing).
# Near-white = all channels high. We trim the white/transparent margins.
near_white = (r > 244) & (g > 244) & (b > 244)
content = (a > 20) & (~near_white)

ys, xs = np.where(content)
if len(xs) == 0:
    raise SystemExit("No content detected in source artwork")

x0, x1 = int(xs.min()), int(xs.max())
y0, y1 = int(ys.min()), int(ys.max())
print(f"full content bbox: x[{x0}..{x1}] y[{y0}..{y1}]  (src {img.width}x{img.height})")


def make_transparent(im):
    """Knock out the white background so the mark sits on any chip. Cobalt ink stays."""
    a2 = np.asarray(im).astype(np.int16)
    rr, gg, bb = a2[..., 0], a2[..., 1], a2[..., 2]
    white = (rr > 244) & (gg > 244) & (bb > 244)
    out = a2.copy()
    out[..., 3] = np.where(white, 0, a2[..., 3])
    return Image.fromarray(out.astype(np.uint8), "RGBA")


# --- Full lockup: tight trim + a small even margin for breathing room ---
pad = 12
fx0, fy0 = max(0, x0 - pad), max(0, y0 - pad)
fx1, fy1 = min(img.width, x1 + 1 + pad), min(img.height, y1 + 1 + pad)
lockup = make_transparent(img.crop((fx0, fy0, fx1, fy1)))
lockup.save(f"{OUT_DIR}/vitalis-logo.png")
print(f"vitalis-logo.png -> {lockup.size}")

# --- V-mark: detect the top mark band by finding the vertical gap between the
# mark and the "VITALIS" wordmark (a run of empty rows in the content mask). ---
row_has = content.any(axis=1)
rows = np.where(row_has)[0]
# Walk down from the first content row; the first sizeable empty gap separates
# the mark from the wordmark.
gap_start = None
prev = rows[0]
for y in rows[1:]:
    if y - prev > 18:  # empty band taller than ~18px = the mark/wordmark divider
        gap_start = prev
        break
    prev = y
if gap_start is None:
    # Fallback: assume mark is the top ~42% of the content height.
    gap_start = y0 + int((y1 - y0) * 0.42)
print(f"mark band: rows {y0}..{gap_start}")

# Horizontal bounds restricted to the mark band (so wide wordmark doesn't widen it).
band_mask = content[y0:gap_start + 1, :]
bxs = np.where(band_mask.any(axis=0))[0]
mx0, mx1 = int(bxs.min()), int(bxs.max())
mpad = 10
mark = make_transparent(
    img.crop((max(0, mx0 - mpad), max(0, y0 - mpad),
              min(img.width, mx1 + 1 + mpad), min(img.height, gap_start + 1 + mpad)))
)
# Pad to a square so the V-mark isn't distorted when shown in a square chip.
side = max(mark.size)
sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
sq.paste(mark, ((side - mark.size[0]) // 2, (side - mark.size[1]) // 2))
sq.save(f"{OUT_DIR}/vitalis-mark.png")
print(f"vitalis-mark.png -> {mark.size} squared to {sq.size}")

# --- Favicon: 64px square V-mark ---
fav = sq.resize((64, 64), Image.LANCZOS)
fav.save(f"{OUT_DIR}/favicon.png")
print("favicon.png -> 64x64")
