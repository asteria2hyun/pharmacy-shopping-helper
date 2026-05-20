// popup.js - HMP 구매도우미

const CALC_URL      = 'https://asteria2hyun.github.io/pharmacy-shopping-helper/hmp-helper.html';
const HMP_URL       = 'https://hmpmall.co.kr';
const COUPON_URL    = 'https://hmpmall.co.kr/mypage/couponList.do';
const PATTERNS_KEY  = 'hmp_coupon_patterns';

let hmpTabId = null, calcTabId = null, isCartRunning = false;
let capturedCoupons = [];
let savedPatterns = []; // [{ before, after, example }]

// DOM
const dotHmp        = document.getElementById('dotHmp');
const dotCalc       = document.getElementById('dotCalc');
const statusHmp     = document.getElementById('statusHmp');
const statusCalc    = document.getElementById('statusCalc');
const previewArea   = document.getElementById('previewArea');
const btnCapture    = document.getElementById('btnCapture');
const btnPreview    = document.getElementById('btnPreview');
const btnStartCart  = document.getElementById('btnStartCart');
const btnStopCart   = document.getElementById('btnStopCart');
const msgCapture    = document.getElementById('msgCapture');
const msgCart       = document.getElementById('msgCart');
const progressWrap  = document.getElementById('progressWrap');
const progressLabel = document.getElementById('progressLabel');
const progressBar   = document.getElementById('progressBar');
const btnOpenCalc   = document.getElementById('btnOpenCalc');
const btnOpenHmp    = document.getElementById('btnOpenHmp');
const btnFetchCoupons = document.getElementById('btnFetchCoupons');
const btnSendCoupons  = document.getElementById('btnSendCoupons');
const couponList    = document.getElementById('couponList');
const msgCoupon     = document.getElementById('msgCoupon');

// ─── 패턴 관리 ───────────────────────────────────────────────

async function loadPatterns() {
  const result = await chrome.storage.local.get(PATTERNS_KEY);
  savedPatterns = result[PATTERNS_KEY] || [];
}

async function savePatterns() {
  await chrome.storage.local.set({ [PATTERNS_KEY]: savedPatterns });
}

// ─── 업체명 목록 관리 ──────────────────────────────────────────

const VENDOR_LIST_URL = 'https://hmpmall.co.kr/front/board/entryGuide.do';
const VENDORS_KEY     = 'hmp_vendor_list';
let knownVendors = []; // { name, minOrder }

async function loadKnownVendors() {
  const result = await chrome.storage.local.get(VENDORS_KEY);
  knownVendors = result[VENDORS_KEY] || [];
}

async function fetchAndCacheVendors() {
  try {
    const res = await fetch(VENDOR_LIST_URL, { credentials: 'include' });
    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const vendors = new Map();

    // 입점업체 페이지 구조:
    // table > tr > td[0]=업체명, td[1]=업무의의, td[2]=대표자, td[3]=담당자, td[4]=전화, td[5]=팩스, td[6]=최소주문금액, td[7]=주소
    doc.querySelectorAll('table tr').forEach(tr => {
      const tds = [...tr.querySelectorAll('td')];
      if (tds.length < 6) return; // 헤더행 제외
      const name = tds[0]?.textContent?.trim();
      if (!name || name.length < 2 || !/[가-힣]/.test(name)) return;
      // 6번째 td가 최소주문금액 (없으면 전체 행에서 찾기)
      const minTd = tds[6] || tds[tds.length - 2];
      const minText = minTd?.textContent?.trim() || '';
      // "5만원", "10만원", "5.5만원", "30만원(도서지역10만원)" 등
      const minMatch = minText.match(/(\d+(?:\.\d+)?)\s*만원/);
      const minOrder = minMatch ? Math.round(parseFloat(minMatch[1]) * 10000) : 50000;
      vendors.set(name, minOrder);
    });

    console.log('[HMP] 파싱된 업체 수:', vendors.size);
    if (vendors.size > 0) {
      knownVendors = [...vendors.entries()].map(([name, minOrder]) => ({ name, minOrder }));
      await chrome.storage.local.set({ [VENDORS_KEY]: knownVendors });
      console.log('[HMP] 업체목록 업데이트:', knownVendors.length, '개, 예시:', knownVendors.slice(0,3));
    }
  } catch (e) {
    console.warn('[HMP] 업체목록 fetch 실패:', e.message);
  }
}

