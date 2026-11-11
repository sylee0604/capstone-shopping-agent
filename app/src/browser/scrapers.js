// 검색 결과 페이지에서 상품 카드를 읽는 함수. chrome.scripting.executeScript로 페이지에 주입되므로
// 함수 밖의 변수·import를 참조하면 안 된다 (데모 extension/background.js의 코드를 옮겨 정리).

export function scrapeTaobao() {
  const parseCount = (s) => { s = String(s || ''); const n = parseFloat(s.replace(/[^\d.]/g, '')) || 0; return /万|w/i.test(s) ? n * 10000 : n; };
  const parsePrice = (el) => { const t = el?.innerText || ''; return Number((t.match(/[¥￥]\s*(\d+(?:\.\d{1,2})?)/) || t.match(/(\d+(?:\.\d{1,2})?)/) || [])[1]) || null; };
  const image = (card) => {
    for (const el of card.querySelectorAll('img')) {
      let src = el.src || el.getAttribute('data-src') || el.getAttribute('data-original') || '';
      if (!src || src.startsWith('data:') || src.length < 30 || (el.width > 0 && el.width < 40)) continue;
      return src.startsWith('//') ? 'https:' + src : src;
    }
    return '';
  };
  const cards = () => {
    const spm = [...document.querySelectorAll('a[data-spm-act-id]')];
    if (spm.length >= 3) return spm;
    for (const sel of ['[class*="Card--doubleCard"]', '[class*="doubleCard"]', '[data-nid]', '.item.J_MouserOnverReq']) {
      let els = [...document.querySelectorAll(sel)];
      els = els.filter((el) => !els.some((o) => o !== el && o.contains(el)));
      if (els.length >= 3) return els;
    }
    const set = new Set();
    for (const a of document.querySelectorAll('a[href*="item.taobao.com"], a[href*="detail.tmall.com"], a[href*="item.htm?id="]')) {
      let el = a.parentElement;
      for (let d = 0; el && d < 5; d++, el = el.parentElement) if (el.querySelector('img') && (el.innerText || '').length > 10) { set.add(el); break; }
    }
    return [...set];
  };
  const out = [], seen = new Set();
  for (const card of cards()) {
    let id = card.getAttribute('data-spm-act-id') || (card.id.match(/item_id_(\d+)/) || [])[1] || card.querySelector('a[data-spm-act-id]')?.getAttribute('data-spm-act-id') || '';
    const link = card.matches('a') ? card : card.querySelector('a[href*="item.taobao.com"], a[href*="detail.tmall.com"], a[href*="item.htm?id="]');
    if (!id && link) id = (link.href.match(/[?&]id=(\d+)/) || [])[1] || '';
    if (!id) id = card.getAttribute('data-nid') || '';
    const title = (card.querySelector('[class*="title"], [class*="Title"], h3, h2')?.innerText || '').trim().slice(0, 150);
    if (!title || seen.has(id || title)) continue;
    seen.add(id || title);
    const sales = (card.querySelector('[class*="sale"], [class*="deal"], [class*="realSales"], [class*="Trade"]')?.innerText || '').trim();
    const isTmall = /tmall/.test(link?.href || '');
    out.push({
      id: id ? `tb${id}` : `tb-${out.length}`, platform: 'taobao', titleZh: title,
      priceCny: parsePrice(card.querySelector('[class*="price"], [class*="Price"]')),
      sales, salesNum: parseCount(sales), image: image(card),
      shop: (card.querySelector('[class*="shop"], [class*="nick"], [class*="Store"]')?.innerText || '').trim(),
      url: id ? (isTmall ? `https://detail.tmall.com/item.htm?id=${id}` : `https://item.taobao.com/item.htm?id=${id}`) : (link?.href || ''),
    });
  }
  return out;
}

