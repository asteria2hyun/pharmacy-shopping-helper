const productsEl = document.querySelector("#products");
const productTemplate = document.querySelector("#productTemplate");
const quoteTemplate = document.querySelector("#quoteTemplate");
const couponTemplate = document.querySelector("#couponTemplate");
const addProductBtn = document.querySelector("#addProductBtn");
const loadSampleBtn = document.querySelector("#loadSampleBtn");
const runTestBtn = document.querySelector("#runTestBtn");
const clearBtn = document.querySelector("#clearBtn");
const testResultEl = document.querySelector("#testResult");
const defaultMinOrderEl = document.querySelector("#defaultMinOrder");
const hmpCaptureInputEl = document.querySelector("#hmpCaptureInput");
const importHmpBtn = document.querySelector("#importHmpBtn");
const pasteClipboardBtn = document.querySelector("#pasteClipboardBtn");
const importHintEl = document.querySelector("#importHint");
const addCouponBtn = document.querySelector("#addCouponBtn");
const couponRowsEl = document.querySelector("#couponRows");
const bestTotalEl = document.querySelector("#bestTotal");
const itemCountEl = document.querySelector("#itemCount");
const bestPlanEl = document.querySelector("#bestPlan");
const vendorSummaryEl = document.querySelector("#vendorSummary");
const alternativesEl = document.querySelector("#alternatives");
const suggestionsEl = document.querySelector("#suggestions");
const copyAutoCartBtn = document.querySelector("#copyAutoCartBtn");
const autoCartStatusEl = document.querySelector("#autoCartStatus");
const statusBadgeEl = document.querySelector("#statusBadge");
const undoSuggestionBtn = document.querySelector("#undoSuggestionBtn");
const storageKey = "hmp-helper-state-v1";
let currentBestPlan = null;
let currentDisplayPlan = null;
let selectedVendors = new Set();
let currentRankedPlans = [];
let suggestionUndoSnapshot = null;

const formatter = new Intl.NumberFormat("ko-KR");

function money(value) {
  return `${formatter.format(Math.round(value))}원`;
}