// 업체명으로 최저주문금액 조회
function getMinOrderForVendor(vendorName) {
  const v = knownVendors.find(v =>
    v.name === vendorName ||
    vendorName.includes(v.name) ||
    v.name.includes(vendorName)
  );
  return v?.minOrder || 50000;
}

// 쿠폰명에서 업체명 fuzzy 매칭
function matchVendorFromList(couponName) {
  if (!knownVendors.length) return null;
  const clean = couponName
    .replace(/\[.*?\]/g, '').replace(/[♥♡★☆◆■▶❤]/g, '')
    .replace(/쿠폰|할인|쇼핑몰|전용|이상|원|구매|H-DAY/gi, '')
    .toLowerCase().trim();
  const matches = knownVendors
    .map(v => v.name)
    .filter(n => clean.includes(n.toLowerCase()))
    .sort((a, b) => b.length - a.length);
  if (matches.length > 0) return matches[0];
  return null;
}

// ─── 쿠폰 fetch (백그라운드, 탭 이동 없음) ───────────────────

async function fetchCouponsBackground() {
  const allCoupons = [];
  let totalPages = 1;

  const parsePage = async (pageNum) => {
    const url = pageNum === 1 ? COUPON_URL : `${COUPON_URL}?pageNum=${pageNum}`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) { console.warn('[HMP] 쿠폰 fetch 실패:', res.status); return; }
    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    if (pageNum === 1) {
      // 페이지 수 파악
      const pageLinks = [...doc.querySelectorAll('.pagination a, .paging a, [class*="page"] a')];
      const nums = pageLinks.map(a => parseInt(a.textContent.trim())).filter(n => !isNaN(n) && n > 0);
      if (nums.length > 0) totalPages = Math.max(...nums);
      // 전체 테이블 행 수 디버그
      const allRows = doc.querySelectorAll('table tr');
      console.log('[HMP] 쿠폰 페이지 전체 tr 수:', allRows.length, '페이지수:', totalPages);
      // 첫 번째 유효 행 확인
      const firstRow = [...allRows].find(tr => tr.querySelectorAll('td').length >= 3);
      if (firstRow) {
        const tds = [...firstRow.querySelectorAll('td')].map(td => td.textContent.trim().slice(0,30));
        console.log('[HMP] 첫 쿠폰 행 tds:', tds);
      }
    }

    // td 수가 3개 이상인 행 파싱 (쿠폰 목록)
    const rows = [...doc.querySelectorAll('table tr')].filter(tr => tr.querySelectorAll('td').length >= 3);
    for (const row of rows) {
      const tds = [...row.querySelectorAll('td')].map(td => td.textContent.trim().replace(/\s+/g, ' '));
      if (tds.length < 3) continue;
      // 쿠폰명 찾기: 가장 긴 텍스트 td 또는 td[1]
      const couponName = tds[1] || tds[0] || '';
      if (!couponName || couponName.length < 3) continue;
      // 할인금액: 숫자만 있는 td 찾기
      const discount = tds.map(t => parseInt(t.replace(/[^0-9]/g, ''))).find(n => n > 0 && n < 1000000) || 0;
      if (discount === 0) continue;
      const minMatch = tds.join(' ').match(/(\d[\d,]+)\s*원\s*이상/);
      const minOrder = minMatch ? parseInt(minMatch[1].replace(/,/g, '')) : 0;
      const qtyMatch = tds.join(' ').match(/(\d+)\s*장/);
      const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
      allCoupons.push({
        couponName: couponName.replace(/사용가능품목\s*:/g, '').trim(),
        discount, minOrder, qty
      });
    }
    console.log('[HMP] 페이지', pageNum, '파싱 쿠폰 수:', allCoupons.length);
  };

  await parsePage(1);
  for (let p = 2; p <= totalPages; p++) await parsePage(p);

  const seen = new Set();
  return {
    coupons: allCoupons.filter(c => {
      const key = `${c.couponName}-${c.discount}-${c.minOrder}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }),
    totalPages
  };
}

// 저장된 패턴으로 업체명 추출 시도
function extractByPatterns(couponName) {
  for (const p of savedPatterns) {
    const bIdx = couponName.indexOf(p.before);
    if (bIdx === -1) continue;
    const start = bIdx + p.before.length;
    const aIdx = p.after ? couponName.indexOf(p.after, start) : couponName.length;
    if (aIdx === -1) continue;
    const vendor = couponName.slice(start, aIdx).trim();
    if (vendor.length > 0 && vendor.length < 20) return vendor;
  }
  return null;
}

// 사용자가 확정한 업체명으로 패턴 학습
async function learnPattern(couponName, vendor) {
  if (!couponName || !vendor) return;
  const idx = couponName.indexOf(vendor);
  if (idx === -1) return;

  const beforeRaw = couponName.slice(0, idx);
  const afterRaw  = couponName.slice(idx + vendor.length);

  // 앞/뒤 구분자: 비한글/비영문/비숫자 문자열
  const beforeDelim = (beforeRaw.match(/[^\w가-힣]+$/) || [''])[0];
  const afterDelim  = (afterRaw.match(/^[^\w가-힣]+/) || [''])[0];

  const alreadyExists = savedPatterns.some(p => p.before === beforeDelim && p.after === afterDelim);
  if (!alreadyExists && (beforeDelim || afterDelim)) {
    savedPatterns.unshift({ before: beforeDelim, after: afterDelim, example: couponName });
    await savePatterns();
  }
}

// ─── Claude API로 업체명 일괄 추출 ──────────────────────────

async function extractVendorsWithClaude(couponNames) {
  const prompt = `다음은 한국 약국 도매 쇼핑몰(HMP몰)의 쿠폰 목록입니다.
각 쿠폰명에서 쿠폰을 발행한 도매업체명만 추출해주세요.

규칙:
- 업체명은 보통 쿠폰명 안에 포함된 상호명입니다 (예: 가성메디칼, 헬스인팜, 대지인팜, 건강두배로)
- [H-DAY], ♥, ★ 같은 장식 문자와 "쇼핑몰", "쿠폰", "할인", "전용" 같은 일반 단어는 업체명이 아닙니다
- 업체명을 특정할 수 없으면 null을 반환하세요

쿠폰 목록:
${couponNames.map((name, i) => `${i + 1}. ${name}`).join('\n')}

반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{"vendors": ["업체명1", "업체명2", ...]}
null은 null로, 예: {"vendors": ["가성메디칼", null, "헬스인팜"]}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) throw new Error(`API 오류: ${response.status}`);
  const data = await response.json();
  const text = data.content.find(b => b.type === 'text')?.text || '';
  const clean = text.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean);
  return parsed.vendors; // ["업체명1", null, ...]
}

