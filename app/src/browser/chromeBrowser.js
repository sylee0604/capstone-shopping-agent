// 브라우저 조작 (Chrome 확장). 사용자의 로그인된 타오바오·1688 탭에서 검색 결과를 읽는다.
// 노드는 이 객체의 search / cnyToKrw / translate만 쓰므로, 테스트에서는 가짜 객체로 바꿔 끼운다.
import { scrapeTaobao, scrape1688, scrollPage, countCards, scrapeDetail } from './scrapers.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 이미지가 표처럼 보이는지 (chartLike의 계산부, 테스트용으로 분리) */
export function looksLikeChart(bmp, W = 120) {
  const H = Math.max(1, Math.round(bmp.height * (W / bmp.width)));
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d');
  // 고품질 축소: 기본 축소는 거칠어서 표 칸 사이의 흰 틈이 사라진다 (선 없이 칸 색으로 나눈 표를 놓침)
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  return bandsLookLikeChart(px, W, H);
}
/**
 * 2 = 표로 보임(격자선이나 열 구조가 뚜렷), 1 = 표일 수도 있음(흰 배경 + 글자), 0 = 아님
 * 1은 글자가 많은 홍보·설명 이미지도 통과하므로, 옵션이 S/M/L뿐인 상품에서는 2만 믿는다.
 */
export function bandsLookLikeChart(px, W, H) {
  const at = (x, y) => (y * W + x) * 4;
  let best = 0, strength = 0;
  for (let y0 = 0; y0 < Math.max(1, H - W / 2); y0 += W) {
    const y1 = Math.min(H, y0 + W), bh = y1 - y0;
    if (bh < 20) continue;
    let low = 0, n = 0, edges = 0, m = 0;
    const colCnt = new Uint32Array(W), rowCnt = new Uint32Array(bh);
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < W; x++) {
        const i = at(x, y), r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if ((mx > 0 ? (mx - mn) / mx : 0) < 0.25) low++;
        n++;
        if (x < W - 1 && y < y1 - 1) {
          const gray = (r + g + b) / 3;
          const j = at(x + 1, y), k = at(x, y + 1);
          const gx = Math.abs(gray - (px[j] + px[j + 1] + px[j + 2]) / 765), gy = Math.abs(gray - (px[k] + px[k + 1] + px[k + 2]) / 765);
          m++;
          if (Math.max(gx, gy) > 0.16) { edges++; colCnt[x]++; rowCnt[y - y0]++; }
        }
      }
    }
    const dens = edges / m;
    const cols = colCnt.reduce((a, v) => a + (v > 0), 0) / W, rows = rowCnt.reduce((a, v) => a + (v > 0), 0) / bh;
    if (!(low / n >= 0.7 && dens >= 0.04 && dens <= 0.5 && cols >= 0.5 && rows >= 0.3)) continue;
    // 표 구조: 가로 격자선(폭의 80% 이상 이어진 경계 줄), 세로 격자선(높이의 60% 이상), 빈 세로 틈으로 나뉜 열 덩어리 수
    let grid = 0, vgrid = 0, runs = 0, prev = false;
    for (let y = 0; y < bh - 1; y++) if (rowCnt[y] / (W - 1) > 0.8) grid++;
    for (let x = 0; x < W - 1; x++) {
      const p = colCnt[x] / (bh - 1);
      if (p > 0.6) vgrid++;
      const on = p > 0.02; if (on && !prev) runs++; prev = on;
    }
    if (grid >= 2 || vgrid >= 2 || runs >= 3) {
      best = 2;
      strength += runs + 3 * Math.min(grid, 5) + 3 * Math.min(vgrid, 5);   // 표 구조가 뚜렷하고 표가 길수록 큼
    } else best = Math.max(best, 1);
  }
  // 정수 부분 = 단계(2 표 / 1 표일 수도 / 0 아님), 소수 부분 = 표다움 점수 (여러 장 중 표다운 순서로 고를 때 사용)
  return best === 2 ? 2 + Math.min(0.99, strength / 200) : best;
}

// 큰 이미지도 스택이 넘치지 않게 나눠서 base64로 변환
export function toBase64(buf) {
  const a = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
  return btoa(s);
}

const SITES = {
  taobao: {
    match: '*://*.taobao.com/*', home: 'https://www.taobao.com',
    url: (q) => `https://s.taobao.com/search?q=${encodeURIComponent(q)}&sort=sale-desc`,
    ready: ['[class*="doubleCard"]', '[data-nid]', 'a[data-spm-act-id]', 'a[href*="item.htm?id="]'],
    scrape: scrapeTaobao,
  },
  1688: {
    match: '*://*.1688.com/*', home: 'https://www.1688.com',
    ready: ['.search-offer-item', '[class*="search-offer"]', '[class*="offer-item"]', 'a[href*="offerId"]'],
    scrape: scrape1688,
  },
};

