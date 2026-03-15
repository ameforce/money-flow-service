import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import {
  ArcElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import { Doughnut, Line } from "react-chartjs-2";
import "./App.css";
import packageJson from "../package.json";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler);

const APP_VERSION_RAW = String(import.meta.env.VITE_APP_VERSION || packageJson.version || "0.0.0").trim();
const APP_VERSION = (APP_VERSION_RAW.startsWith("v") ? APP_VERSION_RAW.substring(1) : APP_VERSION_RAW) || "0.0.0";
const COPYRIGHT_TEXT = `© ENM Software v${APP_VERSION}`;

const API_PREFIX = "/api/v1";
const SAVED_EMAIL_KEY = "money-flow-saved-email";
const ACTIVE_HOUSEHOLD_KEY = "money-flow-active-household-id";
const COOKIE_AUTH_SENTINEL = "__cookie_auth__";
const DEFAULT_CSRF_COOKIE_NAME = "mf_csrf_token";
const DEFAULT_CSRF_HEADER_NAME = "x-csrf-token";
const DEFAULT_HOUSEHOLD_HEADER_NAME = "x-household-id";
const DEBUG_TOKEN_OPT_IN_HEADER = "x-debug-token-opt-in";

function isRuntimeDebugTokenOptInHost() {
  if (typeof window === "undefined") {
    return false;
  }
  return String(window.location.hostname || "").trim().toLowerCase() === "dev.moneyflow.enmsoftware.com";
}

const DEBUG_TOKEN_OPT_IN =
  String(
    import.meta.env.VITE_DEBUG_TOKEN_OPT_IN ??
    (import.meta.env.DEV || import.meta.env.MODE === "test" || isRuntimeDebugTokenOptInHost() ? "true" : "")
  )
    .trim()
    .toLowerCase() === "true";
let csrfCookieName = DEFAULT_CSRF_COOKIE_NAME;
let csrfHeaderName = DEFAULT_CSRF_HEADER_NAME;
let householdHeaderName = DEFAULT_HOUSEHOLD_HEADER_NAME;
const TAB_LABELS = {
  dashboard: "대시보드",
  transactions: "거래",
  holdings: "자산",
  settings: "설정",
  collaboration: "협업",
  import: "데이터 가져오기",
};
const DISPLAY_NAME_MODE_OPTIONS = [
  { value: "real_name", label: "본명 우선" },
  { value: "nickname", label: "닉네임 우선" },
];
const DEFAULT_TRANSACTION_ROW_COLORS = {
  income: "#EDF9F0",
  expense: "#FFF1F0",
  investment: "#EFF4FF",
  transfer: "#FFF7E8",
};
const ONBOARDING_SEEN_KEY_PREFIX = "money-flow-onboarding-seen";
const LEGACY_OWNER_PREFIX = "__legacy_owner__:";
const FLOW_TYPE_OPTIONS = [
  { value: "income", label: "수입" },
  { value: "expense", label: "지출" },
  { value: "investment", label: "투자" },
  { value: "transfer", label: "이체" },
];
const FLOW_TYPE_LABELS = FLOW_TYPE_OPTIONS.reduce((acc, item) => ({ ...acc, [item.value]: item.label }), {});
const ASSET_TYPE_OPTIONS = [
  { value: "cash", label: "현금성" },
  { value: "stock", label: "주식" },
  { value: "crypto", label: "가상자산" },
  { value: "pension", label: "연금" },
  { value: "real_estate", label: "부동산" },
  { value: "other", label: "기타" },
];
const IMPORT_MODE_LABELS = {
  dry_run: "미리 검증",
  apply: "적용",
};
const AUTO_PRICE_REFRESH_INTERVAL_MS = 20_000;
const AUTO_PRICE_REFRESH_COOLDOWN_MS = 30_000;
const WS_REFRESH_DEBOUNCE_MS = 300;
const REALTIME_FALLBACK_SYNC_INTERVAL_MS = 45_000;
const IMPORT_MISMATCH_PREVIEW_LIMIT = 20;
const IMPORT_ISSUE_PREVIEW_LIMIT = 20;
const SOCKET_STATUS_LABELS = {
  connected: "연결됨",
  disconnected: "연결 끊김",
  error: "연결 오류",
  permission_lost: "권한 변경",
};
const FINANCIAL_SUMMARY_LABELS = [
  "수입",
  "지출",
  "투자",
  "순현금흐름",
  "총자산(KRW)",
  "평가손익(KRW)",
];
const PRICE_SUMMARY_LABELS = [
  "시세 지연 건수",
  "시세 갱신 상태",
  "최근 시세 갱신 시각",
];
const HOLDING_LIST_TABS = [
  { value: "all", label: "전체" },
  { value: "stock", label: "주식" },
  { value: "deposit", label: "예금" },
  { value: "savings", label: "적금" },
];
const HOLDING_SORT_KEYS = [
  { field: "name", label: "이름" },
  { field: "owner_name", label: "보유자" },
  { field: "category", label: "카테고리" },
  { field: "quantity", label: "수량" },
  { field: "average_cost", label: "평균단가" },
  { field: "market_value_krw", label: "평가(KRW)" },
  { field: "gain_loss_krw", label: "손익(KRW)" },
  { field: "updated_at", label: "최종 수정일" },
];
const HOLDING_SORT_DEFAULT = { field: "name", direction: "asc" };
const HOLDING_SORT_LABELS = HOLDING_SORT_KEYS.reduce((acc, item) => {
  acc[item.field] = item.label;
  return acc;
}, {});
const HOLDING_FORM_PRESETS = {
  cash: { category: "현금성", currency: "KRW", quantity: "1" },
  stock: { category: "주식", currency: "KRW", quantity: "1" },
  crypto: { category: "가상자산", currency: "KRW", quantity: "1" },
  pension: { category: "연금", currency: "KRW", quantity: "1" },
  real_estate: { category: "부동산", currency: "KRW", quantity: "1" },
  other: { category: "기타", currency: "KRW", quantity: "1" },
};
const COLLAB_ROLE_OPTIONS = [
  { value: "viewer", label: "뷰어" },
  { value: "editor", label: "편집자" },
  { value: "co_owner", label: "공동 소유자" },
  { value: "owner", label: "소유자" },
];
const COLLAB_ROLE_LABELS = COLLAB_ROLE_OPTIONS.reduce((acc, item) => ({ ...acc, [item.value]: item.label }), {});
const INVITATION_STATUS_LABELS = {
  pending: "대기 중",
  accepted: "수락됨",
  revoked: "취소됨",
  expired: "만료됨",
};
const CATEGORY_MAJOR_ALIAS = {
  변동지출: "변동 지출",
  고정지출: "고정 지출",
  저축투자: "저축·투자",
  "저축/투자": "저축·투자",
};
const CATEGORY_MINOR_ALIAS = {
  "카드 대금": "카드대금",
  건강1: "건강",
};
let refreshSessionPromise = null;

function uiGuideMessage(problem, action) {
  return action ? `${problem}\n${action}` : problem;
}

function getSavedEmail() {
  return localStorage.getItem(SAVED_EMAIL_KEY) || "";
}

function getCookieValue(name) {
  const target = `${name}=`;
  const cookies = String(document.cookie || "").split(";");
  for (const item of cookies) {
    const token = item.trim();
    if (token.startsWith(target)) {
      return decodeURIComponent(token.slice(target.length));
    }
  }
  return "";
}

function normalizeHeaderName(value, fallback) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized || fallback;
}

function setClientConfig(config) {
  csrfCookieName = String(config?.csrf_cookie_name || "").trim() || DEFAULT_CSRF_COOKIE_NAME;
  csrfHeaderName = normalizeHeaderName(config?.csrf_header_name, DEFAULT_CSRF_HEADER_NAME);
  householdHeaderName = normalizeHeaderName(config?.household_header_name, DEFAULT_HOUSEHOLD_HEADER_NAME);
}

async function loadClientConfig() {
  try {
    const response = await fetch(`${API_PREFIX}/auth/client-config`, {
      method: "GET",
      credentials: "include",
    });
    if (!response.ok) {
      return;
    }
    const payload = await response.json();
    setClientConfig(payload);
  } catch {
    // Keep default header/cookie names when config endpoint is unavailable.
  }
}

function getActiveHouseholdId() {
  return String(localStorage.getItem(ACTIVE_HOUSEHOLD_KEY) || "").trim();
}

function setActiveHouseholdId(value) {
  const normalized = String(value || "").trim();
  if (normalized) {
    localStorage.setItem(ACTIVE_HOUSEHOLD_KEY, normalized);
    return;
  }
  localStorage.removeItem(ACTIVE_HOUSEHOLD_KEY);
}

function applyCsrfHeader(headers, method) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(normalizedMethod)) {
    return;
  }
  const csrf = getCookieValue(csrfCookieName);
  if (csrf) {
    headers[csrfHeaderName] = csrf;
  }
}

function isAuthRoute(path) {
  return path.startsWith(`${API_PREFIX}/auth/`);
}

function shouldSkipAutoRefresh(path) {
  if (!isAuthRoute(path)) {
    return false;
  }
  if (path.startsWith(`${API_PREFIX}/auth/me`)) {
    return false;
  }
  return (
    path.startsWith(`${API_PREFIX}/auth/login`) ||
    path.startsWith(`${API_PREFIX}/auth/register`) ||
    path.startsWith(`${API_PREFIX}/auth/verify-email`) ||
    path.startsWith(`${API_PREFIX}/auth/resend-verification`) ||
    path.startsWith(`${API_PREFIX}/auth/refresh`) ||
    path.startsWith(`${API_PREFIX}/auth/logout`)
  );
}

function shouldAttachDebugTokenOptInHeader(path, method) {
  if (!DEBUG_TOKEN_OPT_IN) {
    return false;
  }
  const normalizedMethod = String(method || "GET").toUpperCase();
  if (normalizedMethod !== "POST") {
    return false;
  }
  if (path.startsWith(`${API_PREFIX}/auth/register`)) {
    return true;
  }
  if (path.startsWith(`${API_PREFIX}/auth/resend-verification`)) {
    return true;
  }
  return path === `${API_PREFIX}/household/invitations` || path.startsWith(`${API_PREFIX}/household/invitations?`);
}

function shouldAttachHouseholdHeader(path) {
  if (!path.startsWith(`${API_PREFIX}/`)) {
    return false;
  }
  if (path.startsWith(`${API_PREFIX}/auth/`)) {
    return false;
  }
  if (path.startsWith(`${API_PREFIX}/household/current`)) {
    return false;
  }
  if (path.startsWith(`${API_PREFIX}/household/list`)) {
    return false;
  }
  if (path.startsWith(`${API_PREFIX}/household/select`)) {
    return false;
  }
  if (path.startsWith(`${API_PREFIX}/household/invitations/accept`)) {
    return false;
  }
  if (path.startsWith(`${API_PREFIX}/household/invitations/received`)) {
    return false;
  }
  if (/^\/api\/v1\/household\/invitations\/[^/]+\/accept(?:\?|$)/.test(path)) {
    return false;
  }
  return true;
}

function isFormDataBody(body) {
  return typeof FormData !== "undefined" && body instanceof FormData;
}

async function api(path, options = {}, token = null, allowRefresh = true, allowHouseholdRetry = true) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = { ...(options.headers || {}) };
  const pathText = String(path || "");
  const activeHouseholdId = getActiveHouseholdId();
  const hasHouseholdHeader = Boolean(activeHouseholdId && shouldAttachHouseholdHeader(pathText));
  if (!isFormDataBody(options.body)) {
    headers["Content-Type"] = "application/json";
  }
  if (hasHouseholdHeader) {
    headers[householdHeaderName] = activeHouseholdId;
  }
  applyCsrfHeader(headers, method);
  if (token && token !== COOKIE_AUTH_SENTINEL) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (shouldAttachDebugTokenOptInHeader(pathText, method)) {
    headers[DEBUG_TOKEN_OPT_IN_HEADER] = "true";
  }
  const response = await fetch(pathText, { ...options, method, headers, credentials: "include" });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    const payload = data?.error || null;
    const canRetryWithoutHouseholdHeader = method === "GET" || method === "HEAD";
    if (
      response.status === 403 &&
      allowHouseholdRetry &&
      hasHouseholdHeader &&
      String(payload?.code || "").toUpperCase() === "HOUSEHOLD_ACCESS_FORBIDDEN"
    ) {
      setActiveHouseholdId("");
      if (canRetryWithoutHouseholdHeader) {
        return api(pathText, options, token, allowRefresh, false);
      }
    }
    if (response.status === 401 && allowRefresh && !shouldSkipAutoRefresh(pathText)) {
      try {
        if (!refreshSessionPromise) {
          refreshSessionPromise = (async () => {
            const refreshHeaders = {
              "Content-Type": "application/json",
            };
            applyCsrfHeader(refreshHeaders, "POST");
            return fetch(`${API_PREFIX}/auth/refresh`, {
              method: "POST",
              credentials: "include",
              headers: refreshHeaders,
              body: "{}",
            });
          })().finally(() => {
            refreshSessionPromise = null;
          });
        }
        const refreshResponse = await refreshSessionPromise;
        if (refreshResponse.ok) {
          return api(pathText, options, token, false, allowHouseholdRetry);
        }
      } catch {
        // Fall through to normalized auth error.
      }
    }
    const message = payload?.message || data?.detail || data?.message || `${response.status}`;
    const error = new Error(typeof message === "string" ? message : JSON.stringify(message));
    error.status = response.status;
    error.code = payload?.code || null;
    error.action = payload?.action || null;
    error.context = payload?.context ?? null;
    error.detail = data?.detail ?? null;
    throw error;
  }
  return data;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableBootstrapError(error) {
  const text = String(error?.message || error).toLowerCase();
  return text === "500" || text.includes("failed to fetch") || text.includes("network");
}

async function retryBootstrap(task, retries = 8, delayMs = 250) {
  let attempt = 0;
  while (true) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= retries || !isRetryableBootstrapError(error)) {
        throw error;
      }
      attempt += 1;
      await sleep(delayMs);
    }
  }
}

function fmt(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString("ko-KR");
}

function fmtKrw(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${Math.round(Number(value)).toLocaleString("ko-KR")}원`;
}

function parseDateTime(value) {
  if (!value) {
    return null;
  }
  let str = String(value).trim();
  if (!str) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    str = `${str}T00:00:00Z`;
  } else if (!str.endsWith("Z") && !str.includes("+") && !str.match(/-\d{2}:\d{2}$/)) {
    str = str.replace(" ", "T") + "Z";
  }
  const date = new Date(str);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function fmtDateTime(value) {
  const date = parseDateTime(value);
  if (!date) {
    return String(value);
  }
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function fmtDate(value) {
  const date = parseDateTime(value);
  if (!date) {
    return "-";
  }
  return date.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function todayIso() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function currentMonth() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function shiftMonth(base, delta) {
  const anchor = new Date(base.year, base.month - 1, 1);
  anchor.setMonth(anchor.getMonth() + delta);
  return {
    year: anchor.getFullYear(),
    month: anchor.getMonth() + 1,
  };
}

function toYearMonthKey(value) {
  if (!value || !Number.isFinite(Number(value.year)) || !Number.isFinite(Number(value.month))) {
    return "";
  }
  const month = Math.max(1, Math.min(12, Number(value.month)));
  return `${String(Number(value.year)).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function parseYearMonthKey(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }
  return { year, month };
}

function compareYearMonth(left, right) {
  const leftKey = toYearMonthKey(left);
  const rightKey = toYearMonthKey(right);
  if (!leftKey || !rightKey) {
    return 0;
  }
  if (leftKey === rightKey) {
    return 0;
  }
  return leftKey < rightKey ? -1 : 1;
}

function clampYearMonth(value, minValue, maxValue) {
  if (!value) {
    return maxValue || minValue || currentMonth();
  }
  if (minValue && compareYearMonth(value, minValue) < 0) {
    return { ...minValue };
  }
  if (maxValue && compareYearMonth(value, maxValue) > 0) {
    return { ...maxValue };
  }
  return {
    year: Number(value.year),
    month: Number(value.month),
  };
}

function isDepositCategory(category) {
  return /예금/i.test(String(category || ""));
}

function isSavingsCategory(category) {
  return /적금/i.test(String(category || ""));
}

function isMarketTrackedAssetType(assetType) {
  return assetType === "stock" || assetType === "crypto";
}

function toSymbolToken(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildLocalHoldingSymbol(form) {
  const tokens = [form.asset_type, form.name, form.owner_name, form.account_name]
    .map((item) => toSymbolToken(item))
    .filter(Boolean);
  const fallback = `LOCAL-${toSymbolToken(form.asset_type) || "ASSET"}`;
  const joined = (tokens.join("-") || fallback).slice(0, 40);
  return joined || "LOCAL-ASSET";
}

function normalizeNullableText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function stripGrouping(value) {
  return String(value ?? "").replace(/,/g, "").trim();
}

function sanitizeDecimalInput(value) {
  const text = stripGrouping(value).replace(/[^\d.]/g, "");
  if (!text) {
    return "";
  }
  const firstDot = text.indexOf(".");
  if (firstDot < 0) {
    return text;
  }
  const integerPart = text.slice(0, firstDot).replace(/\./g, "");
  const decimalPart = text.slice(firstDot + 1).replace(/\./g, "");
  return `${integerPart || "0"}.${decimalPart}`;
}

function formatGroupedDecimalInput(value) {
  const text = sanitizeDecimalInput(value);
  if (!text) {
    return "";
  }
  const hasDot = text.includes(".");
  const [integerPart, decimalPart = ""] = text.split(".");
  const groupedIntegerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return hasDot ? `${groupedIntegerPart}.${decimalPart}` : groupedIntegerPart;
}

function restoreDecimalInputCaret(input, plainLength) {
  if (!input || typeof plainLength !== "number") {
    return;
  }
  const nextPlainLength = Math.max(0, plainLength);
  try {
    if (nextPlainLength === 0) {
      input.setSelectionRange(0, 0);
      return;
    }
    const formatted = String(input.value || "");
    let seen = 0;
    let caret = formatted.length;
    for (let idx = 0; idx < formatted.length; idx += 1) {
      if (/[0-9.]/.test(formatted[idx])) {
        seen += 1;
        if (seen >= nextPlainLength) {
          caret = idx + 1;
          break;
        }
      }
    }
    input.setSelectionRange(caret, caret);
  } catch {
    // no-op: selection APIs can fail for non-focusable inputs in edge cases.
  }
}

function handleGroupedDecimalInput(event, setForm, field) {
  const input = event.currentTarget;
  const rawValue = String(input.value || "");
  const cursor = Number.isFinite(input.selectionStart) ? input.selectionStart : rawValue.length;
  const leftSanitized = sanitizeDecimalInput(rawValue.slice(0, cursor));
  const formattedValue = formatGroupedDecimalInput(rawValue);
  setForm((prev) => {
    if (!prev || typeof prev !== "object") {
      return prev;
    }
    return {
      ...prev,
      [field]: formattedValue,
    };
  });
  requestAnimationFrame(() => {
    if (document.activeElement !== input) {
      return;
    }
    restoreDecimalInputCaret(input, leftSanitized.length);
  });
}

function normalizeDecimalForCompare(value) {
  const text = stripGrouping(value);
  if (!text) {
    return "";
  }
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) {
    return text;
  }
  return numeric.toString();
}

function normalizeDecimalInputValue(value) {
  const text = stripGrouping(value);
  if (!text) {
    return "";
  }
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) {
    return formatGroupedDecimalInput(text);
  }
  const normalized = Number.isInteger(numeric) ? String(numeric) : text;
  return formatGroupedDecimalInput(normalized);
}