// ─── 빠른 열기 ───────────────────────────────────────────────

btnOpenCalc.addEventListener('click', async () => {
  if (calcTabId) {
    try {
      const tab = await chrome.tabs.get(calcTabId);
      await chrome.tabs.update(calcTabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    } catch { calcTabId = null; btnOpenCalc.click(); }
  } else {
    const tab = await chrome.tabs.create({ url: CALC_URL });
    calcTabId = tab.id;
    dotCalc.className = 'dot ok'; statusCalc.textContent = '계산기 연결됨';
    updateCartButton();
    await waitForTabLoad(calcTabId);
  }
});

btnOpenHmp.addEventListener('click', async () => {
  if (hmpTabId) {
    try {
      const tab = await chrome.tabs.get(hmpTabId);
      await chrome.tabs.update(hmpTabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    } catch { hmpTabId = null; await chrome.tabs.create({ url: HMP_URL }); setTimeout(checkTabs, 2000); }
  } else {
    await chrome.tabs.create({ url: HMP_URL }); setTimeout(checkTabs, 2000);
  }
});

// ─── 탭 상태 ─────────────────────────────────────────────────

const isHmpTab = tab => !!tab?.url?.includes('hmpmall.co.kr');
const isCalcTab = tab => !!tab?.url?.includes('asteria2hyun.github.io/pharmacy-shopping-helper');

async function findPreferredTabs() {
  const tabs = await chrome.tabs.query({});
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const hmpTabs = tabs.filter(isHmpTab);
  const calcTabs = tabs.filter(isCalcTab);

  const hmpTab =
    (isHmpTab(activeTab) ? activeTab : null) ||
    hmpTabs.find(t => t.active && t.windowId === activeTab?.windowId) ||
    (hmpTabId ? hmpTabs.find(t => t.id === hmpTabId) : null) ||
    hmpTabs[0];

  const calcTab =
    (isCalcTab(activeTab) ? activeTab : null) ||
    (calcTabId ? calcTabs.find(t => t.id === calcTabId) : null) ||
    calcTabs.find(t => t.active && t.windowId === activeTab?.windowId) ||
    calcTabs[0];

  return { hmpTab, calcTab };
}

async function checkTabs() {
  const { hmpTab, calcTab } = await findPreferredTabs();

  if (hmpTab) {
    hmpTabId = hmpTab.id;

    // content.js 로드 확인, 없으면 background에 inject 요청
    try {
      await chrome.tabs.sendMessage(hmpTabId, { type: 'PING' });
    } catch {
      // background.js를 통해 inject
      await chrome.runtime.sendMessage({ type: 'INJECT_CONTENT', tabId: hmpTabId });
      await sleep(500);
    }

    dotHmp.className = 'dot ok'; statusHmp.textContent = `HMP몰 연결됨: ${hmpTab.title || '현재 탭'}`;
    btnCapture.disabled = false; btnPreview.disabled = false;
    btnFetchCoupons.disabled = false;
  } else {
    hmpTabId = null;
    dotHmp.className = 'dot'; statusHmp.textContent = 'HMP몰 탭 없음';
    btnCapture.disabled = true; btnPreview.disabled = true;
    btnFetchCoupons.disabled = true;
  }

  if (calcTab) {
    calcTabId = calcTab.id;

    try {
      await chrome.tabs.sendMessage(calcTabId, { type: 'PING_CALC' });
    } catch {
      await chrome.runtime.sendMessage({ type: 'INJECT_CALC', tabId: calcTabId });
      await sleep(500);
    }

    dotCalc.className = 'dot ok'; statusCalc.textContent = '계산기 연결됨';
  } else {
    calcTabId = null;
    dotCalc.className = 'dot'; statusCalc.textContent = '계산기 탭 없음';
  }
  updateCartButton();
}

function updateCartButton() {
  btnStartCart.disabled = !(hmpTabId && calcTabId) || isCartRunning;
}

async function clearStaleHmpProductSelection() {
  if (!hmpTabId) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: hmpTabId },
      func: () => {
        const norm = s => String(s || '').replace(/[\s,원]/g, '').toLowerCase();
        const searchQuery = document.querySelector('input[name="search"]')?.value?.trim() || '';
        const selectedName = window.__hmpSelectedProductName || '';
        const productMatchesSearch = (productName, queryText) => {
          const product = norm(productName);
          const query = norm(queryText);
          if (!product || !query) return !!product;
          if (product.includes(query) || query.includes(product)) return true;
          const tokens = String(queryText || '')
            .split(/[\s/(){}\[\],.+*_-]+/)
            .map(norm)
            .filter(token => token.length >= 2);
          return tokens.some(token => product.includes(token));
        };

        if (selectedName && searchQuery && !productMatchesSearch(selectedName, searchQuery)) {
          window.__hmpSelectedProductName = '';
          window.__hmpSelectedSearchQuery = '';
          return { cleared: true, selectedName, searchQuery };
        }
        return { cleared: false, selectedName, searchQuery };
      }
    });
  } catch (e) {
    console.warn('[HMP] stale selection clear failed:', e.message);
  }
}