export function makeChromeBrowser({ chrome = globalThis.chrome, fetchFn = globalThis.fetch?.bind(globalThis) } = {}) {
  const exec = async (tabId, func, args = []) => (await chrome.scripting.executeScript({ target: { tabId }, func, args }))[0]?.result;

  async function waitComplete(tabId, maxMs = 15000) {
    const t = Date.now();
    await sleep(300);
    while (Date.now() - t < maxMs) {
      try { if ((await chrome.tabs.get(tabId)).status === 'complete') return; } catch { return; }
      await sleep(300);
    }
  }
  async function waitCards(tabId, selectors, maxMs = 10000) {
    const t = Date.now();
    while (Date.now() - t < maxMs) {
      try { if ((await exec(tabId, countCards, [selectors])) >= 3) return true; } catch { /* 이동 중 */ }
      await sleep(400);
    }
    return false;
  }
  // 같은 사이트 탭이 있으면 재사용(로그인 세션 유지), 없으면 새로 연다.
  // 백그라운드 탭은 지연 로딩이 멈출 수 있어 데모처럼 탭을 앞으로 가져온다 (사이드패널은 그대로 열려 있음).
  async function siteTab(site) {
    const [tab] = await chrome.tabs.query({ url: site.match });
    if (tab) { await chrome.tabs.update(tab.id, { active: true }); return tab.id; }
    const t = await chrome.tabs.create({ url: site.home, active: true });
    await waitComplete(t.id);
    return t.id;
  }

  return {
    /** @returns {Promise<{products: object[], blocked: boolean}>} */
    async search({ platform = 'taobao', query }) {
      const site = SITES[platform];
      const tabId = await siteTab(site);
      if (platform === '1688') {
        // 1688 검색은 GBK 인코딩 폼으로 보내야 한다 (데모에서 확인)
        await exec(tabId, (q) => {
          const f = Object.assign(document.createElement('form'), { method: 'GET', action: 'https://s.1688.com/selloffer/offer_search.htm', acceptCharset: 'GBK' });
          for (const [name, value] of Object.entries({ keywords: q, sortType: 'sa_trd30cnt_des', n: 'y' })) f.append(Object.assign(document.createElement('input'), { type: 'hidden', name, value }));
          document.body.append(f); f.submit();
        }, [query]);
      } else {
        await chrome.tabs.update(tabId, { url: site.url(query) });
      }
      await waitComplete(tabId);
      const found = await waitCards(tabId, site.ready);
      if (found) await exec(tabId, scrollPage);
      const products = found ? (await exec(tabId, site.scrape)) ?? [] : [];
      const url = (await chrome.tabs.get(tabId)).url ?? '';
      const blocked = !products.length && /login|passport|punish|captcha/i.test(url);   // 로그인·보안 확인 페이지로 넘어간 경우
      return { products, blocked };
    },

    /** 상세 페이지: 검색에 쓰던 탭에서 상품 페이지를 열고 이미지·SKU를 읽는다 */
    // full: 이미 열린 상세 페이지를 다시 읽되, 옵션 지름길 없이 사이즈표·이미지까지 모두 읽는다 (페이지 이동 없음)
    async detail({ url, platform = 'taobao', full = false }) {
      const tabId = await siteTab(SITES[platform] ?? SITES.taobao);
      if (!full) {
        await chrome.tabs.update(tabId, { url });
        await waitComplete(tabId, 20000);
        await sleep(1500);
      }
      const d = (await exec(tabId, scrapeDetail, [{ full }])) ?? { images: [], skus: [] };
      const now = (await chrome.tabs.get(tabId)).url ?? '';
      return { ...d, blocked: !d.images.length && /login|passport|punish|captcha/i.test(now) };
    },

    /** 이미지 → LLM 입력(base64). 긴 이미지는 글자가 뭉개지지 않게 폭 1000px, 높이 3000px 안으로 줄인다 */
    async loadImages(urls, { maxW = 1000, maxH = 3000 } = {}) {
      const out = [];
      for (const url of urls) {
        try {
          const blob = await (await fetchFn(url)).blob();
          const bmp = await createImageBitmap(blob);
          const k = Math.min(1, maxW / bmp.width, maxH / bmp.height);
          const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
          c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
          const jpg = await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
          out.push({ url, mimeType: 'image/jpeg', base64: toBase64(await jpg.arrayBuffer()) });
        } catch { /* 못 불러온 이미지는 건너뜀 */ }
      }
      return out;
    },

    /**
     * 사이즈표처럼 보이는지 빠르게 판별 (LLM 없이 이 컴퓨터에서 계산).
     * 폭 120px로 줄여 정사각형 띠로 나누고, 채도가 낮고(흰·회색·검정 배경) 글자·선 같은 경계가 고르게 퍼진 띠를 찾는다.
     * 반환: { url: 2(표) | 1(표일 수도) | 0(아님) }. 사이즈표 25장 기준 1 이상 25장, 2는 24장 (고품질 축소). 일반 사진은 0, 글자 많은 홍보 이미지 일부는 2.
     */
    async chartLike(urls) {
      const out = {};
      for (const url of urls) {
        try {
          const bmp = await createImageBitmap(await (await fetchFn(url)).blob());
          out[url] = looksLikeChart(bmp);
        } catch { out[url] = 1; }             // 판별 실패 시에는 '표일 수도'로 (놓치지 않는 쪽)
      }
      return out;
    },

    async cnyToKrw() {
      try { return (await (await fetchFn('https://open.er-api.com/v6/latest/CNY')).json()).rates.KRW; } catch { return 190; }
    },

    // 상품명 번역 (데모와 같은 무료 번역 주소). 실패하면 원문 그대로.
    async translate(texts, from = 'zh-CN', to = 'ko') {
      return Promise.all(texts.map(async (t) => {
        try {
          const r = await fetchFn(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(t)}`);
          return (await r.json())[0].map((s) => s[0]).join('');
        } catch { return t; }
      }));
    },
  };
}