function parseNumber(value) {
  const cleaned = String(value ?? "").replace(/[^\d.-]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function addProduct(initial = {}) {
  const fragment = productTemplate.content.cloneNode(true);
  const product = fragment.querySelector(".product");
  product.dataset.id = crypto.randomUUID();

  product.querySelector(".searchInput").value = initial.search ?? "";
  product.querySelector(".nameInput").value = initial.name ?? "";
  product.querySelector(".qtyInput").value = initial.qty ?? 1;

  product.querySelector(".removeProduct").addEventListener("click", () => {
    product.remove();
    calculate();
  });

  product.querySelector(".addQuoteBtn").addEventListener("click", () => {
    addQuote(product);
    calculate();
  });

  product.querySelector(".pasteToggleBtn").addEventListener("click", () => {
    product.querySelector(".pasteBox").classList.toggle("hidden");
  });

  product.querySelector(".pasteApplyBtn").addEventListener("click", () => {
    applyPastedQuotes(product);
  });

  product.addEventListener("input", calculate);
  product.addEventListener("change", calculate);
  productsEl.appendChild(product);

  if (initial.quotes?.length) {
    initial.quotes.forEach((quote) => addQuote(product, quote));
  } else {
    addQuote(product);
  }

  calculate();
}

function addQuote(product, quote = {}) {
  const fragment = quoteTemplate.content.cloneNode(true);
  const row = fragment.querySelector("tr");
  row.querySelector(".vendorInput").value = quote.vendor ?? "";
  row.querySelector(".priceInput").value = quote.price ?? "";
  row.querySelector(".minInput").value = quote.minOrder ?? "";
  row.querySelector(".stockInput").value = quote.stock ?? "";
  row.querySelector(".enabledInput").checked = quote.enabled ?? true;
  row.querySelector(".removeQuote").addEventListener("click", () => {
    row.remove();
    calculate();
  });
  product.querySelector(".quoteRows").appendChild(row);
}

function addCoupon(coupon = {}) {
  const fragment = couponTemplate.content.cloneNode(true);
  const row = fragment.querySelector("tr");
  row.querySelector(".couponVendorInput").value = coupon.vendor ?? "";
  row.querySelector(".couponAmountInput").value = coupon.amount ?? "";
  row.querySelector(".couponMinInput").value = coupon.minOrder ?? "";
  row.querySelector(".couponQtyInput").value = coupon.qty ?? 1;
  row.querySelector(".couponEnabledInput").checked = coupon.enabled ?? true;
  row.querySelector(".removeCoupon").addEventListener("click", () => {
    row.remove();
    calculate();
  });
  row.addEventListener("input", calculate);
  row.addEventListener("change", calculate);
  couponRowsEl.appendChild(row);
}

function applyPastedQuotes(product) {
  const text = product.querySelector(".pasteInput").value.trim();
  if (!text) return;

  const rows = text.split(/\n+/).map(parsePastedLine).filter(Boolean);
  if (!rows.length) return;

  const quoteRows = product.querySelector(".quoteRows");
  quoteRows.innerHTML = "";
  rows.forEach((row) => addQuote(product, row));
  calculate();
}

function parsePastedLine(line) {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 2) return null;

  const numbers = tokens
    .map((token, index) => ({ index, value: parseNumber(token) }))
    .filter((token) => token.value > 0);

  if (!numbers.length) return null;

  const firstNumber = numbers[0];
  const vendor = tokens.slice(0, firstNumber.index).join(" ").trim();

  return {
    vendor: vendor || "업체명 확인",
    price: firstNumber.value,
    minOrder: numbers[1]?.value ?? 50000,
    stock: numbers[2]?.value ?? "",
    enabled: true,
  };
}

function importHmpCapture() {
  const text = hmpCaptureInputEl.value.trim();
  const parsed = parseHmpCapture(text, parseNumber(defaultMinOrderEl.value) || 50000);

  if (!parsed.quotes.length) {
    importHintEl.textContent = "업체명과 가격을 찾지 못했습니다. 가격표 영역을 조금 더 넓게 복사해 주세요.";
    importHintEl.className = "importHint shortage";
    return;
  }

  addProduct({
    search: parsed.search,
    name: parsed.name,
    qty: 1,
    quotes: parsed.quotes,
  });

  hmpCaptureInputEl.value = "";
  importHintEl.textContent = `${parsed.quotes.length}개 업체 가격을 추가했습니다. 상품명과 수량만 확인해 주세요.`;
  importHintEl.className = "importHint okText";
}

function parseHmpCapture(text, defaultMinOrder) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const quotes = [];
  const ignoredWords = /가격|재고|수량|업체명|일반가|할인가|공급가|상품명|장바구니|관심상품|주문마감|배송|검색결과|선택상품|상세보기/;

  for (const line of lines) {
    if (ignoredWords.test(line) && !/\d[\d,]*\s*원?/.test(line)) continue;

    const matches = [...line.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)];
    if (!matches.length) continue;

    const firstNumber = matches[0];
    const vendor = line.slice(0, firstNumber.index).replace(/[ㆍ·:|-]+$/g, "").trim();
    if (!vendor || vendor.length > 24) continue;
    if (/^\d/.test(vendor)) continue;

    const numbers = matches.map((match) => parseNumber(match[0])).filter((number) => number > 0);
    const price = numbers.find((number) => number >= 10);
    if (!price) continue;

    const stock = numbers.find((number, index) => index > 0 && number !== price) ?? "";
    quotes.push({
      vendor,
      price,
      minOrder: defaultMinOrder,
      stock,
      enabled: true,
    });
  }

  const uniqueQuotes = [];
  const seen = new Set();
  for (const quote of quotes) {
    const key = `${quote.vendor}-${quote.price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueQuotes.push(quote);
  }

  return {
    search: guessSearch(lines),
    name: guessProductName(lines),
    quotes: uniqueQuotes,
  };
}

function guessSearch(lines) {
  const resultLine = lines.find((line) => /검색결과/.test(line));
  const match = resultLine?.match(/['"‘’“”]?([^'"‘’“”\s]+)['"‘’“”]?\s*검색결과/);
  return match?.[1] ?? "";
}

function guessProductName(lines) {
  const candidates = lines.filter((line) => {
    if (line.length < 8 || line.length > 80) return false;
    if (/업체명|일반가|할인가|재고|장바구니|검색결과|배송|수량/.test(line)) return false;
    if (/^\d/.test(line)) return false;
    if (looksLikeVendorPriceLine(line)) return false;
    return /[가-힣A-Za-z]/.test(line);
  });

  const bracketed = candidates.find((line) => /\[.+\]/.test(line));
  return bracketed ?? candidates[0] ?? "HMP 선택 상품";
}

function looksLikeVendorPriceLine(line) {
  const text = String(line || "").trim();
  const numberMatches = text.match(/\d[\d,]*/g) || [];
  const hasProductUnit = /(ml|mg|g|kg|cm|mm|매|팩|포|개|입|정|캡슐|병|통|ea|set|겹)/i.test(text);
  if (hasProductUnit) return false;
  if (numberMatches.length < 2 || text.length >= 36) return false;

  const lettersOnly = text.replace(/[\d\s,./()*+\-~원]/g, "");
  const hasPriceLikeNumber = numberMatches.some((match) => parseNumber(match) >= 100);
  return hasPriceLikeNumber && lettersOnly.length > 0 && lettersOnly.length <= 12;
}

function readProducts() {
  return [...productsEl.querySelectorAll(".product")].map((product, index) => {
    const name = product.querySelector(".nameInput").value.trim() || `상품 ${index + 1}`;
    const search = product.querySelector(".searchInput").value.trim();
    const qty = Math.max(1, parseNumber(product.querySelector(".qtyInput").value));
    const quotes = [...product.querySelectorAll(".quoteRows tr")]
      .map((row) => ({
        productId: product.dataset.id,
        productName: name,
        search,
        qty,
        vendor: row.querySelector(".vendorInput").value.trim(),
        price: parseNumber(row.querySelector(".priceInput").value),
        minOrder: parseNumber(row.querySelector(".minInput").value),
        stock: parseNumber(row.querySelector(".stockInput").value),
        enabled: row.querySelector(".enabledInput").checked,
      }))
      .filter((quote) => quote.vendor && quote.price > 0 && quote.enabled && quote.stock !== 0);

    return { id: product.dataset.id, name, search, qty, quotes };
  });
}

function readCoupons() {
  return [...couponRowsEl.querySelectorAll("tr")]
    .map((row) => ({
      vendor: row.querySelector(".couponVendorInput").value.trim(),
      amount: parseNumber(row.querySelector(".couponAmountInput").value),
      minOrder: parseNumber(row.querySelector(".couponMinInput").value),
      qty: Math.max(1, parseNumber(row.querySelector(".couponQtyInput").value)),
      enabled: row.querySelector(".couponEnabledInput").checked,
    }))
    .filter((coupon) => coupon.vendor && coupon.amount > 0 && coupon.enabled);
}

function calculate() {
  testResultEl.classList.add("hidden");
  const products = readProducts();
  const coupons = readCoupons();
  saveState(products, coupons);
  const readyProducts = products.filter((product) => product.quotes.length);
  itemCountEl.textContent = String(products.length);

  if (!products.length) {
    currentBestPlan = null;
    renderEmpty("상품과 업체 가격을 입력하면 결과가 표시됩니다.");
    return { status: "empty", products, bestPlan: null, alternatives: [] };
  }

  if (readyProducts.length !== products.length) {
    currentBestPlan = null;
    renderEmpty("업체 가격이 없는 상품이 있습니다.");
    setBadge("확인 필요", "warn");
    return { status: "missing-quotes", products, bestPlan: null, alternatives: [] };
  }

  const plans = buildPlans(products, coupons)
    .filter((plan) => plan.valid)
    .sort((a, b) => a.total - b.total);

  if (!plans.length) {
    const relaxed = buildPlans(products, coupons).sort((a, b) => a.shortage - b.shortage || a.total - b.total);
    currentBestPlan = null;
    currentDisplayPlan = relaxed[0] ?? null;
    renderNoValidPlan(relaxed[0]);
    return { status: "shortage", products, bestPlan: relaxed[0] ?? null, alternatives: relaxed.slice(1, 4) };
  }

  const bestTotal = plans[0].total;
  const bestPlans = plans.filter((plan) => plan.total === bestTotal);
  const alternatives = plans.filter((plan) => plan.total !== bestTotal).slice(0, 4);
  currentRankedPlans = [
    ...bestPlans.map((plan) => ({ plan, label: bestPlans.length > 1 ? "공동 1순위" : "1순위" })),
    ...alternatives.map((plan, index) => ({ plan, label: `${index + 2}순위` })),
  ];
  currentBestPlan = bestPlans[0];
  currentDisplayPlan = bestPlans[0];
  renderPlan(bestPlans[0], alternatives, products, coupons, bestPlans);
  return { status: "ok", products, bestPlan: bestPlans[0], bestPlans, alternatives };
}

function buildPlans(products, coupons = []) {
  const plans = buildWholeProductPlans(products, coupons);
  plans.push(...buildSplitPlans(products, coupons));
  return dedupePlans(plans);
}

function buildWholeProductPlans(products, coupons) {
  const plans = [];
  const current = [];

  function walk(index) {
    if (index >= products.length) {
      plans.push(scorePlan(current, coupons, "상품별 최저"));
      return;
    }

    products[index].quotes.forEach((quote) => {
      current.push(quote);
      walk(index + 1);
      current.pop();
    });
  }

  walk(0);
  return plans;
}

function buildSplitPlans(products, coupons) {
  const vendors = [...new Set(products.flatMap((product) => product.quotes.map((quote) => quote.vendor)))];
  const seedGroups = [
    [],
    ...vendors.map((vendor) => [vendor]),
  ];

  return seedGroups
    .map((seedVendors) => repairSplitPlan(products, seedVendors, coupons))
    .filter(Boolean);
}

function repairSplitPlan(products, seedVendors, coupons) {
  const allocations = [];

  products.forEach((product) => {
    const cheapest = [...product.quotes].sort((a, b) => a.price - b.price)[0];
    if (!cheapest) return;
    allocations.push({ ...cheapest, qty: product.qty, amount: cheapest.price * product.qty });
  });

  const activeVendors = new Set([
    ...allocations.map((line) => line.vendor),
    ...seedVendors,
  ]);

  let guard = 0;
  while (guard < 1000) {
    guard += 1;
    const plan = scorePlan(allocations, coupons, "수량 분할");
    const shortVendor = plan.vendors
      .filter((vendor) => activeVendors.has(vendor.vendor) && vendor.shortage > 0)
      .sort((a, b) => b.shortage - a.shortage)[0];

    if (!shortVendor) {
      return scorePlan(allocations, coupons, "수량 분할");
    }

    const move = findBestUnitMove(products, allocations, shortVendor.vendor);
    if (!move) return null;
    applyUnitMove(allocations, move);
  }

  return null;
}

function findBestUnitMove(products, allocations, targetVendor) {
  let bestMove = null;

  products.forEach((product) => {
    const targetQuote = product.quotes.find((quote) => quote.vendor === targetVendor);
    if (!targetQuote) return;

    allocations
      .filter((line) => line.productId === product.id && line.vendor !== targetVendor && line.qty > 0)
      .forEach((sourceLine) => {
        const extraCost = targetQuote.price - sourceLine.price;
        if (!bestMove || extraCost < bestMove.extraCost) {
          bestMove = { product, sourceLine, targetQuote, extraCost };
        }
      });
  });

  return bestMove;
}

function applyUnitMove(allocations, move) {
  move.sourceLine.qty -= 1;
  move.sourceLine.amount = move.sourceLine.qty * move.sourceLine.price;

  let targetLine = allocations.find(
    (line) => line.productId === move.product.id && line.vendor === move.targetQuote.vendor
  );

  if (!targetLine) {
    targetLine = { ...move.targetQuote, qty: 0, amount: 0 };
    allocations.push(targetLine);
  }

  targetLine.qty += 1;
  targetLine.amount = targetLine.qty * targetLine.price;

  for (let index = allocations.length - 1; index >= 0; index -= 1) {
    if (allocations[index].qty <= 0) allocations.splice(index, 1);
  }
}

function dedupePlans(plans) {
  const seen = new Set();
  return plans.filter((plan) => {
    const key = plan.lines
      .map((line) => `${line.productId}:${line.vendor}:${line.qty}`)
      .sort()
      .join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scorePlan(quotes, coupons = [], mode = "") {
  const vendorMap = new Map();
  const lines = quotes.filter((quote) => quote.qty > 0).map((quote) => {
    const amount = quote.price * quote.qty;
    const vendor = vendorMap.get(quote.vendor) ?? {
      vendor: quote.vendor,
      amount: 0,
      discount: 0,
      coupon: null,
      minOrder: 0,
      lines: [],
    };
    vendor.amount += amount;
    vendor.minOrder = Math.max(vendor.minOrder, quote.minOrder || 0);
    vendor.lines.push({ ...quote, amount });
    vendorMap.set(quote.vendor, vendor);
    return { ...quote, amount };
  });

  const vendors = [...vendorMap.values()].map((vendor) => {
    const coupon = pickCoupon(vendor.vendor, vendor.amount, coupons);
    const discount = coupon?.amount ?? 0;
    return {
      ...vendor,
      coupon,
      discount,
      payable: Math.max(0, vendor.amount - discount),
      shortage: Math.max(0, vendor.minOrder - vendor.amount),
    };
  });

  const subtotal = lines.reduce((sum, line) => sum + line.amount, 0);
  const discount = vendors.reduce((sum, vendor) => sum + vendor.discount, 0);
  const total = subtotal - discount;
  const shortage = vendors.reduce((sum, vendor) => sum + vendor.shortage, 0);

  return {
    mode,
    lines,
    vendors,
    subtotal,
    discount,
    total,
    shortage,
    valid: vendors.every((vendor) => vendor.shortage === 0),
  };
}

function pickCoupon(vendor, amount, coupons) {
  return coupons
    .filter((coupon) => coupon.vendor === vendor && coupon.qty > 0 && amount >= coupon.minOrder)
    .sort((a, b) => b.amount - a.amount)[0] ?? null;
}

function renderPlan(plan, alternatives, products = [], coupons = [], bestPlans = [plan]) {
  setBadge("주문 가능", "ok");
  bestTotalEl.textContent = money(plan.total);
  renderPlanLines(plan);

  renderVendors(plan.vendors);
  renderAlternatives(bestPlans, alternatives);
  renderSuggestions(plan, products, coupons);
}

function renderPlanLines(plan) {
  bestPlanEl.className = "planList";
  bestPlanEl.innerHTML = plan.lines.map((line) => `
    <div class="lineItem">
      <div class="lineTop">
        <span>${escapeHtml(line.productName)}</span>
        <span>${money(line.amount)}</span>
      </div>
      <div class="lineMeta">${escapeHtml(line.vendor)} · ${formatter.format(line.qty)}개 × ${money(line.price)}</div>
    </div>
  `).join("");
}

function renderVendors(vendors) {
  vendorSummaryEl.className = "vendorList";
  syncSelectedVendors(vendors);
  vendorSummaryEl.innerHTML = vendors
    .sort((a, b) => a.vendor.localeCompare(b.vendor, "ko"))
    .map((vendor) => `
      <div class="vendorItem">
        <div class="vendorTop">
          <label class="vendorCheck">
            <input class="vendorCopyCheck" type="checkbox" data-vendor="${escapeHtml(vendor.vendor)}" ${selectedVendors.has(vendor.vendor) ? "checked" : ""}>
            <span>${escapeHtml(vendor.vendor)}</span>
          </label>
          <span>${money(vendor.payable ?? vendor.amount)}</span>
        </div>
        <div class="vendorMeta">
          최저주문 ${money(vendor.minOrder)}
          ${vendor.shortage ? `<span class="shortage"> · ${money(vendor.shortage)} 부족</span>` : `<span class="okText"> · 주문 가능</span>`}
          ${vendor.discount ? `<span class="couponText"> · 쿠폰 ${money(vendor.discount)} 적용</span>` : ""}
        </div>
        <div class="vendorLines">
          ${vendor.lines.map((line) => `
            <div class="vendorLine">
              <span>${escapeHtml(line.productName)} ${formatter.format(line.qty)}개</span>
              <span>${money(line.amount)}</span>
            </div>
          `).join("")}
          ${vendor.discount ? `
            <div class="vendorLine couponText">
              <span>${escapeHtml(vendor.coupon.vendor)} 쿠폰</span>
              <span>-${money(vendor.discount)}</span>
            </div>
          ` : ""}
        </div>
      </div>
    `).join("");

  vendorSummaryEl.querySelectorAll(".vendorCopyCheck").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const vendor = checkbox.dataset.vendor;
      if (checkbox.checked) selectedVendors.add(vendor);
      else selectedVendors.delete(vendor);
      updateAutoCartStatus();
    });
  });
  updateAutoCartStatus();
}

function syncSelectedVendors(vendors) {
  const vendorNames = new Set(vendors.map((vendor) => vendor.vendor));
  selectedVendors = new Set([...selectedVendors].filter((vendor) => vendorNames.has(vendor)));

  if (!selectedVendors.size) {
    vendors
      .filter((vendor) => vendor.shortage === 0)
      .forEach((vendor) => selectedVendors.add(vendor.vendor));
  }
}

function renderAlternatives(bestPlans, alternatives) {
  const ranked = [
    ...bestPlans.map((plan) => ({ plan, label: bestPlans.length > 1 ? "공동 1순위" : "1순위" })),
    ...alternatives.map((plan, index) => ({ plan, label: `${index + 2}순위` })),
  ];

  if (!ranked.length) {
    alternativesEl.className = "empty";
    alternativesEl.textContent = "다른 주문 가능 조합이 없습니다.";
    return;
  }

  alternativesEl.className = "altList";
  alternativesEl.innerHTML = ranked.map(({ plan, label }) => {
    const vendors = plan.vendors.map((vendor) => vendor.vendor).join(", ");
    const selected = currentDisplayPlan === plan ? " selectedPlan" : "";
    return `
      <button class="altItem planChoice${selected}" data-plan-id="${escapeHtml(getPlanKey(plan))}">
        <div class="altTop">
          <span><span class="rankLabel">${label}</span>${escapeHtml(plan.mode || "")}</span>
          <span>${money(plan.total)}</span>
        </div>
        <div class="altMeta">${escapeHtml(vendors)}${plan.discount ? ` · 쿠폰 ${money(plan.discount)} 반영` : ""}</div>
      </button>
    `;
  }).join("");

  alternativesEl.querySelectorAll(".planChoice").forEach((button) => {
    button.addEventListener("click", () => {
      const selected = ranked.find(({ plan }) => getPlanKey(plan) === button.dataset.planId);
      if (!selected) return;
      choosePlan(selected.plan);
    });
  });
}

function choosePlan(plan) {
  currentDisplayPlan = plan;
  selectedVendors = new Set(plan.vendors.filter((vendor) => vendor.shortage === 0).map((vendor) => vendor.vendor));
  bestTotalEl.textContent = money(plan.total);
  renderPlanLines(plan);
  renderVendors(plan.vendors);
  renderAlternativesFromCurrent();
  updateAutoCartStatus();
}

function renderAlternativesFromCurrent() {
  if (!currentRankedPlans.length) return;
  const bestPlans = currentRankedPlans
    .filter(({ label }) => label.includes("1순위"))
    .map(({ plan }) => plan);
  const alternatives = currentRankedPlans
    .filter(({ label }) => !label.includes("1순위"))
    .map(({ plan }) => plan);
  renderAlternatives(bestPlans, alternatives);
}

function applyExtraQuantity(productId, extraQty) {
  const product = productsEl.querySelector(`.product[data-id="${CSS.escape(productId)}"]`);
  if (!product) return;

  suggestionUndoSnapshot = readQuantitySnapshot();
  updateUndoSuggestionButton();

  const input = product.querySelector(".qtyInput");
  const currentQty = Math.max(1, parseNumber(input.value));
  input.value = currentQty + extraQty;
  calculate();
  product.scrollIntoView({ block: "center", behavior: "smooth" });
  input.focus();
}

function readQuantitySnapshot() {
  return [...productsEl.querySelectorAll(".product")].map((product) => ({
    id: product.dataset.id,
    qty: Math.max(1, parseNumber(product.querySelector(".qtyInput").value)),
  }));
}

function restoreSuggestionSnapshot() {
  if (!suggestionUndoSnapshot) return;

  suggestionUndoSnapshot.forEach((item) => {
    const product = productsEl.querySelector(`.product[data-id="${CSS.escape(item.id)}"]`);
    if (product) product.querySelector(".qtyInput").value = item.qty;
  });

  suggestionUndoSnapshot = null;
  updateUndoSuggestionButton();
  calculate();
}

function updateUndoSuggestionButton() {
  if (!undoSuggestionBtn) return;
  undoSuggestionBtn.disabled = !suggestionUndoSnapshot;
}

function getPlanKey(plan) {
  return plan.lines
    .map((line) => `${line.productId}:${line.vendor}:${line.qty}`)
    .sort()
    .join("|");
}

function renderSuggestions(plan, products, coupons) {
  const suggestions = buildActionableSuggestions(plan, products, coupons);

  if (!suggestions.length) {
    suggestionsEl.className = "empty";
    suggestionsEl.textContent = "현재 조건에서는 추가 구매나 쿠폰 관점의 뚜렷한 개선 제안이 없습니다.";
    return;
  }

  suggestionsEl.className = "suggestionList";
  suggestionsEl.innerHTML = suggestions
    .slice(0, 5)
    .map((suggestion) => {
      const actionAttrs = suggestion.action
        ? ` data-product-id="${escapeHtml(suggestion.action.productId)}" data-extra-qty="${escapeHtml(String(suggestion.action.extraQty))}"`
        : "";
      return `
      <button class="suggestionCard"${actionAttrs}>
        <div class="suggestionCompany">${escapeHtml(suggestion.vendor)}</div>
        <div class="suggestionProduct">${escapeHtml(suggestion.productName)}</div>
        <div class="suggestionAction">${escapeHtml(suggestion.actionText)}</div>
        <div class="suggestionEffect">${escapeHtml(suggestion.effectText)}</div>
        <div class="suggestionDetail">
          ${suggestion.detailRows.map(([label, value, tone = ""]) => `
            <div class="suggestionDetailRow ${escapeHtml(tone)}">
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(value)}</strong>
            </div>
          `).join("")}
        </div>
      </button>
    `;
    })
    .join("");

  suggestionsEl.querySelectorAll(".suggestionCard").forEach((button) => {
    button.addEventListener("click", () => {
      const productId = button.dataset.productId;
      const extraQty = parseNumber(button.dataset.extraQty);
      if (!productId || !extraQty) return;
      applyExtraQuantity(productId, extraQty);
    });
  });
}

function buildActionableSuggestions(plan, products, coupons) {
  const candidates = [];
  const currentTotal = plan.total;
  const currentKey = getPlanKey(plan);

  products.forEach((product) => {
    const currentQty = product.qty;
    const extraQtys = candidateExtraQtys(product, plan, coupons);

    extraQtys.forEach((extraQty) => {
      const changedProducts = products.map((item) => (
        item.id === product.id ? { ...item, qty: item.qty + extraQty } : item
      ));
      const newPlan = buildPlans(changedProducts, coupons)
        .filter((item) => item.valid)
        .sort((a, b) => a.total - b.total)[0];

      if (!newPlan || getPlanKey(newPlan) === currentKey) return;

      const addedLines = newPlan.lines.filter((line) => line.productId === product.id);
      const targetLine = addedLines
        .sort((a, b) => b.qty - a.qty || a.price - b.price)[0];
      if (!targetLine) return;

      const baselineUnitPrice = cheapestCurrentUnitPrice(product, plan) || targetLine.price;
      const normalExtraCost = baselineUnitPrice * extraQty;
      const realExtraCost = newPlan.total - currentTotal;
      const benefit = normalExtraCost - realExtraCost;
      const vendor = newPlan.vendors.find((item) => item.vendor === targetLine.vendor);
      const couponText = vendor?.discount ? `쿠폰 ${money(vendor.discount)} 적용` : "";
      const minText = vendor ? `최저주문 ${money(vendor.minOrder)} ${vendor.shortage ? `${money(vendor.shortage)} 부족` : "충족"}` : "";

      candidates.push({
        priority: realExtraCost - benefit,
        vendor: targetLine.vendor,
        productName: compactProductName(product.name),
        actionText: `${extraQty}개 더 사면 더 좋은 조합으로 바뀝니다.`,
        effectText: benefit > 0
          ? `그냥 추가하는 것보다 ${money(benefit)} 유리`
          : `실제 추가부담 ${money(realExtraCost)}`,
        detailRows: [
          ["회사명", targetLine.vendor],
          ["변경후", `${compactProductName(product.name)} ${currentQty}개 -> ${currentQty + extraQty}개`],
          ["현재", money(currentTotal)],
          ["변경후 총액", money(newPlan.total)],
          ["일반 추가", money(normalExtraCost)],
          ["실제 추가", money(realExtraCost)],
          ["절약효과", benefit > 0 ? money(benefit) : "조건 충족 중심", benefit > 0 ? "save" : ""],
          couponText ? ["쿠폰", couponText, "coupon"] : null,
          minText ? ["조건", minText] : null,
        ].filter(Boolean),
        action: {
          productId: product.id,
          extraQty,
        },
      });
    });
  });

  return dedupeSuggestions(candidates)
    .sort((a, b) => {
      const aBenefit = /유리$/.test(a.effectText) ? -1 : 0;
      const bBenefit = /유리$/.test(b.effectText) ? -1 : 0;
      if (aBenefit !== bBenefit) return aBenefit - bBenefit;
      return a.priority - b.priority;
    });
}

function candidateExtraQtys(product, plan, coupons) {
  const values = new Set([1, 2, 3, 5, 10]);
  product.quotes.forEach((quote) => {
    const vendor = plan.vendors.find((item) => item.vendor === quote.vendor);
    const currentAmount = vendor?.amount ?? 0;
    const targets = [
      quote.minOrder || 0,
      ...coupons
        .filter((coupon) => coupon.vendor === quote.vendor && coupon.amount > 0)
        .map((coupon) => coupon.minOrder || 0),
    ];

    targets.forEach((target) => {
      const needed = target - currentAmount;
      if (needed > 0) values.add(Math.max(1, Math.ceil(needed / quote.price)));
    });
  });

  return [...values]
    .filter((qty) => qty > 0 && qty <= 100)
    .sort((a, b) => a - b)
    .slice(0, 12);
}

function cheapestCurrentUnitPrice(product, plan) {
  return plan.lines
    .filter((line) => line.productId === product.id)
    .sort((a, b) => a.price - b.price)[0]?.price;
}

function compactProductName(name) {
  const text = String(name || "상품").trim();
  const cleaned = text
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\([^)]{8,}\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= 28) return cleaned;
  const unitMatch = cleaned.match(/^(.{0,22}?(?:\d+\s?(?:ml|mg|g|kg|cm|mm|매|팩|포|개|입|정|캡슐|병|통|ea|set|겹)))/i);
  return `${(unitMatch?.[1] || cleaned.slice(0, 26)).trim()}...`;
}

function dedupeSuggestions(suggestions) {
  const seen = new Set();
  return suggestions.filter((suggestion) => {
    const key = `${suggestion.vendor}:${suggestion.productName}:${suggestion.action?.productId}:${suggestion.action?.extraQty}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cheapestQuoteForVendor(products, vendor) {
  return products
    .flatMap((product) => product.quotes.map((quote) => ({ ...quote, productName: product.name })))
    .filter((quote) => quote.vendor === vendor)
    .sort((a, b) => a.price - b.price)[0] ?? null;
}

function renderNoValidPlan(plan) {
  setBadge("금액 부족", "warn");
  bestTotalEl.textContent = plan ? money(plan.total) : "-";
  bestPlanEl.className = "empty";
  bestPlanEl.textContent = "업체별 최저 주문금액을 충족하는 조합이 없습니다. 수량을 늘리거나 업체를 조정해 주세요.";
  vendorSummaryEl.className = "empty";
  alternativesEl.className = "empty";
  suggestionsEl.className = "empty";

  if (plan) {
    renderVendors(plan.vendors);
    alternativesEl.textContent = `가장 가까운 조합은 총 부족금액 ${money(plan.shortage)}입니다.`;
    suggestionsEl.textContent = "부족금액이 있는 업체의 수량을 늘리거나, 같은 업체에서 같이 살 품목을 추가해 보세요.";
  }
}

function renderEmpty(message) {
  bestTotalEl.textContent = "-";
  bestPlanEl.className = "empty";
  bestPlanEl.textContent = message;
  vendorSummaryEl.className = "empty";
  vendorSummaryEl.textContent = "아직 계산할 내용이 없습니다.";
  alternativesEl.className = "empty";
  alternativesEl.textContent = "추천 조합이 생기면 함께 표시됩니다.";
  suggestionsEl.className = "empty";
  suggestionsEl.textContent = "쿠폰 조건이나 더 싼 업체가 보이면 제안합니다.";
  setBadge("대기", "");
}

function setBadge(text, mode) {
  statusBadgeEl.textContent = text;
  statusBadgeEl.className = `badge ${mode}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadSample() {
  productsEl.innerHTML = "";
  couponRowsEl.innerHTML = "";
  suggestionUndoSnapshot = null;
  updateUndoSuggestionButton();
  addProduct({
    search: "바세린",
    name: "바세린 오리지널 프로텍팅 젤리 100ml 1EA",
    qty: 20,
    quotes: [
      { vendor: "대지인팜", price: 1900, minOrder: 50000, stock: 1236 },
      { vendor: "헬스인팜", price: 1750, minOrder: 50000, stock: 6405 },
      { vendor: "월드비전팜", price: 1900, minOrder: 50000, stock: 6405 },
    ],
  });
  addProduct({
    search: "바세린 립",
    name: "바세린 립테라피 스틱 오리지널 4.8g",
    qty: 10,
    quotes: [
      { vendor: "대지인팜", price: 1900, minOrder: 50000, stock: 210 },
      { vendor: "헬스인팜", price: 2300, minOrder: 50000, stock: 420 },
      { vendor: "피지엠", price: 1810, minOrder: 50000, stock: 2605 },
    ],
  });
  addCoupon({ vendor: "헬스인팜", amount: 5000, minOrder: 50000, qty: 1 });
  calculate();
}

function runSelfTest() {
  const previous = {
    products: serializeProducts(readProducts()),
    coupons: serializeCoupons(readCoupons()),
  };
  loadSample();
  const result = calculate();
  const failures = [];

  if (result.status !== "ok") {
    failures.push("추천 조합이 주문 가능 상태로 나오지 않았습니다.");
  }

  if (result.bestPlan?.total !== 53000) {
    failures.push(`추천 총액이 예상값 53,000원이 아니라 ${money(result.bestPlan?.total ?? 0)}입니다.`);
  }

  const vendors = result.bestPlan?.vendors.map((vendor) => vendor.vendor).sort().join(", ");
  if (vendors !== "헬스인팜") {
    failures.push(`추천 업체가 예상과 다릅니다. 현재: ${vendors || "없음"}`);
  }

  if (result.bestPlan?.vendors.some((vendor) => vendor.shortage > 0)) {
    failures.push("추천 결과에 최저주문금액 미달 업체가 포함되었습니다.");
  }

  testResultEl.className = failures.length ? "testResult fail" : "testResult";
  testResultEl.innerHTML = failures.length
    ? `<strong>테스트 실패</strong><br>${failures.map(escapeHtml).join("<br>")}`
    : "<strong>테스트 통과</strong><br>예시 상품 2개 기준으로 최저주문금액을 만족하는 최저 조합을 정상 계산했습니다.";

  if (previous.products.length || previous.coupons.length) {
    localStorage.setItem(storageKey, JSON.stringify(previous));
  }
}

function serializeProducts(products) {
  return products.map((product) => ({
    search: product.search,
    name: product.name,
    qty: product.qty,
    quotes: product.quotes.map((quote) => ({
      vendor: quote.vendor,
      price: quote.price,
      minOrder: quote.minOrder,
      stock: quote.stock,
      enabled: quote.enabled,
    })),
  }));
}

function serializeCoupons(coupons) {
  return coupons.map((coupon) => ({
    vendor: coupon.vendor,
    amount: coupon.amount,
    minOrder: coupon.minOrder,
    qty: coupon.qty,
    enabled: coupon.enabled,
  }));
}

function saveState(products, coupons = []) {
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      products: serializeProducts(products),
      coupons: serializeCoupons(coupons),
    }));
  } catch {
    // Local storage can be disabled in some browser settings.
  }
}

function restoreState() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
    const products = Array.isArray(saved) ? saved : saved.products;
    const coupons = Array.isArray(saved) ? [] : saved.coupons;
    if (!Array.isArray(products) || !products.length) return false;
    productsEl.innerHTML = "";
    couponRowsEl.innerHTML = "";
    products.forEach((product) => addProduct(product));
    if (Array.isArray(coupons)) coupons.forEach((coupon) => addCoupon(coupon));
    calculate();
    return true;
  } catch {
    return false;
  }
}

function clearAll() {
  localStorage.removeItem(storageKey);
  productsEl.innerHTML = "";
  couponRowsEl.innerHTML = "";
  suggestionUndoSnapshot = null;
  updateUndoSuggestionButton();
  addProduct();
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    hmpCaptureInputEl.value = text;
    importHintEl.textContent = "클립보드 내용을 가져왔습니다. 가격표 추가를 눌러 반영하세요.";
    importHintEl.className = "importHint okText";
  } catch {
    importHintEl.textContent = "브라우저 권한 때문에 자동 붙여넣기가 막혔습니다. 직접 Ctrl+V로 붙여넣어 주세요.";
    importHintEl.className = "importHint shortage";
  }
}

function buildAutoCartPayload(plan) {
  if (!plan?.lines?.length) return null;
  const selected = selectedVendors.size ? selectedVendors : new Set(plan.vendors.map((vendor) => vendor.vendor));
  const vendors = plan.vendors.filter((vendor) => selected.has(vendor.vendor));
  if (!vendors.length) return null;

  return {
    type: "hmp-auto-cart-v1",
    createdAt: new Date().toISOString(),
    total: vendors.reduce((sum, vendor) => sum + (vendor.payable ?? vendor.amount), 0),
    vendors: vendors.map((vendor) => ({
      vendor: vendor.vendor,
      amount: vendor.amount,
      payable: vendor.payable,
      minOrder: vendor.minOrder,
      discount: vendor.discount,
      items: vendor.lines.map((line) => ({
        productName: line.productName,
        search: line.search,
        qty: line.qty,
        unitPrice: line.price,
        amount: line.amount,
      })),
    })),
  };
}

async function copyAutoCartPayload() {
  const payload = buildAutoCartPayload(currentDisplayPlan);
  if (!payload) {
    autoCartStatusEl.textContent = "복사할 업체를 업체별 합계에서 체크해 주세요.";
    autoCartStatusEl.className = "autoCartStatus shortage";
    return;
  }

  const badItems = payload.vendors
    .flatMap((vendor) => vendor.items)
    .filter((item) => looksLikeVendorPriceLine(item.productName));
  if (badItems.length) {
    autoCartStatusEl.textContent = "선택 상품명이 업체 가격행처럼 보입니다. 각 상품 카드의 선택 상품명을 HMP 실제 상품명으로 수정한 뒤 다시 복사해 주세요.";
    autoCartStatusEl.className = "autoCartStatus shortage";
    return;
  }

  const text = JSON.stringify(payload, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    autoCartStatusEl.textContent = `체크한 업체 자동담기 데이터가 복사됐습니다. 업체 ${payload.vendors.length}곳, 품목 ${payload.vendors.reduce((sum, vendor) => sum + vendor.items.length, 0)}개.`;
    autoCartStatusEl.className = "autoCartStatus okText";
  } catch {
    autoCartStatusEl.textContent = "브라우저 권한 때문에 자동 복사가 막혔습니다. HMP 자동담기 데이터 복사는 HTTPS/권한 허용이 필요합니다.";
    autoCartStatusEl.className = "autoCartStatus shortage";
  }
}

function updateAutoCartStatus() {
  if (!autoCartStatusEl) return;
  const count = selectedVendors.size;
  if (count) {
    autoCartStatusEl.textContent = `체크한 업체 ${count}곳만 자동담기 데이터로 복사합니다.`;
    autoCartStatusEl.className = "autoCartStatus";
  } else {
    autoCartStatusEl.textContent = "업체별 합계에서 복사할 업체를 체크해 주세요.";
    autoCartStatusEl.className = "autoCartStatus shortage";
  }
}

addProductBtn.addEventListener("click", () => addProduct());
loadSampleBtn.addEventListener("click", loadSample);
runTestBtn.addEventListener("click", runSelfTest);
clearBtn.addEventListener("click", clearAll);
importHmpBtn.addEventListener("click", importHmpCapture);
pasteClipboardBtn.addEventListener("click", pasteFromClipboard);
copyAutoCartBtn.addEventListener("click", copyAutoCartPayload);
undoSuggestionBtn?.addEventListener("click", restoreSuggestionSnapshot);
addCouponBtn.addEventListener("click", () => {
  addCoupon();
  calculate();
});

if (!restoreState()) {
  addProduct();
}