// ─── 상품 캡처 ───────────────────────────────────────────────

btnPreview.addEventListener('click', async () => {
  await checkTabs();
  if (!hmpTabId) return;
  showMsg(msgCapture, '', '');
  try {
    await clearStaleHmpProductSelection();
    const result = await chrome.tabs.sendMessage(hmpTabId, { type: 'CAPTURE' });
    if (!result.ok) { showMsg(msgCapture, result.error, 'error'); return; }
    renderPreview(result.data);
  } catch (e) { showMsg(msgCapture, '오류: ' + e.message, 'error'); }
});

btnCapture.addEventListener('click', async () => {
  await checkTabs();
  if (!hmpTabId) return;
  showMsg(msgCapture, '캡처 중...', '');
  try {
    await clearStaleHmpProductSelection();
    const result = await chrome.tabs.sendMessage(hmpTabId, { type: 'CAPTURE' });
    if (!result.ok) { showMsg(msgCapture, result.error, 'error'); return; }
    renderPreview(result.data);

    // 계산기 탭 없으면 열기
    if (!calcTabId) {
      showMsg(msgCapture, '계산기 탭 여는 중...', '');
      const tab = await chrome.tabs.create({ url: CALC_URL, active: false });
      calcTabId = tab.id;
      dotCalc.className = 'dot ok'; statusCalc.textContent = '계산기 연결됨';
      updateCartButton();
      await waitForTabLoad(calcTabId);
    } else {
      // 탭 상태 확인 - URL이 맞아도 실제 로드 실패(오류 페이지)일 수 있음
      try {
        const calcTab = await chrome.tabs.get(calcTabId);
        const url = calcTab.url || '';
        const isErrorUrl = url.startsWith('chrome-error://') || url.startsWith('about:neterror') || url === '';
        // PING으로 실제 응답 가능한지 먼저 확인
        let pingOk = false;
        try {
          await chrome.tabs.sendMessage(calcTabId, { type: 'PING_CALC' });
          pingOk = true;
        } catch {}

        if (!pingOk) {
          // PING 실패 → inject 시도
          let injected = false;
          try {
            await chrome.scripting.executeScript({ target: { tabId: calcTabId }, files: ['calculator.js'] });
            await sleep(500);
            injected = true;
          } catch {}

          if (!injected || isErrorUrl) {
            // inject도 실패(오류 페이지) → 재로드
            showMsg(msgCapture, '계산기 페이지 재로드 중...', '');
            await chrome.tabs.update(calcTabId, { url: CALC_URL });
            await waitForTabLoad(calcTabId);
          }
        }
      } catch {
        // 탭 자체가 사라진 경우 → 새로 열기
        showMsg(msgCapture, '계산기 탭 다시 여는 중...', '');
        const tab = await chrome.tabs.create({ url: CALC_URL, active: false });
        calcTabId = tab.id;
        dotCalc.className = 'dot ok'; statusCalc.textContent = '계산기 연결됨';
        updateCartButton();
        await waitForTabLoad(calcTabId);
      }
    }

    // calculator.js inject 최종 확인
    showMsg(msgCapture, '계산기 연결 확인 중...', '');
    let calcReady = false;
    try {
      await chrome.tabs.sendMessage(calcTabId, { type: 'PING_CALC' });
      calcReady = true;
    } catch {
      try {
        await chrome.scripting.executeScript({ target: { tabId: calcTabId }, files: ['calculator.js'] });
        await sleep(800);
        calcReady = true;
      } catch (e) {
        showMsg(msgCapture, '계산기 연결 실패: ' + e.message, 'error');
        return;
      }
    }

    if (!calcReady) {
      showMsg(msgCapture, '계산기에 연결할 수 없습니다. 계산기 탭을 새로고침 해주세요.', 'error');
      return;
    }

    // 상품 추가
    showMsg(msgCapture, '계산기에 추가 중...', '');
    // vendorMinOrders: 업체명 → 최저주문금액 맵
    const vendorMinOrders = {};
    knownVendors.forEach(v => { vendorMinOrders[v.name] = v.minOrder; });
    const addResult = await chrome.tabs.sendMessage(calcTabId, {
      type: 'ADD_PRODUCT',
      data: result.data,
      vendorMinOrders
    });
    if (addResult?.ok === false) { showMsg(msgCapture, '추가 실패: ' + addResult.error, 'error'); return; }
    showMsg(msgCapture, `✅ "${result.data.productName}" 추가됨!\n업체 ${result.data.vendors.length}곳`, 'success');

  } catch (e) { showMsg(msgCapture, '오류: ' + e.message, 'error'); }
});

