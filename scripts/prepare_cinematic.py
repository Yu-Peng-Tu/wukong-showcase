from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/ref/大圣背影_红色披风_天兵压境.jpg'
OUT = ROOT / 'public/textures'
OUT.mkdir(parents=True, exist_ok=True)

image = Image.open(SOURCE).convert('RGB')
w, h = image.size
image.save(OUT / 'wukong-cinematic.jpg', quality=96, subsampling=0, optimize=True)

# Authored for the full-body back-view composition. This is an artistic depth
# guide for restrained 2.5D motion, not a reconstructed 3D scene.
y = np.linspace(0, 1, h, dtype=np.float32)[:, None]
base = 16 + 132 * np.clip((y - 0.08) / 0.92, 0, 1) ** 0.9
base = np.repeat(base, w, axis=1).astype(np.uint8)
depth = Image.fromarray(base, 'L')
draw = ImageDraw.Draw(depth)

def polygon(points, value):
    draw.polygon([(round(x * w), round(y * h)) for x, y in points], fill=value)

# The rocky foreground and the full-body hero share the sharp focal region.
polygon([
    (0.15, 1), (0.19, 0.93), (0.29, 0.85), (0.38, 0.79),
    (0.48, 0.78), (0.57, 0.81), (0.64, 0.88), (0.77, 0.96), (0.82, 1),
], 232)
draw.ellipse((0.473*w, 0.345*h, 0.512*w, 0.425*h), fill=244)
polygon([
    (0.465, 0.41), (0.50, 0.40), (0.525, 0.46), (0.54, 0.57),
    (0.535, 0.70), (0.54, 0.85), (0.505, 0.86), (0.485, 0.75),
    (0.47, 0.86), (0.435, 0.85), (0.445, 0.71), (0.435, 0.59),
], 242)

# The cape extends to the right, with a slightly softer free edge.
polygon([
    (0.47, 0.42), (0.56, 0.38), (0.65, 0.29), (0.77, 0.235),
    (0.86, 0.235), (0.94, 0.275), (0.875, 0.32), (0.93, 0.45),
    (0.90, 0.50), (0.88, 0.56), (0.84, 0.61), (0.855, 0.69),
    (0.81, 0.76), (0.825, 0.84), (0.77, 0.90), (0.70, 0.83),
    (0.61, 0.78), (0.54, 0.71), (0.50, 0.57),
], 226)

# The staff is the closest diagonal silhouette on the left of the hero.
polygon([(0.435, 0.55), (0.447, 0.57), (0.335, 0.98), (0.315, 0.97)], 245)

depth = depth.filter(ImageFilter.GaussianBlur(radius=max(8, round(w / 128))))
depth.save(OUT / 'wukong-depth.png', optimize=True)
depth.resize((1280, 720), Image.Resampling.LANCZOS).save(ROOT / 'docs/ref/景深分层预览.png', optimize=True)
print(f'Prepared {w}x{h} full-body cinematic texture and depth guide in {OUT}')
