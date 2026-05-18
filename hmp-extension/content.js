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
      "right:18px",
      "bottom:18px",
      "z-index:2147483647",
      "width:320px",
      "max-height:420px",
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
    element.click();
    return true;
  }

  function setValue(element, value) {
    element.focus();
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function findSearchInput() {
    return [...document.querySelectorAll("input[type=text], input:not([type]), textarea")]
      .filter(isVisible)
      .sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight))[0];
  }

  function findClickableByText(patterns, root = document) {
    return [...root.querySelectorAll("button, a, input[type=button], input[type=submit], img")]
      .find((element) => {
        if (!isVisible(element)) return false;
        const text = normalize(`${textOf(element)} ${element.value || ""} ${element.alt || ""} ${element.title || ""}`);
        return patterns.some((pattern) => text.includes(normalize(pattern)));
      });
  }

  async function searchProduct(query) {
    const input = findSearchInput();
    if (!input) throw new Error("검색창을 찾지 못했습니다.");

    setValue(input, query);
    const button = findClickableByText(["검색", "search"]) || input.closest("form")?.querySelector("button, input[type=submit]");
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
    const candidates = [...document.querySelectorAll("tr, li, a")]
      .filter(isVisible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width > 850 || rect.height > 180) return false;
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
    clickElement(candidates[0]);
    await sleep(1000);
    return true;
  }

  async function setVendorQuantityAndCart(vendorName, productName, qty) {
    const targetVendor = normalize(vendorName);
    const rows = [...document.querySelectorAll("tr, li, div")]
      .filter(isVisible)
      .filter((element) => normalize(textOf(element)).includes(targetVendor));

    for (const row of rows) {
      const inputs = [...row.querySelectorAll("input")].filter(isVisible);
      const qtyInput = inputs.find((input) => /number|text|tel/.test(input.type || "text"));
      if (qtyInput) setValue(qtyInput, qty);

      const cartButton = findClickableByText(["장바구니", "담기", "cart"], row);
      if (cartButton) {
        clickElement(cartButton);
        await sleep(800);
        return { ok: true, vendor: vendorName, product: productName, qty };
      }
    }

    return {
      ok: false,
      vendor: vendorName,
      product: productName,
      qty,
      reason: "업체 행 또는 장바구니 버튼을 찾지 못했습니다.",
    };
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