// ─── 쿠폰 계산기 전송 헬퍼 ──────────────────────────────────

async function sendCouponsToCalc(coupons) {
  if (!calcTabId || coupons.length === 0) return;
  try {
    await chrome.tabs.sendMessage(calcTabId, { type: 'ADD_COUPONS', coupons });
  } catch (e) {
    console.warn('[HMP] 쿠폰 전송 실패:', e.message);
  }
}

// ─── 쿠폰 캡처 ───────────────────────────────────────────────

btnFetchCoupons.addEventListener('click', async () => {
  showMsg(msgCoupon, '쿠폰 불러오는 중...', '');
  btnFetchCoupons.disabled = true;
  couponList.innerHTML = '<div class="coupon-empty">불러오는 중...</div>';

  try {
    // 업체 목록 먼저 로드 (없으면 fetch, 있으면 캐시 사용)
    if (knownVendors.length === 0) {
      showMsg(msgCoupon, '업체 목록 불러오는 중...', '');
      await fetchAndCacheVendors();
    } else {
      fetchAndCacheVendors().catch(() => {}); // 백그라운드 갱신
    }

    // 1. 백그라운드 fetch (탭 이동 없음)
    const result = await fetchCouponsBackground();

    // 2. 업체명 매칭: 패턴 → 업체목록 순서
    capturedCoupons = result.coupons.map(c => {
      const byPattern = extractByPatterns(c.couponName);
      const byList    = !byPattern ? matchVendorFromList(c.couponName) : null;
      const vendor    = byPattern || byList || '';
      const source    = byPattern ? 'pattern' : byList ? 'list' : 'unknown';
      return { ...c, vendor, source };
    });

    // 3. 미인식만 AI로 추출
    const unknownIdxs = capturedCoupons
      .map((c, i) => c.source === 'unknown' ? i : -1)
      .filter(i => i !== -1);

    if (unknownIdxs.length > 0) {
      showMsg(msgCoupon, `쿠폰 ${result.coupons.length}개\nAI 분석 중... (${unknownIdxs.length}개)`, '');
      try {
        const unknownNames = unknownIdxs.map(i => capturedCoupons[i].couponName);
        const extracted = await extractVendorsWithClaude(unknownNames);
        unknownIdxs.forEach((couponIdx, arrIdx) => {
          const vendor = extracted[arrIdx] || '';
          capturedCoupons[couponIdx].vendor = vendor;
          capturedCoupons[couponIdx].source = vendor ? 'ai' : 'unknown';
        });
        for (const idx of unknownIdxs) {
          const c = capturedCoupons[idx];
          if (c.vendor) await learnPattern(c.couponName, c.vendor);
        }
      } catch (e) { console.warn('AI 추출 실패:', e.message); }
    }

    // 4. 인식된 쿠폰 → 계산기 자동 추가
    const recognized = capturedCoupons.filter(c => c.vendor);
    const unrecognized = capturedCoupons.filter(c => !c.vendor);

    if (recognized.length > 0 && calcTabId) {
      await sendCouponsToCalc(recognized);
    }

    // 5. 미인식 쿠폰만 UI에 표시
    renderCouponList(capturedCoupons);

    const unknown = unrecognized.length;
    if (unknown > 0) {
      showMsg(msgCoupon,
        `✅ ${recognized.length}개 자동 추가됨\n⚠️ ${unknown}개 업체 미인식 → 드롭다운에서 선택해주세요`,
        ''
      );
    } else {
      showMsg(msgCoupon, `✅ 쿠폰 ${recognized.length}개 모두 계산기에 추가됨!`, 'success');
    }

  } catch (e) {
    showMsg(msgCoupon, '오류: ' + e.message, 'error');
    couponList.innerHTML = '<div class="coupon-empty">오류 발생</div>';
  }
  btnFetchCoupons.disabled = false;
});

