import { currentIsoDate } from "./app-runtime.mjs";

function makePageSeeder(bodyFactorySource) {
  return async (page, params) =>
    page.evaluate(
      async ({ bodyFactory, params: innerParams }) => {
        const cookieValue = (cookieName) => {
          const prefix = `${cookieName}=`;
          return String(document.cookie || "")
            .split(";")
            .map((item) => item.trim())
            .find((item) => item.startsWith(prefix))
            ?.slice(prefix.length) || "";
        };
        const csrf = decodeURIComponent(cookieValue("mf_csrf_token"));
        const householdId = String(localStorage.getItem("money-flow-active-household-id") || "").trim();
        const headers = { "Content-Type": "application/json", "x-csrf-token": csrf };
        if (householdId) headers["x-household-id"] = householdId;
        const postJson = async (path, body) => {
          const response = await fetch(path, { method: "POST", credentials: "include", headers, body: JSON.stringify(body) });
          const text = await response.text();
          let payload = null;
          try {
            payload = text ? JSON.parse(text) : null;
          } catch {
            payload = null;
          }
          return { ok: response.ok, status: response.status, payload, text };
        };
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        return AsyncFunction("postJson", "params", bodyFactory)(postJson, innerParams);
      },
      { bodyFactory: bodyFactorySource, params },
    );
}

const seedDashboard = makePageSeeder(`
  const { seedId, today } = params;
  const holding = await postJson("/api/v1/holdings", {
    asset_type: "cash", type_key: "cash", symbol: \`QA\${seedId.slice(-4)}\`, market_symbol: \`QA\${seedId.slice(-4)}\`,
    name: \`QA 현금 \${seedId}\`, category: "현금성", owner_name: null, account_name: "Task 6 QA",
    quantity: "1", average_cost: "300000", currency: "KRW",
  });
  const income = await postJson("/api/v1/transactions", {
    occurred_on: today, flow_type: "income", amount: "180000", category_id: null, currency: "KRW",
    memo: \`Task 6 income \${seedId}\`, owner_name: "", source_ref: null,
  });
  const expense = await postJson("/api/v1/transactions", {
    occurred_on: today, flow_type: "expense", amount: "72000", category_id: null, currency: "KRW",
    memo: \`Task 6 expense \${seedId}\`, owner_name: "", source_ref: null,
  });
  return { seedId, holding, income, expense };
`);

const seedWorkSurface = makePageSeeder(`
  const { holdingName, longMemo, seedId, today } = params;
  const holding = await postJson("/api/v1/holdings", {
    asset_type: "cash", type_key: "cash", symbol: \`T7\${seedId.slice(-4)}\`, market_symbol: \`T7\${seedId.slice(-4)}\`,
    name: holdingName, category: "현금성", owner_name: null, account_name: "Task 7 QA",
    quantity: "1", average_cost: "225000", currency: "KRW",
  });
  const transaction = await postJson("/api/v1/transactions", {
    occurred_on: today, flow_type: "expense", amount: "47225", category_id: null, currency: "KRW",
    memo: longMemo, owner_name: "", source_ref: null,
  });
  return { seedId, holdingName, longMemo, holding, transaction };
`);

export async function seedDashboardFixtures(page) {
  const seedId = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  return seedDashboard(page, { seedId, today: currentIsoDate() });
}

export async function seedWorkSurfaceLedgerFixtures(page) {
  const seedId = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  return seedWorkSurface(page, {
    seedId,
    today: currentIsoDate(),
    longMemo: `Task 7 ledger memo ${seedId} 모바일 세부 행에서 줄바꿈을 확인하기 위한 긴 거래 메모입니다`,
    holdingName: `Task 7 holding ${seedId} 현금성 모바일 긴 자산명`,
  });
}
