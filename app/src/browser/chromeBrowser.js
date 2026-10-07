// 브라우저 조작 (Chrome 확장). 사용자의 로그인된 타오바오·1688 탭에서 검색 결과를 읽는다.
// 노드는 이 객체의 search / cnyToKrw / translate만 쓰므로, 테스트에서는 가짜 객체로 바꿔 끼운다.
import { scrapeTaobao, scrape1688, scrollPage, countCards } from './scrapers.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
