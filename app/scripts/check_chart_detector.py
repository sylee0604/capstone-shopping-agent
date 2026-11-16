# 사이즈표 이미지 판별(표처럼 보이는지, LLM 없이) 점검: 확장 프로그램의 JS 함수를 Chromium에서 그대로 실행
#   cd app && python scripts/check_chart_detector.py
# 필요: pip install playwright numpy pillow scikit-image && playwright install chromium
# 대상: 사이즈표 25장(양성), 일반 사진 5장 + 흰 배경 옷 모양 합성 1장 + 글자 많은 홍보 이미지 합성 7장(음성)
# 결과: 2 = 표로 보임, 1 = 표일 수도, 0 = 아님 → eval/결과/날짜_chart_detector.json
import json, datetime, pathlib
APP = pathlib.Path(__file__).resolve().parent.parent
ROOT = APP.parent
import asyncio, base64, glob, io, re, numpy as np
from PIL import Image
from skimage import data
from playwright.async_api import async_playwright
src = open(APP / 'src/browser/chromeBrowser.js', encoding='utf-8').read()
fn = src[src.index('export function looksLikeChart'):src.index('// 큰 이미지도')].replace('export ', '')
pos = sorted(glob.glob(str(ROOT / '사이즈표/*/*.webp')) + glob.glob(str(ROOT / '사이즈표/*/*.png')))
def b64(path=None, arr=None):
    if path: return ('image/webp' if path.endswith('webp') else 'image/png'), base64.b64encode(open(path, 'rb').read()).decode()
    buf = io.BytesIO(); Image.fromarray(arr).save(buf, 'PNG'); return 'image/png', base64.b64encode(buf.getvalue()).decode()
negs = {n: getattr(data, n)() for n in ['astronaut', 'chelsea', 'coffee', 'rocket', 'retina']}
syn = (np.ones((900, 750, 3)) * 255).astype('uint8'); syn[150:800, 200:550] = [180, 60, 70]; negs['white_bg_garment'] = syn
import random
from PIL import ImageDraw, ImageFont
FONT = next((f for f in ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 'C:/Windows/Fonts/malgun.ttf'] if pathlib.Path(f).exists())); random.seed(1)
lines = ['加厚保暖 冬季必备', '采用90%白鸭绒 蓬松度高 轻盈保暖', '立体剪裁 修身显瘦 不臃肿', '防风防泼水面料 雨雪天气也不怕', '多口袋设计 实用方便', '精致做工 细节见品质', '可拆卸连帽 一衣多穿']
for i in range(6):
    im = Image.new('RGB', (750, 1000), (255, 255, 255) if i % 2 == 0 else (242, 242, 240)); d = ImageDraw.Draw(im)
    f1 = ImageFont.truetype(FONT, 48); f2 = ImageFont.truetype(FONT, 28)
    d.text((375, 80), random.choice(lines), font=f1, fill=(30, 30, 30), anchor='mm')
    for k in range(i % 3 + 2): d.text((375, 160 + k * 44), random.choice(lines), font=f2, fill=(90, 90, 90), anchor='mm')
    if i >= 2: d.rectangle([150, 400, 600, 950], fill=(40 + i * 10, 45, 55))
    negs[f'promo{i}'] = np.asarray(im)
im = Image.new('RGB', (750, 900), 'white'); d = ImageDraw.Draw(im); f2 = ImageFont.truetype(FONT, 26)
for k in range(16): d.text((60, 40 + k * 52), random.choice(lines) + ' ' + random.choice(lines), font=f2, fill=(50, 50, 50))
negs['textwall'] = np.asarray(im)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page()
        await pg.set_content('<html><body></body></html>')
        await pg.add_script_tag(content=fn + '\nwindow.check = async (mime, d) => { const blob = await (await fetch(`data:${mime};base64,${d}`)).blob(); return looksLikeChart(await createImageBitmap(blob)); };')
        lv = {0: 0, 1: 0, 2: 0}; res = {'사이즈표': {}, '음성': {}}
        for f in pos:
            m, d = b64(f); r = await pg.evaluate('([m,d]) => check(m,d)', [m, d]); lv[r] += 1
            res['사이즈표'][pathlib.Path(f).name] = r
            if r < 2: print('level', r, pathlib.Path(f).name)
        print('size charts levels:', lv, 'of', len(pos))
        for n, arr in negs.items():
            m, d = b64(arr=arr if arr.ndim == 3 else np.stack([arr]*3, -1)); r = await pg.evaluate('([m,d]) => check(m,d)', [m, d])
            res['음성'][n] = r; print('neg', n, r)
        await b.close()
        out = APP / 'eval' / '결과' / f"{datetime.date.today():%Y%m%d}_chart_detector.json"
        res['요약'] = {'사이즈표_표로보임(2)': f"{lv[2]}/{len(pos)}", '사이즈표_표일수도(1)': f"{lv[1]}/{len(pos)}", '음성_표로보임(2)': f"{sum(v == 2 for v in res['음성'].values())}/{len(res['음성'])}", '음성_0': f"{sum(v == 0 for v in res['음성'].values())}/{len(res['음성'])}"}
        out.write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding='utf-8'); print(res['요약'], '→', out)
asyncio.run(main())