btnSendCoupons.addEventListener('click', async () => {
  if (!calcTabId || capturedCoupons.length === 0) return;

  const items = [...couponList.querySelectorAll('.coupon-item')];
  const toSend = [];

  for (const item of items) {
    const cb = item.querySelector('.coupon-cb');
    if (!cb.checked) continue;

    const idx = parseInt(item.dataset.idx);
    const coupon = capturedCoupons[idx];

    // 드롭다운으로 직접 선택한 값도 확인
    const selectEl = item.querySelector('.cvendor-input');
    if (selectEl && selectEl.value.trim()) {
      capturedCoupons[idx].vendor = selectEl.value.trim();
      capturedCoupons[idx].source = 'manual';
      await learnPattern(coupon.couponName, selectEl.value.trim());
    }
    if (!capturedCoupons[idx].vendor) {
      showMsg(msgCoupon, `"${coupon.couponName.slice(0,20)}..." 업체명을 선택해주세요.`, 'error');
      selectEl?.focus();
      return;
    }

    // 패턴 재학습 (AI 추출된 것도 패턴으로 굳히기)
    if (coupon.source === 'ai') {
      await learnPattern(coupon.couponName, coupon.vendor);
    }

    toSend.push({ ...coupon });
  }

  if (toSend.length === 0) {
    showMsg(msgCoupon, '추가할 쿠폰을 체크해주세요.', 'error');
    return;
  }

  try {
    const result = await chrome.tabs.sendMessage(calcTabId, { type: 'ADD_COUPONS', coupons: toSend });
    if (result?.ok === false) { showMsg(msgCoupon, '추가 실패: ' + result.error, 'error'); return; }
    showMsg(msgCoupon, `✅ 쿠폰 ${toSend.length}개 계산기에 추가됨!`, 'success');
  } catch (e) { showMsg(msgCoupon, '오류: ' + e.message, 'error'); }
});

