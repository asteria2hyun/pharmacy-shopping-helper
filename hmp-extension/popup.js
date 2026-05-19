const tabStateEl = document.querySelector("#tabState");
const payloadInputEl = document.querySelector("#payloadInput");
const pasteBtn = document.querySelector("#pasteBtn");
const startBtn = document.querySelector("#startBtn");
const testPanelBtn = document.querySelector("#testPanelBtn");
const statusEl = document.querySelector("#status");
const summaryEl = document.querySelector("#summary");

let activeTab = null;

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function setTabState(message, type = "") {
  tabStateEl.textContent = message;
  tabStateEl.className = `badge ${type}`;
}

function parsePayload() {
  const text = payloadInputEl.value.trim();
  if (!text) throw new Error("자동담기 데이터가 비어 있습니다.");

  const payload = JSON.parse(text);
  if (payload.type !== "hmp-auto-cart-v1") {
    throw new Error("HMP 자동담기 데이터 형식이 아닙니다.");
  }

  if (!Array.isArray(payload.vendors) || !payload.vendors.length) {
    throw new Error("담을 업체/상품 데이터가 없습니다.");
  }

  const suspiciousItems = payload.vendors
    .flatMap((vendor) => vendor.items)
    .filter((item) => looksLikePriceRow(item.productName));
  if (suspiciousItems.length) {
    throw new Error("상품명이 업체 가격행처럼 보입니다. 계산기에서 선택 상품명을 실제 상품명으로 수정해 주세요.");
  }

  return payload;
}

function renderSummary(payload) {
  const itemCount = payload.vendors.reduce((sum, vendor) => sum + vendor.items.length, 0);
  summaryEl.className = "summary";
  summaryEl.innerHTML = `
    <strong>담기 예정</strong>
    <span>업체 ${payload.vendors.length}곳 · 품목 ${itemCount}개</span>
    <span>계산 총액 ${Number(payload.total || 0).toLocaleString("ko-KR")}원</span>
  `;
}

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

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab;
  const url = tab?.url || "";
  const isHmp = /^https?:\/\/([^/]+\.)?hmpmall\.co\.kr\//.test(url);
  setTabState(isHmp ? "HMP 탭" : "HMP 아님", isHmp ? "ok" : "warn");
  if (!isHmp) {
    setStatus("HMP몰 탭으로 이동한 뒤 확장 프로그램을 열어주세요.", "error");
  }
}

async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
}

async function pasteClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    payloadInputEl.value = text;
    const payload = parsePayload();
    renderSummary(payload);
    setStatus("클립보드 데이터를 읽었습니다.", "ok");
  } catch (error) {
    setStatus(error.message || "클립보드 읽기에 실패했습니다.", "error");
  }
}

async function startAutoCart() {
  try {
    await getActiveTab();
    if (!activeTab?.id || !/^https?:\/\/([^/]+\.)?hmpmall\.co\.kr\//.test(activeTab.url || "")) {
      throw new Error("HMP몰 탭에서만 실행할 수 있습니다.");
    }

    const payload = parsePayload();
    renderSummary(payload);
    setStatus("HMP몰 화면에 자동담기 패널을 준비하는 중입니다.");
    await ensureContentScript(activeTab.id);

    const response = await chrome.tabs.sendMessage(activeTab.id, {
      type: "HMP_AUTO_CART_START",
      payload,
    });

    if (!response?.ok) {
      throw new Error(response?.message || "HMP몰 화면에서 자동담기를 시작하지 못했습니다.");
    }

    setStatus("자동담기를 HMP 화면에서 시작했습니다. 진행 결과는 HMP 페이지 오른쪽 패널에서 확인하세요.", "ok");
  } catch (error) {
    setStatus(error.message || "자동담기 실행 중 오류가 발생했습니다.", "error");
  }
}

async function testConnection() {
  try {
    await getActiveTab();
    if (!activeTab?.id || !/^https?:\/\/([^/]+\.)?hmpmall\.co\.kr\//.test(activeTab.url || "")) {
      throw new Error("HMP몰 탭에서만 테스트할 수 있습니다.");
    }

    setStatus("HMP 화면에 테스트 패널을 띄우는 중입니다.");
    await ensureContentScript(activeTab.id);
    const response = await chrome.tabs.sendMessage(activeTab.id, {
      type: "HMP_AUTO_CART_TEST",
    });

    if (!response?.ok) {
      throw new Error(response?.message || "HMP 화면과 연결하지 못했습니다.");
    }

    setStatus("연결 성공입니다. HMP 화면 오른쪽 아래에 테스트 패널이 보여야 합니다.", "ok");
  } catch (error) {
    setStatus(error.message || "연결 테스트 중 오류가 발생했습니다.", "error");
  }
}

pasteBtn.addEventListener("click", pasteClipboard);
startBtn.addEventListener("click", startAutoCart);
testPanelBtn?.addEventListener("click", testConnection);
payloadInputEl.addEventListener("input", () => {
  try {
    renderSummary(parsePayload());
    setStatus("데이터 형식이 정상입니다.", "ok");
  } catch {
    summaryEl.className = "summary hidden";
  }
});

getActiveTab();