export function scrape1688() {
  const parseCount = (s) => { s = String(s || ''); const n = parseFloat(s.replace(/[^\d.]/g, '')) || 0; return /万|w/i.test(s) ? n * 10000 : n; };
  const parsePrice = (el) => { const t = el?.innerText || ''; return Number((t.match(/[¥￥]\s*(\d+(?:\.\d{1,2})?)/) || t.match(/(\d+(?:\.\d{1,2})?)/) || [])[1]) || null; };
  const image = (card) => {
    for (const el of card.querySelectorAll('img')) {
      let src = el.src || el.getAttribute('data-src') || el.getAttribute('data-lazyload-src') || '';
      if (!src || src.startsWith('data:') || src.length < 30 || (el.width > 0 && el.width < 40)) continue;
      return src.startsWith('//') ? 'https:' + src : src;
    }
    return '';
  };
  const cards = () => {
    for (const sel of ['.search-offer-item', '.search-offer-wrapper', '[class*="search-offer"]', '[class*="offer-item"]', 'div[data-offer-id]', '[class*="offerItem"]']) {
      let els = [...document.querySelectorAll(sel)];
      els = els.filter((el) => !els.some((o) => o !== el && o.contains(el)));
      if (els.length >= 3) return els;
    }
    const set = new Set();
    for (const a of document.querySelectorAll('a[href*="offerId"]')) {
      let el = a.parentElement;
      for (let d = 0; el && d < 5; d++, el = el.parentElement) if (el.querySelector('img') && (el.innerText || '').length > 10) { set.add(el); break; }
    }
    return [...set];
  };
  const out = [], seen = new Set();
  for (const card of cards()) {
    const link = card.querySelector('a[href*="offerId"], a[href*="detail.1688"], a[href*="1688.com"]');
    let id = '';
    try { id = new URLSearchParams((link?.href || '').split('?')[1] || '').get('offerId') || ''; } catch (e) { /* 무시 */ }
    if (!id) id = (link?.href.match(/\/offer\/(\d+)/) || [])[1] || card.getAttribute('data-offer-id') || '';
    const title = (card.querySelector('[class*="title"],[class*="subject"],h2,h3')?.innerText || '').trim().slice(0, 150);
    if (!title || seen.has(id || title)) continue;
    seen.add(id || title);
    const sales = (card.querySelector('[class*="trade"],[class*="sale"],[class*="sold"]')?.innerText || '').trim();
    out.push({
      id: id ? `al${id}` : `al-${out.length}`, platform: '1688', titleZh: title,
      priceCny: parsePrice(card.querySelector('[class*="price"],em')),
      sales, salesNum: parseCount(sales), image: image(card), shop: '',
      url: id ? `https://detail.1688.com/offer/${id}.html` : (link?.href || ''),
    });
  }
  return out;
}

// 지연 로딩 이미지·카드를 불러오기 위해 페이지를 끝까지 스크롤
export async function scrollPage() {
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  let prev = -1;
  for (let i = 0; i < 15; i++) {
    window.scrollBy(0, 900);
    await delay(250);
    if (document.documentElement.scrollHeight === prev) break;
    prev = document.documentElement.scrollHeight;
  }
  window.scrollTo(0, 0);
}

export function countCards(selectors) {
  return Math.max(0, ...selectors.map((s) => document.querySelectorAll(s).length));
}