// 업체명 탭하면 수정 가능
couponList.addEventListener('click', async e => {
  const vendorEl = e.target.closest('.cvendor');
  if (!vendorEl) return;

  const idx = parseInt(vendorEl.dataset.idx);
  const coupon = capturedCoupons[idx];
  const current = coupon.vendor || '';

  const newVendor = prompt(`업체명 수정\n쿠폰: ${coupon.couponName}`, current);
  if (newVendor === null) return; // 취소
  const trimmed = newVendor.trim();

  capturedCoupons[idx].vendor = trimmed;
  capturedCoupons[idx].source = trimmed ? 'manual' : 'unknown';

  if (trimmed) await learnPattern(coupon.couponName, trimmed);

  renderCouponList(capturedCoupons);
  const unknown = capturedCoupons.filter(c => !c.vendor).length;
  showMsg(msgCoupon, unknown > 0 ? `⚠️ ${unknown}개 업체명 미인식` : '✅ 모두 확인됨. 계산기에 추가해주세요.', unknown > 0 ? '' : 'success');
});

// 드롭다운 선택 시 즉시 계산기에 추가
couponList.addEventListener('change', async e => {
  const select = e.target.closest('.cvendor-input');
  if (!select) return;
  const idx = parseInt(select.dataset.idx);
  const vendor = select.value.trim();
  if (!vendor) return;

  capturedCoupons[idx].vendor = vendor;
  capturedCoupons[idx].source = 'manual';
  await learnPattern(capturedCoupons[idx].couponName, vendor);

  // 즉시 계산기에 추가
  if (calcTabId) {
    await sendCouponsToCalc([capturedCoupons[idx]]);
    select.style.borderColor = '#22c55e';
    select.style.background = '#f0fdf4';
    select.disabled = true;
    // 체크박스도 체크됨으로 표시
    const item = select.closest('.coupon-item');
    const cb = item?.querySelector('.coupon-cb');
    if (cb) cb.checked = true;
  }

  const remaining = capturedCoupons.filter(c => !c.vendor).length;
  if (remaining === 0) {
    showMsg(msgCoupon, '✅ 모든 쿠폰이 계산기에 추가됐어요!', 'success');
  } else {
    showMsg(msgCoupon, `⚠️ ${remaining}개 남음`, '');
  }
});

// ─── 자동담기 ────────────────────────────────────────────────

btnStartCart.addEventListener('click', async () => {
  if (!hmpTabId || !calcTabId || isCartRunning) return;
  showMsg(msgCart, '', '');

  try {
    const calcResult = await chrome.tabs.sendMessage(calcTabId, { type: 'GET_CART_PAYLOAD' });
    if (calcResult?.ok === false) { showMsg(msgCart, calcResult.error, 'error'); return; }

    await sleep(600);
    let payload = null;
    try {
      const clipText = await navigator.clipboard.readText();
      payload = JSON.parse(clipText);
    } catch {
      showMsg(msgCart, '계산기에서 추천 결과를 먼저 만들고\n자동담기 데이터 복사를 눌러주세요.', 'error');
      return;
    }

    if (!payload || payload.type !== 'hmp-auto-cart-v1') {
      showMsg(msgCart, '자동담기 데이터 형식이 맞지 않습니다.', 'error');
      return;
    }

    const totalItems = payload.vendors.reduce((s, v) => s + v.items.length, 0);
    if (totalItems === 0) { showMsg(msgCart, '담을 상품이 없습니다.', 'error'); return; }

    await chrome.tabs.update(hmpTabId, { active: true });
    isCartRunning = true;
    btnStartCart.disabled = true; btnStopCart.disabled = false;
    progressWrap.style.display = 'block';
    updateProgress(0, totalItems, '시작 중...');

    const cartResult = await chrome.tabs.sendMessage(hmpTabId, { type: 'AUTO_CART', payload });
    isCartRunning = false; btnStopCart.disabled = true; updateCartButton();

    if (cartResult?.ok) {
      const ok = cartResult.results.filter(r => r.ok).length;
      const fail = cartResult.results.filter(r => !r.ok);
      showMsg(msgCart,
        `완료! ✅ ${ok}건 성공 / ❌ ${fail.length}건 실패` +
        (fail.length ? '\n\n' + fail.map(r => `• [${r.vendor}] ${r.product}\n  ${r.reason}`).join('\n') : ''),
        fail.length ? 'error' : 'success'
      );
      updateProgress(totalItems, totalItems, '완료!');
    } else {
      showMsg(msgCart, '오류: ' + (cartResult?.error || '알 수 없는 오류'), 'error');
    }
  } catch (e) {
    isCartRunning = false; btnStopCart.disabled = true; updateCartButton();
    showMsg(msgCart, '오류: ' + e.message, 'error');
  }
});