function normalizeTransactionRowColors(value) {
  return {
    ...DEFAULT_TRANSACTION_ROW_COLORS,
    ...(value || {}),
  };
}

function createAuthForm() {
  return {
    email: getSavedEmail(),
    password: "",
    password_confirm: "",
    display_name: "",
  };
}

function createVerifyForm() {
  return {
    email: getSavedEmail(),
    token: "",
    password: "",
    password_confirm: "",
    display_name: "",
  };
}

function createTransactionForm() {
  return {
    id: "",
    version: 0,
    occurred_on: todayIso(),
    flow_type: "expense",
    amount: "",
    category_id: "",
    memo: "",
    owner_user_id: "",
    owner_name: "",
  };
}

function buildDirtyPatchFields(payload, baseline, comparators = {}) {
  if (!baseline) {
    return { ...payload };
  }
  const dirty = {};
  for (const [field, nextValue] of Object.entries(payload)) {
    const compare = comparators[field];
    const isEqual = compare ? compare(nextValue, baseline[field]) : Object.is(nextValue, baseline[field]);
    if (!isEqual) {
      dirty[field] = nextValue;
    }
  }
  return dirty;
}

function getHoldingSortValue(item, sortField, holdingUpdatedAtById) {
  switch (sortField) {
    case "name":
      return String(item.name || "").trim();
    case "owner_name":
      return String(item.owner_name || "").trim().toLowerCase();
    case "category":
      return String(item.category || "기타").trim();
    case "quantity":
      return Number(item.quantity);
    case "average_cost":
      return Number(item.average_cost);
    case "market_value_krw":
      return Number(item.market_value_krw);
    case "gain_loss_krw":
      return Number(item.gain_loss_krw);
    case "updated_at": {
      const raw = String(holdingUpdatedAtById.get(item.holding_id) || "");
      const time = Date.parse(raw);
      return Number.isFinite(time) ? time : 0;
    }
    default:
      return String(item[sortField] || "");
  }
}

function buildTransactionPayloadFromForm(form) {
  return {
    occurred_on: String(form.occurred_on || "").trim(),
    flow_type: String(form.flow_type || "").trim(),
    amount: stripGrouping(form.amount),
    category_id: form.category_id || null,
    memo: String(form.memo || ""),
    owner_user_id: normalizeNullableText(form.owner_user_id),
    owner_name: normalizeNullableText(form.owner_name),
  };
}

const TX_PATCH_COMPARATORS = {
  occurred_on: (left, right) => String(left || "").trim() === String(right || "").trim(),
  flow_type: (left, right) => String(left || "").trim() === String(right || "").trim(),
  amount: (left, right) => normalizeDecimalForCompare(left) === normalizeDecimalForCompare(right),
  category_id: (left, right) => normalizeNullableText(left) === normalizeNullableText(right),
  memo: (left, right) => String(left ?? "") === String(right ?? ""),
  owner_user_id: (left, right) => normalizeNullableText(left) === normalizeNullableText(right),
  owner_name: (left, right) => normalizeNullableText(left) === normalizeNullableText(right),
};

const HOLDING_PATCH_COMPARATORS = {
  market_symbol: (left, right) => String(left || "").trim().toUpperCase() === String(right || "").trim().toUpperCase(),
  name: (left, right) => String(left || "").trim() === String(right || "").trim(),
  category: (left, right) => String(left || "").trim() === String(right || "").trim(),
  owner_user_id: (left, right) => normalizeNullableText(left) === normalizeNullableText(right),
  owner_name: (left, right) => normalizeNullableText(left) === normalizeNullableText(right),
  account_name: (left, right) => normalizeNullableText(left) === normalizeNullableText(right),
  quantity: (left, right) => normalizeDecimalForCompare(left) === normalizeDecimalForCompare(right),
  average_cost: (left, right) => normalizeDecimalForCompare(left) === normalizeDecimalForCompare(right),
  currency: (left, right) => String(left || "").trim().toUpperCase() === String(right || "").trim().toUpperCase(),
};

function createHoldingForm(assetType = "cash") {
  const preset = HOLDING_FORM_PRESETS[assetType] || HOLDING_FORM_PRESETS.cash;
  return {
    asset_type: assetType,
    symbol: "",
    market_symbol: "",
    name: "",
    category: preset.category,
    owner_user_id: "",
    owner_name: "",
    account_name: "",
    quantity: preset.quantity,
    average_cost: "",
    currency: preset.currency,
  };
}

function createHoldingInlineEditForm(row) {
  return {
    id: row.id,
    version: row.version,
    asset_type: row.asset_type,
    symbol: row.symbol || "",
    market_symbol: row.market_symbol || "",
    name: row.name || "",
    category: row.category || "",
    owner_user_id: row.owner_user_id || "",
    owner_name: row.owner_name || "",
    account_name: row.account_name || "",
    quantity: normalizeDecimalInputValue(row.quantity ?? "1"),
    average_cost: normalizeDecimalInputValue(row.average_cost ?? ""),
    currency: row.currency || "KRW",
  };
}

function categoryPalette(size) {
  const base = [
    "#0ea5e9",
    "#10b981",
    "#f59e0b",
    "#8b5cf6",
    "#f43f5e",
    "#14b8a6",
    "#f97316",
    "#3b82f6",
    "#84cc16",
    "#eab308",
    "#ec4899",
    "#06b6d4",
  ];
  if (size <= base.length) {
    return base.slice(0, size);
  }
  return Array.from({ length: size }, (_, idx) => {
    const hue = ((idx * 360) / size + 15) % 360;
    return `hsl(${hue.toFixed(2)}, 70%, 52%)`;
  });
}

function normalizeCategoryText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, "/");
}

function toCategoryMajorLabel(value) {
  const normalized = normalizeCategoryText(value);
  return CATEGORY_MAJOR_ALIAS[normalized] || normalized;
}

function toCategoryMinorLabel(value) {
  const normalized = normalizeCategoryText(value);
  return CATEGORY_MINOR_ALIAS[normalized] || normalized;
}

function toCategoryPairLabel(category) {
  if (!category) return "-";
  return `${toCategoryMajorLabel(category.major)} / ${toCategoryMinorLabel(category.minor)}`;
}

function onboardingSeenKey(userId, householdId) {
  const normalizedUserId = String(userId || "").trim();
  const normalizedHouseholdId = String(householdId || "").trim();
  if (!normalizedUserId || !normalizedHouseholdId) {
    return "";
  }
  return `${ONBOARDING_SEEN_KEY_PREFIX}:${normalizedUserId}:${normalizedHouseholdId}`;
}

function ownerSelectValue(ownerUserId = "", ownerName = "") {
  const normalizedOwnerUserId = String(ownerUserId || "").trim();
  if (normalizedOwnerUserId) {
    return normalizedOwnerUserId;
  }
  const normalizedOwnerName = String(ownerName || "").trim();
  if (!normalizedOwnerName) {
    return "";
  }
  return `${LEGACY_OWNER_PREFIX}${normalizedOwnerName}`;
}

function createProfileForm(user) {
  return {
    real_name: String(user?.real_name || user?.display_name || "").trim(),
    nickname: String(user?.nickname || "").trim(),
    display_name_mode: String(user?.display_name_mode || "real_name").trim() || "real_name",
  };
}

function createHouseholdSettingsForm(settingsPayload) {
  return {
    name: String(settingsPayload?.name || "").trim(),
    transaction_row_colors: normalizeTransactionRowColors(settingsPayload?.transaction_row_colors),
  };
}

function createCategoryDraft(flowType = "expense") {
  return {
    flow_type: flowType,
    major: "",
    minor: "",
  };
}

function renderCategoryCell(category) {
  if (!category) {
    return <span className="category-cell-empty">-</span>;
  }
  return (
    <div className="category-cell">
      <span className="category-cell-major">{toCategoryMajorLabel(category.major)}</span>
      <span className="category-cell-minor">{toCategoryMinorLabel(category.minor)}</span>
    </div>
  );
}

function formatApiError(error, context) {
  const status = Number(error?.status || 0);
  const code = String(error?.code || "").toUpperCase();
  const detail = String(error?.detail || error?.message || error || "").toLowerCase();
  const networkIssue = status >= 500 || detail === "500" || detail.includes("failed to fetch") || detail.includes("network");

  if (context === "auth_login" && (code === "AUTH_INVALID_CREDENTIALS" || code === "AUTH_USER_NOT_FOUND" || status === 401)) {
    return uiGuideMessage("로그인에 실패했습니다.", "이메일과 비밀번호를 확인한 뒤 다시 시도해 주세요.");
  }
  if (context === "auth_register" && (code === "AUTH_EMAIL_ALREADY_EXISTS" || status === 409)) {
    return uiGuideMessage("회원가입에 실패했습니다. 이미 사용 중인 이메일입니다.", "로그인으로 전환하거나 다른 이메일을 사용해 주세요.");
  }
  if (context === "profile_save" && code === "AUTH_NICKNAME_REQUIRED") {
    return uiGuideMessage("닉네임 표시명을 선택하려면 닉네임이 필요합니다.", "닉네임을 입력하거나 표시명 모드를 본명으로 바꿔 주세요.");
  }
  if ((context === "transaction_submit" && code === "TRANSACTION_OWNER_INVALID") || (context === "holding_submit" && code === "HOLDING_OWNER_INVALID")) {
    return uiGuideMessage("선택한 거래자/보유자가 현재 가계 멤버가 아닙니다.", "가계 멤버 목록에서 다시 선택해 주세요.");
  }
  if ((context === "category_create" || context === "category_patch" || context === "category_rename_major") && code === "CATEGORY_DUPLICATE") {
    return uiGuideMessage("동일한 카테고리 조합이 이미 존재합니다.", "다른 이름으로 저장하거나 기존 항목을 수정해 주세요.");
  }
  if (context === "category_delete" && code === "CATEGORY_IN_USE") {
    return uiGuideMessage("사용 중인 카테고리는 삭제할 수 없습니다.", "이름을 바꾸거나 미사용 카테고리만 정리해 주세요.");
  }
  if (context.startsWith("import_")) {
    if (code === "IMPORT_WORKBOOK_NOT_FOUND") {
      return uiGuideMessage("가져올 파일을 찾을 수 없습니다.", "파일 경로를 확인하거나 파일 업로드를 사용해 주세요.");
    }
    if (code === "IMPORT_WORKBOOK_EXTENSION_INVALID") {
      return uiGuideMessage("가져오기는 .xlsx 파일만 지원합니다.", "엑셀(.xlsx) 파일을 다시 선택해 주세요.");
    }
    if (code === "IMPORT_PATH_NOT_ALLOWED") {
      return uiGuideMessage("허용된 경로의 파일만 가져올 수 있습니다.", "프로젝트의 import 허용 폴더(legacy) 파일을 선택해 주세요.");
    }
    if (code === "IMPORT_FILE_TOO_LARGE") {
      return uiGuideMessage("파일 크기가 업로드 제한을 초과했습니다.", "파일 크기를 줄이거나 불필요한 시트를 정리해 주세요.");
    }
    if (code === "IMPORT_ARCHIVE_TOO_COMPLEX") {
      return uiGuideMessage("파일 내부 시트/개체 구성이 너무 복잡합니다.", "불필요한 시트나 개체를 정리한 뒤 다시 시도해 주세요.");
    }
    if (code === "IMPORT_ARCHIVE_EXPANDS_TOO_LARGE") {
      return uiGuideMessage("파일 내부 압축 해제 크기가 제한을 초과했습니다.", "시트 수나 포함 데이터를 줄인 뒤 다시 시도해 주세요.");
    }
    if (status === 413) {
      return uiGuideMessage(
        "서버 업로드 제한으로 파일 전송이 차단되었습니다.",
        "잠시 후 다시 시도하거나 관리자에게 업로드 프록시 제한 설정을 확인해 달라고 요청해 주세요."
      );
    }
    if (code === "IMPORT_ALREADY_RUNNING" || status === 429) {
      return uiGuideMessage("다른 가져오기 작업이 진행 중입니다.", "잠시 기다린 뒤 다시 시도해 주세요.");
    }
    return uiGuideMessage("가져오기 처리 중 오류가 발생했습니다.", "파일 구조를 확인한 뒤 다시 시도해 주세요.");
  }
  if (context === "prices_refresh") {
    if (code === "AUTH_TOKEN_MISSING" || code === "AUTH_TOKEN_INVALID" || status === 401) {
      return uiGuideMessage("시세 갱신 요청에 실패했습니다.", "다시 로그인한 뒤 시도해 주세요.");
    }
    return uiGuideMessage("시세 갱신 요청에 실패했습니다.", "잠시 후 다시 시도해 주세요.");
  }
  if (context === "transaction_submit") {
    if (code === "CATEGORY_INVALID") {
      return uiGuideMessage("거래 저장에 실패했습니다. 카테고리가 유효하지 않습니다.", "대분류와 중분류를 다시 선택해 주세요.");
    }
    return uiGuideMessage("거래 저장에 실패했습니다.", "입력값을 확인한 뒤 다시 시도해 주세요.");
  }
  if (context === "holding_submit") {
    if (code === "HOLDING_ALREADY_EXISTS" || status === 409) {
      return uiGuideMessage("이미 같은 자산이 등록되어 있습니다.", "시장심볼/계좌/보유자를 확인해 주세요.");
    }
    return uiGuideMessage("자산 저장에 실패했습니다.", "입력값을 확인한 뒤 다시 시도해 주세요.");
  }
  if (context === "transaction_delete") {
    return uiGuideMessage("거래 삭제에 실패했습니다.", "새로고침 후 다시 시도해 주세요.");
  }
  if (context === "holding_delete") {
    return uiGuideMessage("자산 삭제에 실패했습니다.", "새로고침 후 다시 시도해 주세요.");
  }
  if (context === "bootstrap") {
    return uiGuideMessage("초기 데이터를 불러오지 못했습니다.", "잠시 후 다시 로그인해 주세요.");
  }
  if (networkIssue) {
    return uiGuideMessage("서버 연결이 불안정합니다.", "잠시 후 다시 시도해 주세요.");
  }
  return uiGuideMessage("요청 처리 중 오류가 발생했습니다.", "입력값을 확인한 뒤 다시 시도해 주세요.");
}

function formatAuthError(error, mode) {
  if (mode === "login") {
    return formatApiError(error, "auth_login");
  }
  if (mode === "verify") {
    return formatApiError(error, "auth_verify");
  }
  if (mode === "resend") {
    return formatApiError(error, "auth_resend");
  }
  return formatApiError(error, "auth_register");
}

function formatImportError(error, mode) {
  const context = mode === "apply" ? "import_apply" : "import_dry_run";
  return formatApiError(error, context);
}

function shouldAutoRefreshPrice(status) {
  const trackedHoldingsCount = Number((status?.tracked_holdings_count ?? status?.holdings_count) || 0);
  const snapshotCount = Number(status?.snapshot_count || 0);
  const staleCount = Number(status?.stale_count || 0);
  if (trackedHoldingsCount <= 0) {
    return false;
  }
  return staleCount > 0 || snapshotCount < trackedHoldingsCount;
}

