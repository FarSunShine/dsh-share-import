"""Draw the storefront tile for the plugin catalog (180x180 PNG)."""
from PIL import Image, ImageDraw

SIZE = 180
SCALE = 4  # draw large, downscale for smooth edges
S = SIZE * SCALE

image = Image.new("RGBA", (S, S), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)

# Rounded blue tile.
radius = 40 * SCALE
draw.rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=(58, 130, 247, 255))

white = (255, 255, 255, 255)
shaft_w = 14 * SCALE
cx = 90 * SCALE

# Import arrow: shaft, head, tray.
draw.line([(cx, 44 * SCALE), (cx, 100 * SCALE)], fill=white, width=shaft_w)
draw.polygon(
    [(66 * SCALE, 86 * SCALE), (114 * SCALE, 86 * SCALE), (cx, 120 * SCALE)],
    fill=white,
)
draw.line(
    [(54 * SCALE, 122 * SCALE), (54 * SCALE, 146 * SCALE), (126 * SCALE, 146 * SCALE), (126 * SCALE, 122 * SCALE)],
    fill=white,
    width=13 * SCALE,
    joint="curve",
)
for x, y in ((54, 122), (126, 122)):
    draw.ellipse(
        [(x * SCALE - 6.5 * SCALE), (y * SCALE - 6.5 * SCALE), (x * SCALE + 6.5 * SCALE), (y * SCALE + 6.5 * SCALE)],
        fill=white,
    )

image = image.resize((SIZE, SIZE), Image.LANCZOS)
image.save(r"C:\Users\SUNSHINE\Documents\deepseek-harness\default-workspace\dsh-share-link-import\assets\icon-180.png")
print("written", image.size)