btnStopCart.addEventListener('click', async () => {
  if (hmpTabId) await chrome.tabs.reload(hmpTabId);
  isCartRunning = false; btnStopCart.disabled = true;
  progressWrap.style.display = 'none'; updateCartButton();
  showMsg(msgCart, '자동담기를 중단했습니다.', 'error');
});

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'CART_PROGRESS') updateProgress(msg.done, msg.total, msg.label);
});

// ─── 렌더링 ──────────────────────────────────────────────────

function renderPreview(data) {
  if (!data) { previewArea.innerHTML = '<div class="empty">데이터 없음</div>'; return; }
  previewArea.innerHTML = `
    <div class="name">${escHtml(data.productName)}</div>
    <div class="vendors">${data.vendors.length}개 업체: ${
      data.vendors.slice(0, 4).map(v => `${escHtml(v.vendor)} ${v.price.toLocaleString()}원`).join(', ')
    }${data.vendors.length > 4 ? ' …' : ''}</div>`;
}

function renderCouponList(coupons) {
  if (!coupons || coupons.length === 0) {
    couponList.innerHTML = '<div class="coupon-empty">쿠폰이 없습니다.</div>';
    return;
  }

  couponList.innerHTML = coupons.map((c, i) => {
    const badge =
      c.source === 'pattern' ? `<span class="cbadge pattern">✓패턴</span>` :
      c.source === 'list'    ? `<span class="cbadge list">✓목록</span>` :
      c.source === 'ai'      ? `<span class="cbadge ai">✦AI</span>` :
      c.source === 'manual'  ? `<span class="cbadge manual">✎수동</span>` :
                               `<span class="cbadge unknown">?미인식</span>`;

    const vendorHtml = c.vendor
      ? `<span class="cvendor" data-idx="${i}">${escHtml(c.vendor)}</span>`
      : `<select class="cvendor-input" data-idx="${i}">
          <option value="">-- 업체 선택 --</option>
          ${knownVendors.map(v => `<option value="${escHtml(v.name)}">${escHtml(v.name)}</option>`).join('')}
         </select>`;

    return `
    <div class="coupon-item" data-idx="${i}">
      <input type="checkbox" class="coupon-cb" ${c.vendor ? 'checked' : ''}>
      <div class="coupon-info">
        <div class="coupon-name" title="${escHtml(c.couponName)}">
          ${escHtml(c.couponName.slice(0, 22))}${c.couponName.length > 22 ? '…' : ''}
        </div>
        <div class="coupon-detail">${c.discount.toLocaleString()}원 / ${c.minOrder > 0 ? c.minOrder.toLocaleString() + '원↑' : '조건없음'} / ${c.qty}장</div>
      </div>
      <div class="coupon-vendor-wrap">
        ${vendorHtml}${badge}
      </div>
    </div>`;
  }).join('');
}

// ─── 유틸 ────────────────────────────────────────────────────

function updateProgress(done, total, label) {
  progressLabel.textContent = `${label} (${done}/${total})`;
  progressBar.style.width = (total > 0 ? Math.round(done / total * 100) : 0) + '%';
}

function showMsg(el, text, type) {
  el.textContent = text;
  el.className = 'msg' + (type ? ' ' + type : '');
}

function escHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 1000);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(resolve, 6000);
  });
}

async function init() {
  await loadPatterns();
  await loadKnownVendors();
  await checkTabs();
  // 업체 목록 백그라운드 갱신
  fetchAndCacheVendors().catch(() => {});
}

init();
