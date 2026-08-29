#!/usr/bin/env python3
"""Genererer app/public/icon-192.png ud fra spolens maerke: filmspolen.

    python3 make_icons.py

Koeres kun, naar ikonet aendres - resultatet committes (build'et kraever, at
de genererede filer ligger i git, ellers mangler de efter en hentning).

PNG og ikke JPEG: JPEG-fallback goer transparens til sort, og PNG kan ikke
kvalitets-komprimeres - skal den mindre, skal den nedskaleres (Kokkeri).
"""
import os
from PIL import Image, ImageDraw

UD = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'app', 'public')
OKKER = (176, 125, 20, 255)      # --accent
HVID = (255, 255, 255, 255)
SKALA = 4                        # tegn stort og skaler ned - PIL antialiaser ikke streger


def tegn(px):
    s = px * SKALA
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(s * 0.22)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=r, fill=OKKER)
    m = s / 2
    ring = s * 0.28
    bred = max(1, int(s * 0.062))
    d.ellipse([m - ring, m - ring, m + ring, m + ring], outline=HVID, width=bred)
    hul = s * 0.055
    d.ellipse([m - hul, m - hul, m + hul, m + hul], fill=HVID)
    for dx, dy in ((0, -1), (0, 1), (-1, 0), (1, 0)):
        cx, cy = m + dx * s * 0.172, m + dy * s * 0.172
        d.ellipse([cx - hul, cy - hul, cx + hul, cy + hul], fill=HVID)
    return img.resize((px, px), Image.LANCZOS)


def main():
    sti = os.path.join(UD, 'icon-192.png')
    tegn(192).save(sti, 'PNG', optimize=True)
    print(f'  icon-192.png  {os.path.getsize(sti):,} b')


if __name__ == '__main__':
    main()
