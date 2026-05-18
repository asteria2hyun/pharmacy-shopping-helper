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
const storageKey = "hmp-helper-state-v1";
let currentBestPlan = null;
let currentDisplayPlan = null;
let selectedVendors = new Set();
let currentRankedPlans = [];

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
