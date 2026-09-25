"""
Draws the Megan Study master icon (build/icon.png, 1024 px) and the Windows
icon built from it (build/icon.ico, with 16, 32, 48 and 256 px layers).

    python3 scripts/make-icon.py      # needs Pillow
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
OUT = Path(__file__).resolve().parent.parent / "build"
FONT = "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf"


def master() -> Image.Image:
    # Drawn at 4x and scaled down, for smooth edges.
    big = SIZE * 4
    top, bottom = (99, 102, 241), (139, 92, 246)  # indigo to violet
    gradient = Image.new("RGB", (1, big))
    for y in range(big):
        t = y / (big - 1)
        gradient.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    gradient = gradient.resize((big, big))

    mask = Image.new("L", (big, big), 0)
    inset = big // 20
    ImageDraw.Draw(mask).rounded_rectangle(
        (inset, inset, big - inset, big - inset), radius=big // 5, fill=255
    )
    icon = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    icon.paste(gradient, mask=mask)

    draw = ImageDraw.Draw(icon)
    font = ImageFont.truetype(FONT, int(big * 0.52))
    draw.text((big / 2, big * 0.53), "M", font=font, fill="white", anchor="mm")
    return icon.resize((SIZE, SIZE), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    icon = master()
    icon.save(OUT / "icon.png")
    icon.save(OUT / "icon.ico", sizes=[(16, 16), (32, 32), (48, 48), (256, 256)])


if __name__ == "__main__":
    main()