function App() {
  const [token, setToken] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState(() => createAuthForm());
  const [verifyForm, setVerifyForm] = useState(() => createVerifyForm());
  const [saveAccountInfo, setSaveAccountInfo] = useState(() => Boolean(getSavedEmail()));
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [user, setUser] = useState(null);
  const [household, setHousehold] = useState(null);
  const [householdSettings, setHouseholdSettings] = useState(null);
  const [householdRole, setHouseholdRole] = useState("");
  const householdRoleRef = useRef("");
  const [householdList, setHouseholdList] = useState([]);
  const [householdMembers, setHouseholdMembers] = useState([]);
  const [householdInvites, setHouseholdInvites] = useState([]);
  const [receivedHouseholdInvites, setReceivedHouseholdInvites] = useState([]);
  const [inviteForm, setInviteForm] = useState({ email: "", role: "viewer" });
  const [inviteAcceptToken, setInviteAcceptToken] = useState("");
  const [inviteAcceptanceNotice, setInviteAcceptanceNotice] = useState(null);
  const [categories, setCategories] = useState([]);
  const [profileForm, setProfileForm] = useState(() => createProfileForm(null));
  const [householdSettingsForm, setHouseholdSettingsForm] = useState(() => createHouseholdSettingsForm(null));
  const [categoryDraft, setCategoryDraft] = useState(() => createCategoryDraft());
  const [categoryEditId, setCategoryEditId] = useState("");
  const [categoryEditForm, setCategoryEditForm] = useState({ major: "", minor: "" });
  const [majorRenameDrafts, setMajorRenameDrafts] = useState({});
  const [showOnboardingGuide, setShowOnboardingGuide] = useState(false);
  const [showTransactionEntryBanner, setShowTransactionEntryBanner] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [socketStatus, setSocketStatus] = useState("disconnected");

  const [filterMode, setFilterMode] = useState("month");
  const [yearMonth, setYearMonth] = useState(currentMonth());
  const [range, setRange] = useState({ start: todayIso(), end: todayIso() });

  const filterModeRef = useRef(filterMode);
  const yearMonthRef = useRef(yearMonth);
  const rangeRef = useRef(range);
  useEffect(() => { filterModeRef.current = filterMode; }, [filterMode]);
  useEffect(() => { yearMonthRef.current = yearMonth; }, [yearMonth]);
  useEffect(() => { rangeRef.current = range; }, [range]);

  const [overview, setOverview] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [holdings, setHoldings] = useState([]);
  const [priceStatus, setPriceStatus] = useState(null);
  const [importReport, setImportReport] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardLoaded, setDashboardLoaded] = useState(false);
  const [importLoadingMode, setImportLoadingMode] = useState("");
  const [priceRefreshPolling, setPriceRefreshPolling] = useState(false);
  const importFileInputRef = useRef(null);
  const dashboardRequestCountRef = useRef(0);
  const wsTicketMethodRef = useRef("POST");
  const wsRefreshTimerRef = useRef(null);
  const wsPendingKindsRef = useRef(new Set());
  const priceRefreshOriginRef = useRef("manual");
  const lastAutoRefreshAtRef = useRef(0);
  const priceRefreshRequestInFlightRef = useRef(false);
  const realtimeFallbackSyncInFlightRef = useRef(false);
  const confirmResolveRef = useRef(null);
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: "",
    action: "",
    confirmLabel: "확인",
  });

  const [txForm, setTxForm] = useState(() => createTransactionForm());
  const [txCategoryMajor, setTxCategoryMajor] = useState("");
  const [txListFilter, setTxListFilter] = useState({
    keyword: "",
    flow_type: "all",
    start: "",
    end: "",
  });
  const [holdingListTab, setHoldingListTab] = useState("all");
  const [holdingSortField, setHoldingSortField] = useState(HOLDING_SORT_DEFAULT.field);
  const [holdingSortDirection, setHoldingSortDirection] = useState(HOLDING_SORT_DEFAULT.direction);

  const [holdingForm, setHoldingForm] = useState(() => createHoldingForm("cash"));
  const [holdingInlineEdit, setHoldingInlineEdit] = useState(null);
  const [txInlineEdit, setTxInlineEdit] = useState(null);

  const [importFile, setImportFile] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const categoryOptions = useMemo(() => categories.filter((item) => item.flow_type === txForm.flow_type), [categories, txForm.flow_type]);
  const categoryMajorOptions = useMemo(
    () => Array.from(new Set(categoryOptions.map((item) => item.major))),
    [categoryOptions]
  );
  const categoryMinorOptions = useMemo(
    () => categoryOptions.filter((item) => item.major === txCategoryMajor),
    [categoryOptions, txCategoryMajor]
  );
  const categoryById = useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories]);
  const txInlineCategoryOptions = useMemo(
    () => categories.filter((item) => txInlineEdit && item.flow_type === txInlineEdit.flow_type),
    [categories, txInlineEdit]
  );
  const txInlineCategoryMajor = String(txInlineEdit?.category_major || "");
  const txInlineCategoryMajorOptions = useMemo(
    () => Array.from(new Set(txInlineCategoryOptions.map((item) => item.major))),
    [txInlineCategoryOptions]
  );
  const txInlineCategoryMinorOptions = useMemo(
    () => txInlineCategoryOptions.filter((item) => item.major === txInlineCategoryMajor),
    [txInlineCategoryOptions, txInlineCategoryMajor]
  );

  function closeTxInlineEdit() {
    setTxInlineEdit(null);
  }
  const transactionById = useMemo(() => new Map(transactions.map((item) => [item.id, item])), [transactions]);
  const filteredTransactions = useMemo(() => {
    const keyword = normalizeCategoryText(txListFilter.keyword).toLowerCase();
    return transactions.filter((item) => {
      if (txListFilter.flow_type !== "all" && item.flow_type !== txListFilter.flow_type) {
        return false;
      }
      if (txListFilter.start && String(item.occurred_on) < txListFilter.start) {
        return false;
      }
      if (txListFilter.end && String(item.occurred_on) > txListFilter.end) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const category = categoryById.get(item.category_id || "");
      const source = [
        item.occurred_on,
        FLOW_TYPE_LABELS[item.flow_type] || item.flow_type,
        item.memo || "",
        item.owner_name || "",
        category ? toCategoryPairLabel(category) : "",
        String(item.amount ?? ""),
      ]
        .join(" ")
        .toLowerCase();
      return source.includes(keyword);
    });
  }, [categoryById, transactions, txListFilter]);
  const holdingById = useMemo(() => new Map(holdings.map((item) => [item.id, item])), [holdings]);
  const holdingUpdatedAtById = useMemo(
    () => new Map(holdings.map((item) => [item.id, item.updated_at])),
    [holdings]
  );
  const holdingItems = useMemo(() => portfolio?.items || [], [portfolio?.items]);
  const filteredHoldingItems = useMemo(() => {
    if (holdingListTab === "all") {
      return holdingItems;
    }
    return holdingItems.filter((item) => {
      const cat = String(item.category || "기타").trim() || "기타";
      return cat === holdingListTab;
    });
  }, [holdingItems, holdingListTab]);
  const sortedHoldingItems = useMemo(() => {
    const direction = holdingSortDirection === "asc" ? 1 : -1;
    const next = [...filteredHoldingItems];
    return next.sort((left, right) => {
      const leftValue = getHoldingSortValue(left, holdingSortField, holdingUpdatedAtById);
      const rightValue = getHoldingSortValue(right, holdingSortField, holdingUpdatedAtById);
      if (typeof leftValue === "number" && typeof rightValue === "number") {
        if (!Number.isNaN(leftValue) && !Number.isNaN(rightValue) && leftValue !== rightValue) {
          return (leftValue - rightValue) * direction;
        }
      }
      const stringCompare = String(leftValue).localeCompare(String(rightValue), "ko");
      if (stringCompare !== 0) {
        return stringCompare * direction;
      }
      return String(left.name || "").localeCompare(String(right.name || ""), "ko") * direction;
    });
  }, [filteredHoldingItems, holdingSortDirection, holdingSortField, holdingUpdatedAtById]);
  const dynamicHoldingTabs = useMemo(() => {
    const categories = new Set();
    for (const item of holdingItems) {
      categories.add(String(item.category || "기타").trim() || "기타");
    }
    const tabs = [{ value: "all", label: "전체" }];
    const sortedCategories = Array.from(categories).sort();
    for (const cat of sortedCategories) {
      tabs.push({ value: cat, label: cat });
    }
    return tabs;
  }, [holdingItems]);
  const groupedHoldingSections = useMemo(() => {
    if (holdingListTab !== "all") {
      return [];
    }
    const bucket = new Map();
    for (const item of sortedHoldingItems) {
      const category = String(item.category || "기타").trim() || "기타";
      const sectionItems = bucket.get(category) || [];
      sectionItems.push(item);
      bucket.set(category, sectionItems);
    }
    return Array.from(bucket.entries()).sort((left, right) => {
      const leftTotal = left[1].reduce((sum, item) => sum + Number(item.market_value_krw || 0), 0);
      const rightTotal = right[1].reduce((sum, item) => sum + Number(item.market_value_krw || 0), 0);
      return rightTotal - leftTotal;
    });
  }, [holdingListTab, sortedHoldingItems]);
  const ownerMemberOptions = useMemo(() => {
    return householdMembers
      .map((member) => {
        const userId = String(member?.user_id || "").trim();
        const displayName = String(member?.display_name || "").trim();
        if (!userId || !displayName) {
          return null;
        }
        return {
          value: userId,
          label: `${displayName}${member?.email ? ` (${member.email})` : ""}`,
          displayName,
          email: String(member?.email || "").trim(),
        };
      })
      .filter(Boolean);
  }, [householdMembers]);
  const categoryGroups = useMemo(() => {
    const flows = new Map();
    for (const category of categories) {
      const flowType = String(category?.flow_type || "").trim() || "expense";
      const major = String(category?.major || "").trim() || "미분류";
      const flowBucket = flows.get(flowType) || new Map();
      const majorBucket = flowBucket.get(major) || [];
      majorBucket.push(category);
      flowBucket.set(major, majorBucket);
      flows.set(flowType, flowBucket);
    }
    return FLOW_TYPE_OPTIONS.map((flow) => ({
      ...flow,
      groups: Array.from((flows.get(flow.value) || new Map()).entries())
        .map(([major, items]) => [major, [...items].sort((left, right) => String(left.minor || "").localeCompare(String(right.minor || ""), "ko"))])
        .sort((left, right) => String(left[0]).localeCompare(String(right[0]), "ko")),
    }));
  }, [categories]);
  const importMismatchPreview = useMemo(
    () => (importReport?.detected_mismatch_cells || []).slice(0, IMPORT_MISMATCH_PREVIEW_LIMIT),
    [importReport]
  );
  const importIssuePreview = useMemo(
    () => (importReport?.issues || []).slice(0, IMPORT_ISSUE_PREVIEW_LIMIT),
    [importReport]
  );

  useEffect(() => {
    setProfileForm(createProfileForm(user));
  }, [user?.id, user?.real_name, user?.nickname, user?.display_name_mode, user?.display_name]);

  useEffect(() => {
    setHouseholdSettingsForm(createHouseholdSettingsForm(householdSettings));
  }, [householdSettings?.household_id, householdSettings?.name, JSON.stringify(householdSettings?.transaction_row_colors || {})]);

  useEffect(() => {
    if (!user?.id || !household?.id) {
      setShowOnboardingGuide(false);
      return;
    }
    const isEmptyHousehold = transactions.length === 0 && holdings.length === 0;
    const seenKey = onboardingSeenKey(user.id, household.id);
    if (!isEmptyHousehold || !seenKey || localStorage.getItem(seenKey)) {
      setShowOnboardingGuide(false);
      return;
    }
    setShowOnboardingGuide(true);
  }, [user?.id, household?.id, transactions.length, holdings.length]);

  useEffect(() => {
    if (transactions.length > 0) {
      setShowTransactionEntryBanner(false);
    }
  }, [transactions.length]);

  function getHoldingSortLabel(field) {
    return HOLDING_SORT_LABELS[field] || field;
  }
  function toggleHoldingSort(field) {
    if (field === holdingSortField) {
      setHoldingSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setHoldingSortField(field);
    setHoldingSortDirection("asc");
  }
  function renderHoldingSortIndicator(field) {
    if (holdingSortField !== field) {
      return "↕";
    }
    return holdingSortDirection === "asc" ? "↑" : "↓";
  }
  function renderHoldingSortHeader(field) {
    const isActive = holdingSortField === field;
    return (
      <button
        type="button"
        className={`sort-header${isActive ? " active" : ""}`}
        onClick={() => toggleHoldingSort(field)}
        aria-label={`Sort holding list by ${field} ${isActive ? (holdingSortDirection === "asc" ? "descending" : "ascending") : "ascending"}`}
      >
        {getHoldingSortLabel(field)}
        <span className="sort-indicator" aria-hidden="true">
          {renderHoldingSortIndicator(field)}
        </span>
      </button>
    );
  }
  function renderHoldingSortAria(field) {
    if (holdingSortField !== field) {
      return "none";
    }
    return holdingSortDirection === "asc" ? "ascending" : "descending";
  }

  function syncTxCategoryMajor(categoryId) {
    if (!categoryId) {
      setTxCategoryMajor("");
      return;
    }
    const selected = categoryById.get(categoryId);
    setTxCategoryMajor(selected?.major || "");
  }

  function closeConfirmDialog(confirmed) {
    const resolve = confirmResolveRef.current;
    confirmResolveRef.current = null;
    setConfirmDialog({
      open: false,
      title: "",
      action: "",
      confirmLabel: "확인",
    });
    if (resolve) {
      resolve(confirmed);
    }
  }

  function requestConfirmDialog({ title, action, confirmLabel = "확인" }) {
    if (confirmResolveRef.current) {
      confirmResolveRef.current(false);
      confirmResolveRef.current = null;
    }
    return new Promise((resolve) => {
      confirmResolveRef.current = resolve;
      setConfirmDialog({
        open: true,
        title,
        action,
        confirmLabel,
      });
    });
  }

  async function handleHouseholdInviteAccepted(acceptedPayload, nextToken = token) {
    const nextHouseholdId = String(acceptedPayload?.household_id || "").trim();
    const nextInvitationId = String(acceptedPayload?.invitation_id || "").trim();
    const nextHouseholdName = String(acceptedPayload?.household_name || "").trim() || "초대 받은 가계";
    const nextRole = String(acceptedPayload?.role || "").trim();
    const activeHouseholdSelected = Boolean(acceptedPayload?.active_household_selected);
    setInviteAcceptToken("");
    await loadAuthContext(nextToken);
    await refreshData(false, nextToken);
    await refreshCollaborationData(nextToken);
    setInviteAcceptanceNotice({
      invitationId: nextInvitationId,
      householdId: nextHouseholdId,
      householdName: nextHouseholdName,
      role: nextRole,
      activeHouseholdSelected,
    });
    setTab("collaboration");
    setMessage(
      uiGuideMessage(
        "초대를 수락했습니다.",
        activeHouseholdSelected
          ? `${nextHouseholdName} 가계가 현재 작업 가계로 선택되었습니다.`
          : `${nextHouseholdName} 가계 참여가 완료되었습니다. 아래에서 작업 가계 전환을 선택할 수 있습니다.`
      )
    );
  }

  useEffect(() => {
    return () => {
      if (confirmResolveRef.current) {
        confirmResolveRef.current(false);
        confirmResolveRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!txForm.category_id) {
      if (!categoryMajorOptions.includes(txCategoryMajor)) {
        setTxCategoryMajor("");
      }
      return;
    }
    const selected = categoryById.get(txForm.category_id);
    const nextMajor = selected?.major || "";
    if (nextMajor !== txCategoryMajor) {
      setTxCategoryMajor(nextMajor);
    }
  }, [categoryById, categoryMajorOptions, txCategoryMajor, txForm.category_id]);

  useEffect(() => {
    setMessage((prev) => (prev ? "" : prev));
  }, [tab]);

  useEffect(() => {
    if (!txInlineEdit) {
      return;
    }
    if (!txInlineEdit.category_id) {
      return;
    }
    const nextMajor = categoryById.get(txInlineEdit.category_id)?.major || "";
    if (nextMajor && nextMajor !== txInlineEdit.category_major) {
      setTxInlineEdit((prev) => {
        if (!prev || prev.id !== txInlineEdit.id) {
          return prev;
        }
        return {
          ...prev,
          category_major: nextMajor,
        };
      });
    }
  }, [categoryById, txInlineEdit?.id, txInlineEdit?.category_id, txInlineEdit?.category_major]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rawHash = String(window.location.hash || "").replace(/^#/, "");
    const hashParams = new URLSearchParams(rawHash.startsWith("?") ? rawHash.slice(1) : rawHash);
    const verifyToken = hashParams.get("verify_token");
    const inviteToken = hashParams.get("invite_token");
    const hadLegacyQueryTokens = params.has("verify_token") || params.has("invite_token");
    if (verifyToken) {
      setAuthMode("verify");
      setVerifyForm((prev) => ({
        ...prev,
        email: prev.email || getSavedEmail() || "",
        token: verifyToken,
      }));
      params.delete("verify_token");
      hashParams.delete("verify_token");
    }
    if (inviteToken) {
      setInviteAcceptToken(inviteToken);
      hashParams.delete("invite_token");
    }
    if (hadLegacyQueryTokens) {
      params.delete("verify_token");
      params.delete("invite_token");
      if (!verifyToken && !inviteToken) {
        setMessage("보안을 위해 URL query 토큰은 지원하지 않습니다. 최신 인증 링크로 다시 시도해 주세요.");
      }
    }
    if (!verifyToken && !inviteToken && !hadLegacyQueryTokens) {
      return;
    }
    const nextQuery = params.toString();
    const nextHash = hashParams.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${nextHash ? `#${nextHash}` : ""}`;
    window.history.replaceState({}, "", nextUrl);
  }, []);

  async function loadAuthContext(nextToken = token) {
    const [me, householdResp, householdListResp, householdSettingsResp, categoryResp] = await Promise.all([
      api(`${API_PREFIX}/auth/me`, {}, nextToken),
      api(`${API_PREFIX}/household/current`, {}, nextToken),
      api(`${API_PREFIX}/household/list`, {}, nextToken),
      api(`${API_PREFIX}/household/settings`, {}, nextToken),
      api(`${API_PREFIX}/categories`, {}, nextToken),
    ]);
    const nextHouseholdId = householdResp?.household?.id || "";
    setActiveHouseholdId(nextHouseholdId);
    setUser(me);
    setHousehold(householdResp.household);
    setHouseholdSettings({
      ...householdSettingsResp,
      transaction_row_colors: normalizeTransactionRowColors(householdSettingsResp?.transaction_row_colors),
    });
    setActiveHouseholdId(nextHouseholdId);
    const nextHouseholdRole = householdResp.role || "";
    householdRoleRef.current = nextHouseholdRole;
    setHouseholdRole(nextHouseholdRole);
    setHouseholdList(householdListResp.households || []);
    setCategories(categoryResp);
  }

  function resolveFilterQuery(override = null) {
    const activeFilterMode = override?.filterMode || filterModeRef.current;
    const activeYearMonth = override?.yearMonth || yearMonthRef.current;
    const activeRange = override?.range || rangeRef.current;
    const txQuery =
      activeFilterMode === "month"
        ? `year=${activeYearMonth.year}&month=${activeYearMonth.month}`
        : `start_date=${encodeURIComponent(activeRange.start)}&end_date=${encodeURIComponent(activeRange.end)}`;
    return {
      txQuery,
      overviewQuery: txQuery,
    };
  }

  async function refreshData(refreshPrices = false, nextToken = token, filterOverride = null, options = {}) {
    const silent = Boolean(options?.silent);
    if (!silent) {
      dashboardRequestCountRef.current += 1;
      setDashboardLoading(true);
    }
    try {
      const { txQuery, overviewQuery } = resolveFilterQuery(filterOverride);
      const [overviewResp, txResp, holdingResp, portfolioResp, statusResp] = await Promise.all([
        api(`${API_PREFIX}/dashboard/overview?${overviewQuery}`, {}, nextToken),
        api(`${API_PREFIX}/transactions?${txQuery}&limit=1000`, {}, nextToken),
        api(`${API_PREFIX}/holdings`, {}, nextToken),
        api(`${API_PREFIX}/dashboard/portfolio`, {}, nextToken),
        api(`${API_PREFIX}/prices/status`, {}, nextToken),
      ]);
      setOverview(overviewResp);
      setTransactions(txResp);
      setHoldings(holdingResp);
      setPortfolio(portfolioResp);
      setPriceStatus(statusResp);
      setPriceRefreshPolling(Boolean(statusResp?.refresh_in_progress));
      setDashboardLoaded(true);
    } finally {
      if (!silent) {
        dashboardRequestCountRef.current = Math.max(0, dashboardRequestCountRef.current - 1);
        if (dashboardRequestCountRef.current === 0) {
          setDashboardLoading(false);
        }
      }
    }
  }

  async function refreshDataByKinds(kinds, nextToken = token, options = {}) {
    if (!kinds || kinds.size === 0) {
      return;
    }
    const includeAll = kinds.has("full");
    const includeTransactions = includeAll || kinds.has("transaction");
    const includeHoldings = includeAll || kinds.has("holding");
    if (!includeTransactions && !includeHoldings) {
      return;
    }
    const silent = Boolean(options?.silent);
    if (!silent) {
      dashboardRequestCountRef.current += 1;
      setDashboardLoading(true);
    }
    try {
      const { txQuery, overviewQuery } = resolveFilterQuery();
      const requests = [];
      if (includeTransactions) {
        requests.push(
          api(`${API_PREFIX}/dashboard/overview?${overviewQuery}`, {}, nextToken).then((data) => ({ key: "overview", data })),
          api(`${API_PREFIX}/transactions?${txQuery}&limit=1000`, {}, nextToken).then((data) => ({ key: "transactions", data })),
        );
      }
      if (includeHoldings) {
        requests.push(
          api(`${API_PREFIX}/holdings`, {}, nextToken).then((data) => ({ key: "holdings", data })),
          api(`${API_PREFIX}/dashboard/portfolio`, {}, nextToken).then((data) => ({ key: "portfolio", data })),
          api(`${API_PREFIX}/prices/status`, {}, nextToken).then((data) => ({ key: "priceStatus", data })),
        );
      }
      const responses = await Promise.all(requests);
      for (const item of responses) {
        if (item.key === "overview") {
          setOverview(item.data);
        } else if (item.key === "transactions") {
          setTransactions(item.data);
        } else if (item.key === "holdings") {
          setHoldings(item.data);
        } else if (item.key === "portfolio") {
          setPortfolio(item.data);
        } else if (item.key === "priceStatus") {
          setPriceStatus(item.data);
          setPriceRefreshPolling(Boolean(item.data?.refresh_in_progress));
        }
      }
      setDashboardLoaded(true);
    } finally {
      if (!silent) {
        dashboardRequestCountRef.current = Math.max(0, dashboardRequestCountRef.current - 1);
        if (dashboardRequestCountRef.current === 0) {
          setDashboardLoading(false);
        }
      }
    }
  }

  async function refreshDataWithUiFeedback(filterOverride = null) {
    try {
      await refreshData(false, token, filterOverride);
    } catch (error) {
      setMessage(formatApiError(error, "bootstrap"));
      const code = String(error?.code || "").toUpperCase();
      if (code === "AUTH_TOKEN_INVALID" || Number(error?.status || 0) === 401) {
        logout({ revoke: false }).catch(() => undefined);
      }
    }
  }

  function getMonthBounds() {
    const now = currentMonth();
    const minFromOverview = parseYearMonthKey(overview?.min_available_month);
    const maxFromOverview = parseYearMonthKey(overview?.max_available_month);
    const minMonth = minFromOverview || now;
    const boundedMax = maxFromOverview && compareYearMonth(maxFromOverview, now) <= 0 ? maxFromOverview : now;
    const maxMonth = compareYearMonth(boundedMax, minMonth) >= 0 ? boundedMax : minMonth;
    return { minMonth, maxMonth };
  }

  function applyMonthFilter(targetYearMonth) {
    const { minMonth, maxMonth } = getMonthBounds();
    const normalized = clampYearMonth(targetYearMonth, minMonth, maxMonth);
    setFilterMode("month");
    setYearMonth(normalized);
    refreshDataWithUiFeedback({ filterMode: "month", yearMonth: normalized }).catch(() => undefined);
  }

  function handleShiftYearMonth(delta) {
    applyMonthFilter(shiftMonth(yearMonth, delta));
  }

  function handleApplyYearMonth() {
    applyMonthFilter(yearMonth);
  }

  function handleMoveToCurrentMonth() {
    applyMonthFilter(currentMonth());
  }

  async function runAuth(event) {
    event.preventDefault();
    const currentMode = authMode;
    if (currentMode === "register" || currentMode === "verify") {
      const activeForm = currentMode === "verify" ? verifyForm : authForm;
      const password = String(activeForm.password || "");
      const passwordConfirm = String(activeForm.password_confirm || "");
      if (password.length < 8) {
        setMessage("비밀번호는 8자 이상이어야 합니다.");
        return;
      }
      if (password !== passwordConfirm) {
        setMessage("비밀번호 확인이 일치하지 않습니다.");
        return;
      }
    }
    setLoading(true);
    setMessage("");
    try {
      await loadClientConfig();
      if (currentMode === "verify") {
        await api(`${API_PREFIX}/auth/verify-email`, {
          method: "POST",
          body: JSON.stringify({
            token: verifyForm.token,
            password: verifyForm.password,
            display_name: verifyForm.display_name,
            remember_me: keepSignedIn,
          }),
        });
      } else if (currentMode === "login") {
        await api(`${API_PREFIX}/auth/login`, {
          method: "POST",
          body: JSON.stringify({
            email: authForm.email,
            password: authForm.password,
            remember_me: keepSignedIn,
          }),
        });
      } else {
        const registerResp = await api(`${API_PREFIX}/auth/register`, {
          method: "POST",
          body: JSON.stringify({
            email: authForm.email,
            password: authForm.password,
            display_name: authForm.display_name,
            remember_me: keepSignedIn,
          }),
        });
        if (registerResp?.status === "verification_required") {
          const debugToken = String(registerResp?.debug_verification_token || "").trim();
          setAuthMode("verify");
          setVerifyForm({
            email: String(registerResp?.email || authForm.email || ""),
            token: DEBUG_TOKEN_OPT_IN ? debugToken : "",
            password: authForm.password,
            password_confirm: authForm.password_confirm,
            display_name: authForm.display_name,
          });
          setMessage(
            registerResp?.message ||
              (DEBUG_TOKEN_OPT_IN ? "테스트 모드 인증 토큰이 주입되었습니다." : "이메일 인증이 필요합니다.")
          );
          return;
        }
      }

      if (saveAccountInfo && (authForm.email || verifyForm.email)) {
        localStorage.setItem(SAVED_EMAIL_KEY, authForm.email || verifyForm.email);
      } else {
        localStorage.removeItem(SAVED_EMAIL_KEY);
      }
      const sessionToken = COOKIE_AUTH_SENTINEL;
      await loadAuthContext(sessionToken);
      await refreshCollaborationData(sessionToken);
      await refreshData(false, sessionToken);
      setToken(sessionToken);
      setAuthReady(true);
      if (inviteAcceptToken) {
        setTab("collaboration");
      }
      setMessage(
        uiGuideMessage(
          "인증이 완료되었습니다.",
          inviteAcceptToken ? "협업 탭에서 초대를 수락해 주세요." : "원하는 메뉴를 선택해 계속 진행해 주세요."
        )
      );
    } catch (error) {
      setActiveHouseholdId("");
      setToken("");
      setMessage(formatAuthError(error, currentMode));
    } finally {
      setLoading(false);
    }
  }

  async function resendVerification() {
    setLoading(true);
    setMessage("");
    try {
      await loadClientConfig();
      const email = String(verifyForm.email || authForm.email || "").trim();
      const payload = await api(`${API_PREFIX}/auth/resend-verification`, {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      const debugToken = String(payload?.debug_verification_token || "").trim();
      if (debugToken && DEBUG_TOKEN_OPT_IN) {
        setVerifyForm((prev) => ({ ...prev, token: debugToken }));
      }
      setVerifyForm((prev) => ({ ...prev, email: String(payload?.email || prev.email || email) }));
      setMessage(payload?.message || "인증 메일 재전송 요청이 접수되었습니다.");
    } catch (error) {
      setMessage(formatAuthError(error, "resend"));
    } finally {
      setLoading(false);
    }
  }

  async function refreshCollaborationData(nextToken = token) {
    const authToken = nextToken || COOKIE_AUTH_SENTINEL;
    const membersPromise = api(`${API_PREFIX}/household/members`, {}, authToken);
    const canManageInvitations =
      householdRoleRef.current === "owner" || householdRoleRef.current === "co_owner";
    const invitesPromise = canManageInvitations
      ? api(`${API_PREFIX}/household/invitations`, {}, authToken)
      : Promise.resolve([]);
    const receivedInvitesPromise = api(`${API_PREFIX}/household/invitations/received`, {}, authToken);
    const [membersResp, invitesResp, receivedInvitesResp] = await Promise.all([
      membersPromise,
      invitesPromise,
      receivedInvitesPromise,
    ]);
    setHouseholdMembers(membersResp || []);
    setHouseholdInvites(invitesResp || []);
    setReceivedHouseholdInvites(receivedInvitesResp || []);
  }

  async function selectActiveHousehold(householdId) {
    setLoading(true);
    setMessage("");
    try {
      await api(
        `${API_PREFIX}/household/select`,
        {
          method: "POST",
          body: JSON.stringify({ household_id: householdId }),
        },
        token
      );
      await loadAuthContext(token);
      await refreshData(false, token);
      await refreshCollaborationData(token);
      setInviteAcceptanceNotice((prev) => {
        if (!prev || String(prev.householdId || "") !== String(householdId || "")) {
          return prev;
        }
        return {
          ...prev,
          activeHouseholdSelected: true,
        };
      });
      setMessage(uiGuideMessage("가계를 전환했습니다.", "협업/거래/자산 화면이 새 가계 기준으로 갱신되었습니다."));
    } catch (error) {
      setMessage(formatApiError(error, "household_select"));
    } finally {
      setLoading(false);
    }
  }

  async function createHouseholdInvite(event) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const payload = await api(
        `${API_PREFIX}/household/invitations`,
        {
          method: "POST",
          body: JSON.stringify({
            email: inviteForm.email,
            role: inviteForm.role,
          }),
        },
        token
      );
      const debugToken = String(payload?.debug_invite_token || "").trim();
      if (debugToken && DEBUG_TOKEN_OPT_IN) {
        setInviteAcceptToken(debugToken);
      }
      setInviteForm({ email: "", role: "viewer" });
      await refreshCollaborationData(token);
      setMessage(
        uiGuideMessage(
          "초대를 발송했습니다.",
          debugToken && DEBUG_TOKEN_OPT_IN
            ? "개발 모드에서는 초대 토큰이 자동 입력되었습니다. 다른 계정으로 수락해 주세요."
            : "상대방이 메일 링크 또는 초대 토큰으로 수락할 수 있습니다."
        )
      );
    } catch (error) {
      setMessage(formatApiError(error, "household_invite_create"));
    } finally {
      setLoading(false);
    }
  }

  async function acceptHouseholdInvite(event) {
    event.preventDefault();
    const rawToken = String(inviteAcceptToken || "").trim();
    if (!rawToken) {
      setMessage(uiGuideMessage("초대 토큰이 비어 있습니다.", "메일 링크의 토큰을 입력하거나 링크로 직접 접속해 주세요."));
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const payload = await api(
        `${API_PREFIX}/household/invitations/accept`,
        {
          method: "POST",
          body: JSON.stringify({ token: rawToken }),
        },
        token
      );
      await handleHouseholdInviteAccepted(payload, token);
    } catch (error) {
      setMessage(formatApiError(error, "household_invite_accept"));
    } finally {
      setLoading(false);
    }
  }

  async function acceptReceivedHouseholdInvite(invitationId) {
    setLoading(true);
    setMessage("");
    try {
      const payload = await api(
        `${API_PREFIX}/household/invitations/${invitationId}/accept`,
        {
          method: "POST",
        },
        token
      );
      await handleHouseholdInviteAccepted(payload, token);
    } catch (error) {
      setMessage(formatApiError(error, "household_invite_accept"));
    } finally {
      setLoading(false);
    }
  }

  async function revokeHouseholdInvite(invitationId) {
    setLoading(true);
    setMessage("");
    try {
      await api(
        `${API_PREFIX}/household/invitations/${invitationId}`,
        {
          method: "DELETE",
        },
        token
      );
      await refreshCollaborationData(token);
      setMessage(uiGuideMessage("초대를 취소했습니다.", "필요하면 새 초대를 다시 발송해 주세요."));
    } catch (error) {
      setMessage(formatApiError(error, "household_invite_revoke"));
    } finally {
      setLoading(false);
    }
  }

  async function changeMemberRole(memberId, role) {
    setLoading(true);
    setMessage("");
    try {
      await api(
        `${API_PREFIX}/household/members/${memberId}/role`,
        {
          method: "PATCH",
          body: JSON.stringify({ role }),
        },
        token
      );
      await loadAuthContext(token);
      await refreshCollaborationData(token);
      setMessage(uiGuideMessage("구성원 권한을 변경했습니다.", "권한 변경 내용이 즉시 반영되었습니다."));
    } catch (error) {
      setMessage(formatApiError(error, "household_member_role"));
    } finally {
      setLoading(false);
    }
  }

  async function removeHouseholdMember(memberId, displayName) {
    const confirmed = await requestConfirmDialog({
      title: "구성원 제거",
      action: `${displayName} 님을 가계에서 제거할까요?`,
      confirmLabel: "제거",
    });
    if (!confirmed) {
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      await api(
        `${API_PREFIX}/household/members/${memberId}`,
        {
          method: "DELETE",
        },
        token
      );
      await loadAuthContext(token);
      await refreshCollaborationData(token);
      setMessage(uiGuideMessage("구성원을 제거했습니다.", "필요하면 새로운 초대를 발송해 주세요."));
    } catch (error) {
      setMessage(formatApiError(error, "household_member_remove"));
    } finally {
      setLoading(false);
    }
  }

  async function submitTransaction(event) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const payload = buildTransactionPayloadFromForm(txForm);
      await api(
        `${API_PREFIX}/transactions`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
        token
      );
      setTxForm(createTransactionForm());
      setTxCategoryMajor("");
      setShowTransactionEntryBanner(false);
      await refreshData(false);
      setMessage(uiGuideMessage("거래를 등록했습니다.", "목록에서 반영 결과를 확인해 주세요."));
    } catch (error) {
      setMessage(formatApiError(error, "transaction_submit"));
    } finally {
      setLoading(false);
    }
  }

  function holdingPayloadFromForm(form) {
    const tracked = isMarketTrackedAssetType(form.asset_type);
    const fallbackSymbol = buildLocalHoldingSymbol(form);
    const symbol = tracked ? String(form.symbol || "").trim() : fallbackSymbol;
    const marketSymbol = tracked ? String(form.market_symbol || symbol).trim() : fallbackSymbol;
    return {
      asset_type: form.asset_type,
      symbol,
      market_symbol: marketSymbol,
      name: String(form.name || "").trim(),
      category: String(form.category || "기타").trim() || "기타",
      owner_user_id: String(form.owner_user_id || "").trim() || null,
      owner_name: String(form.owner_name || "").trim() || null,
      account_name: String(form.account_name || "").trim() || null,
      quantity: tracked ? stripGrouping(form.quantity || "") : "1",
      average_cost: stripGrouping(form.average_cost || ""),
      currency: String(form.currency || "KRW").trim().toUpperCase(),
    };
  }

  function ownerOptionsWithFallback(currentUserId = "", currentOwnerName = "") {
    const normalizedUserId = String(currentUserId || "").trim();
    const normalizedOwnerName = String(currentOwnerName || "").trim();
    if (normalizedUserId && !ownerMemberOptions.some((item) => item.value === normalizedUserId)) {
      return [
        ...ownerMemberOptions,
        {
          value: normalizedUserId,
          label: `${normalizedOwnerName || normalizedUserId} (기존 연결)`,
          displayName: normalizedOwnerName,
        },
      ];
    }
    if (!normalizedOwnerName || normalizedUserId) {
      return ownerMemberOptions;
    }
    const legacyValue = `${LEGACY_OWNER_PREFIX}${normalizedOwnerName}`;
    if (ownerMemberOptions.some((item) => item.value === legacyValue)) {
      return ownerMemberOptions;
    }
    return [
      ...ownerMemberOptions,
      {
        value: legacyValue,
        label: `${normalizedOwnerName} (기존 값)`,
        ownerName: normalizedOwnerName,
        legacy: true,
      },
    ];
  }

  function ownerSelectionFromValue(nextValue, options) {
    const normalizedValue = String(nextValue || "").trim();
    if (!normalizedValue) {
      return { owner_user_id: "", owner_name: "" };
    }
    const matched = options.find((item) => item.value === normalizedValue);
    if (matched?.legacy) {
      return { owner_user_id: "", owner_name: matched.ownerName || "" };
    }
    return {
      owner_user_id: normalizedValue,
      owner_name: matched?.displayName || "",
    };
  }

  async function submitHolding(event) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const payload = holdingPayloadFromForm(holdingForm);
      await api(
        `${API_PREFIX}/holdings`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
        token
      );
      setHoldingForm(createHoldingForm(holdingForm.asset_type));
      await refreshData(false);
      setMessage(uiGuideMessage("자산을 저장했습니다.", "목록에서 반영 결과를 확인해 주세요."));
    } catch (error) {
      setMessage(formatApiError(error, "holding_submit"));
    } finally {
      setLoading(false);
    }
  }

  async function submitTxInlineEdit(event) {
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    if (!txInlineEdit?.id) return;
    setLoading(true);
    setMessage("");
    try {
      const payload = buildTransactionPayloadFromForm(txInlineEdit);
      const originalTx = transactionById.get(txInlineEdit.id);
      const originalPayload = originalTx
        ? buildTransactionPayloadFromForm({
            occurred_on: originalTx.occurred_on,
            flow_type: originalTx.flow_type,
            amount: originalTx.amount,
            category_id: originalTx.category_id || "",
            memo: originalTx.memo || "",
            owner_user_id: originalTx.owner_user_id || "",
            owner_name: originalTx.owner_name || "",
          })
        : null;
      const dirtyPatch = buildDirtyPatchFields(payload, originalPayload, TX_PATCH_COMPARATORS);
      await api(
        `${API_PREFIX}/transactions/${txInlineEdit.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            base_version: txInlineEdit.version,
            ...dirtyPatch,
          }),
        },
        token
      );
      closeTxInlineEdit();
      await refreshData(false);
      setMessage(uiGuideMessage("거래를 수정했습니다.", "목록에서 변경 내용을 확인해 주세요."));
    } catch (error) {
      setMessage(formatApiError(error, "transaction_submit"));
    } finally {
      setLoading(false);
    }
  }

  async function submitHoldingInlineEdit(event) {
    event.preventDefault();
    if (!holdingInlineEdit?.id) {
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const payload = holdingPayloadFromForm(holdingInlineEdit);
      const originalHolding = holdingById.get(holdingInlineEdit.id);
      const patchPayload = {
        market_symbol: payload.market_symbol,
        name: payload.name,
        category: payload.category,
        owner_user_id: payload.owner_user_id,
        owner_name: payload.owner_name,
        account_name: payload.account_name,
        quantity: payload.quantity,
        average_cost: payload.average_cost,
        currency: payload.currency,
      };
      const originalPayload = originalHolding
        ? holdingPayloadFromForm(createHoldingInlineEditForm(originalHolding))
        : null;
      const dirtyPatch = buildDirtyPatchFields(patchPayload, originalPayload, HOLDING_PATCH_COMPARATORS);
      const patchBody = {
        base_version: holdingInlineEdit.version,
        ...dirtyPatch,
      };
      await api(
        `${API_PREFIX}/holdings/${holdingInlineEdit.id}`,
        {
          method: "PATCH",
          body: JSON.stringify(patchBody),
        },
        token
      );
      setHoldingInlineEdit(null);
      await refreshData(false);
      setMessage(uiGuideMessage("자산을 수정했습니다.", "목록에서 변경 내용을 확인해 주세요."));
    } catch (error) {
      setMessage(formatApiError(error, "holding_submit"));
    } finally {
      setLoading(false);
    }
  }

  async function saveProfileSettings(event) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const payload = {
        real_name: String(profileForm.real_name || "").trim() || null,
        nickname: String(profileForm.nickname || "").trim() || null,
        display_name_mode: String(profileForm.display_name_mode || "real_name").trim() || "real_name",
      };
      const nextUser = await api(
        `${API_PREFIX}/auth/me`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        },
        token
      );
      setUser(nextUser);
      await refreshCollaborationData(token);
      await refreshData(false, token);
      setMessage(uiGuideMessage("프로필을 저장했습니다.", "표시명 변경 내용이 멤버 목록과 거래/자산 화면에 반영되었습니다."));
    } catch (error) {
      setMessage(formatApiError(error, "profile_save"));
    } finally {
      setLoading(false);
    }
  }

  async function saveHouseholdSettings(event) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const payload = {
        name: String(householdSettingsForm.name || "").trim(),
        transaction_row_colors: normalizeTransactionRowColors(householdSettingsForm.transaction_row_colors),
      };
      const nextSettings = await api(
        `${API_PREFIX}/household/settings`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        },
        token
      );
      setHouseholdSettings({
        ...nextSettings,
        transaction_row_colors: normalizeTransactionRowColors(nextSettings?.transaction_row_colors),
      });
      await loadAuthContext(token);
      setMessage(uiGuideMessage("가계 설정을 저장했습니다.", "가계 이름과 거래 행 색상이 현재 가계 전체에 반영되었습니다."));
    } catch (error) {
      setMessage(formatApiError(error, "household_settings"));
    } finally {
      setLoading(false);
    }
  }

  async function createCategoryPair(event) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      await api(
        `${API_PREFIX}/categories`,
        {
          method: "POST",
          body: JSON.stringify({
            flow_type: categoryDraft.flow_type,
            major: String(categoryDraft.major || "").trim(),
            minor: String(categoryDraft.minor || "").trim(),
          }),
        },
        token
      );
      setCategoryDraft(createCategoryDraft(categoryDraft.flow_type));
      await loadAuthContext(token);
      setMessage(uiGuideMessage("카테고리를 추가했습니다.", "거래 입력 폼 옵션에도 즉시 반영되었습니다."));
    } catch (error) {
      setMessage(formatApiError(error, "category_create"));
    } finally {
      setLoading(false);
    }
  }

  async function saveCategoryEdit(event, categoryId) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      await api(
        `${API_PREFIX}/categories/${categoryId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            major: String(categoryEditForm.major || "").trim(),
            minor: String(categoryEditForm.minor || "").trim(),
          }),
        },
        token
      );
      setCategoryEditId("");
      setCategoryEditForm({ major: "", minor: "" });
      await loadAuthContext(token);
      await refreshData(false, token);
      setMessage(uiGuideMessage("카테고리를 수정했습니다.", "연결된 거래 화면에도 즉시 반영되었습니다."));
    } catch (error) {
      setMessage(formatApiError(error, "category_patch"));
    } finally {
      setLoading(false);
    }
  }

  async function renameCategoryMajorGroup(flowType, currentMajor) {
    const nextMajor = String(majorRenameDrafts[`${flowType}:${currentMajor}`] || "").trim();
    if (!nextMajor) {
      setMessage("새 대분류 이름을 입력해 주세요.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      await api(
        `${API_PREFIX}/categories/rename-major`,
        {
          method: "POST",
          body: JSON.stringify({
            flow_type: flowType,
            current_major: currentMajor,
            next_major: nextMajor,
          }),
        },
        token
      );
      setMajorRenameDrafts((prev) => ({ ...prev, [`${flowType}:${currentMajor}`]: "" }));
      await loadAuthContext(token);
      await refreshData(false, token);
      setMessage(uiGuideMessage("대분류 이름을 일괄 변경했습니다.", "해당 그룹의 모든 중분류와 기존 거래 표시에 반영되었습니다."));
    } catch (error) {
      setMessage(formatApiError(error, "category_rename_major"));
    } finally {
      setLoading(false);
    }
  }

  async function deleteCategoryPair(category) {
    const confirmed = await requestConfirmDialog({
      title: "카테고리 삭제",
      action: `${toCategoryMajorLabel(category.major)} / ${toCategoryMinorLabel(category.minor)} 카테고리를 삭제할까요?`,
      confirmLabel: "삭제",
    });
    if (!confirmed) {
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      await api(
        `${API_PREFIX}/categories/${category.id}`,
        {
          method: "DELETE",
        },
        token
      );
      await loadAuthContext(token);
      setMessage(uiGuideMessage("카테고리를 삭제했습니다.", "사용 중이지 않은 카테고리만 정리했습니다."));
    } catch (error) {
      setMessage(formatApiError(error, "category_delete"));
    } finally {
      setLoading(false);
    }
  }

  function dismissOnboardingGuide() {
    const seenKey = onboardingSeenKey(user?.id, household?.id);
    if (seenKey) {
      localStorage.setItem(seenKey, "1");
    }
    setShowOnboardingGuide(false);
  }

  function startOnboardingFlow() {
    dismissOnboardingGuide();
    setShowTransactionEntryBanner(true);
    setTab("transactions");
  }

  async function doImport(mode) {
    if (!importFile) {
      setMessage("엑셀 파일을 먼저 업로드해 주세요.");
      return;
    }
    setImportLoadingMode(mode);
    setLoading(true);
    setMessage(`${IMPORT_MODE_LABELS[mode] || mode} 요청을 처리 중입니다. 잠시만 기다려 주세요.`);
    try {
      let report = null;
      const formData = new FormData();
      formData.append("file", importFile);
      report = await api(
        `${API_PREFIX}/imports/workbook/upload?mode=${mode}`,
        {
          method: "POST",
          body: formData,
        },
        token
      );
      setImportReport(report);
      if (mode === "apply") {
        await loadAuthContext(token);
        await refreshData(false);
      }
      setMessage(`${IMPORT_MODE_LABELS[mode] || mode} 완료`);
    } catch (error) {
      setMessage(formatImportError(error, mode));
    } finally {
      setImportLoadingMode("");
      setLoading(false);
    }
  }

  async function refreshPriceNow() {
    setLoading(true);
    try {
      const refreshResp = await requestPriceRefresh({ silent: false, origin: "manual" });
      if (refreshResp && !refreshResp?.in_progress) {
        await refreshDataByKinds(new Set(["holding"]), token, { silent: true });
      }
    } finally {
      setLoading(false);
    }
  }

  async function requestPriceRefresh({ silent = false, origin = "manual" } = {}) {
    if (!token || priceRefreshRequestInFlightRef.current) {
      return null;
    }
    priceRefreshRequestInFlightRef.current = true;
    priceRefreshOriginRef.current = origin;
    if (origin === "auto") {
      lastAutoRefreshAtRef.current = Date.now();
    }
    try {
      const refreshResp = await api(`${API_PREFIX}/prices/refresh`, { method: "POST" }, token);
      setPriceRefreshPolling(Boolean(refreshResp?.in_progress));
      if (!silent) {
        if (refreshResp?.queued) {
          setMessage("이미 시세 갱신이 진행 중입니다. 완료 시점에 자동 반영됩니다.");
        } else {
          setMessage("시세 갱신을 백그라운드로 시작했습니다. 완료 시점에 자동 반영됩니다.");
        }
      }
      return refreshResp;
    } catch (error) {
      const code = String(error?.code || "").toUpperCase();
      if (code === "AUTH_TOKEN_INVALID" || Number(error?.status || 0) === 401) {
        logout({ revoke: false }).catch(() => undefined);
      }
      if (!silent) {
        setMessage(formatApiError(error, "prices_refresh"));
      }
      return null;
    } finally {
      priceRefreshRequestInFlightRef.current = false;
    }
  }

  async function removeTx(id) {
    const confirmed = await requestConfirmDialog({
      title: "거래를 삭제할까요?",
      action: "삭제하려면 삭제를 눌러 주세요.",
      confirmLabel: "삭제",
    });
    if (!confirmed) return;
    try {
      await api(`${API_PREFIX}/transactions/${id}`, { method: "DELETE" }, token);
      await refreshData(false);
      setMessage(uiGuideMessage("거래를 삭제했습니다.", "필요하면 새 거래를 다시 등록해 주세요."));
    } catch (error) {
      setMessage(formatApiError(error, "transaction_delete"));
    }
  }

  async function removeHolding(id) {
    const confirmed = await requestConfirmDialog({
      title: "자산을 삭제할까요?",
      action: "삭제하려면 삭제를 눌러 주세요.",
      confirmLabel: "삭제",
    });
    if (!confirmed) return;
    try {
      await api(`${API_PREFIX}/holdings/${id}`, { method: "DELETE" }, token);
      if (holdingInlineEdit?.id === id) {
        setHoldingInlineEdit(null);
      }
      await refreshData(false);
      setMessage(uiGuideMessage("자산을 삭제했습니다.", "필요하면 새 자산을 다시 등록해 주세요."));
    } catch (error) {
      setMessage(formatApiError(error, "holding_delete"));
    }
  }

  function renderHoldingRow(item, rowKey) {
    const row = holdingById.get(item.holding_id);
    const isEditing = Boolean(row && holdingInlineEdit?.id === row.id);
    const editForm = isEditing ? holdingInlineEdit : null;
    const editTracked = Boolean(editForm && isMarketTrackedAssetType(editForm.asset_type));
    const editOwnerOptions = ownerOptionsWithFallback(editForm?.owner_user_id || "", editForm?.owner_name || "");
    return (
      <Fragment key={rowKey}>
        <tr className={isEditing ? "holding-row-editing" : ""}>
          <td data-label="이름">{item.name}</td>
          <td data-label="보유자">{item.owner_name || "-"}</td>
          <td data-label="카테고리">{item.category}</td>
          <td data-label="수량">{fmt(item.quantity)}</td>
          <td data-label="평균단가">{fmt(item.average_cost)}</td>
          <td data-label="평가(KRW)">{fmtKrw(item.market_value_krw)}</td>
          <td data-label="손익(KRW)">{fmtKrw(item.gain_loss_krw)}</td>
          <td data-label="최종 수정일">{fmtDate(holdingUpdatedAtById.get(item.holding_id))}</td>
          <td data-label="동작">
            <div className="inline">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  if (!row) {
                    return;
                  }
                  setHoldingInlineEdit(createHoldingInlineEditForm(row));
                }}
              >
                {isEditing ? "수정 중" : "수정"}
              </button>
              <button type="button" className="danger" onClick={() => removeHolding(item.holding_id)}>
                삭제
              </button>
            </div>
          </td>
        </tr>
        {isEditing && editForm && (
          <tr key={`${rowKey}-editor`} className="holding-inline-editor-row">
            <td colSpan={9}>
              <form className="form-grid holdings-inline-editor" onSubmit={submitHoldingInlineEdit}>
                <label>
                  자산명
                  <input
                    value={editForm.name}
                    onChange={(event) =>
                      setHoldingInlineEdit((prev) => ({ ...prev, name: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  카테고리
                  <input
                    value={editForm.category}
                    onChange={(event) =>
                      setHoldingInlineEdit((prev) => ({ ...prev, category: event.target.value }))
                    }
                  />
                </label>
                <label>
                  보유자
                  <select
                    value={ownerSelectValue(editForm.owner_user_id, editForm.owner_name)}
                    onChange={(event) =>
                      setHoldingInlineEdit((prev) => ({
                        ...prev,
                        ...ownerSelectionFromValue(event.target.value, editOwnerOptions),
                      }))
                    }
                  >
                    <option value="">(선택 안함)</option>
                    {editOwnerOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  계좌
                  <input
                    value={editForm.account_name}
                    onChange={(event) =>
                      setHoldingInlineEdit((prev) => ({ ...prev, account_name: event.target.value }))
                    }
                  />
                </label>
                {editTracked ? (
                  <>
                    <label>
                      심볼
                      <input value={editForm.symbol} disabled />
                    </label>
                    <label>
                      시장심볼
                      <input
                        value={editForm.market_symbol}
                        onChange={(event) =>
                          setHoldingInlineEdit((prev) => ({ ...prev, market_symbol: event.target.value }))
                        }
                        required
                      />
                    </label>
                    <label>
                      수량
                      <input
                        type="text"
                        inputMode="decimal"
                        value={editForm.quantity}
                        onChange={(event) => handleGroupedDecimalInput(event, setHoldingInlineEdit, "quantity")}
                        required
                      />
                    </label>
                  </>
                ) : (
                  <label>
                    평가금액
                    <input
                      type="text"
                      inputMode="decimal"
                      value={editForm.average_cost}
                      onChange={(event) => handleGroupedDecimalInput(event, setHoldingInlineEdit, "average_cost")}
                      required
                    />
                  </label>
                )}
                {editTracked && (
                  <label>
                    평균단가
                    <input
                      type="text"
                      inputMode="decimal"
                      value={editForm.average_cost}
                      onChange={(event) => handleGroupedDecimalInput(event, setHoldingInlineEdit, "average_cost")}
                      required
                    />
                  </label>
                )}
                <label>
                  통화
                  <input
                    value={editForm.currency}
                    onChange={(event) =>
                      setHoldingInlineEdit((prev) => ({ ...prev, currency: event.target.value.toUpperCase() }))
                    }
                    required
                  />
                </label>
                <div className="inline form-actions">
                  <button type="submit">저장</button>
                  <button type="button" className="secondary" onClick={() => setHoldingInlineEdit(null)}>
                    취소
                  </button>
                </div>
              </form>
            </td>
          </tr>
        )}
      </Fragment>
    );
  }

  async function logout(options = {}) {
    const revoke = options.revoke !== false;
    const activeToken = token;
    const shouldRevoke = Boolean(revoke && activeToken);
    let logoutWarning = "";
    if (shouldRevoke) {
      try {
        await loadClientConfig();
        await api(`${API_PREFIX}/auth/logout`, { method: "POST" }, activeToken);
      } catch (error) {
        if (Number(error?.status || 0) !== 401) {
          logoutWarning = uiGuideMessage(
            "서버 로그아웃 응답이 실패해 로컬 세션만 정리했습니다.",
            "새로고침 후에도 문제가 지속되면 네트워크 상태를 확인해 주세요."
          );
        }
      }
    }
    dashboardRequestCountRef.current = 0;
    setActiveHouseholdId("");
    setToken("");
    setAuthReady(true);
    setUser(null);
    setHousehold(null);
    householdRoleRef.current = "";
    setHouseholdRole("");
    setHouseholdList([]);
    setHouseholdMembers([]);
    setHouseholdInvites([]);
    setReceivedHouseholdInvites([]);
    setInviteForm({ email: "", role: "viewer" });
    setInviteAcceptToken("");
    setInviteAcceptanceNotice(null);
    setCategories([]);
    setOverview(null);
    setTransactions([]);
    setHoldings([]);
    setPortfolio(null);
    setPriceStatus(null);
    setImportReport(null);
    setImportPath("");
    setImportFile(null);
    setImportLoadingMode("");
    setMessage(logoutWarning);
    setPriceRefreshPolling(false);
    setDashboardLoading(false);
    setDashboardLoaded(false);
    setTab("dashboard");
    setFilterMode("month");
    setYearMonth(currentMonth());
    setRange({ start: todayIso(), end: todayIso() });
    setTxListFilter({
      keyword: "",
      flow_type: "all",
      start: "",
      end: "",
    });
    setHoldingListTab("all");
    setTxCategoryMajor("");
    closeTxInlineEdit();
    setTxForm(createTransactionForm());
    setHoldingForm(createHoldingForm("cash"));
    setHoldingInlineEdit(null);
    setAuthMode("login");
    wsTicketMethodRef.current = "POST";
    wsPendingKindsRef.current.clear();
    if (wsRefreshTimerRef.current) {
      clearTimeout(wsRefreshTimerRef.current);
      wsRefreshTimerRef.current = null;
    }
    priceRefreshOriginRef.current = "manual";
    lastAutoRefreshAtRef.current = 0;
    priceRefreshRequestInFlightRef.current = false;
    realtimeFallbackSyncInFlightRef.current = false;
    setAuthForm({
      ...createAuthForm(),
      email: saveAccountInfo ? getSavedEmail() : "",
    });
    setVerifyForm({
      ...createVerifyForm(),
      email: saveAccountInfo ? getSavedEmail() : "",
    });
  }

  useEffect(() => {
    if (!token || !priceRefreshPolling) return;
    let stopped = false;
    const timer = setInterval(async () => {
      if (stopped) return;
      try {
        const statusResp = await api(`${API_PREFIX}/prices/status`, {}, token);
        if (stopped) return;
        setPriceStatus(statusResp);
        if (!statusResp?.refresh_in_progress) {
          setPriceRefreshPolling(false);
          await refreshDataByKinds(new Set(["holding"]), token, { silent: true });
          if (priceRefreshOriginRef.current === "manual") {
            setMessage("시세 갱신 완료");
          }
          priceRefreshOriginRef.current = "manual";
        }
      } catch {
        // Keep polling quietly; next cycle may recover from transient failures.
      }
    }, 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, priceRefreshPolling]);

  useEffect(() => {
    if (!token || !household?.id) return;
    let stopped = false;
    let timerId = null;
    const runAutoRefreshIfNeeded = async () => {
      if (stopped) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (priceRefreshPolling || Boolean(priceStatus?.refresh_in_progress)) return;
      if (!shouldAutoRefreshPrice(priceStatus)) return;
      if (priceRefreshRequestInFlightRef.current) return;
      if (Date.now() - lastAutoRefreshAtRef.current < AUTO_PRICE_REFRESH_COOLDOWN_MS) return;
      await requestPriceRefresh({ silent: true, origin: "auto" });
    };
    const tick = () => {
      runAutoRefreshIfNeeded().catch(() => undefined);
    };
    tick();
    timerId = window.setInterval(tick, AUTO_PRICE_REFRESH_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        tick();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    return () => {
      stopped = true;
      if (timerId) {
        clearInterval(timerId);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, [
    household?.id,
    priceRefreshPolling,
    priceStatus?.holdings_count,
    priceStatus?.tracked_holdings_count,
    priceStatus?.refresh_in_progress,
    priceStatus?.snapshot_count,
    priceStatus?.stale_count,
    token,
  ]);

  useEffect(() => {
    if (!token || !household?.id) return;
    let stopped = false;
    const runFallbackSync = async () => {
      if (stopped) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (realtimeFallbackSyncInFlightRef.current) return;
      realtimeFallbackSyncInFlightRef.current = true;
      try {
        // Process-local websocket hubs can miss events across workers; periodic silent sync keeps UI eventually consistent.
        await refreshDataByKinds(new Set(["full"]), token, { silent: true });
      } catch {
        // Ignore transient sync errors; next interval retries.
      } finally {
        realtimeFallbackSyncInFlightRef.current = false;
      }
    };
    const timerId = window.setInterval(() => {
      runFallbackSync().catch(() => undefined);
    }, REALTIME_FALLBACK_SYNC_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        runFallbackSync().catch(() => undefined);
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    return () => {
      stopped = true;
      clearInterval(timerId);
      realtimeFallbackSyncInFlightRef.current = false;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, [household?.id, token]);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        await loadClientConfig();
        await retryBootstrap(() => loadAuthContext());
        await retryBootstrap(() => refreshCollaborationData());
        await retryBootstrap(() => refreshData(false));
        if (cancelled) return;
        setToken((prev) => prev || COOKIE_AUTH_SENTINEL);
      } catch (error) {
        if (cancelled) return;
        const status = Number(error?.status || 0);
        const code = String(error?.code || "").toUpperCase();
        const isAuthError = status === 401 || code === "AUTH_TOKEN_INVALID" || code === "AUTH_TOKEN_MISSING";
        if (!isAuthError) {
          setMessage(formatApiError(error, "bootstrap"));
        }
        setActiveHouseholdId("");
        setToken("");
      } finally {
        if (!cancelled) {
          setAuthReady(true);
        }
      }
    }
    bootstrap().catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!token || !household?.id) {
      return;
    }
    if (tab !== "collaboration") {
      return;
    }
    refreshCollaborationData(token).catch((error) => {
      setMessage(formatApiError(error, "household_members"));
    });
  }, [household?.id, tab, token]);

  useEffect(() => {
    if (!token || !inviteAcceptToken) {
      return;
    }
    setTab("collaboration");
  }, [inviteAcceptToken, token]);

  useEffect(() => {
    if (!token || !household?.id) return;
    let ws = null;
    let closed = false;
    let reconnectTimer = null;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const queueWsRefresh = (kind) => {
      wsPendingKindsRef.current.add(kind);
      if (wsRefreshTimerRef.current) {
        return;
      }
      wsRefreshTimerRef.current = window.setTimeout(() => {
        wsRefreshTimerRef.current = null;
        const nextKinds = new Set(wsPendingKindsRef.current);
        wsPendingKindsRef.current.clear();
        refreshDataByKinds(nextKinds, token, { silent: true }).catch(() => undefined);
      }, WS_REFRESH_DEBOUNCE_MS);
    };
    async function requestWsTicket() {
      const preferred = wsTicketMethodRef.current;
      const methods =
        preferred === "GET" ? ["GET", "POST"] : preferred === "POST" ? ["POST", "GET"] : [];
      for (const method of methods) {
        try {
          const ticketPayload = await api(`${API_PREFIX}/household/ws-ticket`, { method }, token);
          const ticket = String(ticketPayload?.ticket || "").trim();
          if (ticket) {
            wsTicketMethodRef.current = method;
            return ticket;
          }
        } catch (error) {
          const status = Number(error?.status || 0);
          if ([404, 405].includes(status)) {
            continue;
          }
          if ([401, 403].includes(status)) {
            wsTicketMethodRef.current = "NONE";
            setSocketStatus("permission_lost");
            setMessage(
              uiGuideMessage(
                "가계 접근 권한이 변경되어 실시간 연결을 시작할 수 없습니다.",
                "가계 목록을 새로고침하거나 다시 선택해 주세요.",
              ),
            );
            return "";
          }
          throw error;
        }
      }
      wsTicketMethodRef.current = "NONE";
      return "";
    }

    async function connectWs() {
      try {
        const ticket = await requestWsTicket();
        if (!ticket || closed) return;

        ws = new WebSocket(
          `${protocol}://${window.location.host}/ws/v1/household/${household.id}`,
          [`ticket.${ticket}`],
        );
        ws.onopen = () => setSocketStatus("connected");
        ws.onclose = (event) => {
          if (Number(event?.code || 0) === 1008) {
            setSocketStatus("permission_lost");
            setMessage(
              uiGuideMessage(
                "가계 접근 권한이 변경되어 실시간 연결이 종료되었습니다.",
                "가계 목록을 새로고침하거나 다시 선택해 주세요.",
              ),
            );
            wsTicketMethodRef.current = "NONE";
            refreshDataByKinds(new Set(["full"]), token, { silent: true }).catch(() => undefined);
            return;
          }
          setSocketStatus("disconnected");
          if (!closed && wsTicketMethodRef.current !== "NONE") {
            reconnectTimer = window.setTimeout(() => {
              refreshDataByKinds(new Set(["full"]), token, { silent: true }).catch(() => undefined);
              connectWs().catch(() => undefined);
            }, 1000);
          }
        };
        ws.onerror = () => setSocketStatus("error");
        ws.onmessage = (event) => {
          let kind = "full";
          try {
            const payload = JSON.parse(String(event?.data || "{}"));
            const eventName = String(payload?.event || "");
            if (eventName.startsWith("transaction.")) {
              kind = "transaction";
            } else if (eventName.startsWith("holding.")) {
              kind = "holding";
            }
          } catch {
            kind = "full";
          }
          queueWsRefresh(kind);
        };
      } catch {
        if (!closed) {
          setSocketStatus("error");
          if (wsTicketMethodRef.current !== "NONE") {
            reconnectTimer = window.setTimeout(() => {
              connectWs().catch(() => undefined);
            }, 1500);
          } else {
            setMessage(uiGuideMessage("실시간 연결을 사용할 수 없습니다.", "서버 업데이트 후 페이지를 새로고침해 주세요."));
          }
        }
      }
    }

    connectWs().catch(() => undefined);
    return () => {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (wsRefreshTimerRef.current) {
        clearTimeout(wsRefreshTimerRef.current);
        wsRefreshTimerRef.current = null;
      }
      wsPendingKindsRef.current.clear();
      if (ws) ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, household?.id]);

  const trendChartData = useMemo(() => {
    if (!overview) return null;
    return {
      labels: overview.trend.map((item) => item.month),
      datasets: [
        {
          label: "수입",
          data: overview.trend.map((item) => Number(item.income)),
          borderColor: "#0ea5e9",
          backgroundColor: "rgba(14, 165, 233, 0.2)",
          fill: true,
          tension: 0.2,
        },
        {
          label: "지출",
          data: overview.trend.map((item) => Number(item.expense)),
          borderColor: "#f43f5e",
          backgroundColor: "rgba(244, 63, 94, 0.15)",
          fill: true,
          tension: 0.2,
        },
        {
          label: "투자",
          data: overview.trend.map((item) => Number(item.investment)),
          borderColor: "#8b5cf6",
          backgroundColor: "rgba(139, 92, 246, 0.15)",
          fill: true,
          tension: 0.2,
        },
      ],
    };
  }, [overview]);

  const portfolioChartData = useMemo(() => {
    if (!portfolio) return null;
    const categories = portfolio.categories || [];
    const colors = categoryPalette(categories.length);
    return {
      labels: categories.map((item) => item.category),
      datasets: [
        {
          data: categories.map((item) => Number(item.market_value_krw)),
          backgroundColor: colors,
        },
      ],
    };
  }, [portfolio]);
  const isDashboardInitialLoading = dashboardLoading && !dashboardLoaded;
  const isDashboardRefreshing = dashboardLoading && dashboardLoaded;
  const { minMonth, maxMonth } = getMonthBounds();
  const isPrevMonthDisabled = compareYearMonth(yearMonth, minMonth) <= 0;
  const isNextMonthDisabled = compareYearMonth(yearMonth, maxMonth) >= 0;
  const refreshStateLabel = priceStatus?.refresh_in_progress
    ? "진행 중"
    : priceStatus?.refresh_finished_at
      ? "완료"
      : "대기";
  const latestRefreshAt = priceStatus?.refresh_finished_at || priceStatus?.updated_at || null;
  const financialSummaryRows = [
    { label: "수입", value: fmtKrw(overview?.totals?.income) },
    { label: "지출", value: fmtKrw(overview?.totals?.expense) },
    { label: "투자", value: fmtKrw(overview?.totals?.investment) },
    { label: "순현금흐름", value: fmtKrw(overview?.totals?.net_cashflow) },
    { label: "총자산(KRW)", value: fmtKrw(portfolio?.total_market_value_krw) },
    { label: "평가손익(KRW)", value: fmtKrw(portfolio?.total_gain_loss_krw) },
  ];
  const priceSummaryRows = [
    { label: "시세 지연 건수", value: fmt(priceStatus?.stale_count) },
    { label: "시세 갱신 상태", value: refreshStateLabel },
    { label: "최근 시세 갱신 시각", value: latestRefreshAt ? fmtDateTime(latestRefreshAt) : "-" },
  ];
  const holdingFormTracked = isMarketTrackedAssetType(holdingForm.asset_type);
  const transactionOwnerOptions = ownerOptionsWithFallback(txForm.owner_user_id, txForm.owner_name);
  const holdingFormOwnerOptions = ownerOptionsWithFallback(holdingForm.owner_user_id, holdingForm.owner_name);
  const canEditHouseholdData = householdRole === "owner" || householdRole === "co_owner" || householdRole === "editor";
  const canManageHousehold = householdRole === "owner" || householdRole === "co_owner";
  const canAssignOwner = householdRole === "owner";
  const memberRoleOptions = canAssignOwner
    ? COLLAB_ROLE_OPTIONS
    : COLLAB_ROLE_OPTIONS.filter((item) => item.value !== "owner");
  const inviteAcceptanceCanSwitch =
    Boolean(inviteAcceptanceNotice?.householdId) &&
    household?.id !== inviteAcceptanceNotice?.householdId &&
    householdList.some((entry) => entry.household.id === inviteAcceptanceNotice?.householdId);

  if (!authReady) {
    return (
      <main className="auth-shell" translate="no">
        <div className="auth-card">
          <h1>money-flow</h1>
          <p>세션을 확인하는 중입니다. 잠시만 기다려 주세요.</p>
        </div>
        <div className="app-copyright" aria-hidden="true">
          {COPYRIGHT_TEXT}
        </div>
      </main>
    );
  }

  if (!token) {
    const hasPendingInviteToken = Boolean(String(inviteAcceptToken || "").trim());
    const authDescription =
      authMode === "verify"
        ? hasPendingInviteToken
          ? "회원가입을 완료하면 협업 탭에서 가계부 초대를 수락할 수 있습니다."
          : "회원가입을 완료하려면 이메일 인증을 진행해 주세요."
        : hasPendingInviteToken
          ? "가계부 초대 링크를 확인했습니다. 로그인 후 협업 탭에서 초대를 수락해 주세요."
          : "가구 전체를 쉽게 시작하는 가계부·투자 관리 서비스";
    return (
      <main className="auth-shell" translate="no">
        <form className="auth-card" onSubmit={runAuth}>
          <h1>money-flow</h1>
          <p>{authDescription}</p>
          {hasPendingInviteToken && (
            <div className="auth-pending-invite" role="status">
              <strong>가계부 초대 링크를 확인했습니다.</strong>
              <span>로그인 또는 회원가입 후 협업 탭의 초대 수락 토큰 칸에 자동 입력됩니다.</span>
            </div>
          )}
          {authMode === "verify" ? (
            <>
              <label>
                이메일
                <input
                  type="email"
                  value={verifyForm.email}
                  onChange={(e) => setVerifyForm({ ...verifyForm, email: e.target.value })}
                  required
                />
              </label>
              <label>
                인증 토큰
                <input
                  value={verifyForm.token}
                  onChange={(e) => setVerifyForm({ ...verifyForm, token: e.target.value })}
                  required
                />
              </label>
              <label>
                비밀번호
                <input
                  type="password"
                  value={verifyForm.password}
                  onChange={(e) => setVerifyForm({ ...verifyForm, password: e.target.value })}
                  required
                />
              </label>
              <label>
                비밀번호 확인
                <input
                  type="password"
                  value={verifyForm.password_confirm}
                  onChange={(e) => setVerifyForm({ ...verifyForm, password_confirm: e.target.value })}
                  required
                />
              </label>
              <label>
                본명
                <input
                  value={verifyForm.display_name}
                  onChange={(e) => setVerifyForm({ ...verifyForm, display_name: e.target.value })}
                  required
                />
              </label>
            </>
          ) : (
            <>
              <label>
                이메일
                <input type="email" value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} required />
              </label>
              <label>
                비밀번호
                <input type="password" value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} required />
              </label>
              {authMode === "register" && (
                <>
                  <label>
                    비밀번호 확인
                    <input
                      type="password"
                      value={authForm.password_confirm}
                      onChange={(e) => setAuthForm({ ...authForm, password_confirm: e.target.value })}
                      required
                    />
                  </label>
                  <label>
                    본명
                    <input value={authForm.display_name} onChange={(e) => setAuthForm({ ...authForm, display_name: e.target.value })} required />
                  </label>
                </>
              )}
            </>
          )}
          {hasPendingInviteToken && (
            <label>
              감지된 초대 토큰
              <input value={inviteAcceptToken} readOnly spellCheck={false} />
            </label>
          )}
          <div className="auth-options">
            <label className="check-row">
              <input
                type="checkbox"
                checked={keepSignedIn}
                onChange={(e) => setKeepSignedIn(e.target.checked)}
              />
              로그인 상태 유지
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={saveAccountInfo}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setSaveAccountInfo(checked);
                  if (!checked) {
                    localStorage.removeItem(SAVED_EMAIL_KEY);
                  }
                }}
              />
              계정 정보 저장 (이메일)
            </label>
          </div>
          <button disabled={loading} type="submit">
            {loading ? "처리 중..." : authMode === "login" ? "로그인하기" : authMode === "register" ? "회원가입하고 시작" : "이메일 인증 완료"}
          </button>
          {authMode === "verify" && (
            <button type="button" className="secondary" onClick={() => resendVerification().catch(() => undefined)} disabled={loading}>
              인증 메일 재전송
            </button>
          )}
          <div className="auth-switch">
            {authMode === "login" ? (
              <>
                <span>처음이신가요?</span>
                <button type="button" className="text-button" onClick={() => { setAuthMode("register"); setMessage(""); }}>
                  회원가입
                </button>
              </>
            ) : authMode === "register" ? (
              <>
                <span>이미 계정이 있나요?</span>
                <button type="button" className="text-button" onClick={() => { setAuthMode("login"); setMessage(""); }}>
                  로그인으로 돌아가기
                </button>
              </>
            ) : (
              <>
                <span>인증 링크가 없나요?</span>
                <button type="button" className="text-button" onClick={() => { setAuthMode("login"); setMessage(""); }}>
                  로그인으로 돌아가기
                </button>
              </>
            )}
          </div>
          {message && <div className="message">{message}</div>}
        </form>
        <div className="app-copyright" aria-hidden="true">
          {COPYRIGHT_TEXT}
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell" translate="no">
      <header className="topbar">
        <div>
          <h1>money-flow</h1>
          <div className="meta">
            <span>사용자: {user?.display_name}</span>
            <span>가계: {household?.name}</span>
            <span>실시간 연결: {SOCKET_STATUS_LABELS[socketStatus] || socketStatus}</span>
          </div>
        </div>
        <div className="actions">
          <button className="secondary" onClick={() => refreshDataWithUiFeedback().catch(() => undefined)} disabled={dashboardLoading}>
            {dashboardLoading ? "불러오는 중..." : "새로고침"}
          </button>
          <button
            className="secondary"
            onClick={refreshPriceNow}
            disabled={loading || dashboardLoading || priceStatus?.refresh_in_progress || priceRefreshPolling}
          >
            {priceStatus?.refresh_in_progress || priceRefreshPolling ? "시세 갱신 중..." : "시세 갱신"}
          </button>
          <button className="danger" onClick={() => logout().catch(() => undefined)}>로그아웃</button>
        </div>
      </header>

      <nav className="tabs">
        {["dashboard", "transactions", "holdings", "settings", "collaboration", "import"].map((item) => (
          <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
            {TAB_LABELS[item] || item}
          </button>
        ))}
      </nav>

      {message && <div className="message">{message}</div>}
      {showOnboardingGuide && (
        <section className="card onboarding-guide" role="status">
          <div>
            <h2>처음 입력할 준비가 됐습니다</h2>
            <p>현재 가계에는 아직 거래와 자산이 없습니다. 첫 거래 한 건만 입력해도 대시보드와 카테고리 흐름이 바로 살아납니다.</p>
          </div>
          <div className="inline">
            <button type="button" className="primary" onClick={startOnboardingFlow}>
              바로 입력하기
            </button>
            <button type="button" className="secondary" onClick={dismissOnboardingGuide}>
              나중에
            </button>
          </div>
        </section>
      )}

      {tab === "dashboard" && (
        <section className="grid-2" aria-busy={dashboardLoading ? "true" : "false"}>
          {isDashboardInitialLoading && (
            <div className="dashboard-loading-banner" role="status" aria-live="polite">
              대시보드 데이터를 불러오는 중입니다.
            </div>
          )}
          {isDashboardRefreshing && (
            <div className="dashboard-refresh-note" role="status" aria-live="polite">
              최신 데이터를 새로 불러오고 있습니다.
            </div>
          )}
          <article className="card filter-card">
            <div className="filter-container">
              <div className="filter-modes-segmented">
                <button className={filterMode === "month" ? "active" : ""} onClick={() => setFilterMode("month")}>월별</button>
                <button className={filterMode === "range" ? "active" : ""} onClick={() => setFilterMode("range")}>기간</button>
              </div>
              <div className="filter-inputs-wrapper">
                {filterMode === "month" ? (
                  <div className="month-stepper">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="이전 달"
                      disabled={isPrevMonthDisabled}
                      onClick={() => handleShiftYearMonth(-1)}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                    </button>
                    <div className="date-inputs">
                      <input type="number" aria-label="연도" value={yearMonth.year} onChange={(e) => setYearMonth({ ...yearMonth, year: Number(e.target.value) })} />
                      <span>년</span>
                      <input type="number" min="1" max="12" aria-label="월" value={yearMonth.month} onChange={(e) => setYearMonth({ ...yearMonth, month: Number(e.target.value) })} />
                      <span>월</span>
                    </div>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="다음 달"
                      disabled={isNextMonthDisabled}
                      onClick={() => handleShiftYearMonth(1)}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </button>
                    <button
                      type="button"
                      className="text-btn"
                      onClick={handleMoveToCurrentMonth}
                    >
                      이번 달
                    </button>
                  </div>
                ) : (
                  <div className="range-picker">
                    <input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} />
                    <span className="range-separator">~</span>
                    <input type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} />
                  </div>
                )}
              </div>
              <button
                className="filter-apply-btn primary"
                onClick={() =>
                  filterMode === "month"
                    ? handleApplyYearMonth()
                    : refreshDataWithUiFeedback().catch(() => undefined)
                }
                disabled={dashboardLoading}
              >
                {dashboardLoading ? "로딩중..." : "조회 적용"}
              </button>
            </div>
          </article>

          <article className="card summary-card">
            <h2>요약</h2>
            <div className="summary" aria-busy={dashboardLoading ? "true" : "false"}>
              {isDashboardInitialLoading
                ? FINANCIAL_SUMMARY_LABELS.map((label) => (
                    <div key={label} className="summary-placeholder">
                      {label}: 불러오는 중...
                    </div>
                  ))
                : financialSummaryRows.map((item) => (
                    <div key={item.label}>
                      <strong>{item.label}</strong>
                      <span>{item.value}</span>
                    </div>
                  ))}
            </div>
            
            <hr style={{ margin: "1rem 0", border: "none", borderTop: "1px solid #dbe3ef" }} />
            
            <div className="summary" aria-busy={dashboardLoading ? "true" : "false"}>
              {isDashboardInitialLoading
                ? PRICE_SUMMARY_LABELS.map((label) => (
                    <div key={label} className="summary-placeholder">
                      {label}: 불러오는 중...
                    </div>
                  ))
                : priceSummaryRows.map((item) => (
                    <div key={item.label}>
                      <strong>{item.label}</strong>
                      <span>{item.value}</span>
                    </div>
                  ))}
            </div>
          </article>

          <article
            className="card chart-card"
            data-portfolio-palette={portfolioChartData?.datasets?.[0]?.backgroundColor?.join(",") || ""}
          >
            <h2>월별 흐름</h2>
            <div className="chart-wrap">
              {isDashboardInitialLoading ? (
                <div className="chart-loading" role="status" aria-live="polite">
                  <span className="loading-spinner" aria-hidden="true" />
                  <p>차트 데이터를 불러오는 중...</p>
                </div>
              ) : trendChartData ? (
                <Line data={trendChartData} options={{ responsive: true, maintainAspectRatio: false }} />
              ) : (
                <p>데이터 없음</p>
              )}
            </div>
          </article>
          <article className="card chart-card">
            <h2>포트폴리오</h2>
            <div className="chart-wrap">
              {isDashboardInitialLoading ? (
                <div className="chart-loading" role="status" aria-live="polite">
                  <span className="loading-spinner" aria-hidden="true" />
                  <p>차트 데이터를 불러오는 중...</p>
                </div>
              ) : portfolioChartData ? (
                <Doughnut data={portfolioChartData} options={{ responsive: true, maintainAspectRatio: false }} />
              ) : (
                <p>데이터 없음</p>
              )}
            </div>
          </article>
        </section>
      )}

      {tab === "transactions" && (
        <section className="grid-1">
          <article className="card">
            <h2>거래 입력</h2>
            <p className="table-summary">수정은 아래 거래 목록에서 바로 진행됩니다.</p>
            {showTransactionEntryBanner && (
              <div className="tx-entry-banner" role="status">
                <span>첫 거래를 바로 입력해 보세요. 거래자와 카테고리를 먼저 고르면 정리 속도가 빨라집니다.</span>
                <button type="button" className="secondary" onClick={() => setShowTransactionEntryBanner(false)}>
                  닫기
                </button>
              </div>
            )}
            <form className="form-grid transactions-form-grid" onSubmit={submitTransaction}>
              <label className="date-field">
                일자
                <div className="date-input-wrap">
                  <input
                    type="date"
                    value={txForm.occurred_on}
                    onChange={(e) => setTxForm({ ...txForm, occurred_on: e.target.value })}
                    required
                  />
                  <button
                    type="button"
                    className="secondary today-btn"
                    onClick={() => setTxForm({ ...txForm, occurred_on: todayIso() })}
                  >
                    오늘
                  </button>
                </div>
              </label>
              <label>
                유형
                <select
                  value={txForm.flow_type}
                  onChange={(e) => {
                    setTxForm({ ...txForm, flow_type: e.target.value, category_id: "" });
                    setTxCategoryMajor("");
                  }}
                >
                  {FLOW_TYPE_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                금액
                <input
                  type="text"
                  inputMode="decimal"
                  value={txForm.amount}
                  onChange={(event) => handleGroupedDecimalInput(event, setTxForm, "amount")}
                  required
                />
              </label>
              <label>
                대분류
                <select
                  value={txCategoryMajor}
                  onChange={(e) => {
                    setTxCategoryMajor(e.target.value);
                    setTxForm({ ...txForm, category_id: "" });
                  }}
                >
                  <option value="">(선택 안함)</option>
                  {categoryMajorOptions.map((major) => (
                    <option key={major} value={major}>
                      {toCategoryMajorLabel(major)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                중분류
                <select
                  value={txForm.category_id}
                  disabled={!txCategoryMajor}
                  onChange={(e) => setTxForm({ ...txForm, category_id: e.target.value })}
                >
                  <option value="">(선택 안함)</option>
                  {categoryMinorOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {toCategoryMinorLabel(item.minor)}
                    </option>
                  ))}
                </select>
              </label>
              <label>메모<input value={txForm.memo} onChange={(e) => setTxForm({ ...txForm, memo: e.target.value })} /></label>
              <label>
                거래자
                <select
                  value={ownerSelectValue(txForm.owner_user_id, txForm.owner_name)}
                  onChange={(event) => {
                    const nextOwner = ownerSelectionFromValue(event.target.value, transactionOwnerOptions);
                    setTxForm({ ...txForm, ...nextOwner });
                  }}
                >
                  <option value="">(선택 안함)</option>
                  {transactionOwnerOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="inline form-actions">
                <button type="button" className="secondary" onClick={() => {
                  setTxForm(createTransactionForm());
                  setTxCategoryMajor("");
                }}>
                  초기화
                </button>
                <button type="submit">거래 등록</button>
              </div>
            </form>
          </article>
          <article className="card table-card">
            <h2>거래 목록</h2>
            <div className="table-header-group">
              <div className="month-stepper-inline">
                <div className="month-stepper">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="이전 달"
                    disabled={isPrevMonthDisabled}
                    onClick={() => handleShiftYearMonth(-1)}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                  </button>
                  <div className="date-inputs">
                    <input
                      type="number"
                      aria-label="연도"
                      value={yearMonth.year}
                      onChange={(event) => setYearMonth({ ...yearMonth, year: Number(event.target.value) })}
                    />
                    <span>년</span>
                    <input
                      type="number"
                      min="1"
                      max="12"
                      aria-label="월"
                      value={yearMonth.month}
                      onChange={(event) => setYearMonth({ ...yearMonth, month: Number(event.target.value) })}
                    />
                    <span>월</span>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="다음 달"
                    disabled={isNextMonthDisabled}
                    onClick={() => handleShiftYearMonth(1)}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                  </button>
                  <button type="button" className="text-btn" onClick={handleMoveToCurrentMonth}>
                    이번 달
                  </button>
                  <button type="button" className="text-btn apply-btn" onClick={handleApplyYearMonth}>
                    조회 적용
                  </button>
                </div>
                <p className="table-summary">
                  조회 가능 월: {toYearMonthKey(minMonth)} ~ {toYearMonthKey(maxMonth)}
                </p>
              </div>
            </div>
            <div className="table-toolbar">
              <label>
                검색
                <input
                  placeholder="메모, 거래자, 카테고리"
                  value={txListFilter.keyword}
                  onChange={(e) => setTxListFilter({ ...txListFilter, keyword: e.target.value })}
                />
              </label>
              <label>
                유형
                <select
                  value={txListFilter.flow_type}
                  onChange={(e) => setTxListFilter({ ...txListFilter, flow_type: e.target.value })}
                >
                  <option value="all">전체</option>
                  {FLOW_TYPE_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                시작일
                <input
                  type="date"
                  value={txListFilter.start}
                  onChange={(e) => setTxListFilter({ ...txListFilter, start: e.target.value })}
                />
              </label>
              <label>
                종료일
                <input
                  type="date"
                  value={txListFilter.end}
                  onChange={(e) => setTxListFilter({ ...txListFilter, end: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  setTxListFilter({
                    keyword: "",
                    flow_type: "all",
                    start: "",
                    end: "",
                  })
                }
              >
                필터 초기화
              </button>
            </div>
            <p className="table-summary">
              총 {transactions.length}건 중 {filteredTransactions.length}건 표시
            </p>
            <table>
              <thead>
                <tr><th>일자</th><th>유형</th><th>금액</th><th>카테고리</th><th>메모</th><th>거래자명</th><th>최종 수정일</th><th>동작</th></tr>
              </thead>
              <tbody>
                {filteredTransactions.length === 0 && (
                  <tr>
                    <td colSpan={8} className="empty-state">조건에 맞는 거래가 없습니다.</td>
                  </tr>
                )}
                {filteredTransactions.map((item) => {
                  const isEditing = Boolean(item && txInlineEdit?.id === item.id);
                  const editForm = isEditing ? txInlineEdit : null;
                  const editOwnerOptions = ownerOptionsWithFallback(editForm?.owner_user_id || "", editForm?.owner_name || "");
                  const rowKey = item.id;
                  return (
                    <Fragment key={rowKey}>
                      <tr
                        className={`transaction-row transaction-row-${item.flow_type} ${isEditing ? "transaction-row-editing" : ""}`}
                        style={{
                          "--transaction-row-bg": normalizeTransactionRowColors(householdSettings?.transaction_row_colors)[item.flow_type] || DEFAULT_TRANSACTION_ROW_COLORS[item.flow_type],
                          "--transaction-row-accent": normalizeTransactionRowColors(householdSettings?.transaction_row_colors)[item.flow_type] || DEFAULT_TRANSACTION_ROW_COLORS[item.flow_type],
                        }}
                      >
                        <td data-label="일자">{item.occurred_on}</td>
                        <td data-label="유형">{FLOW_TYPE_LABELS[item.flow_type] || item.flow_type}</td>
                        <td data-label="금액">{fmtKrw(item.amount)}</td>
                        <td data-label="카테고리">{renderCategoryCell(categoryById.get(item.category_id || ""))}</td>
                        <td data-label="메모">{item.memo}</td>
                        <td data-label="거래자명">{item.owner_name || "-"}</td>
                        <td data-label="최종 수정일">{fmtDate(item.updated_at)}</td>
                        <td data-label="동작">
                          <div className="inline">
                            <button
                              className={isEditing ? "primary" : "secondary"}
                              onClick={() => {
                                if (isEditing) {
                                  closeTxInlineEdit();
                                } else {
                                  setTxInlineEdit({
                                    id: item.id,
                                    version: item.version,
                                    occurred_on: item.occurred_on,
                                    flow_type: item.flow_type,
                                    amount: normalizeDecimalInputValue(item.amount),
                                    category_id: item.category_id || "",
                                    category_major: categoryById.get(item.category_id || "")?.major || "",
                                    memo: item.memo || "",
                                    owner_user_id: item.owner_user_id || "",
                                    owner_name: item.owner_name || "",
                                  });
                                }
                              }}
                            >
                              {isEditing ? "수정 중" : "수정"}
                            </button>
                            <button className="danger" onClick={() => removeTx(item.id)}>삭제</button>
                          </div>
                        </td>
                      </tr>
                      {isEditing && editForm && (
                        <tr className="transaction-inline-editor-row transactions-inline-editor">
                          <td data-label="일자">
                            <label className="tx-inline-date-field">
                              <input
                                aria-label="일자"
                                type="date"
                                placeholder="일자"
                                value={editForm.occurred_on}
                                onChange={(e) => setTxInlineEdit({ ...editForm, occurred_on: e.target.value })}
                                required
                              />
                            </label>
                          </td>
                          <td data-label="유형">
                            <label className="tx-inline-type-field">
                              <select
                                aria-label="유형"
                                value={editForm.flow_type}
                                onChange={(e) => {
                                  setTxInlineEdit({
                                    ...editForm,
                                    flow_type: e.target.value,
                                    category_id: "",
                                    category_major: "",
                                  });
                                }}
                              >
                                {FLOW_TYPE_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </td>
                          <td data-label="금액">
                            <label className="tx-inline-amount-field">
                              <input
                                aria-label="금액"
                                placeholder="금액"
                                type="text"
                                inputMode="decimal"
                                value={editForm.amount}
                                onChange={(event) => handleGroupedDecimalInput(event, setTxInlineEdit, "amount")}
                                required
                              />
                            </label>
                          </td>
                          <td data-label="카테고리">
                            <div className="tx-inline-category-section" aria-label="카테고리 선택">
                              <label className="tx-inline-major-field">
                                <select
                                  aria-label="대분류"
                                  value={txInlineCategoryMajor}
                                  onChange={(event) =>
                                    setTxInlineEdit({
                                      ...editForm,
                                      category_major: event.target.value,
                                      category_id: "",
                                    })
                                  }
                                >
                                  <option value="">(선택 안함)</option>
                                  {txInlineCategoryMajorOptions.map((major) => (
                                    <option key={major} value={major}>
                                      {toCategoryMajorLabel(major)}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="tx-inline-minor-field">
                                <select
                                  aria-label="중분류"
                                  value={editForm.category_id}
                                  disabled={!txInlineCategoryMajor}
                                  onChange={(e) => setTxInlineEdit({ ...editForm, category_id: e.target.value })}
                                >
                                  <option value="">(선택 안함)</option>
                                  {txInlineCategoryMinorOptions.map((cat) => (
                                    <option key={cat.id} value={cat.id}>
                                      {toCategoryMinorLabel(cat.minor)}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                          </td>
                          <td data-label="메모">
                            <label className="tx-inline-memo-field">
                              <input
                                aria-label="메모"
                                placeholder="메모"
                                value={editForm.memo}
                                onChange={(e) => setTxInlineEdit({ ...editForm, memo: e.target.value })}
                              />
                            </label>
                          </td>
                          <td data-label="거래자명">
                            <label className="tx-inline-owner-field">
                              <select
                                aria-label="거래자"
                                value={ownerSelectValue(editForm.owner_user_id, editForm.owner_name)}
                                onChange={(event) =>
                                  setTxInlineEdit({
                                    ...editForm,
                                    ...ownerSelectionFromValue(event.target.value, editOwnerOptions),
                                  })
                                }
                              >
                                <option value="">(선택 안함)</option>
                                {editOwnerOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </td>
                          <td data-label="최종 수정일">-</td>
                          <td data-label="동작">
                            <div className="inline tx-inline-editor-actions">
                              <button type="button" className="secondary" onClick={() => closeTxInlineEdit()}>
                                취소
                              </button>
                              <button
                                type="button"
                                className="primary"
                                onClick={() => {
                                  void submitTxInlineEdit();
                                }}
                              >
                                저장
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </article>
        </section>
      )}

      {tab === "holdings" && (
        <section className="grid-1">
          <article className="card">
            <h2>자산 입력</h2>
            <p className="table-summary">수정은 아래 자산 목록에서 바로 진행됩니다.</p>
            <div className="holdings-form-container">
              <form className="holdings-form-grid" onSubmit={submitHolding}>
                <label>
                  유형
                  <select
                    value={holdingForm.asset_type}
                    onChange={(event) => {
                      const nextType = String(event.target.value || "cash");
                      setHoldingForm((prev) => ({
                        ...createHoldingForm(nextType),
                        name: prev.name,
                        owner_user_id: prev.owner_user_id,
                        owner_name: prev.owner_name,
                        account_name: prev.account_name,
                        average_cost: prev.average_cost,
                      }));
                    }}
                  >
                    {ASSET_TYPE_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  자산명
                  <input
                    value={holdingForm.name}
                    onChange={(event) => setHoldingForm({ ...holdingForm, name: event.target.value })}
                    required
                  />
                </label>
                <label>
                  카테고리
                  <input
                    value={holdingForm.category}
                    onChange={(event) => setHoldingForm({ ...holdingForm, category: event.target.value })}
                  />
                </label>
                <label>
                  보유자
                  <select
                    value={ownerSelectValue(holdingForm.owner_user_id, holdingForm.owner_name)}
                    onChange={(event) =>
                      setHoldingForm({
                        ...holdingForm,
                        ...ownerSelectionFromValue(event.target.value, holdingFormOwnerOptions),
                      })
                    }
                  >
                    <option value="">(선택 안함)</option>
                    {holdingFormOwnerOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  계좌
                  <input
                    value={holdingForm.account_name}
                    onChange={(event) => setHoldingForm({ ...holdingForm, account_name: event.target.value })}
                  />
                </label>
                {holdingFormTracked ? (
                  <>
                    <label>
                      심볼
                      <input
                        value={holdingForm.symbol}
                        onChange={(event) => setHoldingForm({ ...holdingForm, symbol: event.target.value })}
                        required
                      />
                    </label>
                    <label>
                      시장심볼
                      <input
                        value={holdingForm.market_symbol}
                        onChange={(event) => setHoldingForm({ ...holdingForm, market_symbol: event.target.value })}
                      />
                    </label>
                    <label>
                      수량
                      <input
                        type="text"
                        inputMode="decimal"
                        value={holdingForm.quantity}
                        onChange={(event) => handleGroupedDecimalInput(event, setHoldingForm, "quantity")}
                        required
                      />
                    </label>
                  </>
                ) : (
                  <label>
                    평가금액
                    <input
                      type="text"
                      inputMode="decimal"
                      value={holdingForm.average_cost}
                      onChange={(event) => handleGroupedDecimalInput(event, setHoldingForm, "average_cost")}
                      required
                    />
                  </label>
                )}
                {holdingFormTracked && (
                  <label>
                    평균단가
                    <input
                      type="text"
                      inputMode="decimal"
                      value={holdingForm.average_cost}
                      onChange={(event) => handleGroupedDecimalInput(event, setHoldingForm, "average_cost")}
                      required
                    />
                  </label>
                )}
                <label>
                  통화
                  <input
                    value={holdingForm.currency}
                    onChange={(event) => setHoldingForm({ ...holdingForm, currency: event.target.value.toUpperCase() })}
                    required
                  />
                </label>
                <div className="holdings-form-actions">
                  <button type="button" className="secondary" onClick={() => setHoldingForm(createHoldingForm(holdingForm.asset_type))}>
                    초기화
                  </button>
                  <button type="submit" className="primary">자산 등록</button>
                </div>
              </form>
            </div>
          </article>
          <article className="card table-card">
            <h2>자산 목록</h2>
            <div className="tabs sub-tabs" role="tablist" aria-label="자산 목록 분류">
              {dynamicHoldingTabs.map((tabItem) => (
                <button
                  key={tabItem.value}
                  type="button"
                  role="tab"
                  aria-selected={holdingListTab === tabItem.value}
                  className={holdingListTab === tabItem.value ? "active" : ""}
                  onClick={() => setHoldingListTab(tabItem.value)}
                >
                  {tabItem.label}
                </button>
              ))}
            </div>
            <p className="table-summary">
              총 {holdingItems.length}건 중 {filteredHoldingItems.length}건 표시
            </p>
            <table>
              <thead>
              <tr>
                <th aria-sort={renderHoldingSortAria("name")}>{renderHoldingSortHeader("name")}</th>
                <th aria-sort={renderHoldingSortAria("owner_name")}>{renderHoldingSortHeader("owner_name")}</th>
                <th aria-sort={renderHoldingSortAria("category")}>{renderHoldingSortHeader("category")}</th>
                <th aria-sort={renderHoldingSortAria("quantity")}>{renderHoldingSortHeader("quantity")}</th>
                <th aria-sort={renderHoldingSortAria("average_cost")}>{renderHoldingSortHeader("average_cost")}</th>
                <th aria-sort={renderHoldingSortAria("market_value_krw")}>{renderHoldingSortHeader("market_value_krw")}</th>
                <th aria-sort={renderHoldingSortAria("gain_loss_krw")}>{renderHoldingSortHeader("gain_loss_krw")}</th>
                <th aria-sort={renderHoldingSortAria("updated_at")}>{renderHoldingSortHeader("updated_at")}</th>
                <th>동작</th>
              </tr>
              </thead>
              <tbody>
                {sortedHoldingItems.length === 0 && (
                  <tr>
                    <td colSpan={9} className="empty-state">조건에 맞는 자산이 없습니다.</td>
                  </tr>
                )}
                {holdingListTab === "all"
                  ? groupedHoldingSections.flatMap(([categoryName, sectionItems]) => [
                      <tr key={`section-${categoryName}`}>
                        <td className="section-header-cell" colSpan={9}>
                          {categoryName}
                        </td>
                      </tr>,
                      ...sectionItems.map((item) => renderHoldingRow(item, `all-${categoryName}-${item.holding_id}`)),
                    ])
                  : sortedHoldingItems.map((item) => renderHoldingRow(item, `tab-${holdingListTab}-${item.holding_id}`))}
              </tbody>
            </table>
          </article>
        </section>
      )}

      {tab === "settings" && (
        <section className="grid-2 settings-grid">
          <article className="card">
            <h2>내 프로필</h2>
            <form className="form-grid settings-form-grid" onSubmit={saveProfileSettings}>
              <label>
                본명
                <input
                  value={profileForm.real_name}
                  onChange={(event) => setProfileForm((prev) => ({ ...prev, real_name: event.target.value }))}
                  required
                />
              </label>
              <label>
                닉네임
                <input
                  value={profileForm.nickname}
                  onChange={(event) => setProfileForm((prev) => ({ ...prev, nickname: event.target.value }))}
                  placeholder="선택 입력"
                />
              </label>
              <label>
                표시명 방식
                <select
                  value={profileForm.display_name_mode}
                  onChange={(event) => setProfileForm((prev) => ({ ...prev, display_name_mode: event.target.value }))}
                >
                  {DISPLAY_NAME_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="settings-preview">
                현재 표시명: <strong>{user?.display_name || "-"}</strong>
              </div>
              <div className="inline form-actions settings-actions">
                <button type="submit">프로필 저장</button>
              </div>
            </form>
          </article>

          <article className="card">
            <h2>가계 설정</h2>
            <form className="form-grid settings-form-grid" onSubmit={saveHouseholdSettings}>
              <label>
                가계 이름
                <input
                  value={householdSettingsForm.name}
                  onChange={(event) => setHouseholdSettingsForm((prev) => ({ ...prev, name: event.target.value }))}
                  required
                />
              </label>
              <div className="settings-preview">
                현재 기준 통화: <strong>{householdSettings?.base_currency || household?.base_currency || "KRW"}</strong>
              </div>
              <div className="inline form-actions settings-actions">
                <button type="submit" disabled={!canManageHousehold}>
                  가계 설정 저장
                </button>
              </div>
            </form>
            {!canManageHousehold && (
              <p className="table-summary">가계 이름과 공통 색상은 공동 소유자 이상 권한에서만 변경할 수 있습니다.</p>
            )}
          </article>

          <article className="card">
            <h2>거래 행 색상</h2>
            <form className="settings-color-form" onSubmit={saveHouseholdSettings}>
              {FLOW_TYPE_OPTIONS.map((option) => {
                const colorValue = householdSettingsForm.transaction_row_colors?.[option.value] || DEFAULT_TRANSACTION_ROW_COLORS[option.value];
                return (
                  <label key={option.value} className="settings-color-row">
                    <span>{option.label}</span>
                    <span
                      className="settings-color-preview-bar"
                      style={{ "--settings-color-preview": colorValue }}
                      aria-hidden="true"
                    />
                    <input
                      type="color"
                      value={colorValue}
                      onChange={(event) =>
                        setHouseholdSettingsForm((prev) => ({
                          ...prev,
                          transaction_row_colors: {
                            ...prev.transaction_row_colors,
                            [option.value]: event.target.value.toUpperCase(),
                          },
                        }))
                      }
                      disabled={!canManageHousehold}
                    />
                    <code>{colorValue}</code>
                  </label>
                );
              })}
              <div className="inline form-actions settings-actions">
                <button type="submit" disabled={!canManageHousehold}>
                  색상 저장
                </button>
              </div>
            </form>
          </article>

          <article className="card settings-span-full">
            <h2>카테고리 관리</h2>
            <form className="form-grid settings-form-grid category-create-form" onSubmit={createCategoryPair}>
              <label>
                유형
                <select
                  value={categoryDraft.flow_type}
                  onChange={(event) => setCategoryDraft((prev) => ({ ...prev, flow_type: event.target.value }))}
                  disabled={!canEditHouseholdData}
                >
                  {FLOW_TYPE_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                새 대분류
                <input
                  value={categoryDraft.major}
                  onChange={(event) => setCategoryDraft((prev) => ({ ...prev, major: event.target.value }))}
                  required
                  disabled={!canEditHouseholdData}
                />
              </label>
              <label>
                첫 중분류
                <input
                  value={categoryDraft.minor}
                  onChange={(event) => setCategoryDraft((prev) => ({ ...prev, minor: event.target.value }))}
                  required
                  disabled={!canEditHouseholdData}
                />
              </label>
              <div className="inline form-actions settings-actions">
                <button type="submit" disabled={!canEditHouseholdData}>카테고리 추가</button>
              </div>
            </form>
            {!canEditHouseholdData && (
              <p className="table-summary">카테고리 변경은 편집자 이상 권한에서만 가능합니다.</p>
            )}

            <div className="settings-category-flows">
              {categoryGroups.map((flowGroup) => (
                <section key={flowGroup.value} className="settings-category-flow">
                  <header className="settings-category-flow-header">
                    <h3>{FLOW_TYPE_LABELS[flowGroup.value] || flowGroup.value}</h3>
                    <span className="table-summary">{flowGroup.groups.reduce((count, [, items]) => count + items.length, 0)}개</span>
                  </header>
                  {flowGroup.groups.length === 0 ? (
                    <p className="table-summary">등록된 카테고리가 없습니다.</p>
                  ) : (
                    flowGroup.groups.map(([major, items]) => (
                      <div key={`${flowGroup.value}:${major}`} className="settings-category-group">
                        <div className="settings-category-group-header">
                          <strong>{toCategoryMajorLabel(major)}</strong>
                          <div className="inline">
                            <input
                              value={majorRenameDrafts[`${flowGroup.value}:${major}`] || ""}
                              onChange={(event) =>
                                setMajorRenameDrafts((prev) => ({
                                  ...prev,
                                  [`${flowGroup.value}:${major}`]: event.target.value,
                                }))
                              }
                              placeholder="새 대분류명"
                              disabled={!canEditHouseholdData}
                            />
                            <button type="button" className="secondary" disabled={!canEditHouseholdData} onClick={() => renameCategoryMajorGroup(flowGroup.value, major)}>
                              대분류 변경
                            </button>
                          </div>
                        </div>
                        <div className="settings-category-list">
                          {items.map((category) => {
                            const isEditing = categoryEditId === category.id;
                            return isEditing ? (
                              <form
                                key={category.id}
                                className="settings-category-row category-row-editing"
                                onSubmit={(event) => saveCategoryEdit(event, category.id)}
                              >
                                <span className="settings-category-major">{toCategoryMajorLabel(category.major)}</span>
                                <input
                                  value={categoryEditForm.minor}
                                  onChange={(event) => setCategoryEditForm((prev) => ({ ...prev, major: category.major, minor: event.target.value }))}
                                  required
                                  disabled={!canEditHouseholdData}
                                />
                                <span className="settings-category-usage">사용 {category.usage_count}건</span>
                                <div className="inline">
                                  <button type="submit" disabled={!canEditHouseholdData}>저장</button>
                                  <button type="button" className="secondary" onClick={() => { setCategoryEditId(""); setCategoryEditForm({ major: "", minor: "" }); }}>
                                    취소
                                  </button>
                                </div>
                              </form>
                            ) : (
                              <div key={category.id} className="settings-category-row">
                                <span className="settings-category-major">{toCategoryMajorLabel(category.major)}</span>
                                <span className="settings-category-minor">{toCategoryMinorLabel(category.minor)}</span>
                                <span className="settings-category-usage">사용 {category.usage_count}건</span>
                                <div className="inline">
                                  <button
                                    type="button"
                                    className="secondary"
                                    disabled={!canEditHouseholdData}
                                    onClick={() => {
                                      setCategoryEditId(category.id);
                                      setCategoryEditForm({ major: category.major, minor: category.minor });
                                    }}
                                  >
                                    중분류 수정
                                  </button>
                                  <button
                                    type="button"
                                    className="danger"
                                    disabled={!canEditHouseholdData || Number(category.usage_count || 0) > 0}
                                    onClick={() => deleteCategoryPair(category).catch(() => undefined)}
                                  >
                                    삭제
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </section>
              ))}
            </div>
          </article>
        </section>
      )}

      {tab === "collaboration" && (
        <section className="grid-1">
          <article className="card">
            <h2>가계 협업 관리</h2>
            <div className="collaboration-toolbar">
              <label>
                작업 가계
                <select
                  className="household-select"
                  value={household?.id || ""}
                  onChange={(event) => {
                    const nextId = String(event.target.value || "");
                    if (!nextId || nextId === household?.id) {
                      return;
                    }
                    selectActiveHousehold(nextId).catch(() => undefined);
                  }}
                  disabled={loading || householdList.length === 0}
                >
                  {householdList.length === 0 && <option value="">선택 가능한 가계 없음</option>}
                  {householdList.map((entry) => (
                    <option key={entry.household.id} value={entry.household.id}>
                      {entry.household.name} · 내 권한 {COLLAB_ROLE_LABELS[entry.role] || entry.role}
                    </option>
                  ))}
                </select>
              </label>
              <p className="table-summary">
                현재 가계: {household?.name || "-"} / 내 권한: {COLLAB_ROLE_LABELS[householdRole] || householdRole || "-"}
              </p>
            </div>

            {inviteAcceptanceNotice && (
              <div className="invite-acceptance-banner" role="status">
                <div className="invite-acceptance-copy">
                  <strong>{inviteAcceptanceNotice.householdName} 초대를 수락했습니다.</strong>
                  <span>
                    권한: {COLLAB_ROLE_LABELS[inviteAcceptanceNotice.role] || inviteAcceptanceNotice.role || "-"}
                    {inviteAcceptanceNotice.activeHouseholdSelected
                      ? " · 현재 작업 가계로 선택되었습니다."
                      : " · 필요하면 바로 작업 가계로 전환할 수 있습니다."}
                  </span>
                </div>
                {inviteAcceptanceCanSwitch && (
                  <div className="inline">
                    <button
                      type="button"
                      onClick={() => selectActiveHousehold(inviteAcceptanceNotice.householdId).catch(() => undefined)}
                      disabled={loading}
                    >
                      작업 가계로 전환
                    </button>
                  </div>
                )}
              </div>
            )}

            <form className="form-grid collaboration-form-grid" onSubmit={createHouseholdInvite}>
              <label>
                초대할 이메일
                <input
                  type="email"
                  value={inviteForm.email}
                  onChange={(event) => setInviteForm((prev) => ({ ...prev, email: event.target.value }))}
                  placeholder="example@email.com"
                  disabled={loading || !canManageHousehold}
                  required
                />
              </label>
              <label>
                권한
                <select
                  value={inviteForm.role}
                  onChange={(event) => setInviteForm((prev) => ({ ...prev, role: event.target.value }))}
                  disabled={loading || !canManageHousehold}
                >
                  {COLLAB_ROLE_OPTIONS.filter((item) => item.value !== "owner").map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="inline form-actions">
                <button type="submit" disabled={loading || !canManageHousehold}>
                  초대 발송
                </button>
              </div>
            </form>
            {!canManageHousehold && (
              <p className="table-summary">초대 발송/권한 변경은 공동 소유자 이상 권한에서만 가능합니다.</p>
            )}

            <form className="form-grid collaboration-accept-grid" onSubmit={acceptHouseholdInvite}>
              <label>
                초대 수락 토큰
                <input
                  value={inviteAcceptToken}
                  onChange={(event) => setInviteAcceptToken(event.target.value)}
                  placeholder="메일 링크의 token 값을 붙여 넣으세요."
                />
              </label>
              <div className="inline form-actions">
                <button
                  type="submit"
                  className="secondary"
                  disabled={loading || !String(inviteAcceptToken || "").trim()}
                >
                  초대 수락
                </button>
              </div>
            </form>
          </article>

          <article className="card table-card">
            <h2>받은 초대</h2>
            <p className="table-summary">총 {receivedHouseholdInvites.length}건</p>
            <table>
              <thead>
                <tr><th>가계</th><th>초대한 사람</th><th>권한</th><th>상태</th><th>시각</th><th>동작</th></tr>
              </thead>
              <tbody>
                {receivedHouseholdInvites.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty-state">받은 초대가 없습니다.</td>
                  </tr>
                )}
                {receivedHouseholdInvites.map((invite) => {
                  const pending = invite.status === "pending";
                  const accepted = invite.status === "accepted";
                  const canSwitchToInviteHousehold = accepted && invite.household_id && invite.household_id !== household?.id;
                  const isRecentlyAccepted = inviteAcceptanceNotice?.invitationId === invite.id;
                  return (
                    <tr key={invite.id} className={isRecentlyAccepted ? "invite-row-highlight" : ""}>
                      <td data-label="가계">{invite.household_name || "-"}</td>
                      <td data-label="초대한 사람">{invite.inviter_display_name || "-"}</td>
                      <td data-label="권한">{COLLAB_ROLE_LABELS[invite.role] || invite.role}</td>
                      <td data-label="상태">
                        <span className={`status-pill status-pill-${invite.status} ${isRecentlyAccepted ? "status-pill-highlight" : ""}`}>
                          {INVITATION_STATUS_LABELS[invite.status] || invite.status}
                        </span>
                      </td>
                      <td data-label="시각">{fmtDateTime(invite.accepted_at || invite.expires_at)}</td>
                      <td data-label="동작">
                        <div className="inline">
                          {pending && (
                            <button
                              type="button"
                              className="secondary"
                              disabled={loading}
                              onClick={() => acceptReceivedHouseholdInvite(invite.id).catch(() => undefined)}
                            >
                              초대 수락
                            </button>
                          )}
                          {!pending && canSwitchToInviteHousehold && (
                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => selectActiveHousehold(invite.household_id).catch(() => undefined)}
                            >
                              작업 가계로 전환
                            </button>
                          )}
                          {!pending && !canSwitchToInviteHousehold && "-"}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </article>

          <article className="card table-card">
            <h2>멤버 목록</h2>
            <p className="table-summary">총 {householdMembers.length}명</p>
            <table>
              <thead>
                <tr><th>이름</th><th>이메일</th><th>권한</th><th>가입일</th><th>동작</th></tr>
              </thead>
              <tbody>
                {householdMembers.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty-state">아직 등록된 멤버가 없습니다.</td>
                  </tr>
                )}
                {householdMembers.map((member) => {
                  const isSelf = Boolean(user?.id && member.user_id === user.id);
                  return (
                    <tr key={member.member_id}>
                      <td data-label="이름">{member.display_name || "-"}</td>
                      <td data-label="이메일">{member.email || "-"}</td>
                      <td data-label="권한">
                        <select
                          value={member.role}
                          disabled={!canManageHousehold || loading}
                          onChange={(event) =>
                            changeMemberRole(member.member_id, event.target.value).catch(() => undefined)
                          }
                        >
                          {memberRoleOptions.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                          {!canAssignOwner && member.role === "owner" && (
                            <option value="owner">{COLLAB_ROLE_LABELS.owner}</option>
                          )}
                        </select>
                      </td>
                      <td data-label="가입일">{fmtDateTime(member.created_at)}</td>
                      <td data-label="동작">
                        <div className="inline">
                          <button
                            type="button"
                            className="danger"
                            disabled={!canManageHousehold || loading || isSelf}
                            onClick={() => removeHouseholdMember(member.member_id, member.display_name).catch(() => undefined)}
                          >
                            {isSelf ? "본인" : "멤버 제거"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </article>

          <article className="card table-card">
            <h2>보낸 초대 현황</h2>
            <p className="table-summary">총 {householdInvites.length}건</p>
            <table>
              <thead>
                <tr><th>이메일</th><th>권한</th><th>상태</th><th>초대한 사람</th><th>만료일</th><th>동작</th></tr>
              </thead>
              <tbody>
                {householdInvites.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty-state">진행 중인 초대가 없습니다.</td>
                  </tr>
                )}
                {householdInvites.map((invite) => {
                  const pending = invite.status === "pending";
                  return (
                    <tr key={invite.id}>
                      <td data-label="이메일">{invite.email}</td>
                      <td data-label="권한">{COLLAB_ROLE_LABELS[invite.role] || invite.role}</td>
                      <td data-label="상태">
                        <span className={`status-pill status-pill-${invite.status}`}>
                          {INVITATION_STATUS_LABELS[invite.status] || invite.status}
                        </span>
                      </td>
                      <td data-label="초대한 사람">{invite.inviter_display_name || "-"}</td>
                      <td data-label="만료일">{fmtDateTime(invite.expires_at)}</td>
                      <td data-label="동작">
                        <div className="inline">
                          <button
                            type="button"
                            className="danger"
                            disabled={!canManageHousehold || loading || !pending}
                            onClick={() => revokeHouseholdInvite(invite.id).catch(() => undefined)}
                          >
                            {pending ? "초대 취소" : "-"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </article>
        </section>
      )}

      {tab === "import" && (
        <section className="grid-1">
          <article className="card">
            <h2>데이터 파일 가져오기</h2>
            <div
              className={`file-drop-area ${isDragOver ? "drag-over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (!importLoadingMode) setIsDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setIsDragOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                if (!importLoadingMode && e.dataTransfer.files?.[0]) {
                  setImportFile(e.dataTransfer.files[0]);
                }
              }}
              onClick={() => {
                if (!importLoadingMode) importFileInputRef.current?.click();
              }}
            >
              <input
                ref={importFileInputRef}
                type="file"
                accept=".xlsx"
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                style={{ display: "none" }}
                aria-label="엑셀 파일 업로드"
                disabled={Boolean(importLoadingMode)}
              />
              {importFile ? (
                <div className="upload-file-name">선택된 파일: {importFile.name}</div>
              ) : (
                <div className="upload-placeholder">엑셀 파일을 이곳에 드래그 앤 드롭 하거나 클릭하여 업로드하세요.</div>
              )}
            </div>
            <div className="inline" style={{ marginTop: "1rem" }}>
              <button disabled={Boolean(importLoadingMode)} onClick={() => doImport("dry_run")}>
                {importLoadingMode === "dry_run" ? "미리 검증 중..." : IMPORT_MODE_LABELS.dry_run}
              </button>
              <button disabled={Boolean(importLoadingMode)} onClick={() => doImport("apply")}>
                {importLoadingMode === "apply" ? "적용 중..." : IMPORT_MODE_LABELS.apply}
              </button>
            </div>
            {importLoadingMode && (
              <div className="import-progress">서버에서 파일을 처리 중입니다. 완료까지 잠시만 기다려 주세요.</div>
            )}
            {importReport && (
              <section className="import-report">
                <div className="import-summary-grid">
                  <div className="import-summary-item"><strong>파일</strong><span>{importReport.workbook_path}</span></div>
                  <div className="import-summary-item"><strong>시트 수</strong><span>{fmt(importReport.sheets)}</span></div>
                  <div className="import-summary-item"><strong>거래 행</strong><span>{fmt(importReport.transaction_rows)}</span></div>
                  <div className="import-summary-item"><strong>보유 행</strong><span>{fmt(importReport.holding_rows)}</span></div>
                  <div className="import-summary-item"><strong>적용된 거래</strong><span>{fmt(importReport.applied_transactions)}</span></div>
                  <div className="import-summary-item"><strong>적용된 보유(추가/수정)</strong><span>{fmt(importReport.applied_holdings_added)} / {fmt(importReport.applied_holdings_updated)}</span></div>
                </div>
                <div className="import-list-grid">
                  <section>
                    <h3>수식 불일치 셀 ({fmt(importReport.monthly_formula_mismatch_count)})</h3>
                    {importMismatchPreview.length === 0 ? (
                      <p className="table-summary">불일치가 없습니다.</p>
                    ) : (
                      <ul className="compact-list">
                        {importMismatchPreview.map((cell) => (
                          <li key={cell}>{cell}</li>
                        ))}
                      </ul>
                    )}
                    {(importReport.detected_mismatch_cells || []).length > importMismatchPreview.length && (
                      <p className="table-summary">
                        +{(importReport.detected_mismatch_cells || []).length - importMismatchPreview.length}건 더 있음
                      </p>
                    )}
                  </section>
                  <section>
                    <h3>이슈 ({fmt((importReport.issues || []).length)})</h3>
                    {importIssuePreview.length === 0 ? (
                      <p className="table-summary">검출된 이슈가 없습니다.</p>
                    ) : (
                      <ul className="compact-list">
                        {importIssuePreview.map((issue, index) => (
                          <li key={`${issue.code}-${issue.sheet || "none"}-${issue.row || 0}-${index}`}>
                            [{issue.severity}] {issue.message}
                            {issue.sheet ? ` (${issue.sheet}` : ""}
                            {issue.row ? `:${issue.row}` : ""}
                            {issue.sheet ? ")" : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                    {(importReport.issues || []).length > importIssuePreview.length && (
                      <p className="table-summary">+{(importReport.issues || []).length - importIssuePreview.length}건 더 있음</p>
                    )}
                  </section>
                </div>
                <details className="report-raw">
                  <summary>원본 JSON 보기</summary>
                  <pre className="report">{JSON.stringify(importReport, null, 2)}</pre>
                </details>
              </section>
            )}
          </article>
        </section>
      )}
      {confirmDialog.open && (
        <div
          className="confirm-backdrop"
          role="presentation"
          onClick={() => closeConfirmDialog(false)}
        >
          <section
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="confirm-title">{confirmDialog.title}</h2>
            <p>{confirmDialog.action}</p>
            <div className="confirm-actions">
              <button type="button" className="secondary" onClick={() => closeConfirmDialog(false)}>
                취소
              </button>
              <button type="button" className="danger" onClick={() => closeConfirmDialog(true)}>
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      )}
      <div className="app-copyright" aria-hidden="true">
        {COPYRIGHT_TEXT}
      </div>
    </main>
  );
}

export default App;