// 상세 페이지: 상세 설명 이미지(순서대로)와 SKU(사이즈 선택지·품절 여부). 타오바오·티몰·1688 공통으로 넓게 찾는다.
export async function scrapeDetail() {
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const scrollDown = async (times) => {
    let prev = -1;
    for (let i = 0; i < times; i++) {
      window.scrollBy(0, 1200);
      await delay(250);
      if (document.documentElement.scrollHeight === prev && i > 5) break;
      prev = document.documentElement.scrollHeight;
    }
    await delay(400);
    window.scrollTo(0, 0);
  };

  // 1) 옵션(SKU): 페이지 위쪽에 있어 스크롤 없이 읽는다. 티몰 새 페이지는 valueItem--xxxx, 예전 페이지는 J_TSaleProp li
  const skuEls = [...document.querySelectorAll('[class*="valueItem"], [class*="skuItem"], [class*="sku-item"], [data-vid], .J_TSaleProp li, [class*="prop-item"]')]
    .filter((el) => !el.querySelector('[class*="valueItem"], [data-vid]'));                     // 바깥 껍데기 말고 실제 선택지
  const skus = [];
  for (const el of skuEls) {
    const label = (el.getAttribute('title') || el.querySelector('[title]')?.getAttribute('title') || el.innerText || '').trim().split('\n')[0];
    if (!label || label.length > 40 || skus.some((s) => s.label === label)) continue;
    const cls = `${el.className || ''} ${el.parentElement?.className || ''}`;
    skus.push({ label, soldOut: /disabled|soldout|out-of-stock|noStock|isDisable/i.test(cls) || el.getAttribute('aria-disabled') === 'true' });
  }

  // 2) 사이즈표: 티몰 등은 판매자가 이미지 대신 표준 사이즈표(HTML 표)를 쓰는 경우가 많다. "尺码表" 버튼을 눌러 표를 연 뒤 글자로 읽는다
  const SIZE = /尺码|身高|体重|胸围|衣长|裤长|腰围|肩宽/;
  const tableText = (t) => [...t.rows].map((r) => [...r.cells].map((c) => (c.innerText || '').trim()).join(' | ')).join('\n');
  const findTable = async () => {
    const btn = [...document.querySelectorAll('a, button, span, div')].find((e) => e.children.length <= 2 && /^(查看)?(尺码表|尺码参考|尺码助手|尺码对照表?|尺寸表|尺码信息)$/.test((e.innerText || '').trim()));
    if (btn) { try { btn.click(); await delay(1800); } catch (e) { /* 무시 */ } }
    let tables = [...document.querySelectorAll('table')].map(tableText).filter((x) => SIZE.test(x) && x.split('\n').length >= 2);
    if (!tables.length) {
      // 표가 div 격자로 된 경우: 사이즈 관련 말이 있고 줄이 여러 개인 가장 작은 덩어리
      const boxes = [...document.querySelectorAll('[class*="size" i], [class*="chima"], [role="dialog"]')]
        .map((e) => (e.innerText || '').trim()).filter((x) => SIZE.test(x) && x.split('\n').length >= 4 && x.length < 8000);
      tables = boxes.sort((a, b) => a.length - b.length).slice(0, 1);
    }
    return { text: [...new Set(tables)].join('\n\n').slice(0, 8000), button: Boolean(btn) };
  };
  let table = await findTable();

  // 3) 상세 설명 이미지: 표를 찾았으면 짧게만 내리고(시간 절약), 못 찾았으면 끝까지 내려 이미지를 모두 불러온 뒤 표를 한 번 더 찾는다
  await scrollDown(table.text ? 4 : 40);
  if (!table.text) table = await findTable();

  const src = (el) => {
    let s = el.getAttribute('data-src') || el.getAttribute('data-ks-lazyload') || el.getAttribute('data-lazyload-src') || el.currentSrc || el.src || '';
    if (s.startsWith('//')) s = 'https:' + s;
    return s.replace(/_\d+x\d+(q\d+)?\.(jpg|webp|png).*$/i, '').replace(/\.(jpg|png)_\.webp$/i, '.$1');
  };
  const root = document.querySelector('#description, .descV8-container, [class*="desc--"], [class*="Desc"], [class*="detail-desc"], #J_DivItemDesc, .content-detail') || document.body;
  const seen = new Set(), images = [];
  [...root.querySelectorAll('img')].forEach((el) => {
    const url = src(el);
    if (!/^https:\/\//.test(url) || !/alicdn|tbcdn|taobaocdn|1688/.test(url) || seen.has(url)) return;
    const w = el.naturalWidth || el.width || 0, h = el.naturalHeight || el.height || 0;
    if (w && w < 200) return;                                     // 아이콘·작은 썸네일 제외
    seen.add(url);
    const near = (el.closest('div,p,section')?.innerText || '').slice(0, 80);
    images.push({ url, w, h, alt: el.alt || '', near });
  });
  const title = (document.querySelector('h1, [class*="mainTitle"], [class*="ItemTitle"], .tb-main-title')?.innerText || document.title || '').trim().slice(0, 150);
  return { title, images, skus, sizeTableText: table.text, sizeButton: table.button, url: location.href };
}
