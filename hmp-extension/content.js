// content.js - HMP몰 탭에서 실행
if (window.__hmpContentLoaded) {
  // 이미 로드됨 - 무시
} else {
window.__hmpContentLoaded = true;

const norm = s => String(s || '').replace(/[\s,원]/g, '').toLowerCase();
const visible = el => !!(el && el.offsetParent !== null && el.offsetWidth > 0);

function getSearchQuery() {
  return document.querySelector('input[name="search"]')?.value?.trim() || '';
}

function extractProductNameFromHref(href) {
  const m = String(href || '').match(/searchSubList\s*\(\s*['"]?[^,'"]+['"]?\s*,\s*['"]?[^,'"]+['"]?\s*,\s*['"]([^'"]+)['"]/);
  return m ? m[1].trim() : '';
}

function isProductNameCompatible(productName, searchQuery) {
  const p = norm(productName);
  const q = norm(searchQuery);
  if (!p || !q) return !!p;
  if (p.includes(q) || q.includes(p)) return true;

  const tokens = String(searchQuery || '')
    .split(/[\s/(){}\[\],.+*-]+/)
    .map(norm)
    .filter(t => t.length >= 2);
  return tokens.length > 0 && tokens.some(t => p.includes(t));
}

function getHighlightedResultProductName() {
  const rows = [...document.querySelectorAll('#mainListTable tr[id^="mainList"], tr[id^="mainList"]')];
  for (const row of rows) {
    const bg = window.getComputedStyle(row).backgroundColor;
    const selected = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'rgb(255, 255, 255)';
    if (!selected) continue;

    const link = row.querySelector('a[href*="searchSubList"], a[href*="searchTwoStep"], a');
    const fromHref = extractProductNameFromHref(link?.getAttribute('href') || '');
    const fromText = link?.innerText?.trim() || '';
    return fromHref || fromText;
  }
  return '';
}

function getFirstResultProductName() {
  const links = [...document.querySelectorAll(
    '#mainListTable a[href*="searchSubList"], #mainListTable a[href*="searchTwoStep"], ' +
    'tr[id^="mainList"] a[href*="searchSubList"], tr[id^="mainList"] a[href*="searchTwoStep"], ' +
    'a[href*="searchSubList"], a[href*="searchTwoStep"]'
  )].filter(visible);

  for (const link of links) {
    const fromHref = extractProductNameFromHref(link.getAttribute('href') || '');
    const fromText = link.innerText.trim();
    const name = fromHref || fromText;
    if (name && name.length >= 2) return name;
  }
  return '';
}

// ─── searchSubList 후킹 ───────────────────────────────────────
// 상품 클릭 시 searchSubList(rowIdx, goodsNo, goodsName, unit) 호출됨
// 이 함수를 가로채서 선택된 상품명을 저장

function hookSearchSubList() {
  const tryHook = () => {
    // searchTwoStepList 객체 방식
    if (window.searchTwoStepList?.searchSubList && !window.__hmpHooked1) {
      const orig = window.searchTwoStepList.searchSubList.bind(window.searchTwoStepList);
      window.searchTwoStepList.searchSubList = function(...args) {
        window.__hmpSelectedProductName = args[2] || '';
        window.__hmpSelectedSearchQuery = getSearchQuery();
        console.log('[HMP] 상품 선택됨:', window.__hmpSelectedProductName);
        return orig(...args);
      };
      window.__hmpHooked1 = true;
      return true;
    }
    // 전역 함수 방식
    if (typeof window.searchSubList === 'function' && !window.__hmpHooked2) {
      const orig = window.searchSubList;
      window.searchSubList = function(...args) {
        window.__hmpSelectedProductName = args[2] || '';
        window.__hmpSelectedSearchQuery = getSearchQuery();
        console.log('[HMP] 상품 선택됨:', window.__hmpSelectedProductName);
        return orig.call(this, ...args);
      };
      window.__hmpHooked2 = true;
      return true;
    }
    return false;
  };

  if (!tryHook()) {
    let tries = 0;
    const iv = setInterval(() => { if (tryHook() || tries++ > 30) clearInterval(iv); }, 300);
  }
}

// a[href*="searchSubList"] 클릭 이벤트로도 상품명 캡처 (백업)
document.addEventListener('click', e => {
  const link = e.target.closest('a[href*="searchSubList"], a[href*="searchTwoStep"]');
  if (!link) return;
  const href = link.getAttribute('href') || '';
  // searchSubList('5','12345','상품명','1EA') 형태에서 3번째 인자 추출
  const m = href.match(/searchSubList\s*\(\s*['"]?[^,'"]+['"]?\s*,\s*['"]?[^,'"]+['"]?\s*,\s*['"]([^'"]+)['"]/);
  if (m) {
    window.__hmpSelectedProductName = m[1];
    window.__hmpSelectedSearchQuery = getSearchQuery();
    console.log('[HMP] 클릭으로 상품 선택됨:', m[1]);
  } else {
    // 링크 텍스트로 fallback
    const txt = link.innerText.trim();
    if (txt.length > 3) {
      window.__hmpSelectedProductName = txt;
      window.__hmpSelectedSearchQuery = getSearchQuery();
    }
  }
}, true);

hookSearchSubList();

// ─── 상품 캡처 ───────────────────────────────────────────────

function captureCurrentProduct() {
  try {
    const searchQuery = getSearchQuery();

    // 1. 후킹/클릭으로 저장된 상품명. 단, 새 검색어와 맞지 않으면 예전 상품명으로 보고 버림.
    let productName = '';
    const cachedName = window.__hmpSelectedProductName || '';
    const cachedQuery = window.__hmpSelectedSearchQuery || '';
    if (cachedName && (!searchQuery || cachedQuery === searchQuery || isProductNameCompatible(cachedName, searchQuery))) {
      productName = cachedName;
    }

    // 2. mainListTable 강조행에서 읽기
    const highlightedName = getHighlightedResultProductName();
    if (!productName && isProductNameCompatible(highlightedName, searchQuery)) {
      productName = highlightedName;
    }

    // 3. 상품을 클릭하지 않은 경우 첫 번째 검색 결과에서 읽기
    const firstResultName = getFirstResultProductName();
    if (!productName && isProductNameCompatible(firstResultName, searchQuery)) {
      productName = firstResultName;
    }

    // 4. script var productName fallback
    if (!productName) {
      for (const s of [...document.querySelectorAll('script:not([src])')].reverse()) {
        const m = s.textContent.match(/var\s+productName\s*=\s*['"]([^'"]{3,})['"]/);
        const scriptName = m && !m[1].includes('undefined') ? m[1].trim() : '';
        if (isProductNameCompatible(scriptName, searchQuery)) { productName = scriptName; break; }
      }
    }

    const radios = [...document.querySelectorAll('input[name="subInfoRadio"]')].filter(visible);
    if (radios.length === 0) {
      return { ok: false, error: '업체 가격표를 찾지 못했습니다.\nHMP몰에서 상품을 선택한 후 다시 시도하세요.' };
    }

    const vendors = [];
    for (const radio of radios) {
      const row = radio.closest('tr');
      if (!row) continue;
      const tds = [...row.querySelectorAll('td')].map(td => td.innerText.trim());
      // 구조: [0]=라디오(빈칸) [1]=업체명 [2]=일반가 [3]=할인가(없으면"") [4]=재고
      const vendorName = tds[1] || '';
      const price = parseInt((tds[2] || '').replace(/[^0-9]/g, '')) || 0;
      const discountPrice = parseInt((tds[3] || '').replace(/[^0-9]/g, '')) || 0;
      const stock = parseInt((tds[4] || '').replace(/[^0-9]/g, '')) || 0;

      if (!vendorName || price === 0) continue;
      vendors.push({
        vendor: vendorName,
        price: discountPrice > 0 ? discountPrice : price,
        originalPrice: price,
        stock: stock === 0 ? '' : stock,
        radioValue: radio.value
      });
    }

    if (vendors.length === 0) return { ok: false, error: '업체 정보를 파싱하지 못했습니다.' };

    return {
      ok: true,
      data: {
        productName: productName || searchQuery,
        searchQuery,
        vendors,
        capturedAt: new Date().toISOString()
      }
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── 쿠폰 캡처 ────────────────────────────────────────────────

function guessVendorFromCouponName(couponName) {
  const name = couponName
    .replace(/\[.*?\]/g, '').replace(/[♥♡★☆◆■▶]/g, '')
    .replace(/쿠폰|할인|쇼핑몰|전용|이상|원|구매|적립|포인트|사용|가능|품목/g, '')
    .replace(/\s+/g, ' ').trim();
  const words = name.match(/[가-힣]{2,}/g) || [];
  return words.find(w => /팜$|몰$|샵$|마켓$|스토어$|약$/.test(w))
    || words.find(w => w.length >= 3) || words[0] || '';
}

async function captureAllCoupons() {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  if (!location.href.includes('couponList')) {
    location.href = 'https://hmpmall.co.kr/mypage/couponList.do';
    return { ok: false, error: '쿠폰 페이지로 이동합니다. 잠시 후 다시 시도하세요.' };
  }

  const allCoupons = [];

  function parseCouponsOnPage() {
    const rows = [...document.querySelectorAll('table tr')].filter(tr => tr.querySelectorAll('td').length >= 5);
    const coupons = [];
    for (const row of rows) {
      const tds = [...row.querySelectorAll('td')].map(td => td.innerText.trim().replace(/\s+/g, ' '));
      if (tds.length < 5) continue;
      const couponName = tds[1] || '';
      const discount = parseInt(tds[2].replace(/[^0-9]/g, '')) || 0;
      if (discount === 0) continue;
      const minMatch = tds[3].match(/(\d[\d,]+)\s*원\s*이상/);
      const minOrder = minMatch ? parseInt(minMatch[1].replace(/,/g, '')) : 0;
      const qty = parseInt(tds[6]?.replace(/[^0-9]/g, '') || tds[5]?.replace(/[^0-9]/g, '') || '1') || 1;
      coupons.push({
        couponName: couponName.replace(/사용가능품목\s*:/g, '').trim(),
        vendor: guessVendorFromCouponName(couponName),
        discount, minOrder, qty
      });
    }
    return coupons;
  }

  function getTotalPages() {
    const pageLinks = [...document.querySelectorAll('.pagination a, .paging a, [class*="page"] a')];
    const nums = pageLinks.map(a => parseInt(a.innerText.trim())).filter(n => !isNaN(n) && n > 0);
    return nums.length > 0 ? Math.max(...nums) : 1;
  }

  allCoupons.push(...parseCouponsOnPage());
  const totalPages = getTotalPages();

  for (let page = 2; page <= totalPages; page++) {
    const pageLinks = [...document.querySelectorAll('.pagination a, .paging a, [class*="page"] a')];
    const targetLink = pageLinks.find(a => a.innerText.trim() === String(page));
    if (!targetLink) break;
    targetLink.click();
    await sleep(1500);
    allCoupons.push(...parseCouponsOnPage());
  }

  const seen = new Set();
  const unique = allCoupons.filter(c => {
    const key = `${c.couponName}-${c.discount}-${c.minOrder}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  return { ok: true, coupons: unique, totalPages };
}

// ─── 자동담기 ─────────────────────────────────────────────────

async function runAutoCart(payload, onProgress) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const setVal = (el, val) => {
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const results = [];
  const totalItems = payload.vendors.reduce((s, v) => s + v.items.length, 0);
  let doneCount = 0;

  for (const vendor of payload.vendors) {
    for (const item of vendor.items) {
      const r = { vendor: vendor.vendor, product: item.productName, qty: item.qty, ok: false, reason: '' };
      try {
        onProgress(doneCount, totalItems, `검색 중: ${item.productName}`);
        const searchInput = document.querySelector('input[name="search"]');
        if (!searchInput) throw new Error('검색창을 찾지 못했습니다.');
        setVal(searchInput, item.search || item.productName);
        const submitBtn = searchInput.form?.querySelector('button[type=submit], input[type=submit]');
        if (submitBtn) submitBtn.click();
        else searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        await sleep(2500);

        onProgress(doneCount, totalItems, `상품 선택 중: ${item.productName}`);
        const norm_name = norm(item.productName);
        const links = [...document.querySelectorAll('a')].filter(visible);
        let bestLink = null, bestScore = 0;
        for (const a of links) {
          const t = norm(a.innerText || a.textContent || '');
          if (t.length < 3 || t.length > 120) continue;
          let score = t === norm_name ? 1000 : t.includes(norm_name) ? 500 : norm_name.split('').filter(c => t.includes(c)).length * 2;
          if (score > bestScore) { bestScore = score; bestLink = a; }
        }
        if (!bestLink) throw new Error('상품 링크를 찾지 못했습니다.');
        bestLink.scrollIntoView({ block: 'center' });
        bestLink.click();
        await sleep(2000);

        onProgress(doneCount, totalItems, `업체 선택 중: ${vendor.vendor}`);
        const norm_vendor = norm(vendor.vendor);
        const radios = [...document.querySelectorAll('input[name="subInfoRadio"]')].filter(visible);
        let matched = null;
        for (const radio of radios) {
          const row = radio.closest('tr');
          if (norm(row?.innerText || '').includes(norm_vendor)) { matched = radio; break; }
        }
        if (!matched) throw new Error(`업체 "${vendor.vendor}"를 찾지 못했습니다.`);
        matched.scrollIntoView({ block: 'center' });
        matched.click();
        await sleep(600);

        const qtyInput = document.querySelector('input[name="requestQuantity"]');
        if (!qtyInput) throw new Error('수량 입력란을 찾지 못했습니다.');
        setVal(qtyInput, String(item.qty));
        await sleep(300);

        onProgress(doneCount, totalItems, `장바구니 담는 중: ${item.productName}`);
        const cartBtn = document.querySelector('button.cartBtn');
        if (!cartBtn || !visible(cartBtn)) throw new Error('장바구니 버튼을 찾지 못했습니다.');
        cartBtn.scrollIntoView({ block: 'center' });
        cartBtn.click();
        await sleep(1200);
        r.ok = true;
      } catch (e) { r.reason = e.message; }

      results.push(r);
      doneCount++;
      onProgress(doneCount, totalItems, doneCount < totalItems ? '다음 상품...' : '완료!');
      await sleep(400);
    }
  }
  return results;
}

// ─── 메시지 수신 ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PING') { sendResponse({ ok: true, url: location.href }); return true; }
  if (msg.type === 'CAPTURE') { sendResponse(captureCurrentProduct()); return true; }
  if (msg.type === 'CAPTURE_COUPONS') {
    captureAllCoupons().then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === 'AUTO_CART') {
    runAutoCart(msg.payload, (done, total, label) => {
      chrome.runtime.sendMessage({ type: 'CART_PROGRESS', done, total, label });
    }).then(results => sendResponse({ ok: true, results }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  return false;
});

} // end of __hmpContentLoaded guard
