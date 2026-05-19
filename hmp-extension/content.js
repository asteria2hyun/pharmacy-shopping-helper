(() => {
  if (window.__hmpAutoCartContentLoaded) return;
  window.__hmpAutoCartContentLoaded = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value) => String(value || "").replace(/\s+/g, "").toLowerCase();
  const textOf = (element) => String(element?.innerText || element?.textContent || "");
  const isVisible = (element) => Boolean(element && element.offsetParent !== null);
  let isRunning = false;

  function looksLikePriceRow(value) {
    const text = String(value || "").trim();
    const numberMatches = text.match(/\d[\d,]*/g) || [];
    const hasProductUnit = /(ml|mg|g|kg|cm|mm|매|팩|포|개|입|정|캡슐|병|통|ea|set|겹)/i.test(text);
    if (hasProductUnit) return false;
    if (numberMatches.length < 2 || text.length >= 36) return false;

    const lettersOnly = text.replace(/[\d\s,./()*+\-~원]/g, "");
    const hasPriceLikeNumber = numberMatches.some((match) => Number(String(match).replace(/[^\d.-]/g, "")) >= 100);
    return hasPriceLikeNumber && lettersOnly.length > 0 && lettersOnly.length <= 12;
  }

  function parseNumber(value) {
    const number = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(number) ? number : 0;
  }

  function validatePayload(payload) {
    const badItems = payload.vendors
      .flatMap((vendor) => vendor.items)
      .filter((item) => looksLikePriceRow(item.productName));
    if (badItems.length) {
      throw new Error("상품명이 업체 가격행처럼 보입니다. 계산기에서 선택 상품명을 실제 HMP 상품명으로 수정해 주세요.");
    }
  }

  function ensurePanel() {
    let panel = document.querySelector("#hmp-auto-cart-panel");
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = "hmp-auto-cart-panel";
    panel.style.cssText = [
      "position:fixed",
      "right:24px",
      "top:130px",
      "z-index:2147483647",
      "width:360px",
      "max-height:520px",
      "overflow:auto",
      "border:1px solid #1663d9",
      "border-radius:8px",
      "box-shadow:0 12px 30px rgba(0,0,0,.18)",
      "background:#fff",
      "font-family:Malgun Gothic,Segoe UI,Arial,sans-serif",
      "font-size:12px",
      "color:#17202a",
    ].join(";");
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#1663d9;color:white;font-weight:800;">
        <span>약국쇼핑몰 자동담기</span>
        <button id="hmp-auto-cart-close" style="border:0;background:transparent;color:white;font-size:18px;cursor:pointer;">×</button>
      </div>
      <div id="hmp-auto-cart-log" style="display:grid;gap:6px;padding:10px 12px;"></div>
    `;
    document.body.appendChild(panel);
    panel.querySelector("#hmp-auto-cart-close").addEventListener("click", () => panel.remove());
    return panel;
  }

  function log(message, type = "") {
    const panel = ensurePanel();
    const logBox = panel.querySelector("#hmp-auto-cart-log");
    const row = document.createElement("div");
    const color = type === "ok" ? "#0f8f5f" : type === "error" ? "#d92d20" : "#667085";
    row.style.cssText = `line-height:1.45;color:${color};border-bottom:1px solid #eef2f6;padding-bottom:5px;`;
    row.textContent = message;
    logBox.appendChild(row);
    row.scrollIntoView({ block: "nearest" });
  }

  function clickElement(element) {
    if (!element) return false;
    element.scrollIntoView({ block: "center", inline: "center" });
    element.focus?.();
    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    element.click();
    return true;
  }

  function setValue(element, value) {
    element.focus();
    element.select?.();
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (nativeSetter) nativeSetter.call(element, String(value));
    else element.value = String(value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: String(value).slice(-1) || "0" }));
  }

  function callInlineHandler(element) {
    const onclick = element?.getAttribute?.("onclick");
    if (!onclick) return false;
    try {
      Function(onclick).call(element);
      return true;
    } catch (error) {
      log(`직접 실행 실패: ${error.message}`, "error");
      return false;
    }
  }

  function distanceBetween(a, b) {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    const ax = ar.left + ar.width / 2;
    const ay = ar.top + ar.height / 2;
    const bx = br.left + br.width / 2;
    const by = br.top + br.height / 2;
    return Math.hypot(ax - bx, ay - by);
  }

  function findSearchInput() {
    return [...document.querySelectorAll("input[type=text], input:not([type]), textarea")]
      .filter(isVisible)
      .filter((input) => {
        const rect = input.getBoundingClientRect();
        const text = normalize(`${input.placeholder || ""} ${input.name || ""} ${input.id || ""}`);
        return rect.width >= 180 || text.includes("search") || text.includes("keyword") || text.includes("상품");
      })
      .sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight))[0];
  }

  function findClickableByText(patterns, root = document) {
    return [...root.querySelectorAll("button, a, input[type=button], input[type=submit]")]
      .find((element) => {
        if (!isVisible(element)) return false;
        const text = normalize(`${textOf(element)} ${element.value || ""} ${element.alt || ""} ${element.title || ""}`);
        return patterns.some((pattern) => text.includes(normalize(pattern)));
      });
  }

  function clickableText(element) {
    return normalize(`${textOf(element)} ${element.value || ""} ${element.alt || ""} ${element.title || ""} ${element.getAttribute("onclick") || ""}`);
  }

  function findSearchButton(input) {
    const inputRect = input.getBoundingClientRect();
    const candidates = [...document.querySelectorAll("button, a, input[type=button], input[type=submit], img")]
      .filter((element) => {
        if (!isVisible(element)) return false;
        const rect = element.getBoundingClientRect();
        const isNearRight = rect.left >= inputRect.right - 8 && rect.left <= inputRect.right + 90;
        const isSameLine = Math.abs((rect.top + rect.height / 2) - (inputRect.top + inputRect.height / 2)) <= 28;
        const text = clickableText(element);
        return isNearRight && isSameLine && (
          text.includes("검색") ||
          text.includes("search") ||
          text.includes("btnsearch") ||
          text.includes("goodssearch")
        );
      })
      .sort((a, b) => distanceBetween(a, input) - distanceBetween(b, input));
    return candidates[0] || null;
  }

  function findOrderPanel(vendorName = "") {
    const vendor = normalize(vendorName);
    const allCandidates = [...document.querySelectorAll("div, section, table, tbody")]
      .filter(isVisible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const text = normalize(textOf(element));
        return { element, rect, text, area: rect.width * rect.height };
      })
      .filter(({ rect, text }) => {
        if (rect.width < 220 || rect.width > 430 || rect.height < 180) return false;
        if (rect.left < window.innerWidth * 0.45) return false;
        const hasOrderWords = text.includes("선택상품") || text.includes("업체명") || text.includes("공급가") || text.includes("장바구니담기");
        const hasVendor = !vendor || text.includes(vendor);
        return hasOrderWords && hasVendor;
      });

    const candidates = allCandidates.length ? allCandidates : [...document.querySelectorAll("div, section, table, tbody")]
      .filter(isVisible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const text = normalize(textOf(element));
        return { element, rect, text, area: rect.width * rect.height };
      })
      .filter(({ rect, text }) => {
        if (rect.width < 220 || rect.width > 430 || rect.height < 180) return false;
        if (rect.left < window.innerWidth * 0.45) return false;
        return text.includes("선택상품") || text.includes("업체명") || text.includes("공급가") || text.includes("장바구니담기");
      });

    candidates
      .sort((a, b) => {
        const aScore = (a.text.includes("장바구니담기") ? 0 : 1) + (a.text.includes("업체명") ? 0 : 1);
        const bScore = (b.text.includes("장바구니담기") ? 0 : 1) + (b.text.includes("업체명") ? 0 : 1);
        if (aScore !== bScore) return aScore - bScore;
        return a.area - b.area;
      });
    return candidates[0]?.element || document;
  }

  function getCurrentSearchText() {
    return String(findSearchInput()?.value || "").trim();
  }

  function compactLines(element) {
    return textOf(element)
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }

  function guessSelectedProductName(panel) {
    const lines = compactLines(panel);
    const search = normalize(getCurrentSearchText());
    const candidates = lines.filter((line) => {
      if (line.length < 8 || line.length > 90) return false;
      if (/선택상품|업체명|공급가|재고|수량|장바구니|관심상품|배송|주문마감|최근주문|가격우선순/.test(line)) return false;
      if (looksLikePriceRow(line)) return false;
      if (/^\d/.test(line)) return false;
      return /[가-힣A-Za-z]/.test(line);
    });

    if (search) {
      const searched = candidates.find((line) => normalize(line).includes(search));
      if (searched) return searched;
    }

    return candidates.sort((a, b) => b.length - a.length)[0] || "";
  }

  function parseQuoteRows(panel) {
    const rows = [...panel.querySelectorAll("tr, li, div")]
      .filter(isVisible)
      .map((row) => {
        const text = textOf(row).replace(/\s+/g, " ").trim();
        const normalized = normalize(text);
        const rect = row.getBoundingClientRect();
        return { row, text, normalized, rect };
      })
      .filter(({ text, normalized, rect }) => {
        if (!text || rect.width > 430 || rect.height > 120 || rect.height < 12) return false;
        if (/업체명|공급가|재고|수량|장바구니|주문마감|배송/.test(text)) return false;
        return /\d[\d,]*\s*원?/.test(text) && /[가-힣A-Za-z]/.test(text) && !normalized.includes("부족금액");
      });

    const quotes = [];
    rows.forEach(({ text, row }) => {
      const checked = row.querySelector("input[type=radio], input[type=checkbox]");
      const matches = [...text.matchAll(/\d[\d,]*/g)];
      if (!matches.length) return;

      const firstNumber = matches[0];
      const vendor = text.slice(0, firstNumber.index).replace(/[ㆍ·:|-]+$/g, "").trim();
      if (!vendor || vendor.length > 24 || /^\d/.test(vendor)) return;

      const numbers = matches.map((match) => parseNumber(match[0])).filter((number) => number > 0);
      const price = numbers.find((number) => number >= 10);
      if (!price) return;

      const stock = numbers.find((number, index) => index > 0 && number !== price) ?? "";
      quotes.push({
        vendor,
        price,
        minOrder: 50000,
        stock,
        enabled: true,
        selected: Boolean(checked?.checked),
      });
    });

    const seen = new Set();
    return quotes.filter((quote) => {
      const key = `${quote.vendor}:${quote.price}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function captureCurrentProduct() {
    const panel = findOrderPanel();
    const productName = guessSelectedProductName(panel);
    const quotes = parseQuoteRows(panel);
    if (!productName || !quotes.length) {
      throw new Error("선택상품명 또는 업체 가격표를 찾지 못했습니다. HMP에서 상품을 선택한 뒤 다시 시도해 주세요.");
    }

    return {
      type: "hmp-product-capture-v1",
      createdAt: new Date().toISOString(),
      source: location.href,
      search: getCurrentSearchText(),
      name: productName,
      qty: 1,
      quotes,
    };
  }

  function findCartButton(root = document) {
    const candidates = [...root.querySelectorAll("button, a, input[type=button], input[type=submit]")]
      .filter(isVisible)
      .map((element) => {
        const text = clickableText(element);
        return { element, text };
      })
      .filter(({ text }) => {
        if (!text) return false;
        if (/(보기|이동|요약|미니|최근주문|관심상품|전체보기|전용관|추천|재구매)/.test(text)) return false;
        return text.includes("장바구니담기") || text.includes("cartinsert") || text.includes("addcart");
      })
      .sort((a, b) => {
        const aExact = a.text.includes("장바구니담기") ? 1 : 0;
        const bExact = b.text.includes("장바구니담기") ? 1 : 0;
        if (bExact !== aExact) return bExact - aExact;
        return textOf(a.element).length - textOf(b.element).length;
      });
    return candidates[0]?.element || null;
  }

  function findCartButtonNearQuantity(qtyInput, root = document) {
    const buttons = [...root.querySelectorAll("button, a, input[type=button], input[type=submit]")]
      .filter(isVisible)
      .map((element) => ({ element, text: clickableText(element) }))
      .filter(({ text }) => {
        if (!text) return false;
        if (/(보기|이동|요약|미니|최근주문|관심상품|전체보기|전용관|추천|재구매)/.test(text)) return false;
        return text.includes("장바구니담기") || text.includes("cartinsert") || text.includes("addcart");
      })
      .sort((a, b) => distanceBetween(a.element, qtyInput) - distanceBetween(b.element, qtyInput));
    return buttons[0]?.element || null;
  }

  async function searchProduct(query) {
    const input = findSearchInput();
    if (!input) throw new Error("검색창을 찾지 못했습니다.");

    setValue(input, query);
    const button = findSearchButton(input) || input.closest("form")?.querySelector("button, input[type=submit]");
    if (button) {
      clickElement(button);
    } else {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    }
    await sleep(1800);
  }

  async function selectProduct(productName) {
    const target = normalize(productName);
    const tokens = target
      .split(/[\[\]\(\)\/,+·ㆍ\-_ ]+/)
      .map(normalize)
      .filter((token) => token.length >= 2)
      .slice(0, 6);
    const shortTarget = target.slice(0, Math.min(18, target.length));
    const candidates = [...document.querySelectorAll("tr, li")]
      .filter(isVisible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width > 900 || rect.height > 190 || rect.height < 18) return false;
        const text = normalize(textOf(element));
        if (!text || /이벤트|바로가기|자세히보기|광고|골프|레슨/.test(textOf(element)) && !target.includes("골프")) return false;
        const tokenHits = tokens.filter((token) => text.includes(token)).length;
        return text.includes(shortTarget) || tokenHits >= Math.min(2, tokens.length);
      })
      .sort((a, b) => {
        const aText = normalize(textOf(a));
        const bText = normalize(textOf(b));
        const aHits = tokens.filter((token) => aText.includes(token)).length;
        const bHits = tokens.filter((token) => bText.includes(token)).length;
        if (bHits !== aHits) return bHits - aHits;
        return textOf(a).length - textOf(b).length;
      });

    if (!candidates[0]) return false;
    const link = candidates[0].querySelector("a, button, input[type=button]");
    clickElement(link || candidates[0]);
    await sleep(1000);
    return true;
  }

  function findVendorRow(vendorName, root = document) {
    const targetVendor = normalize(vendorName);
    const rows = [...root.querySelectorAll("tr, li, div")]
      .filter(isVisible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width > 430 || rect.height > 180 || rect.height < 12) return false;
        return normalize(textOf(element)).includes(targetVendor);
      })
      .sort((a, b) => {
        const aHasRadio = a.querySelector("input[type=radio]") ? 1 : 0;
        const bHasRadio = b.querySelector("input[type=radio]") ? 1 : 0;
        if (bHasRadio !== aHasRadio) return bHasRadio - aHasRadio;
        return textOf(a).length - textOf(b).length;
      });
    return rows[0] || null;
  }

  function findQuantityInput(anchor, root = document) {
    const localInput = [...anchor.querySelectorAll("input")]
      .filter(isVisible)
      .find((input) => /number|text|tel/.test(input.type || "text") && !input.readOnly && !input.disabled);
    if (localInput) return localInput;

    const searchInput = findSearchInput();
    const inputs = [...root.querySelectorAll("input")]
      .filter(isVisible)
      .filter((input) => input !== searchInput)
      .filter((input) => /number|text|tel/.test(input.type || "text") && !input.readOnly && !input.disabled)
      .filter((input) => {
        const rect = input.getBoundingClientRect();
        const value = String(input.value || "").trim();
        return rect.width <= 95 && rect.height <= 38 && (!value || /^\d+$/.test(value));
      })
      .sort((a, b) => distanceBetween(a, anchor) - distanceBetween(b, anchor));
    return inputs[0] || null;
  }

  async function setVendorQuantityAndCart(vendorName, productName, qty) {
    const panel = findOrderPanel(vendorName);
    log(`주문패널 확인: ${panel === document ? "전체 화면 기준" : "오른쪽 선택상품 패널 기준"}`);

    const row = findVendorRow(vendorName, panel);
    if (!row) {
      return {
        ok: false,
        vendor: vendorName,
        product: productName,
        qty,
        reason: "업체 행을 찾지 못했습니다.",
      };
    }

    const radio = row.querySelector("input[type=radio], input[type=checkbox]");
    if (radio) {
      clickElement(radio);
      await sleep(250);
    } else {
      clickElement(row);
      await sleep(250);
    }

    const qtyInput = findQuantityInput(row, panel);
    if (!qtyInput) {
      return {
        ok: false,
        vendor: vendorName,
        product: productName,
        qty,
        reason: "수량 입력칸을 찾지 못했습니다.",
      };
    }
    setValue(qtyInput, qty);
    log(`수량 입력: ${vendorName} ${qty}개 (현재 칸 값: ${qtyInput.value})`);
    await sleep(500);

    const cartButton = findCartButtonNearQuantity(qtyInput, panel) || findCartButton(panel);
    if (!cartButton) {
      return {
        ok: false,
        vendor: vendorName,
        product: productName,
        qty,
        reason: "장바구니 담기 버튼을 찾지 못했습니다.",
      };
    }

    log(`장바구니 담기 버튼 클릭: ${textOf(cartButton) || cartButton.value || cartButton.title || cartButton.getAttribute("onclick") || "버튼"}`);
    clickElement(cartButton);
    callInlineHandler(cartButton);
    await sleep(1300);
    return { ok: true, vendor: vendorName, product: productName, qty };
  }

  async function runAutoCart(payload) {
    if (isRunning) {
      log("이미 자동담기가 진행 중입니다.", "error");
      return [];
    }

    validatePayload(payload);
    isRunning = true;
    const results = [];
    const itemCount = payload.vendors.reduce((sum, vendor) => sum + vendor.items.length, 0);
    log(`자동담기 시작: 업체 ${payload.vendors.length}곳, 품목 ${itemCount}개`);

    for (const vendor of payload.vendors) {
      for (const item of vendor.items) {
        try {
          log(`검색: ${item.search || item.productName}`);
          await searchProduct(item.search || item.productName);
          await selectProduct(item.productName);
          const result = await setVendorQuantityAndCart(vendor.vendor, item.productName, item.qty);
          results.push(result);
          log(`${result.ok ? "성공" : "실패"}: ${vendor.vendor} / ${item.productName} ${item.qty}개${result.reason ? ` (${result.reason})` : ""}`, result.ok ? "ok" : "error");
        } catch (error) {
          const result = {
            ok: false,
            vendor: vendor.vendor,
            product: item.productName,
            qty: item.qty,
            reason: error.message,
          };
          results.push(result);
          log(`실패: ${vendor.vendor} / ${item.productName} (${error.message})`, "error");
        }
      }
    }

    const okCount = results.filter((result) => result.ok).length;
    log(`완료: 성공 ${okCount}건, 실패 ${results.length - okCount}건`, results.length === okCount ? "ok" : "error");
    isRunning = false;
    return results;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "HMP_AUTO_CART_TEST") {
      log("HMP 연결 테스트 성공. 이 패널이 보이면 확장프로그램이 HMP 화면과 연결된 상태입니다.", "ok");
      sendResponse({ ok: true, message: "connected" });
      return false;
    }

    if (message?.type === "HMP_CAPTURE_PRODUCT") {
      try {
        const product = captureCurrentProduct();
        log(`상품 가져오기 완료: ${product.name} / 업체 ${product.quotes.length}곳`, "ok");
        sendResponse({ ok: true, product });
      } catch (error) {
        log(`상품 가져오기 실패: ${error.message}`, "error");
        sendResponse({ ok: false, message: error.message });
      }
      return false;
    }

    if (message?.type !== "HMP_AUTO_CART_START") return false;

    runAutoCart(message.payload)
      .catch((error) => {
        isRunning = false;
        log(`자동담기 중단: ${error.message}`, "error");
      });

    sendResponse({ ok: true, message: "started" });
    return false;
  });
})();
