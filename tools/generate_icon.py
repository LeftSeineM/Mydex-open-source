"""Original geometric terminal icon; no downloaded brand assets."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
for density, size in [('mdpi',48),('hdpi',72),('xhdpi',96),('xxhdpi',144),('xxxhdpi',192)]:
    scale=4
    image=Image.new('RGB',(size*scale,size*scale),'#ffffff')
    draw=ImageDraw.Draw(image)
    def box(coords): return tuple(round(v*size*scale) for v in coords)
    draw.rounded_rectangle(box((.10,.10,.90,.90)),radius=round(.20*size*scale),fill='#24262a')
    draw.line([box((.29,.35)),box((.43,.49)),box((.29,.63))],fill='#ffffff',width=round(.055*size*scale),joint='curve')
    draw.rounded_rectangle(box((.50,.60,.71,.65)),radius=round(.02*size*scale),fill='#ffffff')
    dest=root/'android/app/src/main/res'/('mipmap-'+density)/'ic_launcher.png'
    image.resize((size,size),Image.Resampling.LANCZOS).save(dest)
print('Generated Mydex launcher icons.')
