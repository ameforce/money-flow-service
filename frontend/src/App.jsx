// SIZE_OK issue-248 app-shell; maxPureLoc=10852; transitional shell debt must shrink or stay flat until later extraction.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { AppShell, TAB_IDS } from "./components/AppShell";
import { IsoDateInput } from "./components/IsoDateInput";
import { useCompactViewport } from "./hooks/useCompactViewport";
import { CollaborationPage } from "./pages/CollaborationPage";
import { DashboardPage } from "./pages/DashboardPage";
import { HoldingsPage } from "./pages/HoldingsPage";
import { ImportPage } from "./pages/ImportPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import { TransactionCategoryQuickPicker } from "./components/worksurface/TransactionCategoryQuickPicker";
import { extractVisibleInitial, resolveSemanticColor, withAlpha } from "./components/worksurface/colorSemantics";
import { getWorkSurfaceMobilePriority } from "./components/worksurface/fieldPriority";
import "./App.css";
import packageJson from "../package.json";
import {
  normalizeFileArray,
  patchTossRowWithInference,
  recomputeTossDuplicateRows,
} from "./tossImportUtils.js";
import { displayImportFileName, formatTechnicalReportJson } from "./importReportUtils.js";
import { resolveClientVersionState } from "./clientVersion.js";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler);

const APP_VERSION_RAW = String(import.meta.env.VITE_APP_VERSION || packageJson.version || "0.0.0").trim();
const APP_VERSION = (APP_VERSION_RAW.startsWith("v") ? APP_VERSION_RAW.substring(1) : APP_VERSION_RAW) || "0.0.0";
const COPYRIGHT_TEXT = `© ENM Software v${APP_VERSION}`;

const API_PREFIX = "/api/v1";
const CLIENT_VERSION_CHECK_INTERVAL_MS = 60_000;
const TRANSACTION_LEDGER_PAGE_LIMIT = 1000;
const TRANSACTION_LEDGER_MAX_PAGES = 60;
const SAVED_EMAIL_KEY = "money-flow-saved-email";
const ACTIVE_HOUSEHOLD_KEY = "money-flow-active-household-id";
const ACTIVE_TAB_KEY = "money-flow-active-tab";
const COOKIE_AUTH_SENTINEL = "__cookie_auth__";
const DEFAULT_CSRF_COOKIE_NAME = "mf_csrf_token";
const DEFAULT_CSRF_HEADER_NAME = "x-csrf-token";
const DEFAULT_HOUSEHOLD_HEADER_NAME = "x-household-id";
const DEBUG_TOKEN_OPT_IN_HEADER = "x-debug-token-opt-in";
const KRW_TRANSACTION_INTEGER_AMOUNT_MESSAGE = "원화 금액은 소수 없이 정수로 입력해 주세요.";

const DEBUG_TOKEN_OPT_IN =
  String(
    import.meta.env.VITE_DEBUG_TOKEN_OPT_IN ??
    (import.meta.env.DEV || import.meta.env.MODE === "test" ? "true" : "")
  )
    .trim()
    .toLowerCase() === "true";
let csrfCookieName = DEFAULT_CSRF_COOKIE_NAME;
let csrfHeaderName = DEFAULT_CSRF_HEADER_NAME;
let householdHeaderName = DEFAULT_HOUSEHOLD_HEADER_NAME;
const DISPLAY_NAME_MODE_OPTIONS = [
  { value: "real_name", label: "본명 우선" },
  { value: "nickname", label: "닉네임 우선" },
];
const DEFAULT_TRANSACTION_ROW_COLORS = {
  income: "#16A34A",
  expense: "#E11D48",
  investment: "#4F46E5",
  transfer: "#D97706",
};
const DEFAULT_HOLDING_TYPES = [
  { key: "cash", label: "현금성", asset_type: "cash", tracked: false, show_average_cost: true, show_gain_loss: false },
  { key: "stock", label: "주식", asset_type: "stock", tracked: true, show_average_cost: true, show_gain_loss: true },
  { key: "crypto", label: "가상자산", asset_type: "crypto", tracked: true, show_average_cost: true, show_gain_loss: true },
  { key: "pension", label: "연금", asset_type: "pension", tracked: false, show_average_cost: true, show_gain_loss: false },
  { key: "real_estate", label: "부동산", asset_type: "real_estate", tracked: false, show_average_cost: true, show_gain_loss: false },
  { key: "other", label: "기타", asset_type: "other", tracked: false, show_average_cost: true, show_gain_loss: false },
];
const DEFAULT_HOLDING_SETTINGS = {
  types: DEFAULT_HOLDING_TYPES,
  owner_colors: {},
  category_colors: {},
  type_colors: {},
  category_order: [],
  column_widths: {},
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
const PORTFOLIO_VIEW_OPTIONS = [
  { value: "holding_type", label: "자산 유형" },
  { value: "transaction_flow", label: "거래 유형" },
];
const PORTFOLIO_VIEW_LABELS = PORTFOLIO_VIEW_OPTIONS.reduce((acc, item) => ({ ...acc, [item.value]: item.label }), {});
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
const IMPORT_SOURCE_MODES = [
  { value: "workbook", label: "XLSX" },
  { value: "toss", label: "토스 이미지" },
];
const TOSS_IMAGE_ACCEPT = ".png,.jpg,.jpeg,.webp";
const AUTO_PRICE_REFRESH_INTERVAL_MS = 20_000;
const AUTO_PRICE_REFRESH_COOLDOWN_MS = 30_000;
const PRICE_REFRESH_POLL_INTERVAL_MS = 1_000;
const PRICE_REFRESH_STATUS_FAILURE_LIMIT = 3;
const WS_REFRESH_DEBOUNCE_MS = 300;
const REALTIME_FALLBACK_SYNC_INTERVAL_MS = 45_000;
const COLLAB_ACTIVE_SYNC_INTERVAL_MS = 8_000;
const IMPORT_MISMATCH_PREVIEW_LIMIT = 20;
const IMPORT_ISSUE_PREVIEW_LIMIT = 20;
const IMPORT_REPORT_SORT_OPTIONS = [
  { value: "row_asc", label: "행 오름차순" },
  { value: "row_desc", label: "행 내림차순" },
  { value: "severity", label: "심각도순" },
  { value: "type", label: "유형순" },
];
const IMPORT_REPORT_SEVERITY_LABELS = {
  error: "오류",
  warning: "경고",
  warn: "경고",
  info: "안내",
  informational: "안내",
};
const IMPORT_REPORT_SEVERITY_RANK = {
  error: 0,
  warning: 1,
  warn: 1,
  info: 2,
  informational: 2,
};
const MOBILE_BREAKPOINT_PX = 820;
const TRANSACTION_LEDGER_LANDSCAPE_BREAKPOINT_PX = 900;
const TRANSACTION_LEDGER_LANDSCAPE_MAX_HEIGHT_PX = 520;
const HOLDING_SUMMARY_SCROLL_OFFSET_PX = 96;
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

function matchesTransactionLedgerCompactViewport() {
  if (typeof window === "undefined") {
    return false;
  }
  return (
    window.innerWidth <= MOBILE_BREAKPOINT_PX ||
    (window.innerWidth <= TRANSACTION_LEDGER_LANDSCAPE_BREAKPOINT_PX &&
      window.innerHeight <= TRANSACTION_LEDGER_LANDSCAPE_MAX_HEIGHT_PX)
  );
}

const HOLDING_LIST_TABS = [
  { value: "all", label: "전체" },
  { value: "stock", label: "주식" },
  { value: "deposit", label: "예금" },
  { value: "savings", label: "적금" },
];
const HOLDING_SORT_KEYS = [
  { field: "display_order", label: "순서" },
  { field: "name", label: "이름" },
  { field: "owner_name", label: "보유자" },
  { field: "type_key", label: "유형" },
  { field: "category", label: "카테고리" },
  { field: "quantity", label: "수량" },
  { field: "average_cost", label: "평균단가" },
  { field: "market_value_krw", label: "평가(KRW)" },
  { field: "gain_loss_krw", label: "손익(KRW)" },
  { field: "updated_at", label: "최종 수정일" },
];
const HOLDING_SORT_DEFAULT = { field: "display_order", direction: "asc" };
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
const PASSWORD_RECOVERY_EMAIL = "support@enmsoftware.com";
const PASSWORD_RECOVERY_MAILTO = `mailto:${PASSWORD_RECOVERY_EMAIL}?subject=${encodeURIComponent(
  "Money Flow 비밀번호 재설정 요청"
)}&body=${encodeURIComponent("가입 이메일:\n요청 내용: 비밀번호 재설정을 요청합니다.")}`;
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

function normalizeTabId(value) {
  const normalized = String(value || "").trim();
  return TAB_IDS.has(normalized) ? normalized : "dashboard";
}

function getUrlTabId(search = "") {
  try {
    const params = new URLSearchParams(search);
    const value = String(params.get("tab") || "").trim();
    return TAB_IDS.has(value) ? value : "";
  } catch {
    return "";
  }
}

function getSavedTabId() {
  return normalizeTabId(localStorage.getItem(ACTIVE_TAB_KEY));
}

function getInitialTabId() {
  if (typeof window === "undefined") {
    return "dashboard";
  }
  return getUrlTabId(window.location.search) || getSavedTabId();
}

function setSavedTabId(value) {
  localStorage.setItem(ACTIVE_TAB_KEY, normalizeTabId(value));
}

function clearSavedTabId() {
  localStorage.removeItem(ACTIVE_TAB_KEY);
}

function syncUrlTabParam(value) {
  if (typeof window === "undefined") {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  if (!params.has("tab")) {
    return;
  }
  const tabId = normalizeTabId(value);
  if (tabId === "dashboard") {
    params.delete("tab");
  } else {
    params.set("tab", tabId);
  }
  const nextQuery = params.toString();
  const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash || ""}`;
  window.history.replaceState(window.history.state || {}, "", nextUrl);
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
  const requestOptions = { ...(options || {}) };
  const responseType = String(requestOptions.responseType || "json").trim().toLowerCase();
  delete requestOptions.responseType;
  const method = String(requestOptions.method || "GET").toUpperCase();
  const headers = { ...(requestOptions.headers || {}) };
  const pathText = String(path || "");
  const activeHouseholdId = getActiveHouseholdId();
  const hasHouseholdHeader = Boolean(activeHouseholdId && shouldAttachHouseholdHeader(pathText));
  if (!isFormDataBody(requestOptions.body)) {
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
  const response = await fetch(pathText, { ...requestOptions, method, headers, credentials: "include" });
  if (response.ok && responseType === "blob") {
    return response;
  }
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
  if (responseType === "text") {
    return text;
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

function fmtSignedPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  const numeric = Number(value);
  const sign = numeric >= 0 ? "+" : "";
  return `${sign}${numeric.toFixed(2)}%`;
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

function normalizeImportReportSeverity(value, fallback = "info") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || fallback;
}

function formatImportReportSeverity(value) {
  const normalized = normalizeImportReportSeverity(value);
  return IMPORT_REPORT_SEVERITY_LABELS[normalized] || normalized.toUpperCase();
}

function parseImportMismatchCell(value) {
  const text = String(value || "").trim();
  const parts = text.split("!");
  const rawCell = parts.pop() || text;
  const sheet = parts.join("!").replace(/^'|'$/g, "");
  const rowMatch = rawCell.match(/(\d+)/);
  return {
    sheet,
    row: rowMatch ? Number(rowMatch[1]) : null,
    target: text,
  };
}

function normalizeImportReportRows(report) {
  const mismatchRows = (report?.detected_mismatch_cells || []).map((cell, index) => {
    const parsed = parseImportMismatchCell(cell);
    return {
      id: `mismatch-${index}`,
      source: "formula_mismatch",
      type: "formula_mismatch",
      typeLabel: "수식 불일치",
      severity: "warning",
      severityLabel: "경고",
      sheet: parsed.sheet,
      row: parsed.row,
      target: parsed.target,
      message: "월별 수식과 계산값이 일치하지 않습니다.",
    };
  });
  const issueRows = (report?.issues || []).map((issue, index) => {
    const type = String(issue.code || "issue").trim() || "issue";
    const sheet = String(issue.sheet || "").trim();
    const row = Number(issue.row || 0) || null;
    return {
      id: `issue-${index}`,
      source: "issue",
      type,
      typeLabel: type,
      severity: normalizeImportReportSeverity(issue.severity, "error"),
      severityLabel: formatImportReportSeverity(issue.severity || "error"),
      sheet,
      row,
      target: sheet && row ? `${sheet}:${row}` : sheet || (row ? `행 ${row}` : "-"),
      message: String(issue.message || "").trim() || "가져오기 이슈",
    };
  });
  return [...mismatchRows, ...issueRows].map((row) => ({
    ...row,
    searchText: [row.type, row.typeLabel, row.severity, row.severityLabel, row.sheet, row.row, row.target, row.message]
      .filter((item) => item !== null && item !== undefined)
      .join(" ")
      .toLowerCase(),
  }));
}

function compareImportReportRowNumber(left, right, direction = "asc") {
  const leftRow = Number.isFinite(left.row) ? left.row : Number.POSITIVE_INFINITY;
  const rightRow = Number.isFinite(right.row) ? right.row : Number.POSITIVE_INFINITY;
  const result = leftRow - rightRow || left.target.localeCompare(right.target, "ko");
  return direction === "desc" ? -result : result;
}

function sortImportReportRows(rows, sortMode) {
  const nextRows = [...rows];
  if (sortMode === "row_desc") {
    return nextRows.sort((left, right) => compareImportReportRowNumber(left, right, "desc"));
  }
  if (sortMode === "severity") {
    return nextRows.sort((left, right) => {
      const leftRank = IMPORT_REPORT_SEVERITY_RANK[left.severity] ?? 9;
      const rightRank = IMPORT_REPORT_SEVERITY_RANK[right.severity] ?? 9;
      return leftRank - rightRank || compareImportReportRowNumber(left, right);
    });
  }
  if (sortMode === "type") {
    return nextRows.sort((left, right) => {
      const typeCompare = left.typeLabel.localeCompare(right.typeLabel, "ko");
      return typeCompare || compareImportReportRowNumber(left, right);
    });
  }
  return nextRows.sort((left, right) => compareImportReportRowNumber(left, right));
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function formatImportReportCsv(rows) {
  const header = ["severity", "type", "sheet", "row", "target", "message"];
  const body = rows.map((row) =>
    [row.severityLabel, row.typeLabel, row.sheet, row.row || "", row.target, row.message].map(csvEscape).join(",")
  );
  return [header.join(","), ...body].join("\n");
}

function normalizeImportAppliedTransactionRefs(report) {
  return (Array.isArray(report?.applied_transaction_refs) ? report.applied_transaction_refs : [])
    .map((item) => ({
      id: String(item?.id || "").trim(),
      occurred_on: String(item?.occurred_on || "").trim(),
      memo: String(item?.memo || "").trim(),
      source_ref: String(item?.source_ref || "").trim(),
    }))
    .filter((item) => item.id);
}

function normalizeImportAppliedHoldingRefs(report) {
  return (Array.isArray(report?.applied_holding_refs) ? report.applied_holding_refs : [])
    .map((item) => ({
      id: String(item?.id || "").trim(),
      name: String(item?.name || "").trim(),
      category: String(item?.category || "").trim(),
      source_ref: String(item?.source_ref || "").trim(),
      action: String(item?.action || "").trim(),
    }))
    .filter((item) => item.id);
}

function getImportRefMonth(ref) {
  const key = String(ref?.occurred_on || "").slice(0, 7);
  return parseYearMonthKey(key);
}

function scrollToDataRow(attributeName, value) {
  const targetValue = String(value || "").trim();
  if (!targetValue || typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const rows = Array.from(document.querySelectorAll(`[${attributeName}]`));
      const row = rows.find((item) => item.getAttribute(attributeName) === targetValue);
      row?.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "smooth" });
    });
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

function millisecondsUntilNextLocalDay(now = new Date()) {
  const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 100);
  return Math.max(100, nextDay.getTime() - now.getTime());
}

function yearMonthFromIsoDate(value, fallback = todayIso()) {
  const normalized = normalizeIsoDateKey(value, fallback);
  const [year, month] = normalized.split("-").map((part) => Number(part));
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return currentMonth();
  }
  return { year, month };
}

function isoDateFromUtcDate(value) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeIsoDateKey(value, fallback = todayIso()) {
  const normalized = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : fallback;
}

function yearMonthEndDateKey(value, todayKey = todayIso()) {
  const parsed = {
    year: Number(value?.year),
    month: Number(value?.month),
  };
  if (!Number.isFinite(parsed.year) || !Number.isFinite(parsed.month)) {
    return normalizeIsoDateKey(todayKey);
  }
  const month = Math.max(1, Math.min(12, parsed.month));
  const lastDay = isoDateFromUtcDate(new Date(Date.UTC(parsed.year, month, 0)));
  const normalizedToday = normalizeIsoDateKey(todayKey);
  return lastDay > normalizedToday ? normalizedToday : lastDay;
}

function yearMonthFullDateRange(value, todayKey = todayIso()) {
  const fallbackDate = normalizeIsoDateKey(todayKey);
  const [fallbackYear, fallbackMonth] = fallbackDate.split("-").map((part) => Number(part));
  const parsed = {
    year: Number(value?.year),
    month: Number(value?.month),
  };
  const year = Number.isFinite(parsed.year) ? parsed.year : fallbackYear;
  const month = Number.isFinite(parsed.month) ? Math.max(1, Math.min(12, parsed.month)) : fallbackMonth;
  const monthText = String(month).padStart(2, "0");
  return {
    start: `${year}-${monthText}-01`,
    end: isoDateFromUtcDate(new Date(Date.UTC(year, month, 0))),
  };
}

function recentDateRange(days = 30, todayKey = todayIso()) {
  const end = normalizeIsoDateKey(todayKey);
  const [year, month, day] = end.split("-").map((part) => Number(part));
  const startDate = new Date(Date.UTC(year, month - 1, day - Math.max(0, days - 1)));
  return {
    start: isoDateFromUtcDate(startDate),
    end,
  };
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

function decimalPayload(value) {
  const normalized = stripGrouping(value);
  return normalized || null;
}

function signedAmountPayload(row, amountText) {
  const fallback = decimalPayload(row?.signed_amount);
  const magnitude = String(amountText || fallback || "").replace(/^[+-]/, "");
  if (!magnitude) {
    return fallback;
  }
  return row?.flow_type === "income" ? magnitude : `-${magnitude}`;
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

function hasDecimalSeparatorInput(value) {
  return sanitizeDecimalInput(value).includes(".");
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

function parseAmountFilterNumber(value) {
  const text = stripGrouping(value);
  if (!text) {
    return null;
  }
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
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

function normalizeHoldingTypeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeHoldingSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const usedKeys = new Set();
  const normalizedTypes = Array.isArray(source.types)
    ? source.types
      .map((item, index) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const fallbackKey = `type_${index + 1}`;
        const key = normalizeHoldingTypeKey(item.key || fallbackKey);
        if (!key || usedKeys.has(key)) {
          return null;
        }
        usedKeys.add(key);
        const assetType = ASSET_TYPE_OPTIONS.some((option) => option.value === item.asset_type)
          ? item.asset_type
          : "other";
        const trackedDefault = assetType === "stock" || assetType === "crypto";
        return {
          key,
          label: String(item.label || key).trim() || key,
          asset_type: assetType,
          tracked: Boolean(item.tracked ?? trackedDefault),
          show_average_cost: Boolean(item.show_average_cost ?? true),
          show_gain_loss: Boolean(item.show_gain_loss ?? trackedDefault),
        };
      })
      .filter(Boolean)
    : [];
  const types = normalizedTypes.length > 0 ? normalizedTypes : DEFAULT_HOLDING_TYPES.map((item) => ({ ...item }));
  const normalizeColorMap = (input) => {
    if (!input || typeof input !== "object") {
      return {};
    }
    const next = {};
    for (const [key, color] of Object.entries(input)) {
      const normalizedKey = String(key || "").trim();
      const normalizedColor = String(color || "").trim();
      if (!normalizedKey || !/^#[0-9A-Fa-f]{6}$/.test(normalizedColor)) {
        continue;
      }
      next[normalizedKey] = normalizedColor.toUpperCase();
    }
    return next;
  };
  const categoryOrder = Array.isArray(source.category_order)
    ? source.category_order
      .map((item) => String(item || "").trim())
      .filter(Boolean)
    : [];
  const columnWidths = source.column_widths && typeof source.column_widths === "object"
    ? Object.fromEntries(
      Object.entries(source.column_widths)
        .map(([key, width]) => [String(key || "").trim(), Number(width)])
        .filter(([key, width]) => Boolean(key) && Number.isFinite(width) && width >= 80 && width <= 600)
    )
    : {};
  return {
    types,
    owner_colors: normalizeColorMap(source.owner_colors),
    category_colors: normalizeColorMap(source.category_colors),
    type_colors: normalizeColorMap(source.type_colors),
    category_order: categoryOrder,
    column_widths: columnWidths,
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
    verification_code: "",
    password: "",
    password_confirm: "",
    requires_password_setup: false,
    password_setup_reason: "",
  };
}

function createVerificationMeta() {
  return {
    expiresInSeconds: null,
    expiresAtMs: 0,
    resendLimit: null,
    resendWindowSeconds: null,
    resendCooldownSeconds: null,
    lastResendAt: 0,
    resendUsedCount: 0,
  };
}

function verificationMetaFromPayload(payload, previous = createVerificationMeta(), receivedAt = Date.now()) {
  const seconds = Number(payload?.verification_expires_in_seconds);
  const resendLimit = Number(payload?.verification_resend_limit);
  const resendWindowSeconds = Number(payload?.verification_resend_window_seconds);
  const resendCooldownSeconds = Number(payload?.verification_resend_cooldown_seconds);
  const expiresInSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : previous.expiresInSeconds;
  return {
    ...previous,
    expiresInSeconds,
    expiresAtMs: expiresInSeconds ? receivedAt + expiresInSeconds * 1000 : previous.expiresAtMs,
    resendLimit: Number.isFinite(resendLimit) && resendLimit > 0 ? Math.round(resendLimit) : previous.resendLimit,
    resendWindowSeconds:
      Number.isFinite(resendWindowSeconds) && resendWindowSeconds > 0
        ? Math.round(resendWindowSeconds)
        : previous.resendWindowSeconds,
    resendCooldownSeconds:
      Number.isFinite(resendCooldownSeconds) && resendCooldownSeconds >= 0
        ? Math.round(resendCooldownSeconds)
        : previous.resendCooldownSeconds,
  };
}

function formatDurationKo(totalSeconds) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes <= 0) {
    return `${rest}초`;
  }
  if (rest === 0) {
    return `${minutes}분`;
  }
  return `${minutes}분 ${rest}초`;
}

function createTransactionForm(defaultOccurredOn = todayIso()) {
  return {
    id: "",
    version: 0,
    occurred_on: defaultOccurredOn,
    flow_type: "expense",
    amount: "",
    category_id: "",
    memo: "",
    owner_user_id: "",
    owner_name: "",
    anchor_transaction_id: "",
    insert_position: "",
  };
}

function createTransactionFormErrors() {
  return {
    occurred_on: "",
    amount: "",
  };
}

function createRepeatTransactionForm(previousForm, fallbackOccurredOn = todayIso()) {
  const normalizedDate = normalizeIsoDateKey(previousForm?.occurred_on, fallbackOccurredOn);
  return {
    ...createTransactionForm(normalizedDate),
    flow_type: previousForm?.flow_type || "expense",
    category_id: previousForm?.category_id || "",
    owner_user_id: previousForm?.owner_user_id || "",
    owner_name: previousForm?.owner_name || "",
  };
}

function hasTransactionInsertAnchor(form) {
  return Boolean(form?.anchor_transaction_id || form?.insert_position || form?.anchor_id || form?.mode === "insert");
}

function clearTransactionInsertAnchor(form) {
  if (!hasTransactionInsertAnchor(form)) {
    return form;
  }
  return {
    ...form,
    id: "",
    version: 0,
    anchor_id: "",
    anchor_transaction_id: "",
    insert_position: "",
    mode: "",
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
    case "display_order":
      return Number(item.display_order || 0);
    case "name":
      return String(item.name || "").trim();
    case "owner_name":
      return String(item.owner_name || "").trim().toLowerCase();
    case "type_key":
      return String(item.type_key || item.category || "").trim().toLowerCase();
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
  const payload = {
    occurred_on: String(form.occurred_on || "").trim(),
    flow_type: String(form.flow_type || "").trim(),
    amount: stripGrouping(form.amount),
    category_id: form.category_id || null,
    memo: String(form.memo || ""),
    owner_user_id: normalizeNullableText(form.owner_user_id),
    owner_name: normalizeNullableText(form.owner_name),
  };
  const anchorTransactionId = String(form.anchor_transaction_id || "").trim();
  const insertPosition = String(form.insert_position || "").trim();
  if (anchorTransactionId || insertPosition) {
    payload.anchor_transaction_id = anchorTransactionId || null;
    payload.insert_position = insertPosition || null;
  }
  return payload;
}

function transactionOrderKey(item) {
  const value = Number(item?.order_key);
  return Number.isFinite(value) ? value : 0;
}

function transactionCreatedTime(item) {
  const value = Date.parse(String(item?.created_at || ""));
  return Number.isFinite(value) ? value : 0;
}

function compareTransactionsByLedgerOrder(left, right, dateDirection = 1) {
  const leftDate = String(left?.occurred_on || "");
  const rightDate = String(right?.occurred_on || "");
  if (leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate) * dateDirection;
  }
  const leftOrderKey = transactionOrderKey(left);
  const rightOrderKey = transactionOrderKey(right);
  if (leftOrderKey !== rightOrderKey) {
    return leftOrderKey - rightOrderKey;
  }
  const leftCreated = transactionCreatedTime(left);
  const rightCreated = transactionCreatedTime(right);
  if (leftCreated !== rightCreated) {
    return leftCreated - rightCreated;
  }
  return String(left?.id || "").localeCompare(String(right?.id || ""));
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
  type_key: (left, right) => normalizeNullableText(left) === normalizeNullableText(right),
  market_symbol: (left, right) => String(left || "").trim().toUpperCase() === String(right || "").trim().toUpperCase(),
  name: (left, right) => String(left || "").trim() === String(right || "").trim(),
  category: (left, right) => String(left || "").trim() === String(right || "").trim(),
  owner_user_id: (left, right) => normalizeNullableText(left) === normalizeNullableText(right),
  owner_name: (left, right) => normalizeNullableText(left) === normalizeNullableText(right),
  account_name: (left, right) => normalizeNullableText(left) === normalizeNullableText(right),
  quantity: (left, right) => normalizeDecimalForCompare(left) === normalizeDecimalForCompare(right),
  average_cost: (left, right) => normalizeDecimalForCompare(left) === normalizeDecimalForCompare(right),
  currency: (left, right) => String(left || "").trim().toUpperCase() === String(right || "").trim().toUpperCase(),
  display_order: (left, right) => Number(left || 0) === Number(right || 0),
};

function createHoldingForm(assetType = "cash", typeKey = "", typeLabel = "") {
  const preset = HOLDING_FORM_PRESETS[assetType] || HOLDING_FORM_PRESETS.cash;
  const normalizedTypeKey = normalizeHoldingTypeKey(typeKey || assetType || "cash") || "cash";
  return {
    asset_type: assetType,
    type_key: normalizedTypeKey,
    symbol: "",
    market_symbol: "",
    name: "",
    category: holdingDefaultCategory({ asset_type: assetType, label: typeLabel }),
    owner_user_id: "",
    owner_name: "",
    account_name: "",
    quantity: preset.quantity,
    average_cost: "",
    currency: preset.currency,
  };
}

function holdingPresetCategory(assetType = "other") {
  const preset = HOLDING_FORM_PRESETS[assetType] || HOLDING_FORM_PRESETS.other || HOLDING_FORM_PRESETS.cash;
  return String(preset?.category || "기타").trim() || "기타";
}

function holdingDefaultCategory(typeLike) {
  const assetType = typeof typeLike === "string" ? typeLike : typeLike?.asset_type || "other";
  const label = typeof typeLike === "object" ? String(typeLike?.label || "").trim() : "";
  return label || holdingPresetCategory(assetType);
}

function compactHouseholdSelectOptionName(name, maxLength = 24) {
  const text = String(name || "").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}

function renderBreakableInlineText(value, chunkLength = 8) {
  const text = String(value || "").trim() || "-";
  const chunks = [];
  for (let index = 0; index < text.length; index += chunkLength) {
    chunks.push(text.slice(index, index + chunkLength));
  }
  return chunks.map((chunk, index) => (
    <Fragment key={`${chunk}-${index}`}>
      {index > 0 && <wbr />}
      {chunk}
    </Fragment>
  ));
}

function resolveHoldingCategoryOnTypeChange(currentCategory, previousType, nextType) {
  const normalizedCurrent = String(currentCategory || "").trim();
  if (!normalizedCurrent) {
    return holdingDefaultCategory(nextType);
  }
  const previousDefaults = new Set(
    [
      holdingDefaultCategory(previousType),
      holdingPresetCategory(typeof previousType === "string" ? previousType : previousType?.asset_type || "other"),
    ].filter(Boolean)
  );
  return previousDefaults.has(normalizedCurrent) ? holdingDefaultCategory(nextType) : normalizedCurrent;
}

function holdingAverageCostSemantic(typeLike) {
  const assetType = typeof typeLike === "string" ? typeLike : typeLike?.asset_type || "other";
  const tracked = Boolean(
    typeof typeLike === "object" && typeLike !== null && "tracked" in typeLike
      ? typeLike.tracked
      : isMarketTrackedAssetType(assetType)
  );
  const showAverageCost = Boolean(
    typeof typeLike === "object" && typeLike !== null && "show_average_cost" in typeLike
      ? typeLike.show_average_cost
      : true
  );
  if (!showAverageCost) {
    return "hidden";
  }
  return tracked ? "average-cost" : "valuation";
}

function nextAverageCostForHoldingTypeChange(previousValue, previousType, nextType) {
  const nextSemantic = holdingAverageCostSemantic(nextType);
  if (nextSemantic === "hidden") {
    return "0";
  }
  return holdingAverageCostSemantic(previousType) === nextSemantic ? previousValue : "";
}

function shouldExplainHoldingValueReset(previousValue, previousType, nextType) {
  return Boolean(
    String(previousValue || "").trim() &&
      holdingAverageCostSemantic(previousType) !== holdingAverageCostSemantic(nextType)
  );
}

function holdingValuationInputMode(currency) {
  return String(currency || "KRW").trim().toUpperCase() === "KRW" ? "numeric" : "decimal";
}

function createHoldingInlineEditForm(row) {
  return {
    id: row.id,
    version: row.version,
    asset_type: row.asset_type,
    type_key: normalizeHoldingTypeKey(row.type_key || row.asset_type || "other") || "other",
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
    display_order: Number(row.display_order || 0) || 100,
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

function formatSharePercent(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "0%";
  }
  return `${numeric.toFixed(1)}%`;
}

const DONUT_CUTOUT_PERCENT = 56;
const DONUT_LABEL_RADIUS_PERCENT = 25 * (1 + DONUT_CUTOUT_PERCENT / 100);

function buildDonutSliceLabelMeta(items, { maxLabels = 6 } = {}) {
  const normalizedItems = Array.isArray(items)
    ? items
        .map((item, index) => ({
          index,
          label: String(item?.label || "").trim() || "비중",
          value: Number(item?.value || 0),
        }))
        .filter((item) => Number.isFinite(item.value) && item.value > 0)
    : [];
  const total = normalizedItems.reduce((sum, item) => sum + item.value, 0);
  if (!normalizedItems.length || total <= 0) {
    return [];
  }

  const colors = categoryPalette(normalizedItems.length);
  let cumulativeShare = 0;
  const positionedItems = normalizedItems.map((item, visualIndex) => {
    const share = (item.value / total) * 100;
    const midpointShare = cumulativeShare + share / 2;
    cumulativeShare += share;
    const angle = (midpointShare / 100) * Math.PI * 2 - Math.PI / 2;
    const angleDeg = (angle * 180) / Math.PI;
    const radius = DONUT_LABEL_RADIUS_PERCENT;
    return {
      ...item,
      visualIndex,
      share,
      shareText: formatSharePercent(share),
      color: colors[visualIndex],
      angleDeg,
      radius,
      left: 50 + Math.cos(angle) * radius,
      top: 50 + Math.sin(angle) * radius,
    };
  });

  return positionedItems
    .filter((item) => item.share >= 3 || positionedItems.length <= 3)
    .slice(0, maxLabels);
}

function buildPortfolioChartData(chartSource) {
  if (!chartSource?.items?.length) {
    return null;
  }
  const values = chartSource.items.map((item) => Number(item.value || 0));
  const colors = categoryPalette(chartSource.items.length);
  const isSingleVisibleSlice = values.filter((value) => Number.isFinite(value) && value > 0).length === 1;
  return {
    labels: chartSource.items.map((item) => item.label),
    datasets: [
      {
        data: values,
        backgroundColor: colors,
        ...(isSingleVisibleSlice
          ? {
              borderColor: colors,
              borderWidth: 0,
              hoverBorderWidth: 0,
              spacing: 0,
            }
          : {}),
      },
    ],
  };
}

function buildPortfolioBreakdownItems(chartSource, keyPrefix = "portfolio") {
  const items = chartSource?.items || [];
  const total = items.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const colors = categoryPalette(items.length);
  if (!items.length || total <= 0) {
    return [];
  }
  return items.map((item, index) => {
    const value = Number(item.value || 0);
    const share = total > 0 ? (value / total) * 100 : 0;
    return {
      key: item.key || item.label || `${keyPrefix}-${index}`,
      label: item.label,
      value,
      valueText: fmtKrw(value),
      shareText: formatSharePercent(share),
      color: colors[index],
    };
  });
}

function buildPortfolioChartSourceForMode(
  viewMode,
  { overviewTotals, holdingTypeTotals }
) {
  if (viewMode === "transaction_flow") {
    return {
      title: "거래 유형",
      items: FLOW_TYPE_OPTIONS
        .map((option) => ({
          label: option.label,
          value: Number(overviewTotals?.[option.value] || 0),
        }))
        .filter((item) => Number(item.value) > 0),
    };
  }
  return {
    title: "자산 유형",
    items: holdingTypeTotals || [],
  };
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

function normalizeCategoryFlowType(value) {
  return String(value || "expense").trim() || "expense";
}

function findCompatibleCategoryForFlow(categories, sourceCategory, flowType) {
  if (!sourceCategory) {
    return null;
  }
  const targetFlowType = normalizeCategoryFlowType(flowType);
  const sourceMajor = normalizeCategoryText(sourceCategory.major);
  const sourceMinor = normalizeCategoryText(sourceCategory.minor);
  if (!sourceMajor || !sourceMinor) {
    return null;
  }
  return (
    (categories || []).find((candidate) => {
      if (normalizeCategoryFlowType(candidate?.flow_type) !== targetFlowType) {
        return false;
      }
      return (
        normalizeCategoryText(candidate?.major) === sourceMajor &&
        normalizeCategoryText(candidate?.minor) === sourceMinor
      );
    }) || null
  );
}

function buildCategoryRestoreSnapshot(category) {
  if (!category?.id) {
    return null;
  }
  return {
    flow_type: normalizeCategoryFlowType(category.flow_type),
    category_id: String(category.id || ""),
    category_major: String(category.major || ""),
    label: toCategoryPairLabel(category),
  };
}

function buildTransactionCategoryQuickChips({ categoryOptions, categoryById, flowType, transactionItems }) {
  const normalizedFlowType = String(flowType || "expense").trim() || "expense";
  const usageByCategoryId = new Map();
  const toComparableTime = (item) => {
    const explicitTime = Date.parse(String(item?.updated_at || item?.created_at || ""));
    if (Number.isFinite(explicitTime)) {
      return explicitTime;
    }
    const dateKey = normalizeIsoDateKey(item?.occurred_on, "");
    const dateTime = Date.parse(dateKey);
    return Number.isFinite(dateTime) ? dateTime : 0;
  };

  for (const item of transactionItems || []) {
    if (String(item?.flow_type || "").trim() !== normalizedFlowType) {
      continue;
    }
    const categoryId = String(item?.category_id || "").trim();
    const category = categoryById.get(categoryId);
    if (!category || String(category.flow_type || "").trim() !== normalizedFlowType) {
      continue;
    }
    const occurredOn = normalizeIsoDateKey(item?.occurred_on, "");
    const latestTime = toComparableTime(item);
    const prev = usageByCategoryId.get(categoryId) || { category, count: 0, latestTime: 0, latestDate: "" };
    prev.count += 1;
    if (!prev.latestDate || (occurredOn && occurredOn > prev.latestDate)) {
      prev.latestDate = occurredOn;
      prev.latestTime = latestTime;
    } else if (occurredOn && occurredOn === prev.latestDate) {
      prev.latestTime = Math.max(prev.latestTime, latestTime);
    } else if (!occurredOn) {
      prev.latestTime = Math.max(prev.latestTime, latestTime);
    }
    usageByCategoryId.set(categoryId, prev);
  }

  const recentChips = Array.from(usageByCategoryId.entries())
    .map(([id, info]) => ({
      id,
      label: toCategoryPairLabel(info.category),
      count: info.count,
      latestTime: info.latestTime,
      latestDate: info.latestDate,
    }))
    .sort((left, right) => {
      if (left.latestDate !== right.latestDate) {
        return right.latestDate.localeCompare(left.latestDate);
      }
      if (left.latestTime !== right.latestTime) {
        return right.latestTime - left.latestTime;
      }
      if (left.count !== right.count) {
        return right.count - left.count;
      }
      const labelOrder = left.label.localeCompare(right.label, "ko");
      return labelOrder || left.id.localeCompare(right.id);
    });

  if (recentChips.length > 0) {
    return recentChips.slice(0, 6);
  }

  return [...(categoryOptions || [])]
    .filter((category) => String(category?.id || "").trim())
    .sort((left, right) => {
      const leftOrder = Number(left?.display_order ?? left?.sort_order ?? 0);
      const rightOrder = Number(right?.display_order ?? right?.sort_order ?? 0);
      if (Number.isFinite(leftOrder) && Number.isFinite(rightOrder) && leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      const labelOrder = toCategoryPairLabel(left).localeCompare(toCategoryPairLabel(right), "ko");
      return labelOrder || String(left?.id || "").localeCompare(String(right?.id || ""));
    })
    .slice(0, 6)
    .map((category) => ({
      id: String(category.id || ""),
      label: toCategoryPairLabel(category),
      count: 0,
      latestTime: 0,
      latestDate: "",
    }));
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

function normalizeOwnerName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function isLegacyOwnerIdentity(ownerUserId = "", ownerName = "") {
  return !String(ownerUserId || "").trim() && Boolean(normalizeOwnerName(ownerName));
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
    holding_settings: normalizeHoldingSettings(settingsPayload?.holding_settings),
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
  const majorLabel = toCategoryMajorLabel(category.major);
  const minorLabel = toCategoryMinorLabel(category.minor);
  return (
    <div className="category-cell">
      <span className="category-cell-compact">{majorLabel}{minorLabel ? ` · ${minorLabel}` : ""}</span>
      <span className="category-cell-major">{majorLabel}</span>
      <span className="category-cell-minor">{minorLabel}</span>
    </div>
  );
}

function formatApiError(error, context) {
  const status = Number(error?.status || 0);
  const code = String(error?.code || "").toUpperCase();
  const detail = String(error?.detail || error?.message || error || "").toLowerCase();
  const networkIssue = status >= 500 || detail === "500" || detail.includes("failed to fetch") || detail.includes("network");
  const apiMessage = String(error?.message || "").trim();
  const apiAction = String(error?.action || "").trim();
  const structuredApiMessage = code && apiMessage && !networkIssue ? uiGuideMessage(apiMessage, apiAction) : "";

  if (code === "AUTH_CSRF_ORIGIN_FORBIDDEN") {
    return uiGuideMessage("허용되지 않은 출처(origin) 요청입니다.", "앱을 실행한 프론트엔드 주소가 백엔드 허용 출처에 포함되어 있는지 확인해 주세요.");
  }
  if (code === "AUTH_CSRF_ORIGIN_REQUIRED") {
    return uiGuideMessage("요청 출처를 확인할 수 없습니다.", "브라우저에서 앱을 다시 열고 로그인해 주세요.");
  }
  if (context === "auth_login" && (code === "AUTH_INVALID_CREDENTIALS" || code === "AUTH_USER_NOT_FOUND" || status === 401)) {
    return uiGuideMessage(
      "로그인에 실패했습니다.",
      "이메일과 비밀번호를 확인한 뒤 다시 시도해 주세요. 비밀번호를 잊었다면 관리자에게 재설정을 요청해 주세요."
    );
  }
  if (context === "auth_register" && (code === "AUTH_EMAIL_ALREADY_EXISTS" || status === 409)) {
    return uiGuideMessage("이미 가입된 이메일입니다.", "로그인으로 전환하거나 다른 이메일을 사용해 주세요.");
  }
  if (context === "auth_verify" && code === "AUTH_REGISTRATION_CONTEXT_REQUIRED") {
    return uiGuideMessage(
      "인증 링크를 바로 완료할 수 없습니다.",
      "회원가입을 시작했던 같은 브라우저에서 링크를 열거나, 다시 회원가입을 진행한 뒤 최신 인증 메일을 확인해 주세요."
    );
  }
  if (context === "auth_verify" && code === "AUTH_REGISTRATION_PASSWORD_SETUP_REQUIRED") {
    return registrationPasswordSetupMessage();
  }
  if (context === "auth_verify" && code === "AUTH_VERIFICATION_PASSWORD_REQUIRED") {
    return uiGuideMessage(
      "이 인증 메일은 현재 화면에서 완료할 수 없습니다.",
      "다시 회원가입을 진행한 뒤 새로 받은 최신 인증 메일을 확인해 주세요."
    );
  }
  if (
    context === "auth_verify" &&
    (code === "AUTH_VERIFICATION_TOKEN_INVALID" || code === "REQUEST_VALIDATION_FAILED" || status === 422)
  ) {
    return uiGuideMessage("인증 토큰이 유효하지 않습니다.", "최신 인증 메일의 버튼을 다시 열거나 6자리 인증번호를 입력해 주세요.");
  }
  if (context === "auth_verify" && code === "AUTH_VERIFICATION_CODE_INVALID") {
    return uiGuideMessage("인증번호가 올바르지 않습니다.", "최신 인증 메일의 6자리 숫자를 다시 확인해 주세요.");
  }
  if (context === "auth_verify" && code === "AUTH_VERIFICATION_TOKEN_EXPIRED") {
    return uiGuideMessage("인증 링크 유효기간이 지났습니다.", "인증 메일을 재전송한 뒤 최신 메일의 버튼을 열어 주세요.");
  }
  if (context === "auth_verify" && code === "AUTH_VERIFICATION_CODE_EXPIRED") {
    return uiGuideMessage("인증번호 유효기간이 지났습니다.", "인증 메일을 재전송한 뒤 최신 메일의 6자리 숫자를 입력해 주세요.");
  }
  if (context === "auth_resend" && (code === "AUTH_RESEND_RATE_LIMITED" || status === 429)) {
    return uiGuideMessage("인증 메일 재전송 횟수를 초과했습니다.", "잠시 후 다시 시도해 주세요.");
  }
  if (context === "household_invite_accept") {
    if (code === "HOUSEHOLD_INVITE_EMAIL_MISMATCH" || (!code && status === 403)) {
      return uiGuideMessage("로그인한 이메일과 초대 이메일이 다릅니다.", "초대 받은 이메일로 로그인해 주세요.");
    }
    if (code === "HOUSEHOLD_INVITE_EXPIRED") {
      return uiGuideMessage("초대 토큰이 만료되었습니다.", "초대를 다시 요청해 주세요.");
    }
    if (code === "HOUSEHOLD_INVITE_NOT_FOUND" || status === 404) {
      return uiGuideMessage("초대 정보를 찾을 수 없습니다.", "초대 현황을 새로고침해 주세요.");
    }
    if (code === "HOUSEHOLD_INVITE_INVALID" && apiMessage.includes("이미 처리")) {
      return uiGuideMessage("이미 처리된 초대입니다.", "가계 목록을 새로고침하거나 새 초대를 요청해 주세요.");
    }
    if (
      code === "HOUSEHOLD_INVITE_INVALID" ||
      code === "REQUEST_VALIDATION_FAILED" ||
      status === 400 ||
      status === 422
    ) {
      return uiGuideMessage(
        "초대 토큰이 올바르지 않거나 만료되었습니다.",
        "메일 링크의 token 값을 다시 확인하거나 새 초대를 요청해 주세요."
      );
    }
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
  if (context.startsWith("migration_")) {
    if (code === "MIGRATION_PACKAGE_EXTENSION_INVALID") {
      return uiGuideMessage("이식 패키지 형식이 올바르지 않습니다.", "dev에서 내려받은 ZIP 파일을 다시 선택해 주세요.");
    }
    if (
      code === "MIGRATION_PACKAGE_INVALID_ARCHIVE" ||
      code === "MIGRATION_PACKAGE_INVALID_MANIFEST" ||
      code === "MIGRATION_PACKAGE_INVALID" ||
      code === "MIGRATION_PACKAGE_SCHEMA_UNSUPPORTED" ||
      code === "MIGRATION_PACKAGE_HASH_MISMATCH"
    ) {
      return uiGuideMessage("이식 패키지 검증에 실패했습니다.", "패키지를 다시 추출해 업로드해 주세요.");
    }
    if (code === "MIGRATION_PACKAGE_ARCHIVE_TOO_COMPLEX") {
      return uiGuideMessage("이식 패키지 압축 구조가 복잡해 처리할 수 없습니다.", "패키지를 다시 추출해 업로드해 주세요.");
    }
    if (code === "MIGRATION_APPLY_REPLACE_REQUIRED") {
      return uiGuideMessage("적용 전 기존 데이터 교체 확인이 필요합니다.", "교체 확인 후 다시 적용해 주세요.");
    }
    if (code === "IMPORT_ALREADY_RUNNING" || status === 429) {
      return uiGuideMessage("다른 가져오기/이식 작업이 진행 중입니다.", "잠시 기다린 뒤 다시 시도해 주세요.");
    }
    if (status === 413 || code === "MIGRATION_PACKAGE_TOO_LARGE") {
      return uiGuideMessage("이식 패키지 크기가 제한을 초과했습니다.", "패키지 크기를 줄이거나 분리해서 다시 시도해 주세요.");
    }
    return uiGuideMessage("이식 패키지 처리 중 오류가 발생했습니다.", "파일과 권한을 확인한 뒤 다시 시도해 주세요.");
  }
  if (context === "prices_refresh") {
    if (code === "AUTH_TOKEN_MISSING" || code === "AUTH_TOKEN_INVALID" || status === 401) {
      return uiGuideMessage("시세 갱신 요청에 실패했습니다.", "다시 로그인한 뒤 시도해 주세요.");
    }
    return uiGuideMessage("시세 갱신 요청에 실패했습니다.", "잠시 후 다시 시도해 주세요.");
  }
  if (context === "transaction_submit") {
    if (code === "CATEGORY_INVALID") {
      return uiGuideMessage("거래 저장에 실패했습니다. 카테고리가 유효하지 않습니다.", "카테고리 그룹과 카테고리를 다시 선택해 주세요.");
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
  if (structuredApiMessage) {
    return structuredApiMessage;
  }
  return uiGuideMessage("요청 처리 중 오류가 발생했습니다.", "입력값을 확인한 뒤 다시 시도해 주세요.");
}

function isRegistrationPasswordSetupRequired(error) {
  return String(error?.code || "").toUpperCase() === "AUTH_REGISTRATION_PASSWORD_SETUP_REQUIRED";
}

function registrationPasswordSetupMessage() {
  return uiGuideMessage(
    "다른 브라우저에서 인증 링크를 열었습니다.",
    "회원가입을 시작했던 브라우저와 현재 브라우저가 달라, 이전에 입력한 비밀번호를 보안상 그대로 사용할 수 없습니다. 이 브라우저에서 사용할 비밀번호를 다시 설정해 주세요."
  );
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

function formatMigrationError(error, mode) {
  if (mode === "export") {
    return formatApiError(error, "migration_export");
  }
  const context = mode === "apply" ? "migration_apply" : "migration_dry_run";
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

const MOBILE_FORM_FIELD_SELECTOR = [
  "input:not([type='hidden']):not([type='button']):not([type='submit']):not([type='reset'])",
  "select",
  "textarea",
].join(", ");

function isFocusableFormField(control) {
  return Boolean(
      control &&
      !control.disabled &&
      control.getAttribute("aria-hidden") !== "true" &&
      control.getClientRects().length > 0
  );
}

function isSequentialEnterField(control) {
  return Boolean(isFocusableFormField(control) && control.getAttribute("data-skip-enter-flow") !== "true");
}

function App() {
  const [token, setToken] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState(() => createAuthForm());
  const [verifyForm, setVerifyForm] = useState(() => createVerifyForm());
  const [verificationMeta, setVerificationMeta] = useState(() => createVerificationMeta());
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [saveAccountInfo, setSaveAccountInfo] = useState(() => Boolean(getSavedEmail()));
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [user, setUser] = useState(null);
  const [household, setHousehold] = useState(null);
  const [householdSettings, setHouseholdSettings] = useState(null);
  const [householdRole, setHouseholdRole] = useState("");
  const householdRoleRef = useRef("");
  const autoVerifyTokenRef = useRef("");
  const [householdList, setHouseholdList] = useState([]);
  const [householdMembers, setHouseholdMembers] = useState([]);
  const [householdInvites, setHouseholdInvites] = useState([]);
  const [receivedHouseholdInvites, setReceivedHouseholdInvites] = useState([]);
  const [inviteForm, setInviteForm] = useState({ email: "", role: "viewer" });
  const [inviteFormErrors, setInviteFormErrors] = useState({ email: "" });
  const [inviteAcceptToken, setInviteAcceptToken] = useState("");
  const [inviteAcceptanceNotice, setInviteAcceptanceNotice] = useState(null);
  const [receivedInviteTab, setReceivedInviteTab] = useState("new");
  const [sentInviteTab, setSentInviteTab] = useState("new");
  const [collaborationInvitePulse, setCollaborationInvitePulse] = useState(false);
  const [recentInviteIds, setRecentInviteIds] = useState([]);
  const [categories, setCategories] = useState([]);
  const [profileForm, setProfileForm] = useState(() => createProfileForm(null));
  const [householdSettingsForm, setHouseholdSettingsForm] = useState(() => createHouseholdSettingsForm(null));
  const [categoryDraft, setCategoryDraft] = useState(() => createCategoryDraft());
  const [categoryDraftMajorSelect, setCategoryDraftMajorSelect] = useState("__custom__");
  const [categoryDraftMinorSelect, setCategoryDraftMinorSelect] = useState("__custom__");
  const [categoryQuickSelectedId, setCategoryQuickSelectedId] = useState("");
  const [categoryEditId, setCategoryEditId] = useState("");
  const [categoryEditForm, setCategoryEditForm] = useState({ major: "", minor: "" });
  const [majorRenameDrafts, setMajorRenameDrafts] = useState({});
  const [categoryUsageExpanded, setCategoryUsageExpanded] = useState({});
  const [categoryUsageById, setCategoryUsageById] = useState({});
  const [categoryUsageLoadingId, setCategoryUsageLoadingId] = useState("");
  const [showTxCategoryManager, setShowTxCategoryManager] = useState(false);
  const [showOnboardingGuide, setShowOnboardingGuide] = useState(false);
  const [showTransactionEntryBanner, setShowTransactionEntryBanner] = useState(false);
  const [showTransactionForm, setShowTransactionForm] = useState(false);
  const [showTransactionFilterPanel, setShowTransactionFilterPanel] = useState(false);
  const [transactionFilterFocusTarget, setTransactionFilterFocusTarget] = useState("");
  const [transactionSupportOpen, setTransactionSupportOpen] = useState(false);
  const [txEntrySheetStep, setTxEntrySheetStep] = useState("form");
  const [, setShowTransactionQuickResume] = useState(false);
  const [txRepeatFocusRequest, setTxRepeatFocusRequest] = useState(0);
  const [txQuickOwnerTouched, setTxQuickOwnerTouched] = useState(false);
  const [txDraftTouched, setTxDraftTouched] = useState(false);
  const [showHoldingForm, setShowHoldingForm] = useState(false);
  const [holdingOwnerTouched, setHoldingOwnerTouched] = useState(false);
  const [holdingDraftTouched, setHoldingDraftTouched] = useState(false);
  const [holdingSummaryOpen, setHoldingSummaryOpen] = useState(true);
  const [tab, setTab] = useState(() => getInitialTabId());
  const isCompactViewport = useCompactViewport(MOBILE_BREAKPOINT_PX);
  const [isTransactionLedgerCompactViewport, setIsTransactionLedgerCompactViewport] = useState(() =>
    matchesTransactionLedgerCompactViewport()
  );
  const [socketStatus, setSocketStatus] = useState("disconnected");
  const [dashboardPortfolioViewMode, setDashboardPortfolioViewMode] = useState("holding_type");
  const [holdingTypeFilter, setHoldingTypeFilter] = useState("all");
  const [txFlowBreakdownExpanded, setTxFlowBreakdownExpanded] = useState({
    income: false,
    expense: false,
    investment: false,
  });
  const [transactionsMobileStickyActive, setTransactionsMobileStickyActive] = useState(false);
  const [showTransactionScrollTop, setShowTransactionScrollTop] = useState(false);
  const [selectedTransactionIds, setSelectedTransactionIds] = useState(() => new Set());
  const [expandedTransactionRows, setExpandedTransactionRows] = useState(() => new Set());

  const [filterMode, setFilterMode] = useState("month");
  const [yearMonth, setYearMonth] = useState(currentMonth());
  const [isMonthFilterPending, setIsMonthFilterPending] = useState(false);
  const [range, setRange] = useState(() => yearMonthFullDateRange(currentMonth()));

  const filterModeRef = useRef(filterMode);
  const yearMonthRef = useRef(yearMonth);
  const appliedYearMonthRef = useRef(yearMonth);
  const isMonthFilterPendingRef = useRef(false);
  const rangeRef = useRef(range);
  useEffect(() => { filterModeRef.current = filterMode; }, [filterMode]);
  useEffect(() => { yearMonthRef.current = yearMonth; }, [yearMonth]);
  useEffect(() => { rangeRef.current = range; }, [range]);

  useEffect(() => {
    if (!isCompactViewport) {
      return undefined;
    }

    const handleMobileFormEnter = (event) => {
      if (
        event.defaultPrevented ||
        event.key !== "Enter" ||
        event.shiftKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.isComposing
      ) {
        return;
      }
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.matches(MOBILE_FORM_FIELD_SELECTOR)) {
        return;
      }
      if (target.tagName === "TEXTAREA" && target.getAttribute("enterkeyhint") !== "next") {
        return;
      }
      const form = target.closest("form");
      if (!form) {
        return;
      }
      if (form === txQuickFormRef.current) {
        return;
      }
      const fields = Array.from(form.querySelectorAll(MOBILE_FORM_FIELD_SELECTOR)).filter(isSequentialEnterField);
      const currentIndex = fields.indexOf(target);
      const nextField = fields.slice(currentIndex + 1).find(isSequentialEnterField);
      if (!nextField) {
        return;
      }
      event.preventDefault();
      nextField.focus({ preventScroll: true });
      if (nextField instanceof HTMLInputElement && typeof nextField.select === "function") {
        nextField.select();
      }
    };

    document.addEventListener("keydown", handleMobileFormEnter, true);
    return () => document.removeEventListener("keydown", handleMobileFormEnter, true);
  }, [isCompactViewport]);

  const [overview, setOverview] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [ownerCleanupTransactions, setOwnerCleanupTransactions] = useState([]);
  const [ownerCleanupTransactionsLoaded, setOwnerCleanupTransactionsLoaded] = useState(false);
  const [holdings, setHoldings] = useState([]);
  const [priceStatus, setPriceStatus] = useState(null);
  const [importReport, setImportReport] = useState(null);
  const [recentImportTransactionIds, setRecentImportTransactionIds] = useState(() => new Set());
  const [recentSavedTransactionIds, setRecentSavedTransactionIds] = useState(() => new Set());
  const [recentImportHoldingIds, setRecentImportHoldingIds] = useState(() => new Set());
  const [pendingImportEditTransactionId, setPendingImportEditTransactionId] = useState("");
  const [pendingImportEditHoldingId, setPendingImportEditHoldingId] = useState("");
  const [migrationReport, setMigrationReport] = useState(null);
  const [importReportSearch, setImportReportSearch] = useState("");
  const [importReportSeverityFilter, setImportReportSeverityFilter] = useState("all");
  const [importReportTypeFilter, setImportReportTypeFilter] = useState("all");
  const [importReportSort, setImportReportSort] = useState("row_asc");
  const [ownerRemapTargets, setOwnerRemapTargets] = useState({});
  const [ownerRemappingKey, setOwnerRemappingKey] = useState("");
  const [importMode, setImportMode] = useState("workbook");
  const [tossPreview, setTossPreview] = useState(null);
  const [tossApplyReport, setTossApplyReport] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardLoaded, setDashboardLoaded] = useState(false);
  const [clientVersionState, setClientVersionState] = useState(() =>
    resolveClientVersionState({ bundledVersion: APP_VERSION, serverVersion: APP_VERSION })
  );
  const [importLoadingMode, setImportLoadingMode] = useState("");
  const [migrationLoadingMode, setMigrationLoadingMode] = useState("");
  const [migrationExporting, setMigrationExporting] = useState(false);
  const migrationPackageInputRef = useRef(null);
  const [tossLoadingMode, setTossLoadingMode] = useState("");
  const [priceRefreshPolling, setPriceRefreshPolling] = useState(false);
  const importFileInputRef = useRef(null);
  const tossFileInputRef = useRef(null);
  const dashboardRequestCountRef = useRef(0);
  const transactionLedgerRequestRef = useRef(0);
  const transactionLatestAnchorPendingRef = useRef(tab === "transactions");
  const transactionLatestAnchorSuppressedRef = useRef(false);
  const clientVersionCheckInFlightRef = useRef(false);
  const wsTicketMethodRef = useRef("POST");
  const wsRefreshTimerRef = useRef(null);
  const wsPendingKindsRef = useRef(new Set());
  const priceRefreshOriginRef = useRef("manual");
  const lastAutoRefreshAtRef = useRef(0);
  const priceRefreshRequestInFlightRef = useRef(false);
  const priceRefreshPollFailureCountRef = useRef(0);
  const realtimeFallbackSyncInFlightRef = useRef(false);
  const tabRef = useRef(tab);
  const transactionLocalTodayRef = useRef(todayIso());
  const transactionEntryDefaultDateRef = useRef(todayIso());
  const roleNoticeStateRef = useRef({ householdId: "", role: "" });
  const receivedInviteIdsRef = useRef(new Set());
  const activeDeepLinkFlowRef = useRef({ type: "", token: "" });
  const inviteEmailInputRef = useRef(null);
  const confirmResolveRef = useRef(null);

  const transactionEntryTodayDate = useCallback(() => {
    return normalizeIsoDateKey(transactionLocalTodayRef.current, todayIso());
  }, []);

  const transactionEntryContextDate = useCallback(() => {
    const todayDate = transactionEntryTodayDate();
    if (filterModeRef.current === "month") {
      return yearMonthEndDateKey(appliedYearMonthRef.current || yearMonthRef.current, todayDate);
    }
    return todayDate;
  }, [transactionEntryTodayDate]);

  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: "",
    action: "",
    confirmLabel: "확인",
  });
  const requestConfirmDialog = useCallback(({ title, action, confirmLabel = "확인" }) => {
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
  }, []);

  const [txForm, setTxForm] = useState(() => createTransactionForm());
  const [txFormErrors, setTxFormErrors] = useState(() => createTransactionFormErrors());
  const [txFormSubmitting, setTxFormSubmitting] = useState(false);
  const [txCategoryMajor, setTxCategoryMajor] = useState("");
  const [txCategoryRestore, setTxCategoryRestore] = useState(null);
  const [txListFilter, setTxListFilter] = useState({
    keyword: "",
    flow_type: "all",
    start: "",
    end: "",
    amount_min: "",
    amount_max: "",
  });
  const [txSortDirection, setTxSortDirection] = useState("asc");
  const [holdingListTab, setHoldingListTab] = useState("all");
  const [holdingSummaryViewMode, setHoldingSummaryViewMode] = useState("type");
  const [holdingSortField, setHoldingSortField] = useState(HOLDING_SORT_DEFAULT.field);
  const [holdingSortDirection, setHoldingSortDirection] = useState(HOLDING_SORT_DEFAULT.direction);
  const [holdingColorMode, setHoldingColorMode] = useState("none");
  const [holdingGroupByColor, setHoldingGroupByColor] = useState(false);
  const [holdingColumnWidths, setHoldingColumnWidths] = useState({});
  const [selectedHoldingIds, setSelectedHoldingIds] = useState(() => new Set());
  const [expandedHoldingRows, setExpandedHoldingRows] = useState(() => new Set());
  const [holdingTypeDraft, setHoldingTypeDraft] = useState({
    key: "",
    label: "",
    asset_type: "other",
    tracked: false,
    show_average_cost: true,
    show_gain_loss: false,
  });
  const [holdingTypeEditKey, setHoldingTypeEditKey] = useState("");

  const [holdingForm, setHoldingForm] = useState(() => createHoldingForm("cash"));
  const [holdingInlineEdit, setHoldingInlineEdit] = useState(null);
  const [txInlineEdit, setTxInlineEdit] = useState(null);
  const [txInlineEditSubmitting, setTxInlineEditSubmitting] = useState(false);

  const [importFile, setImportFile] = useState(null);
  const [migrationPackageFile, setMigrationPackageFile] = useState(null);
  const [tossFiles, setTossFiles] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const txDateInputRef = useRef(null);
  const txAmountInputRef = useRef(null);
  const txQuickMemoInputRef = useRef(null);
  const txMemoInputRef = useRef(null);
  const txQuickFormRef = useRef(null);
  const txQuickLastFocusedFieldRef = useRef(null);
  const txQuickFocusScrollTimersRef = useRef([]);
  const holdingNameInputRef = useRef(null);
  const txCategoryManagerRef = useRef(null);
  const transactionSupportDetailsRef = useRef(null);
  const transactionListHeadingRef = useRef(null);
  const transactionListCardRef = useRef(null);
  const transactionStickyToolbarRef = useRef(null);
  const transactionDesktopAddActionRef = useRef(null);
  const transactionFabRef = useRef(null);
  const txInlineEditSubmittingRef = useRef(false);
  const transactionSheetScrollYRef = useRef(0);
  const holdingSheetScrollYRef = useRef(0);
  const holdingEntryActionRef = useRef(null);
  const holdingEntryReturnFocusRef = useRef(null);
  const holdingSummaryCardRef = useRef(null);
  const topbarTabsRef = useRef(null);
  const receivedInviteSectionRef = useRef(null);

  const categoryOptions = useMemo(() => categories.filter((item) => item.flow_type === txForm.flow_type), [categories, txForm.flow_type]);
  const categoryMajorOptions = useMemo(
    () => Array.from(new Set(categoryOptions.map((item) => item.major))),
    [categoryOptions]
  );
  const categoryMinorOptions = useMemo(
    () => categoryOptions.filter((item) => item.major === txCategoryMajor),
    [categoryOptions, txCategoryMajor]
  );
  const categoryById = useMemo(
    () => new Map(categories.map((item) => [String(item.id || ""), item])),
    [categories]
  );
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

  function dismissMessage() {
    setMessage("");
  }

  function switchPublicAuthMode(nextMode) {
    setAuthMode(nextMode);
    setMessage("");
    setAuthForm((prev) => ({
      ...prev,
      password: "",
      password_confirm: "",
      ...(nextMode === "login" ? { display_name: "" } : {}),
    }));
  }

  useEffect(() => {
    const normalizedMessage = String(message || "").trim();
    if (!normalizedMessage) {
      return undefined;
    }
    const requiresUserAttention = /실패|오류|입력|선택|권한|필요|수 없습니다|토큰|비밀번호|먼저|초과|올바르지|유효하지|만료|일치|찾지 못|삭제할|비어/u.test(
      normalizedMessage
    );
    if (requiresUserAttention) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setMessage("");
    }, 3800);
    return () => window.clearTimeout(timer);
  }, [message]);

  function handleTxInlineEditKeyDown(event) {
    if (event.key !== "Enter") {
      return;
    }
    if (event.isComposing || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const targetTag = String(event.target?.tagName || "").toLowerCase();
    if (targetTag === "textarea") {
      return;
    }
    event.preventDefault();
    void submitTxInlineEdit();
  }

  const transactionLedgerItems = transactions;
  const transactionById = useMemo(
    () => new Map(transactionLedgerItems.map((item) => [item.id, item])),
    [transactionLedgerItems]
  );
  const filteredTransactions = useMemo(() => {
    const keyword = normalizeCategoryText(txListFilter.keyword).toLowerCase();
    const amountMin = parseAmountFilterNumber(txListFilter.amount_min);
    const amountMax = parseAmountFilterNumber(txListFilter.amount_max);
    const isAmountFilterActive = amountMin !== null || amountMax !== null;
    return transactionLedgerItems.filter((item) => {
      if (txListFilter.flow_type !== "all" && item.flow_type !== txListFilter.flow_type) {
        return false;
      }
      if (txListFilter.start && String(item.occurred_on) < txListFilter.start) {
        return false;
      }
      if (txListFilter.end && String(item.occurred_on) > txListFilter.end) {
        return false;
      }
      if (isAmountFilterActive) {
        const amount = parseAmountFilterNumber(item.amount);
        if (amount === null) {
          return false;
        }
        if (amountMin !== null && amount < amountMin) {
          return false;
        }
        if (amountMax !== null && amount > amountMax) {
          return false;
        }
      }
      if (!keyword) {
        return true;
      }
      const category = categoryById.get(String(item.category_id || ""));
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
  }, [categoryById, transactionLedgerItems, txListFilter]);
  const sortedTransactions = useMemo(() => {
    const direction = txSortDirection === "asc" ? 1 : -1;
    const next = [...filteredTransactions];
    return next.sort((left, right) => compareTransactionsByLedgerOrder(left, right, direction));
  }, [filteredTransactions, txSortDirection]);
  const txFlowCategorySummary = useMemo(() => {
    const base = {
      income: { total: 0, categories: new Map() },
      expense: { total: 0, categories: new Map() },
      investment: { total: 0, categories: new Map() },
    };
    for (const item of sortedTransactions) {
      const flowType = String(item?.flow_type || "").trim();
      if (!base[flowType]) {
        continue;
      }
      const amount = Number(item?.amount || 0);
      if (!Number.isFinite(amount)) {
        continue;
      }
      base[flowType].total += amount;
      const category = categoryById.get(String(item.category_id || ""));
      const categoryLabel = category ? toCategoryPairLabel(category) : "미분류";
      const prevAmount = Number(base[flowType].categories.get(categoryLabel) || 0);
      base[flowType].categories.set(categoryLabel, prevAmount + amount);
    }
    return Object.entries(base).map(([flowType, info]) => ({
      flowType,
      total: info.total,
      categories: Array.from(info.categories.entries())
        .map(([label, amount]) => ({ label, amount }))
        .sort((left, right) => Number(right.amount) - Number(left.amount)),
    }));
  }, [categoryById, sortedTransactions]);
  const txInlineCategoryQuickChips = useMemo(
    () =>
      buildTransactionCategoryQuickChips({
        categoryOptions: txInlineCategoryOptions,
        categoryById,
        flowType: txInlineEdit?.flow_type,
        transactionItems: transactionLedgerItems,
      }),
    [categoryById, transactionLedgerItems, txInlineCategoryOptions, txInlineEdit?.flow_type]
  );
  const selectedTransactionSummary = useMemo(() => {
    let count = 0;
    let amount = 0;
    for (const transactionId of selectedTransactionIds) {
      const tx = transactionById.get(transactionId);
      if (!tx) {
        continue;
      }
      count += 1;
      const nextAmount = Number(tx.amount || 0);
      if (Number.isFinite(nextAmount)) {
        amount += nextAmount;
      }
    }
    return { count, amount };
  }, [selectedTransactionIds, transactionById]);
  const selectedTransactionItems = useMemo(
    () => Array.from(selectedTransactionIds).map((id) => transactionById.get(id)).filter(Boolean),
    [selectedTransactionIds, transactionById]
  );
  const singleSelectedTransaction = selectedTransactionItems.length === 1 ? selectedTransactionItems[0] : null;
  const isTransactionFilterActive = Boolean(
    String(txListFilter.keyword || "").trim() ||
      txListFilter.flow_type !== "all" ||
      txListFilter.start ||
      txListFilter.end ||
      String(txListFilter.amount_min || "").trim() ||
      String(txListFilter.amount_max || "").trim()
  );
  function clearTxListFilter() {
    setTxListFilter({
      keyword: "",
      flow_type: "all",
      start: "",
      end: "",
      amount_min: "",
      amount_max: "",
    });
  }

  async function revealSavedTransactionInList(transaction, fallbackDate, options = {}) {
    const savedId = String(transaction?.id || "").trim();
    const savedDate = normalizeIsoDateKey(
      transaction?.occurred_on || fallbackDate,
      todayIso()
    );
    const targetMonth = yearMonthFromIsoDate(savedDate, todayIso());
    const targetRange = yearMonthFullDateRange(targetMonth, todayIso());

    clearTxListFilter();
    setRecentSavedTransactionIds(savedId ? new Set([savedId]) : new Set());
    setRecentImportTransactionIds(new Set());
    setRecentImportHoldingIds(new Set());
    setFilterMode("month");
    filterModeRef.current = "month";
    yearMonthRef.current = targetMonth;
    appliedYearMonthRef.current = targetMonth;
    rangeRef.current = targetRange;
    setMonthFilterPending(false);
    setYearMonth(targetMonth);
    setRange(targetRange);

    await refreshData(false, token, { filterMode: "month", yearMonth: targetMonth });
    void options;
    if (savedId) {
      scrollToDataRow("data-transaction-id", savedId);
    }
  }

  const transactionSortSummary = txSortDirection === "asc"
      ? "오래된순"
      : "최신순";
  const areAllFilteredTransactionsSelected = useMemo(() => {
    if (sortedTransactions.length === 0) {
      return false;
    }
    return sortedTransactions.every((item) => selectedTransactionIds.has(item.id));
  }, [selectedTransactionIds, sortedTransactions]);
  const normalizedHoldingSettings = useMemo(
    () => normalizeHoldingSettings(householdSettings?.holding_settings),
    [householdSettings?.holding_settings]
  );
  const holdingTypeOptions = useMemo(() => normalizedHoldingSettings.types || [], [normalizedHoldingSettings.types]);
  const holdingTypeByKey = useMemo(
    () =>
      new Map(
        holdingTypeOptions.map((item) => [
          normalizeHoldingTypeKey(item.key || item.asset_type || "other"),
          item,
        ])
      ),
    [holdingTypeOptions]
  );
  const holdingById = useMemo(() => new Map(holdings.map((item) => [item.id, item])), [holdings]);
  useEffect(() => {
    if (!pendingImportEditTransactionId || tab !== "transactions") {
      return;
    }
    const item = transactionById.get(pendingImportEditTransactionId);
    if (!item) {
      return;
    }
    setTxInlineEdit({
      id: item.id,
      version: item.version,
      occurred_on: item.occurred_on,
      flow_type: item.flow_type,
      amount: normalizeDecimalInputValue(item.amount),
      category_id: item.category_id || "",
      category_major: categoryById.get(String(item.category_id || ""))?.major || "",
      memo: item.memo || "",
      owner_user_id: item.owner_user_id || "",
      owner_name: item.owner_name || "",
    });
    setExpandedTransactionRows((prev) => new Set(prev).add(item.id));
    setPendingImportEditTransactionId("");
    scrollToDataRow("data-transaction-id", item.id);
  }, [categoryById, pendingImportEditTransactionId, tab, transactionById]);
  useEffect(() => {
    if (!pendingImportEditHoldingId || tab !== "holdings") {
      return;
    }
    const row = holdingById.get(pendingImportEditHoldingId);
    if (!row) {
      return;
    }
    setHoldingInlineEdit(createHoldingInlineEditForm(row));
    setExpandedHoldingRows((prev) => new Set(prev).add(row.id));
    setPendingImportEditHoldingId("");
    scrollToDataRow("data-holding-id", row.id);
  }, [holdingById, pendingImportEditHoldingId, tab]);
  const holdingUpdatedAtById = useMemo(
    () => new Map(holdings.map((item) => [item.id, item.updated_at])),
    [holdings]
  );
  const holdingItems = useMemo(() => portfolio?.items || [], [portfolio?.items]);
  const holdingPortfolioById = useMemo(
    () => new Map(holdingItems.map((item) => [item.holding_id, item])),
    [holdingItems]
  );
  const selectedHoldingSummary = useMemo(() => {
    let count = 0;
    let amount = 0;
    for (const holdingId of selectedHoldingIds) {
      const item = holdingPortfolioById.get(holdingId);
      if (!item) {
        continue;
      }
      count += 1;
      const marketValue = Number(item.market_value_krw || 0);
      if (Number.isFinite(marketValue)) {
        amount += marketValue;
      }
    }
    return { count, amount };
  }, [holdingPortfolioById, selectedHoldingIds]);
  const filteredHoldingItems = useMemo(() => {
    return holdingItems.filter((item) => {
      const typeKey = normalizeHoldingTypeKey(item.type_key || item.asset_type || "other") || "other";
      if (holdingTypeFilter !== "all" && typeKey !== holdingTypeFilter) {
        return false;
      }
      if (holdingListTab === "all") {
        return true;
      }
      const cat = String(item.category || "기타").trim() || "기타";
      return cat === holdingListTab;
    });
  }, [holdingItems, holdingListTab, holdingTypeFilter]);
  const sortedHoldingItems = useMemo(() => {
    const direction = holdingSortDirection === "asc" ? 1 : -1;
    const next = [...filteredHoldingItems];
    const ownerColors = normalizedHoldingSettings.owner_colors || {};
    const categoryColors = normalizedHoldingSettings.category_colors || {};
    const typeColors = normalizedHoldingSettings.type_colors || {};
    const colorValueOf = (item) => {
      if (holdingColorMode === "owner") {
        return String(ownerColors[String(item.owner_name || "").trim()] || "").trim();
      }
      if (holdingColorMode === "category") {
        return String(categoryColors[String(item.category || "").trim()] || "").trim();
      }
      if (holdingColorMode === "type") {
        const typeKey = normalizeHoldingTypeKey(item.type_key || item.asset_type || "other") || "other";
        return String(typeColors[typeKey] || "").trim();
      }
      return "";
    };
    return next.sort((left, right) => {
      if (holdingGroupByColor) {
        const leftColor = colorValueOf(left);
        const rightColor = colorValueOf(right);
        const colorCompare = leftColor.localeCompare(rightColor, "ko");
        if (colorCompare !== 0) {
          return colorCompare;
        }
      }
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
  }, [
    filteredHoldingItems,
    holdingColorMode,
    holdingGroupByColor,
    holdingSortDirection,
    holdingSortField,
    holdingUpdatedAtById,
    normalizedHoldingSettings.category_colors,
    normalizedHoldingSettings.owner_colors,
    normalizedHoldingSettings.type_colors,
  ]);
  const dynamicHoldingTabs = useMemo(() => {
    const categories = new Set();
    for (const item of holdingItems) {
      categories.add(String(item.category || "기타").trim() || "기타");
    }
    const tabs = [{ value: "all", label: "전체" }];
    const categoryOrder = normalizedHoldingSettings.category_order || [];
    const orderIndex = new Map(categoryOrder.map((item, index) => [String(item || "").trim(), index]));
    const sortedCategories = Array.from(categories).sort((left, right) => {
      const leftOrder = orderIndex.has(left) ? Number(orderIndex.get(left)) : Number.POSITIVE_INFINITY;
      const rightOrder = orderIndex.has(right) ? Number(orderIndex.get(right)) : Number.POSITIVE_INFINITY;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.localeCompare(right, "ko");
    });
    for (const cat of sortedCategories) {
      tabs.push({ value: cat, label: cat });
    }
    return tabs;
  }, [holdingItems, normalizedHoldingSettings.category_order]);
  const activeHoldingTabLabel = dynamicHoldingTabs.find((item) => item.value === holdingListTab)?.label || "전체";
  const holdingSortSummary = `${getHoldingSortLabel(holdingSortField)} ${holdingSortDirection === "asc" ? "오름차순" : "내림차순"}`;
  const holdingColorModeLabel = {
    none: "색상 기준 없음",
    owner: "보유자 색상",
    category: "카테고리 색상",
    type: "유형 색상",
  }[holdingColorMode] || "색상 기준 없음";
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
    const categoryOrder = normalizedHoldingSettings.category_order || [];
    const orderIndex = new Map(categoryOrder.map((item, index) => [String(item || "").trim(), index]));
    return Array.from(bucket.entries()).sort((left, right) => {
      const leftOrder = orderIndex.has(left[0]) ? Number(orderIndex.get(left[0])) : Number.POSITIVE_INFINITY;
      const rightOrder = orderIndex.has(right[0]) ? Number(orderIndex.get(right[0])) : Number.POSITIVE_INFINITY;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      const leftTotal = left[1].reduce((sum, item) => sum + Number(item.market_value_krw || 0), 0);
      const rightTotal = right[1].reduce((sum, item) => sum + Number(item.market_value_krw || 0), 0);
      return rightTotal - leftTotal;
    });
  }, [holdingListTab, sortedHoldingItems, normalizedHoldingSettings.category_order]);
  const holdingTypeTotals = useMemo(() => {
    const bucket = new Map();
    for (const item of holdingItems) {
      const typeKey = normalizeHoldingTypeKey(item.type_key || item.asset_type || "other") || "other";
      const typeLabel = holdingTypeByKey.get(typeKey)?.label || typeKey;
      const current = bucket.get(typeKey) || { key: typeKey, label: typeLabel, value: 0 };
      bucket.set(typeKey, {
        ...current,
        value: Number(current.value || 0) + Number(item.market_value_krw || 0),
      });
    }
    return Array.from(bucket.values())
      .sort((left, right) => Number(right.value) - Number(left.value));
  }, [holdingItems, holdingTypeByKey]);
  const activeHoldingTypeFilterLabel =
    holdingTypeFilter === "all"
      ? "전체"
      : holdingTypeTotals.find((item) => item.key === holdingTypeFilter)?.label || holdingTypeFilter;
  const holdingListTabAriaLabel =
    holdingTypeFilter === "all"
      ? "자산 목록 분류"
      : `자산 목록 분류, 유형 필터 ${activeHoldingTypeFilterLabel} 적용 중`;
  useEffect(() => {
    if (holdingTypeFilter === "all") {
      return;
    }
    if (!holdingTypeTotals.some((item) => item.key === holdingTypeFilter)) {
      setHoldingTypeFilter("all");
    }
  }, [holdingTypeFilter, holdingTypeTotals]);
  const holdingCategoryTotals = useMemo(() => {
    const bucket = new Map();
    for (const item of holdingItems) {
      const category = String(item.category || "기타").trim() || "기타";
      const current = Number(bucket.get(category) || 0);
      bucket.set(category, current + Number(item.market_value_krw || 0));
    }
    return Array.from(bucket.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((left, right) => Number(right.value) - Number(left.value));
  }, [holdingItems]);
  const holdingOwnerTotals = useMemo(() => {
    const bucket = new Map();
    for (const item of holdingItems) {
      const owner = String(item.owner_name || "미지정").trim() || "미지정";
      const current = Number(bucket.get(owner) || 0);
      bucket.set(owner, current + Number(item.market_value_krw || 0));
    }
    return Array.from(bucket.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((left, right) => Number(right.value) - Number(left.value));
  }, [holdingItems]);
  const holdingOwnerNames = useMemo(
    () =>
      Array.from(
        new Set(
          holdingItems
            .map((item) => String(item.owner_name || "").trim())
            .filter(Boolean)
        )
      ).sort((left, right) => left.localeCompare(right, "ko")),
    [holdingItems]
  );
  const holdingCategoryNames = useMemo(
    () =>
      Array.from(
        new Set(
          holdingItems
            .map((item) => String(item.category || "").trim())
            .filter(Boolean)
        )
      ).sort((left, right) => left.localeCompare(right, "ko")),
    [holdingItems]
  );
  const holdingSummarySource = useMemo(() => {
    if (holdingSummaryViewMode === "category") {
      return {
        title: "자산 분류",
        items: holdingCategoryTotals,
      };
    }
    if (holdingSummaryViewMode === "owner") {
      return {
        title: "보유자",
        items: holdingOwnerTotals,
      };
    }
    return {
      title: "자산 유형",
      items: holdingTypeTotals,
    };
  }, [holdingCategoryTotals, holdingOwnerTotals, holdingSummaryViewMode, holdingTypeTotals]);
  const currentUserId = String(user?.id || "").trim();
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
  const defaultOwnerRemapOption = useMemo(() => {
    if (currentUserId) {
      const currentUserOption = ownerMemberOptions.find((option) => option.value === currentUserId);
      if (currentUserOption) {
        return currentUserOption;
      }
    }
    return ownerMemberOptions[0] || null;
  }, [currentUserId, ownerMemberOptions]);
  const legacyOwnerCleanupRows = useMemo(() => {
    const groups = new Map();
    const transactionSource = ownerCleanupTransactionsLoaded ? ownerCleanupTransactions : transactions;
    const addItem = (kind, item) => {
      const ownerName = normalizeOwnerName(item?.owner_name);
      if (!isLegacyOwnerIdentity(item?.owner_user_id, ownerName)) {
        return;
      }
      const key = ownerName.toLocaleLowerCase("ko-KR");
      const group = groups.get(key) || {
        key,
        ownerName,
        transactions: [],
        holdings: [],
      };
      group[kind].push(item);
      groups.set(key, group);
    };
    transactionSource.forEach((item) => addItem("transactions", item));
    holdings.forEach((item) => addItem("holdings", item));
    return [...groups.values()].sort((left, right) => left.ownerName.localeCompare(right.ownerName, "ko-KR"));
  }, [holdings, ownerCleanupTransactions, ownerCleanupTransactionsLoaded, transactions]);
  const transactionQuickOwnerSuggestion = useMemo(() => {
    if (txQuickOwnerTouched) {
      return null;
    }
    if (txForm.owner_user_id || txForm.owner_name) {
      return null;
    }
    if (ownerMemberOptions.length === 0) {
      return null;
    }

    const currentOwnerOption = currentUserId
      ? ownerMemberOptions.find((option) => option.value === currentUserId)
      : null;
    if (currentOwnerOption) {
      return currentOwnerOption;
    }

    return ownerMemberOptions.length === 1 ? ownerMemberOptions[0] : null;
  }, [currentUserId, ownerMemberOptions, txForm.owner_name, txForm.owner_user_id, txQuickOwnerTouched]);
  const holdingOwnerSuggestion = useMemo(() => {
    if (holdingOwnerTouched) {
      return null;
    }
    if (holdingForm.owner_user_id || holdingForm.owner_name) {
      return null;
    }
    if (ownerMemberOptions.length === 0) {
      return null;
    }

    const currentOwnerOption = currentUserId
      ? ownerMemberOptions.find((option) => option.value === currentUserId)
      : null;
    if (currentOwnerOption) {
      return currentOwnerOption;
    }

    return ownerMemberOptions.length === 1 ? ownerMemberOptions[0] : null;
  }, [currentUserId, holdingForm.owner_name, holdingForm.owner_user_id, holdingOwnerTouched, ownerMemberOptions]);
  const transactionDraftHasContent = Boolean(
    String(stripGrouping(txForm.amount) || "").trim() ||
      String(txForm.memo || "").trim() ||
      String(txForm.category_id || "").trim() ||
      String(txCategoryMajor || "").trim() ||
      String(txForm.flow_type || "expense") !== "expense" ||
      String(txForm.occurred_on || "") !== String(transactionEntryTodayDate()) ||
      (txQuickOwnerTouched && (txForm.owner_user_id || txForm.owner_name))
  );
  const isTransactionEntryDraftDirty = txDraftTouched && transactionDraftHasContent;
  const holdingDraftType =
    holdingTypeByKey.get(normalizeHoldingTypeKey(holdingForm.type_key || holdingForm.asset_type || "")) ||
    holdingTypeOptions[0] ||
    DEFAULT_HOLDING_TYPES[0];
  const holdingDraftDefault = createHoldingForm(
    holdingDraftType?.asset_type || holdingForm.asset_type || "cash",
    holdingDraftType?.key || holdingForm.type_key || "",
    holdingDraftType?.label || ""
  );
  const holdingDraftHasContent = Boolean(
    String(holdingForm.name || "").trim() ||
      String(holdingForm.symbol || "").trim() ||
      String(holdingForm.market_symbol || "").trim() ||
      String(holdingForm.account_name || "").trim() ||
      (holdingOwnerTouched && (holdingForm.owner_user_id || holdingForm.owner_name)) ||
      String(holdingForm.category || "").trim() !== String(holdingDraftDefault.category || "").trim() ||
      normalizeDecimalForCompare(holdingForm.quantity) !== normalizeDecimalForCompare(holdingDraftDefault.quantity) ||
      normalizeDecimalForCompare(holdingForm.average_cost) !== normalizeDecimalForCompare(holdingDraftDefault.average_cost) ||
      String(holdingForm.currency || "").trim().toUpperCase() !==
        String(holdingDraftDefault.currency || "").trim().toUpperCase()
  );
  const isHoldingEntryDraftDirty = holdingDraftTouched && holdingDraftHasContent;
  useEffect(() => {
    setOwnerRemapTargets((prev) => {
      const next = {};
      let changed = Object.keys(prev).length !== legacyOwnerCleanupRows.length;
      for (const row of legacyOwnerCleanupRows) {
        const existing = String(prev[row.key] || "").trim();
        const existingStillValid = ownerMemberOptions.some((option) => option.value === existing);
        const nextValue = existingStillValid ? existing : defaultOwnerRemapOption?.value || "";
        next[row.key] = nextValue;
        if (prev[row.key] !== nextValue) {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [defaultOwnerRemapOption?.value, legacyOwnerCleanupRows, ownerMemberOptions]);
  useEffect(() => {
    if (!token || !household?.id) {
      setOwnerCleanupTransactions([]);
      setOwnerCleanupTransactionsLoaded(false);
      return undefined;
    }
    if (tab !== "import") {
      return undefined;
    }
    let active = true;
    api(`${API_PREFIX}/transactions?limit=3000`, {}, token)
      .then((rows) => {
        if (!active) {
          return;
        }
        setOwnerCleanupTransactions(Array.isArray(rows) ? rows : []);
        setOwnerCleanupTransactionsLoaded(true);
      })
      .catch(() => {
        if (active) {
          setOwnerCleanupTransactionsLoaded(false);
        }
      });
    return () => {
      active = false;
    };
  }, [household?.id, tab, token]);
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
  const categoryDraftFlowItems = useMemo(
    () => categories.filter((item) => item.flow_type === categoryDraft.flow_type),
    [categories, categoryDraft.flow_type]
  );
  const categoryDraftMajorOptions = useMemo(
    () => Array.from(new Set(categoryDraftFlowItems.map((item) => String(item.major || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko")),
    [categoryDraftFlowItems]
  );
  const categoryDraftMinorOptions = useMemo(() => {
    const selectedMajor =
      categoryDraftMajorSelect === "__custom__"
        ? String(categoryDraft.major || "").trim()
        : String(categoryDraftMajorSelect || "").trim();
    if (!selectedMajor) {
      return [];
    }
    return Array.from(
      new Set(
        categoryDraftFlowItems
          .filter((item) => String(item.major || "").trim() === selectedMajor)
          .map((item) => String(item.minor || "").trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b, "ko"));
  }, [categoryDraft.major, categoryDraftMajorSelect, categoryDraftFlowItems]);
  const categoryQuickOptions = useMemo(
    () =>
      categoryDraftFlowItems
        .map((item) => ({
          id: item.id,
          label: `${toCategoryMajorLabel(item.major)} / ${toCategoryMinorLabel(item.minor)}`,
        }))
        .sort((left, right) => left.label.localeCompare(right.label, "ko")),
    [categoryDraftFlowItems]
  );
  const selectedQuickCategory = useMemo(
    () => categories.find((item) => String(item.id) === String(categoryQuickSelectedId)) || null,
    [categories, categoryQuickSelectedId]
  );
  const categoryDraftGuideText = useMemo(() => {
    const majorGuide =
      categoryDraftMajorSelect === "__custom__"
        ? "새 대분류를 만들려면 아래 입력칸에 이름을 적으세요."
        : `현재 저장된 대분류 '${toCategoryMajorLabel(categoryDraftMajorSelect)}' 아래에 중분류를 추가합니다.`;
    const minorGuide =
      categoryDraftMinorSelect === "__custom__"
        ? "첫 중분류는 아래 입력칸에 직접 적어 새 조합을 만듭니다."
        : "드롭다운은 현재 보유한 중분류 목록을 보여줍니다. 새 이름을 만들려면 '직접 입력'을 선택하세요.";
    return `${majorGuide} ${minorGuide}`;
  }, [categoryDraftMajorSelect, categoryDraftMinorSelect]);
  const categoryDraftSummaryText = useMemo(() => {
    const flowLabel = FLOW_TYPE_LABELS[categoryDraft.flow_type] || categoryDraft.flow_type;
    const majorLabel = String(categoryDraft.major || "").trim() ? toCategoryMajorLabel(categoryDraft.major) : "대분류 입력 대기";
    const minorLabel = String(categoryDraft.minor || "").trim() ? toCategoryMinorLabel(categoryDraft.minor) : "중분류 입력 대기";
    return `${flowLabel} / ${majorLabel} / ${minorLabel}`;
  }, [categoryDraft.flow_type, categoryDraft.major, categoryDraft.minor]);
  const categoryQuickActionText = useMemo(() => {
    if (!selectedQuickCategory) {
      return "기존 카테고리를 선택하면 아래 버튼으로 바로 수정하거나 삭제할 수 있습니다.";
    }
    const usageCount = Number(selectedQuickCategory.usage_count || 0);
    return `선택됨: ${toCategoryPairLabel(selectedQuickCategory)} · 사용 ${usageCount}건${usageCount > 0 ? " · 사용 중인 항목은 삭제 버튼이 비활성화됩니다." : ""}`;
  }, [selectedQuickCategory]);
  const categoryQuickSelectionInUse = Number(selectedQuickCategory?.usage_count || 0) > 0;
  const importMismatchPreview = useMemo(
    () => (importReport?.detected_mismatch_cells || []).slice(0, IMPORT_MISMATCH_PREVIEW_LIMIT),
    [importReport]
  );
  const importIssuePreview = useMemo(
    () => (importReport?.issues || []).slice(0, IMPORT_ISSUE_PREVIEW_LIMIT),
    [importReport]
  );
  const importReportRows = useMemo(() => normalizeImportReportRows(importReport), [importReport]);
  const importAppliedTransactionRefs = useMemo(
    () => normalizeImportAppliedTransactionRefs(importReport),
    [importReport]
  );
  const importAppliedHoldingRefs = useMemo(
    () => normalizeImportAppliedHoldingRefs(importReport),
    [importReport]
  );
  const hasImportPostApplyTargets = importAppliedTransactionRefs.length > 0 || importAppliedHoldingRefs.length > 0;
  const importReportSeverityOptions = useMemo(
    () =>
      Array.from(new Set(importReportRows.map((row) => row.severity)))
        .filter(Boolean)
        .map((severity) => ({ value: severity, label: formatImportReportSeverity(severity) })),
    [importReportRows]
  );
  const importReportTypeOptions = useMemo(
    () =>
      Array.from(new Map(importReportRows.map((row) => [row.type, row.typeLabel])).entries())
        .map(([value, label]) => ({ value, label }))
        .sort((left, right) => left.label.localeCompare(right.label, "ko")),
    [importReportRows]
  );
  const importReportVisibleRows = useMemo(() => {
    const query = importReportSearch.trim().toLowerCase();
    const filteredRows = importReportRows.filter((row) => {
      const matchesSearch = !query || row.searchText.includes(query);
      const matchesSeverity = importReportSeverityFilter === "all" || row.severity === importReportSeverityFilter;
      const matchesType = importReportTypeFilter === "all" || row.type === importReportTypeFilter;
      return matchesSearch && matchesSeverity && matchesType;
    });
    return sortImportReportRows(filteredRows, importReportSort);
  }, [importReportRows, importReportSearch, importReportSeverityFilter, importReportSort, importReportTypeFilter]);
  const importReportCsv = useMemo(() => formatImportReportCsv(importReportVisibleRows), [importReportVisibleRows]);
  const migrationIssuePreview = useMemo(
    () => (migrationReport?.issues || []).slice(0, IMPORT_ISSUE_PREVIEW_LIMIT),
    [migrationReport]
  );
  const tossRows = tossPreview?.rows || [];
  const tossExcludedCandidates = tossPreview?.excluded_candidates || [];
  const tossIncludedCount = tossRows.filter((row) => row.included).length;
  const tossDuplicateCount = tossRows.filter((row) => row.duplicate_group_id).length;

  useEffect(() => {
    setImportReportSearch("");
    setImportReportSeverityFilter("all");
    setImportReportTypeFilter("all");
    setImportReportSort("row_asc");
  }, [importReport]);

  useEffect(() => {
    setProfileForm(createProfileForm(user));
  }, [user?.id, user?.real_name, user?.nickname, user?.display_name_mode, user?.display_name]);

  useEffect(() => {
    setHouseholdSettingsForm(createHouseholdSettingsForm(householdSettings));
  }, [
    householdSettings?.household_id,
    householdSettings?.name,
    JSON.stringify(householdSettings?.transaction_row_colors || {}),
    JSON.stringify(householdSettings?.holding_settings || {}),
  ]);

  useEffect(() => {
    const nextHouseholdId = String(household?.id || "").trim();
    const nextRole = String(householdRole || "").trim();
    const previous = roleNoticeStateRef.current;
    if (token && nextHouseholdId && nextRole && previous.householdId === nextHouseholdId && previous.role && previous.role !== nextRole) {
      setMessage(
        uiGuideMessage(
          "내 권한이 변경되었습니다.",
          `현재 권한: ${COLLAB_ROLE_LABELS[nextRole] || nextRole || "-"}`,
        ),
      );
    }
    roleNoticeStateRef.current = {
      householdId: nextHouseholdId,
      role: nextRole,
    };
  }, [household?.id, householdRole, token]);

  useEffect(() => {
    const canShowOnboardingGuide = householdRole === "owner" || householdRole === "co_owner" || householdRole === "editor";
    if (!user?.id || !household?.id || !canShowOnboardingGuide) {
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
  }, [user?.id, household?.id, householdRole, transactions.length, holdings.length]);

  useEffect(() => {
    if (transactions.length > 0) {
      setShowTransactionEntryBanner(false);
    }
  }, [transactions.length]);

  useEffect(() => {
    setSelectedTransactionIds((prev) => {
      const next = new Set([...prev].filter((transactionId) => transactionById.has(transactionId)));
      if (next.size === prev.size) {
        return prev;
      }
      return next;
    });
  }, [transactionById]);

  useEffect(() => {
    setExpandedTransactionRows((prev) => {
      const next = new Set([...prev].filter((transactionId) => transactionById.has(transactionId)));
      if (next.size === prev.size) {
        return prev;
      }
      return next;
    });
  }, [transactionById]);

  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);

  function setMonthFilterPending(nextValue) {
    const normalized = Boolean(nextValue);
    isMonthFilterPendingRef.current = normalized;
    setIsMonthFilterPending(normalized);
  }

  useEffect(() => {
    const nextDefaultDate = transactionEntryTodayDate();
    const previousDefaultDate = transactionEntryDefaultDateRef.current || transactionEntryTodayDate();
    transactionEntryDefaultDateRef.current = nextDefaultDate;
    setTxForm((prev) => {
      const pristineDefaultDraft =
        !txDraftTouched &&
        !hasTransactionInsertAnchor(prev) &&
        !prev.amount &&
        !prev.memo &&
        (!prev.occurred_on || prev.occurred_on === previousDefaultDate);
      if (!pristineDefaultDraft || prev.occurred_on === nextDefaultDate) {
        return prev;
      }
      return { ...prev, occurred_on: nextDefaultDate };
    });
  }, [transactionEntryTodayDate, txDraftTouched]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    let timeoutId = 0;
    const syncLocalToday = () => {
      const nextToday = todayIso();
      const previousLocalToday = normalizeIsoDateKey(transactionLocalTodayRef.current, nextToday);
      if (nextToday === previousLocalToday) {
        return;
      }
      transactionLocalTodayRef.current = nextToday;
      const previousMonth = yearMonthFromIsoDate(previousLocalToday, previousLocalToday);
      const nextMonth = yearMonthFromIsoDate(nextToday, nextToday);
      if (
        filterModeRef.current === "month" &&
        compareYearMonth(previousMonth, nextMonth) !== 0 &&
        compareYearMonth(appliedYearMonthRef.current, previousMonth) === 0
      ) {
        yearMonthRef.current = nextMonth;
        appliedYearMonthRef.current = nextMonth;
        setMonthFilterPending(false);
        setYearMonth(nextMonth);
        refreshDataWithUiFeedback({ filterMode: "month", yearMonth: nextMonth }).catch(() => undefined);
      }
      setTxForm((prev) => {
        const draftDate = normalizeIsoDateKey(prev.occurred_on, "");
        const canAdvanceDefaultDraft =
          !txDraftTouched &&
          draftDate === previousLocalToday &&
          !prev.amount &&
          !prev.memo &&
          !hasTransactionInsertAnchor(prev);
        if (!canAdvanceDefaultDraft) {
          return prev;
        }
        return { ...prev, occurred_on: nextToday };
      });
    };
    const scheduleNextDayCheck = () => {
      timeoutId = window.setTimeout(() => {
        syncLocalToday();
        scheduleNextDayCheck();
      }, millisecondsUntilNextLocalDay());
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        syncLocalToday();
      }
    };
    syncLocalToday();
    scheduleNextDayCheck();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txDraftTouched]);

  useEffect(() => {
    setSelectedHoldingIds((prev) => {
      const next = new Set([...prev].filter((holdingId) => holdingPortfolioById.has(holdingId)));
      if (next.size === prev.size) {
        return prev;
      }
      return next;
    });
  }, [holdingPortfolioById]);

  useEffect(() => {
    setExpandedHoldingRows((prev) => {
      const next = new Set([...prev].filter((holdingId) => holdingPortfolioById.has(holdingId)));
      if (next.size === prev.size) {
        return prev;
      }
      return next;
    });
  }, [holdingPortfolioById]);

  useEffect(() => {
    setHoldingColumnWidths(normalizedHoldingSettings.column_widths || {});
  }, [JSON.stringify(normalizedHoldingSettings.column_widths || {})]);

  useLayoutEffect(() => {
    if (!showTransactionForm) {
      return undefined;
    }
    let cancelled = false;
    let frameId = 0;
    let timeoutId = 0;
    const focusEntryTarget = () => {
      if (cancelled) {
        return;
      }
      const focusTarget = txEntrySheetStep === "form" ? txAmountInputRef.current : txDateInputRef.current;
      if (!focusTarget || focusTarget.disabled) {
        return;
      }
      txQuickLastFocusedFieldRef.current = focusTarget;
      focusTarget?.focus?.({ preventScroll: true });
      if (focusTarget === txAmountInputRef.current) {
        setShowTransactionQuickResume(false);
      }
    };
    focusEntryTarget();
    frameId = requestAnimationFrame(focusEntryTarget);
    timeoutId = window.setTimeout(focusEntryTarget, 0);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [isCompactViewport, showTransactionForm, txEntrySheetStep]);

  useEffect(() => {
    if (!txRepeatFocusRequest || loading || !showTransactionForm || txEntrySheetStep !== "form") {
      return undefined;
    }

    let cancelled = false;
    let timeoutId = 0;
    let frameId = requestAnimationFrame(() => {
      timeoutId = window.setTimeout(() => {
        if (cancelled) {
          return;
        }
        const amountInput = txAmountInputRef.current;
        if (!amountInput || amountInput.disabled) {
          return;
        }
        txQuickLastFocusedFieldRef.current = amountInput;
        amountInput.focus?.({ preventScroll: true });
        amountInput.select?.();
        if (document.activeElement === amountInput) {
          setShowTransactionQuickResume(false);
        }
      }, 0);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [loading, showTransactionForm, txEntrySheetStep, txRepeatFocusRequest]);

  useEffect(() => {
    if (!isCompactViewport || !showTransactionForm || txEntrySheetStep !== "form") {
      return undefined;
    }

    const isQuickRestorableField = (element) => {
      const quickForm = txQuickFormRef.current;
      return Boolean(
        quickForm &&
        element instanceof HTMLElement &&
        quickForm.contains(element) &&
        element.matches(MOBILE_FORM_FIELD_SELECTOR) &&
        isFocusableFormField(element)
      );
    };

    const restoreQuickFieldFocus = () => {
      requestAnimationFrame(() => {
        const rememberedField = txQuickLastFocusedFieldRef.current;
        const focusTarget = isQuickRestorableField(rememberedField)
          ? rememberedField
          : isQuickRestorableField(txAmountInputRef.current)
            ? txAmountInputRef.current
            : null;
        if (!focusTarget) {
          return;
        }
        focusTarget.focus?.({ preventScroll: true });
        const focusRestored = document.activeElement === focusTarget;
        if (focusRestored) {
          txQuickLastFocusedFieldRef.current = focusTarget;
        }
        setShowTransactionQuickResume(!focusRestored);
      });
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        setShowTransactionQuickResume(true);
        return;
      }
      restoreQuickFieldFocus();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", restoreQuickFieldFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", restoreQuickFieldFocus);
    };
  }, [isCompactViewport, showTransactionForm, txEntrySheetStep]);

  useEffect(() => {
    if (
      !showTransactionForm ||
      txEntrySheetStep !== "form" ||
      txQuickOwnerTouched ||
      !transactionQuickOwnerSuggestion ||
      txForm.owner_user_id ||
      txForm.owner_name
    ) {
      return;
    }

    setTxForm((prev) => {
      if (prev.owner_user_id || prev.owner_name) {
        return prev;
      }
      return {
        ...prev,
        owner_user_id: transactionQuickOwnerSuggestion.value,
        owner_name: transactionQuickOwnerSuggestion.displayName || "",
      };
    });
  }, [
    showTransactionForm,
    transactionQuickOwnerSuggestion,
    txEntrySheetStep,
    txForm.owner_name,
    txForm.owner_user_id,
    txQuickOwnerTouched,
  ]);

  useEffect(() => {
    if (
      !showHoldingForm ||
      holdingOwnerTouched ||
      !holdingOwnerSuggestion ||
      holdingForm.owner_user_id ||
      holdingForm.owner_name
    ) {
      return;
    }

    setHoldingForm((prev) => {
      if (prev.owner_user_id || prev.owner_name) {
        return prev;
      }
      return {
        ...prev,
        owner_user_id: holdingOwnerSuggestion.value,
        owner_name: holdingOwnerSuggestion.displayName || "",
      };
    });
  }, [
    holdingForm.owner_name,
    holdingForm.owner_user_id,
    holdingOwnerSuggestion,
    holdingOwnerTouched,
    showHoldingForm,
  ]);

  useEffect(() => {
    if (!showHoldingForm) {
      return;
    }
    requestAnimationFrame(() => {
      holdingNameInputRef.current?.focus?.();
    });
  }, [showHoldingForm]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    const mediaQuery = window.matchMedia(
      `(max-width: ${MOBILE_BREAKPOINT_PX}px), (max-width: ${TRANSACTION_LEDGER_LANDSCAPE_BREAKPOINT_PX}px) and (max-height: ${TRANSACTION_LEDGER_LANDSCAPE_MAX_HEIGHT_PX}px)`
    );
    const syncLedgerViewportMode = () => {
      setIsTransactionLedgerCompactViewport(matchesTransactionLedgerCompactViewport());
    };
    syncLedgerViewportMode();
    window.addEventListener("resize", syncLedgerViewportMode);
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncLedgerViewportMode);
      return () => {
        window.removeEventListener("resize", syncLedgerViewportMode);
        mediaQuery.removeEventListener("change", syncLedgerViewportMode);
      };
    }
    mediaQuery.addListener(syncLedgerViewportMode);
    return () => {
      window.removeEventListener("resize", syncLedgerViewportMode);
      mediaQuery.removeListener(syncLedgerViewportMode);
    };
  }, []);


  useLayoutEffect(() => {
    if (typeof window === "undefined" || tab !== "transactions") {
      return undefined;
    }

    const listCard = transactionListCardRef.current;
    const toolbar = transactionStickyToolbarRef.current;
    if (!listCard || !toolbar) {
      return undefined;
    }

    let frameId = 0;
    const applyStickyGeometry = () => {
      const toolbarHeight = Math.ceil(toolbar.getBoundingClientRect().height);
      if (!Number.isFinite(toolbarHeight) || toolbarHeight <= 0) {
        return;
      }
      listCard.style.setProperty("--transaction-toolbar-sticky-height", `${toolbarHeight}px`);
      listCard.style.setProperty("--surface-heading-sticky-height", `${toolbarHeight + 4}px`);
    };
    const scheduleStickyGeometry = () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        applyStickyGeometry();
      });
    };

    applyStickyGeometry();

    const resizeObserver =
      typeof window.ResizeObserver === "function" ? new window.ResizeObserver(scheduleStickyGeometry) : null;
    resizeObserver?.observe(toolbar);
    window.addEventListener("resize", scheduleStickyGeometry);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleStickyGeometry);
    };
  }, [
    tab,
    showTransactionFilterPanel,
    selectedTransactionSummary.count,
    selectedTransactionSummary.amount,
    transactionSortSummary,
    isTransactionFilterActive,
    sortedTransactions.length,
  ]);

  useEffect(() => {
    if (!isTransactionLedgerCompactViewport || tab !== "transactions") {
      setTransactionsMobileStickyActive(false);
      return undefined;
    }
    const updateStickyState = () => {
      const listCard = transactionListCardRef.current;
      const ledgerHead = listCard?.querySelector(".transactions-mobile-ledger-head");
      if (!listCard) {
        setTransactionsMobileStickyActive(false);
        return;
      }
      const threshold = 88;
      const listCardRect = listCard.getBoundingClientRect();
      const ledgerRect = ledgerHead?.getBoundingClientRect();
      const nextActive =
        window.scrollY > 16 &&
        listCardRect.top <= threshold + 160 &&
        (ledgerRect?.top ?? Number.POSITIVE_INFINITY) <= threshold + 180 &&
        listCardRect.bottom >= threshold + 180;
      setTransactionsMobileStickyActive(nextActive);
    };
    updateStickyState();
    window.addEventListener("scroll", updateStickyState, { passive: true });
    window.addEventListener("resize", updateStickyState);
    return () => {
      window.removeEventListener("scroll", updateStickyState);
      window.removeEventListener("resize", updateStickyState);
    };
  }, [isTransactionLedgerCompactViewport, tab, sortedTransactions.length]);

  useEffect(() => {
    if (typeof window === "undefined" || tab !== "transactions") {
      setShowTransactionScrollTop(false);
      return undefined;
    }
    let frameId = 0;
    const updateScrollTopAffordance = () => {
      if (frameId) {
        return;
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        const listCard = transactionListCardRef.current;
        const listRect = listCard?.getBoundingClientRect();
        const listStillVisible = Boolean(listRect && listRect.bottom > window.innerHeight * 0.34);
        setShowTransactionScrollTop(sortedTransactions.length > 8 && window.scrollY > 280 && listStillVisible);
      });
    };
    updateScrollTopAffordance();
    window.addEventListener("scroll", updateScrollTopAffordance, { passive: true });
    window.addEventListener("resize", updateScrollTopAffordance);
    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      window.removeEventListener("scroll", updateScrollTopAffordance);
      window.removeEventListener("resize", updateScrollTopAffordance);
    };
  }, [tab, sortedTransactions.length]);

  function scrollTransactionListToTop() {
    const target = transactionListCardRef.current || transactionStickyToolbarRef.current;
    if (!target || typeof target.scrollIntoView !== "function") {
      return;
    }
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    target.scrollIntoView({ block: "start", inline: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  }

  function toggleTxSortDirection() {
    setTxSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
  }

  const clearTransactionQuickFocusScrollTimers = useCallback(() => {
    if (typeof window === "undefined") {
      txQuickFocusScrollTimersRef.current = [];
      return;
    }
    for (const timerId of txQuickFocusScrollTimersRef.current) {
      window.clearTimeout(timerId);
    }
    txQuickFocusScrollTimersRef.current = [];
  }, []);

  const clearTransactionEntryValidationFeedback = useCallback(() => {
    const validationMessages = new Set(
      [txFormErrors.occurred_on, txFormErrors.amount]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    );

    setTxFormErrors(createTransactionFormErrors());
    setMessage((prev) => {
      const normalized = String(prev || "").trim();
      return normalized && validationMessages.has(normalized) ? "" : prev;
    });
  }, [txFormErrors.amount, txFormErrors.occurred_on]);

  function openTransactionEntrySheet(nextStep = "form") {
    if (loading) {
      return;
    }
    transactionSheetScrollYRef.current = typeof window !== "undefined" ? window.scrollY : 0;
    clearTransactionEntryValidationFeedback();
    setTxEntrySheetStep(nextStep);
    setShowTransactionForm(true);
  }

  function openNormalTransactionEntrySheet(nextStep = "form") {
    if (isTransactionEntryDraftDirty) {
      setTxForm((previous) => clearTransactionInsertAnchor(previous));
    } else {
      setTxForm(createTransactionForm(transactionEntryTodayDate()));
      setTxFormErrors(createTransactionFormErrors());
      setTxCategoryMajor("");
      setTxCategoryRestore(null);
      setTxDraftTouched(false);
      setShowTransactionQuickResume(false);
      setTxQuickOwnerTouched(false);
    }
    openTransactionEntrySheet(nextStep);
  }

  const closeTransactionEntrySheet = useCallback(async ({ skipDraftGuard = false } = {}) => {
    if (!skipDraftGuard && txEntrySheetStep === "form" && isTransactionEntryDraftDirty) {
      const confirmed = await requestConfirmDialog({
        title: "거래 입력을 닫을까요?",
        action: "작성 중인 거래 초안은 보존됩니다. 닫으면 목록으로 돌아가고 다시 열어 이어서 입력할 수 있습니다.",
        confirmLabel: "입력 닫기",
      });
      if (!confirmed) {
        return false;
      }
    }
    const restoreScrollY = transactionSheetScrollYRef.current;
    clearTransactionEntryValidationFeedback();
    setShowTransactionForm(false);
    setTxEntrySheetStep("form");
    setShowTransactionQuickResume(false);
    clearTransactionQuickFocusScrollTimers();
    window.setTimeout(() => {
      window.scrollTo({ top: restoreScrollY, behavior: "auto" });
      const trigger = isCompactViewport ? transactionFabRef.current : transactionDesktopAddActionRef.current ?? transactionFabRef.current;
      trigger?.focus?.({ preventScroll: true });
    }, 0);
    return true;
  }, [
    clearTransactionEntryValidationFeedback,
    clearTransactionQuickFocusScrollTimers,
    isCompactViewport,
    isTransactionEntryDraftDirty,
    requestConfirmDialog,
    txEntrySheetStep,
  ]);

  useEffect(() => {
    if (!showTransactionForm) {
      return undefined;
    }
    const handleTransactionEntryEscape = (event) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      closeTransactionEntrySheet();
    };
    document.addEventListener("keydown", handleTransactionEntryEscape);
    return () => document.removeEventListener("keydown", handleTransactionEntryEscape);
  }, [showTransactionForm, closeTransactionEntrySheet]);

  function resetTransactionDraft() {
    setTxForm(createTransactionForm(transactionEntryTodayDate()));
    setTxFormErrors(createTransactionFormErrors());
    setTxCategoryMajor("");
    setTxCategoryRestore(null);
    setTxDraftTouched(false);
    setShowTransactionQuickResume(false);
    setTxQuickOwnerTouched(false);
    if (isCompactViewport && showTransactionForm) {
      focusTransactionQuickAmount();
    }
  }

  function focusTransactionQuickAmount() {
    txQuickLastFocusedFieldRef.current = txAmountInputRef.current;
    requestAnimationFrame(() => {
      txAmountInputRef.current?.focus?.({ preventScroll: true });
      if (document.activeElement === txAmountInputRef.current) {
        setShowTransactionQuickResume(false);
      }
    });
  }

  function focusTransactionAmountForRepeatEntry() {
    setTxRepeatFocusRequest((current) => current + 1);
  }

  function clearTransactionFormError(field) {
    setTxFormErrors((prev) => (prev[field] ? { ...prev, [field]: "" } : prev));
  }

  function focusFirstTransactionFormError(errors) {
    const target = errors.occurred_on ? txDateInputRef.current : errors.amount ? txAmountInputRef.current : null;
    requestAnimationFrame(() => {
      target?.focus?.({ preventScroll: true });
    });
  }

  function isTransactionQuickRestorableField(element) {
    const quickForm = txQuickFormRef.current;
    return Boolean(
      quickForm &&
      element instanceof HTMLElement &&
      quickForm.contains(element) &&
      element.matches(MOBILE_FORM_FIELD_SELECTOR) &&
      isFocusableFormField(element)
    );
  }

  function keepTransactionQuickFieldVisible(element) {
    clearTransactionQuickFocusScrollTimers();
    if (typeof window === "undefined" || !(element instanceof HTMLElement)) {
      return;
    }
    const quickForm = txQuickFormRef.current;
    const primaryStack = quickForm?.querySelector(".transaction-quick-primary-stack");
    if (!(primaryStack instanceof HTMLElement) || !primaryStack.contains(element)) {
      return;
    }

    const revealFocusedField = () => {
      if (!txQuickFormRef.current?.contains(element) || !primaryStack.contains(element)) {
        return;
      }
      const targetRect = element.getBoundingClientRect();
      const stackRect = primaryStack.getBoundingClientRect();
      if (!targetRect.height || !stackRect.height) {
        return;
      }

      const margin = 8;
      const topOverflow = stackRect.top + margin - targetRect.top;
      if (topOverflow > 0) {
        primaryStack.scrollTop -= topOverflow;
        return;
      }

      const bottomOverflow = targetRect.bottom - (stackRect.bottom - margin);
      if (bottomOverflow > 0) {
        primaryStack.scrollTop += bottomOverflow;
      }
    };

    revealFocusedField();
    txQuickFocusScrollTimersRef.current = [
      window.setTimeout(revealFocusedField, 0),
      window.setTimeout(revealFocusedField, 80),
    ];
  }

  function rememberTransactionQuickField(element) {
    if (isTransactionQuickRestorableField(element)) {
      txQuickLastFocusedFieldRef.current = element;
    }
  }

  function handleTransactionQuickFieldFocus(element) {
    rememberTransactionQuickField(element);
    keepTransactionQuickFieldVisible(element);
  }

  function rememberActiveTransactionQuickField() {
    rememberTransactionQuickField(document.activeElement);
  }

  function getTransactionQuickFields() {
    const quickForm = txQuickFormRef.current;
    if (!quickForm) {
      return [];
    }
    return Array.from(quickForm.querySelectorAll(MOBILE_FORM_FIELD_SELECTOR)).filter(isSequentialEnterField);
  }

  function focusTransactionQuickTarget(target) {
    if (!target) {
      return false;
    }
    target.focus?.({ preventScroll: true });
    const restored = document.activeElement === target;
    if (restored) {
      txQuickLastFocusedFieldRef.current = target;
      keepTransactionQuickFieldVisible(target);
    }
    return restored;
  }

  function focusNextTransactionQuickField(target) {
    const fields = getTransactionQuickFields();
    const currentIndex = fields.indexOf(target);
    const nextField = fields.slice(currentIndex + 1).find(isFocusableFormField);
    if (!nextField) {
      return false;
    }
    focusTransactionQuickTarget(nextField);
    if (nextField instanceof HTMLInputElement && typeof nextField.select === "function") {
      nextField.select();
    }
    return true;
  }

  function focusTransactionQuickMemo() {
    const memoInput = txQuickMemoInputRef.current;
    if (!isFocusableFormField(memoInput)) {
      return false;
    }
    const restored = focusTransactionQuickTarget(memoInput);
    if (restored && memoInput instanceof HTMLInputElement && typeof memoInput.select === "function") {
      memoInput.select();
    }
    return restored;
  }

  function handleTransactionQuickFormKeyDown(event) {
    if (
      event.defaultPrevented ||
      event.key !== "Enter" ||
      event.shiftKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.isComposing
    ) {
      return;
    }
    const target = event.target;
    if (!isTransactionQuickRestorableField(target)) {
      return;
    }
    if (target.tagName === "TEXTAREA" && target.getAttribute("enterkeyhint") !== "next") {
      return;
    }
    if (target === txAmountInputRef.current && focusTransactionQuickMemo()) {
      event.preventDefault();
      return;
    }

    const shouldSubmit = target === txQuickMemoInputRef.current || !focusNextTransactionQuickField(target);
    event.preventDefault();
    if (shouldSubmit) {
      txQuickFormRef.current?.requestSubmit?.();
    }
  }

  function handleTransactionQuickAmountKeyDown(event) {
    if (event.defaultPrevented || event.key !== "Enter" || event.isComposing) {
      return;
    }
    event.preventDefault();
    focusTransactionQuickMemo();
  }

  function handleTransactionQuickMemoKeyDown(event) {
    if (
      event.defaultPrevented ||
      event.key !== "Enter" ||
      event.isComposing ||
      event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    txQuickFormRef.current?.requestSubmit?.();
  }

  function applyTransactionCategory(categoryId, categoryOverride = null) {
    const normalizedCategoryId = String(categoryId || "").trim();
    const category = categoryOverride || categoryById.get(normalizedCategoryId);
    setTxDraftTouched(true);
    setTxForm((prev) => ({ ...prev, category_id: normalizedCategoryId }));
    setTxCategoryMajor(category ? String(category.major || "") : "");
    setTxCategoryRestore(null);
  }

  function changeTransactionFlowType(nextFlowType) {
    const normalizedFlowType = normalizeCategoryFlowType(nextFlowType);
    if (normalizedFlowType === txForm.flow_type) {
      return;
    }
    setTxDraftTouched(true);
    const selectedCategory = categoryById.get(String(txForm.category_id || ""));
    const compatibleCategory = findCompatibleCategoryForFlow(categories, selectedCategory, normalizedFlowType);
    setTxForm((prev) => ({
      ...prev,
      flow_type: normalizedFlowType,
      category_id: compatibleCategory ? String(compatibleCategory.id || "") : "",
    }));
    setTxCategoryMajor(compatibleCategory ? String(compatibleCategory.major || "") : "");
    if (compatibleCategory) {
      setTxCategoryRestore(null);
      setMessage(
        uiGuideMessage(
          "유형에 맞는 카테고리를 유지했습니다.",
          `${toCategoryPairLabel(compatibleCategory)} 카테고리로 이어서 입력합니다.`
        )
      );
      return;
    }
    const restoreSnapshot = buildCategoryRestoreSnapshot(selectedCategory);
    setTxCategoryRestore(restoreSnapshot);
    if (restoreSnapshot) {
      setMessage(
        uiGuideMessage(
          "카테고리 선택을 비웠습니다.",
          "선택한 유형에 같은 카테고리가 없어 필요하면 이전 카테고리를 복구하세요."
        )
      );
    }
  }

  function restoreTransactionCategorySelection() {
    if (!txCategoryRestore) {
      return;
    }
    setTxDraftTouched(true);
    setTxForm((prev) => ({
      ...prev,
      flow_type: txCategoryRestore.flow_type,
      category_id: txCategoryRestore.category_id,
    }));
    setTxCategoryMajor(txCategoryRestore.category_major);
    setTxCategoryRestore(null);
    setMessage(
      uiGuideMessage(
        "이전 카테고리를 복구했습니다.",
        `${FLOW_TYPE_LABELS[txCategoryRestore.flow_type] || txCategoryRestore.flow_type} · ${txCategoryRestore.label}`
      )
    );
  }

  function renderTransactionCategoryRestoreNotice() {
    if (!txCategoryRestore) {
      return null;
    }
    return (
      <div className="tx-category-restore-notice" data-testid="transaction-category-restore-notice" role="status">
        <span>
          <strong>카테고리 선택을 비웠습니다.</strong>
          <small>이전 선택: {txCategoryRestore.label}</small>
        </span>
        <button
          type="button"
          className="secondary"
          data-testid="transaction-category-restore-button"
          onClick={restoreTransactionCategorySelection}
        >
          이전 카테고리 복구
        </button>
      </div>
    );
  }

  function focusTransactionAfterCategoryCreate() {
    if (typeof window === "undefined") {
      return;
    }
    window.setTimeout(() => {
      const hasAmount = String(txForm.amount || "").trim();
      const target = isCompactViewport
        ? txQuickMemoInputRef.current || txAmountInputRef.current
        : hasAmount
          ? txMemoInputRef.current || txAmountInputRef.current
          : txAmountInputRef.current || txMemoInputRef.current;
      target?.focus?.({ preventScroll: true });
    }, 0);
  }

  function focusTxInlineAfterCategoryCreate() {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    window.setTimeout(() => {
      const editorRow = document.querySelector("tr.transaction-inline-editor-row");
      const target =
        editorRow?.querySelector('input[aria-label="메모"]') ||
        editorRow?.querySelector('input[aria-label="금액"]');
      target?.focus?.({ preventScroll: true });
    }, 0);
  }

  function openHoldingEntrySheet(event) {
    if (loading) {
      return;
    }
    const trigger = event?.currentTarget;
    if (trigger?.focus) {
      holdingEntryReturnFocusRef.current = trigger;
    } else if (!holdingEntryReturnFocusRef.current) {
      holdingEntryReturnFocusRef.current = holdingEntryActionRef.current;
    }
    if (isCompactViewport && typeof window !== "undefined") {
      holdingSheetScrollYRef.current = window.scrollY;
    }
    setShowHoldingForm(true);
  }

  const closeHoldingEntrySheet = useCallback(async ({ skipDraftGuard = false } = {}) => {
    if (!skipDraftGuard && isHoldingEntryDraftDirty) {
      const confirmed = await requestConfirmDialog({
        title: "자산 입력을 닫을까요?",
        action: "작성 중인 자산 초안은 보존됩니다. 닫으면 목록으로 돌아가고 다시 열어 이어서 입력할 수 있습니다.",
        confirmLabel: "입력 닫기",
      });
      if (!confirmed) {
        return false;
      }
    }
    setShowHoldingForm(false);
    if (typeof window === "undefined") {
      return true;
    }
    const restoreScrollY = holdingSheetScrollYRef.current;
    window.setTimeout(() => {
      if (isCompactViewport) {
        window.scrollTo({ top: restoreScrollY, behavior: "auto" });
      }
      const returnFocusTarget = holdingEntryReturnFocusRef.current || holdingEntryActionRef.current;
      returnFocusTarget?.focus?.({ preventScroll: true });
      holdingEntryReturnFocusRef.current = null;
    }, 0);
    return true;
  }, [isCompactViewport, isHoldingEntryDraftDirty, requestConfirmDialog]);

  useEffect(() => {
    if (!showHoldingForm || !isCompactViewport) {
      return undefined;
    }
    const handleHoldingEntryEscape = (event) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      closeHoldingEntrySheet();
    };
    document.addEventListener("keydown", handleHoldingEntryEscape);
    return () => document.removeEventListener("keydown", handleHoldingEntryEscape);
  }, [showHoldingForm, isCompactViewport, closeHoldingEntrySheet]);

  function scrollToHoldingSummary() {
    const summaryCard = holdingSummaryCardRef.current;
    if (!summaryCard || typeof window === "undefined") {
      return;
    }
    summaryCard.open = true;
    setHoldingSummaryOpen(true);
    scrollHoldingSummaryIntoViewport(summaryCard);
  }

  function scrollHoldingSummaryIntoViewport(summaryCard) {
    if (!summaryCard || typeof window === "undefined") {
      return;
    }
    const targetTop = window.scrollY + summaryCard.getBoundingClientRect().top - HOLDING_SUMMARY_SCROLL_OFFSET_PX;
    window.scrollTo({
      top: Math.max(targetTop, 0),
      behavior: "auto",
    });
    keepHoldingSummaryClearOfBottomNav(summaryCard);
  }

  function isCurrentCompactViewport() {
    return typeof window !== "undefined" && window.innerWidth <= MOBILE_BREAKPOINT_PX;
  }

  function getFixedBottomNavTop() {
    const nav = topbarTabsRef.current;
    const navBox = nav?.getBoundingClientRect();
    const navStyle = nav ? getComputedStyle(nav) : null;
    const isFixedBottomNav =
      navBox &&
      navStyle?.position === "fixed" &&
      navBox.bottom >= window.innerHeight - 32 &&
      navBox.top > window.innerHeight * 0.5;
    return isFixedBottomNav ? navBox.top : window.innerHeight;
  }

  function keepHoldingSummaryClearOfBottomNav(summaryCard) {
    if (!isCurrentCompactViewport() || !summaryCard?.open || typeof window === "undefined") {
      return;
    }
    const labels = Array.from(summaryCard.querySelectorAll(".portfolio-donut-slice-label"));
    const chart = summaryCard.querySelector(".compact-chart-wrap");
    const measuredNodes = labels.length > 0 ? labels : chart ? [chart] : [];
    if (measuredNodes.length === 0) {
      return;
    }
    const lowestBottom = Math.max(...measuredNodes.map((node) => node.getBoundingClientRect().bottom));
    const overflow = lowestBottom - (getFixedBottomNavTop() - 8);
    if (overflow > 0) {
      window.scrollBy({
        top: Math.ceil(overflow + 8),
        behavior: "auto",
      });
    }
  }

  function keepHoldingSummaryOpenContentVisible(summaryCard) {
    if (!isCurrentCompactViewport() || !summaryCard?.open || typeof window === "undefined") {
      return;
    }
    const alignSummary = () => {
      if (summaryCard.isConnected && summaryCard.open) {
        scrollHoldingSummaryIntoViewport(summaryCard);
      }
    };
    alignSummary();
    window.requestAnimationFrame(alignSummary);
    window.setTimeout(alignSummary, 120);
  }

  function handleHoldingSummaryToggle(event) {
    const summaryCard = event.currentTarget;
    setHoldingSummaryOpen(summaryCard.open);
    if (summaryCard.open) {
      keepHoldingSummaryOpenContentVisible(summaryCard);
    }
  }

  function handleHoldingSummarySummaryClick(event) {
    const summaryCard = event.currentTarget.parentElement;
    if (isCurrentCompactViewport() && summaryCard && !summaryCard.open) {
      scrollHoldingSummaryIntoViewport(summaryCard);
    }
  }

  function toggleTransactionCategoryManager(forceOpen) {
    setShowTxCategoryManager((prev) => {
      const nextOpen = typeof forceOpen === "boolean" ? forceOpen : !prev;
      if (nextOpen) {
        if (transactionSupportDetailsRef.current) {
          transactionSupportDetailsRef.current.open = true;
        }
        setTransactionSupportOpen(true);
        window.setTimeout(() => {
          txCategoryManagerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 0);
      }
      return nextOpen;
    });
  }

  function toggleTransactionSelection(transactionId) {
    setSelectedTransactionIds((prev) => {
      const next = new Set(prev);
      if (next.has(transactionId)) {
        next.delete(transactionId);
      } else {
        next.add(transactionId);
      }
      return next;
    });
  }

  function selectTransactionRows(transactionIds) {
    setTransactionRowsSelected(transactionIds, true);
  }

  function setTransactionRowsSelected(transactionIds, selected) {
    setSelectedTransactionIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const transactionId of transactionIds) {
        if (!transactionId) {
          continue;
        }
        if (selected && !next.has(transactionId)) {
          next.add(transactionId);
          changed = true;
        } else if (!selected && next.has(transactionId)) {
          next.delete(transactionId);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }

  function setTransactionRowsExpanded(transactionIds, expanded) {
    setExpandedTransactionRows((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const transactionId of transactionIds) {
        if (!transactionId) {
          continue;
        }
        if (expanded && !next.has(transactionId)) {
          next.add(transactionId);
          changed = true;
        } else if (!expanded && next.has(transactionId)) {
          next.delete(transactionId);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }

  function toggleAllFilteredTransactionSelection(checked) {
    setSelectedTransactionIds((prev) => {
      const next = new Set(prev);
      for (const item of sortedTransactions) {
        if (checked) {
          next.add(item.id);
        } else {
          next.delete(item.id);
        }
      }
      return next;
    });
  }

  function toggleExpandedTransactionRow(transactionId) {
    setExpandedTransactionRows((prev) => {
      const next = new Set(prev);
      if (next.has(transactionId)) {
        next.delete(transactionId);
      } else {
        next.add(transactionId);
      }
      return next;
    });
  }

  function toggleHoldingSelection(holdingId) {
    setSelectedHoldingIds((prev) => {
      const next = new Set(prev);
      if (next.has(holdingId)) {
        next.delete(holdingId);
      } else {
        next.add(holdingId);
      }
      return next;
    });
  }

  function toggleExpandedHoldingRow(holdingId) {
    setExpandedHoldingRows((prev) => {
      const next = new Set(prev);
      if (next.has(holdingId)) {
        next.delete(holdingId);
      } else {
        next.add(holdingId);
      }
      return next;
    });
  }

  function updateHoldingColumnWidth(columnKey, width) {
    const parsed = Number(width);
    if (!Number.isFinite(parsed)) {
      return;
    }
    const clamped = Math.min(600, Math.max(80, Math.round(parsed)));
    setHoldingColumnWidths((prev) => ({
      ...prev,
      [columnKey]: clamped,
    }));
    setHouseholdSettingsForm((prev) => ({
      ...prev,
      holding_settings: normalizeHoldingSettings({
        ...(prev?.holding_settings || {}),
        column_widths: {
          ...(prev?.holding_settings?.column_widths || {}),
          [columnKey]: clamped,
        },
      }),
    }));
  }

  function setHoldingColorInForm(scopeKey, itemKey, colorValue) {
    const normalizedKey = String(itemKey || "").trim();
    if (!normalizedKey) {
      return;
    }
    setHouseholdSettingsForm((prev) => ({
      ...prev,
      holding_settings: normalizeHoldingSettings({
        ...(prev?.holding_settings || {}),
        [scopeKey]: {
          ...(prev?.holding_settings?.[scopeKey] || {}),
          [normalizedKey]: String(colorValue || "").toUpperCase(),
        },
      }),
    }));
  }

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
        aria-label={`${getHoldingSortLabel(field)} 정렬 ${isActive ? (holdingSortDirection === "asc" ? "내림차순으로 변경" : "오름차순으로 변경") : "오름차순으로 변경"}`}
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
      return;
    }
    const selected = categoryById.get(String(txForm.category_id || ""));
    const nextMajor = selected?.major || "";
    if (nextMajor !== txCategoryMajor) {
      setTxCategoryMajor(nextMajor);
    }
  }, [categoryById, txCategoryMajor, txForm.category_id]);

  useEffect(() => {
    setSavedTabId(tab);
    syncUrlTabParam(tab);
    setMessage((prev) => (prev ? "" : prev));
    if (tab === "transactions") {
      if (transactionLatestAnchorSuppressedRef.current) {
        transactionLatestAnchorPendingRef.current = false;
        return;
      }
      transactionLatestAnchorPendingRef.current = true;
      return;
    }
    transactionLatestAnchorPendingRef.current = false;
    transactionLatestAnchorSuppressedRef.current = false;
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      });
    }
  }, [tab]);

  useEffect(() => {
    if (
      tab !== "transactions" ||
      !transactionLatestAnchorPendingRef.current ||
      transactionLatestAnchorSuppressedRef.current ||
      sortedTransactions.length === 0 ||
      typeof window === "undefined"
    ) {
      return undefined;
    }
    let attempts = 0;
    let disposed = false;
    const scrollLatestRow = () => {
      if (disposed) {
        return;
      }
      const rows = Array.from(transactionListCardRef.current?.querySelectorAll(".transaction-row") || []);
      const targetRow = txSortDirection === "asc" ? rows[rows.length - 1] : rows[0];
      if (!targetRow) {
        attempts += 1;
        if (attempts < 6) {
          window.setTimeout(() => window.requestAnimationFrame(scrollLatestRow), attempts < 3 ? 0 : 80);
        }
        return;
      }
      targetRow.scrollIntoView({ block: "end", inline: "nearest", behavior: "auto" });
      transactionLatestAnchorPendingRef.current = false;
    };
    window.requestAnimationFrame(scrollLatestRow);
    return () => {
      disposed = true;
    };
  }, [tab, sortedTransactions, txSortDirection]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    const syncTabFromUrl = () => {
      const nextTab = getUrlTabId(window.location.search);
      if (nextTab) {
        setTab((prev) => (prev === nextTab ? prev : nextTab));
      }
    };
    syncTabFromUrl();
    window.addEventListener("popstate", syncTabFromUrl);
    return () => {
      window.removeEventListener("popstate", syncTabFromUrl);
    };
  }, []);

  useEffect(() => {
    if (!txInlineEdit) {
      return;
    }
    if (!txInlineEdit.category_id) {
      return;
    }
    const nextMajor = categoryById.get(String(txInlineEdit.category_id || ""))?.major || "";
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
    if (!txForm.category_id) {
      return;
    }
    if (!categoryById.has(String(txForm.category_id || ""))) {
      setTxForm((prev) => ({ ...prev, category_id: "" }));
    }
  }, [categoryById, txForm.category_id]);

  useEffect(() => {
    if (!txInlineEdit?.category_id) {
      return;
    }
    if (!categoryById.has(String(txInlineEdit.category_id || ""))) {
      setTxInlineEdit((prev) => (prev ? { ...prev, category_id: "" } : prev));
    }
  }, [categoryById, txInlineEdit?.category_id]);

  useEffect(() => {
    const nextIds = new Set(
      receivedHouseholdInvites
        .filter((invite) => String(invite?.status || "") === "pending")
        .map((invite) => String(invite.id))
    );
    const prevIds = receivedInviteIdsRef.current;
    const nextArrivals = [];
    for (const inviteId of nextIds) {
      if (!prevIds.has(inviteId)) {
        nextArrivals.push(inviteId);
      }
    }
    receivedInviteIdsRef.current = nextIds;
    setRecentInviteIds((prev) => {
      const retained = prev.filter((inviteId) => nextIds.has(inviteId));
      for (const inviteId of nextArrivals) {
        if (!retained.includes(inviteId)) {
          retained.push(inviteId);
        }
      }
      return retained;
    });
    if (nextArrivals.length === 0) {
      return undefined;
    }
    setCollaborationInvitePulse(true);
    const timer = window.setTimeout(() => {
      setCollaborationInvitePulse(false);
      setRecentInviteIds((prev) => prev.filter((inviteId) => !nextArrivals.includes(inviteId)));
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [receivedHouseholdInvites]);

  useEffect(() => {
    if (tab === "collaboration") {
      setCollaborationInvitePulse(false);
    }
  }, [tab]);

  useEffect(() => {
    const fallbackType = holdingTypeOptions[0];
    if (!fallbackType) {
      return;
    }
    const normalizedTypeKey = normalizeHoldingTypeKey(holdingForm.type_key || holdingForm.asset_type || "");
    const selectedType = holdingTypeByKey.get(normalizedTypeKey) || fallbackType;
    const nextTypeKey = normalizeHoldingTypeKey(selectedType.key || selectedType.asset_type || "other") || "other";
    const nextAssetType = String(selectedType.asset_type || "other");
    const nextCategory = String(holdingForm.category || "").trim() || holdingDefaultCategory(selectedType);
    if (
      holdingForm.type_key === nextTypeKey &&
      holdingForm.asset_type === nextAssetType &&
      String(holdingForm.category || "").trim() === nextCategory
    ) {
      return;
    }
    setHoldingForm((prev) => ({
      ...prev,
      type_key: nextTypeKey,
      asset_type: nextAssetType,
      category: nextCategory,
    }));
  }, [holdingForm.asset_type, holdingForm.category, holdingForm.type_key, holdingTypeByKey, holdingTypeOptions]);

  useEffect(() => {
    const selectedTypeKey = normalizeHoldingTypeKey(holdingForm.type_key || holdingForm.asset_type || "");
    const selectedType = holdingTypeByKey.get(selectedTypeKey) || holdingTypeOptions[0] || DEFAULT_HOLDING_TYPES[0];
    const isTracked = Boolean(selectedType?.tracked ?? isMarketTrackedAssetType(holdingForm.asset_type));
    const showAverageCost = Boolean(selectedType?.show_average_cost ?? true);
    if (!isTracked && String(holdingForm.quantity || "").trim() !== "1") {
      setHoldingForm((prev) => ({ ...prev, quantity: "1" }));
      return;
    }
    if (!showAverageCost && String(holdingForm.average_cost || "").trim() !== "0") {
      setHoldingForm((prev) => ({ ...prev, average_cost: "0" }));
    }
  }, [holdingForm.asset_type, holdingForm.average_cost, holdingForm.quantity, holdingForm.type_key, holdingTypeByKey, holdingTypeOptions]);

  useEffect(() => {
    if (!household?.id) {
      return;
    }
    setTxCategoryMajor("");
    setTxCategoryRestore(null);
    setTxForm((prev) => ({ ...prev, category_id: "" }));
    closeTxInlineEdit();
    setHoldingInlineEdit(null);
    setCategoryDraft(createCategoryDraft());
    setCategoryDraftMajorSelect("__custom__");
    setCategoryDraftMinorSelect("__custom__");
    setCategoryQuickSelectedId("");
    setCategoryEditId("");
    setCategoryEditForm({ major: "", minor: "" });
    setMajorRenameDrafts({});
    setCategoryUsageExpanded({});
    setCategoryUsageById({});
    setCategoryUsageLoadingId("");
    setShowTxCategoryManager(false);
    setShowTransactionForm(false);
    setTxEntrySheetStep("form");
    setShowHoldingForm(false);
    setReceivedInviteTab("new");
    setSentInviteTab("new");
    setCollaborationInvitePulse(false);
    setRecentInviteIds([]);
    receivedInviteIdsRef.current = new Set();
    setImportReport(null);
    setRecentImportTransactionIds(new Set());
    setRecentSavedTransactionIds(new Set());
    setRecentImportHoldingIds(new Set());
    setPendingImportEditTransactionId("");
    setPendingImportEditHoldingId("");
    setMigrationReport(null);
    setMigrationPackageFile(null);
    setMigrationLoadingMode("");
    setMigrationExporting(false);
  }, [household?.id]);

  useEffect(() => {
    const consumeDeepLinkTokens = () => {
      const params = new URLSearchParams(window.location.search);
      const rawHash = String(window.location.hash || "").replace(/^#/, "");
      const hashParams = new URLSearchParams(rawHash.startsWith("?") ? rawHash.slice(1) : rawHash);
      const verifyToken = hashParams.get("verify_token");
      const inviteToken = hashParams.get("invite_token");
      const hadLegacyQueryTokens = params.has("verify_token") || params.has("invite_token");

      if (verifyToken || inviteToken) {
        setMessage("");
      }
      if (verifyToken) {
        activeDeepLinkFlowRef.current = { type: "verify", token: verifyToken };
        setInviteAcceptToken("");
        setInviteAcceptanceNotice(null);
        setAuthMode("verify");
        setVerifyForm((prev) => ({
          ...prev,
          email: prev.email || getSavedEmail() || "",
          token: verifyToken,
          verification_code: "",
          password: "",
          password_confirm: "",
          requires_password_setup: false,
          password_setup_reason: "",
        }));
        verifyEmailTokenFromLink(verifyToken).catch(() => undefined);
        params.delete("verify_token");
        hashParams.delete("verify_token");
        hashParams.delete("invite_token");
      } else if (inviteToken) {
        activeDeepLinkFlowRef.current = { type: "invite", token: inviteToken };
        autoVerifyTokenRef.current = "";
        setLoading(false);
        setAuthMode("login");
        setVerifyForm((prev) => ({
          ...createVerifyForm(),
          email: prev.email || getSavedEmail() || "",
        }));
        setVerificationMeta(createVerificationMeta());
        setInviteAcceptToken(inviteToken);
        hashParams.delete("verify_token");
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
    };

    consumeDeepLinkTokens();
    window.addEventListener("hashchange", consumeDeepLinkTokens);
    window.addEventListener("popstate", consumeDeepLinkTokens);
    return () => {
      window.removeEventListener("hashchange", consumeDeepLinkTokens);
      window.removeEventListener("popstate", consumeDeepLinkTokens);
    };
    // Deep-link tokens must be consumed once per URL transition, including hash-only navigation in the mounted SPA.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (authMode !== "verify" || (!verificationMeta.expiresAtMs && !verificationMeta.resendCooldownSeconds)) {
      return undefined;
    }
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [authMode, verificationMeta.expiresAtMs, verificationMeta.resendCooldownSeconds]);

  async function loadAuthContext(nextToken = token) {
    const [me, householdResp, householdListResp] = await Promise.all([
      api(`${API_PREFIX}/auth/me`, {}, nextToken),
      api(`${API_PREFIX}/household/current`, {}, nextToken),
      api(`${API_PREFIX}/household/list`, {}, nextToken),
    ]);
    const nextHouseholdId = householdResp?.household?.id || "";
    setActiveHouseholdId(nextHouseholdId);
    const [householdSettingsResp, categoryResp] = await Promise.all([
      api(`${API_PREFIX}/household/settings`, {}, nextToken),
      api(`${API_PREFIX}/categories`, {}, nextToken),
    ]);
    setUser(me);
    setHousehold(householdResp.household);
    setHouseholdSettings({
      ...householdSettingsResp,
      transaction_row_colors: normalizeTransactionRowColors(householdSettingsResp?.transaction_row_colors),
      holding_settings: normalizeHoldingSettings(householdSettingsResp?.holding_settings),
    });
    const nextHouseholdRole = householdResp.role || "";
    householdRoleRef.current = nextHouseholdRole;
    setHouseholdRole(nextHouseholdRole);
    setHouseholdList(householdListResp.households || []);
    setCategories(categoryResp);
  }

  function resolveFilterQuery(override = null) {
    const activeFilterMode = override?.filterMode || filterModeRef.current;
    const activeYearMonth = override?.yearMonth || appliedYearMonthRef.current;
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

  function beginTransactionLedgerRequest(txQuery) {
    transactionLedgerRequestRef.current += 1;
    return {
      id: transactionLedgerRequestRef.current,
      txQuery,
    };
  }

  function isTransactionLedgerRequestCurrent(request) {
    return (
      request?.id === transactionLedgerRequestRef.current &&
      resolveFilterQuery().txQuery === request.txQuery
    );
  }

  function captureDocumentScrollPosition() {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return null;
    }
    return {
      left: window.scrollX || document.documentElement.scrollLeft || 0,
      top: window.scrollY || document.documentElement.scrollTop || 0,
    };
  }

  function restoreDocumentScrollPosition(snapshot) {
    if (!snapshot || typeof document === "undefined" || typeof window === "undefined") {
      return;
    }
    let attempts = 0;
    const restore = () => {
      const maxTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo({
        top: Math.min(snapshot.top, maxTop),
        left: snapshot.left,
        behavior: "auto",
      });
      attempts += 1;
      if (attempts < 8) {
        window.setTimeout(() => window.requestAnimationFrame(restore), attempts < 3 ? 0 : 80);
      }
    };
    window.requestAnimationFrame(restore);
  }

  function applyPriceStatus(nextStatus) {
    if (!nextStatus) {
      setPriceStatus(nextStatus);
      setPriceRefreshPolling(false);
      priceRefreshOriginRef.current = "manual";
      priceRefreshPollFailureCountRef.current = 0;
      return nextStatus;
    }
    const normalizedStatus = {
      ...nextStatus,
      refresh_in_progress: Boolean(nextStatus?.refresh_in_progress),
    };
    setPriceStatus(normalizedStatus);
    setPriceRefreshPolling(normalizedStatus.refresh_in_progress);
    if (normalizedStatus.refresh_in_progress) {
      priceRefreshPollFailureCountRef.current = 0;
    } else {
      priceRefreshOriginRef.current = "manual";
      priceRefreshPollFailureCountRef.current = 0;
    }
    return normalizedStatus;
  }

  function releasePriceRefreshLock() {
    setPriceRefreshPolling(false);
    priceRefreshOriginRef.current = "manual";
    priceRefreshPollFailureCountRef.current = 0;
    setPriceStatus((current) => (
      current?.refresh_in_progress ? { ...current, refresh_in_progress: false } : current
    ));
  }

  function loadPriceStatusQuietly(nextToken = token) {
    return api(`${API_PREFIX}/prices/status`, {}, nextToken)
      .then((data) => ({ ok: true, data }))
      .catch((error) => ({ ok: false, error }));
  }

  async function loadOwnerCleanupTransactions(nextToken = token) {
    const rows = await api(`${API_PREFIX}/transactions?limit=3000`, {}, nextToken);
    setOwnerCleanupTransactions(Array.isArray(rows) ? rows : []);
    setOwnerCleanupTransactionsLoaded(true);
    return rows;
  }

  async function loadTransactionLedgerItems(txQuery, nextToken = token) {
    const allRows = [];
    const seenIds = new Set();
    let offset = 0;
    for (let pageIndex = 0; pageIndex < TRANSACTION_LEDGER_MAX_PAGES; pageIndex += 1) {
      const pageRows = await api(
        `${API_PREFIX}/transactions?${txQuery}&limit=${TRANSACTION_LEDGER_PAGE_LIMIT}&offset=${offset}`,
        {},
        nextToken
      );
      const safeRows = Array.isArray(pageRows) ? pageRows : [];
      let appendedCount = 0;
      for (const row of safeRows) {
        const rowId = String(row?.id || "");
        if (rowId && seenIds.has(rowId)) {
          continue;
        }
        if (rowId) {
          seenIds.add(rowId);
        }
        allRows.push(row);
        appendedCount += 1;
      }
      if (safeRows.length < TRANSACTION_LEDGER_PAGE_LIMIT || appendedCount === 0) {
        break;
      }
      offset += safeRows.length;
    }
    return allRows;
  }

  async function refreshData(REFRESH_PRICES = false, nextToken = token, filterOverride = null, options = {}) {
    const silent = Boolean(options?.silent);
    void REFRESH_PRICES;
    if (!silent) {
      dashboardRequestCountRef.current += 1;
      setDashboardLoading(true);
    }
    try {
      const { txQuery, overviewQuery } = resolveFilterQuery(filterOverride);
      const ledgerRequest = beginTransactionLedgerRequest(txQuery);
      const [overviewResp, txResp, holdingResp, portfolioResp, statusResp] = await Promise.all([
        api(`${API_PREFIX}/dashboard/overview?${overviewQuery}`, {}, nextToken),
        loadTransactionLedgerItems(txQuery, nextToken),
        api(`${API_PREFIX}/holdings`, {}, nextToken),
        api(`${API_PREFIX}/dashboard/portfolio`, {}, nextToken),
        loadPriceStatusQuietly(nextToken),
      ]);
      if (!isTransactionLedgerRequestCurrent(ledgerRequest)) {
        return;
      }
      setOverview(overviewResp);
      setTransactions(txResp);
      setHoldings(holdingResp);
      setPortfolio(portfolioResp);
      if (statusResp.ok) {
        applyPriceStatus(statusResp.data);
      } else {
        releasePriceRefreshLock();
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

  async function refreshDataByKinds(kinds, nextToken = token, options = {}) {
    if (!kinds || kinds.size === 0) {
      return;
    }
    const includeAll = kinds.has("full");
    const includeTransactions = includeAll || kinds.has("transaction");
    const includeHoldings = includeAll || kinds.has("holding");
    const includeCollaboration = includeAll || kinds.has("collaboration");
    const includeContext = includeAll || includeCollaboration || kinds.has("context");
    if (!includeTransactions && !includeHoldings && !includeContext && !includeCollaboration) {
      return;
    }
    const silent = Boolean(options?.silent);
    if (!silent) {
      dashboardRequestCountRef.current += 1;
      setDashboardLoading(true);
    }
    try {
      const { txQuery, overviewQuery } = resolveFilterQuery();
      const ledgerRequest = includeTransactions ? beginTransactionLedgerRequest(txQuery) : null;
      const requests = [];
      if (includeTransactions) {
        requests.push(
          api(`${API_PREFIX}/dashboard/overview?${overviewQuery}`, {}, nextToken).then((data) => ({ key: "overview", data })),
          loadTransactionLedgerItems(txQuery, nextToken).then((data) => ({ key: "transactions", data })),
        );
      }
      if (includeHoldings) {
        requests.push(
          api(`${API_PREFIX}/holdings`, {}, nextToken).then((data) => ({ key: "holdings", data })),
          api(`${API_PREFIX}/dashboard/portfolio`, {}, nextToken).then((data) => ({ key: "portfolio", data })),
          loadPriceStatusQuietly(nextToken).then((result) => ({ key: "priceStatus", result })),
        );
      }
      if (includeContext) {
        requests.push(
          loadAuthContext(nextToken).then(() => ({ key: "context", data: null })),
        );
      }
      if (includeCollaboration) {
        requests.push(
          refreshCollaborationData(nextToken).then(() => ({ key: "collaboration", data: null })),
        );
      }
      const responses = await Promise.all(requests);
      if (ledgerRequest && !isTransactionLedgerRequestCurrent(ledgerRequest)) {
        return;
      }
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
          if (item.result.ok) {
            applyPriceStatus(item.result.data);
          } else {
            releasePriceRefreshLock();
          }
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
    const expectedTxQuery = resolveFilterQuery(filterOverride).txQuery;
    try {
      await refreshData(false, token, filterOverride);
    } catch (error) {
      if (resolveFilterQuery().txQuery !== expectedTxQuery) {
        return;
      }
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
    if (typeof document !== "undefined") {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && activeElement.closest(".month-stepper")) {
        activeElement.blur();
      }
    }
    setFilterMode("month");
    filterModeRef.current = "month";
    yearMonthRef.current = normalized;
    appliedYearMonthRef.current = normalized;
    setMonthFilterPending(false);
    setYearMonth(normalized);
    if (tab === "transactions" && !transactionLatestAnchorSuppressedRef.current) {
      transactionLatestAnchorPendingRef.current = true;
    }
    refreshDataWithUiFeedback({ filterMode: "month", yearMonth: normalized }).catch(() => undefined);
  }

  function handleShiftYearMonth(delta) {
    applyMonthFilter(shiftMonth(yearMonthRef.current, delta));
  }

  function updateYearMonthInput(part, value) {
    const numericValue = Number(value);
    const safeValue = Number.isFinite(numericValue) ? numericValue : 0;
    const next = { ...yearMonthRef.current, [part]: safeValue };
    yearMonthRef.current = next;
    setYearMonth(next);
    setMonthFilterPending(compareYearMonth(next, appliedYearMonthRef.current) !== 0);
  }

  function handleApplyYearMonth() {
    applyMonthFilter(yearMonthRef.current);
  }

  function applyRangeFilter(nextRange = range) {
    setFilterMode("range");
    filterModeRef.current = "range";
    rangeRef.current = nextRange;
    setMonthFilterPending(false);
    setRange(nextRange);
    if (!nextRange.start || !nextRange.end) {
      return;
    }
    if (tab === "transactions" && !transactionLatestAnchorSuppressedRef.current) {
      transactionLatestAnchorPendingRef.current = true;
    }
    refreshDataWithUiFeedback({ filterMode: "range", range: nextRange }).catch(() => undefined);
  }

  function handleRangeInputChange(field, value) {
    applyRangeFilter({ ...range, [field]: value });
  }

  function handleSwitchToRangeFilter() {
    const nextRange = filterModeRef.current === "month"
      ? yearMonthFullDateRange(yearMonthRef.current, transactionLocalTodayRef.current || todayIso())
      : rangeRef.current;
    applyRangeFilter(nextRange);
  }

  function handleRangePreset(preset) {
    if (preset === "current_month") {
      const nextMonth = currentMonth();
      yearMonthRef.current = nextMonth;
      setYearMonth(nextMonth);
      applyRangeFilter(yearMonthFullDateRange(nextMonth, transactionLocalTodayRef.current || todayIso()));
      return;
    }
    if (preset === "recent_30") {
      applyRangeFilter(recentDateRange(30, transactionLocalTodayRef.current || todayIso()));
    }
  }

  function handleYearMonthInputKeyDown(event) {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    handleApplyYearMonth();
  }

  function handleMoveToCurrentMonth() {
    applyMonthFilter(currentMonth());
  }

  async function finishAuthFlow(authPayload, successMessage = null, { showSuccessMessage = true } = {}) {
    const accountEmail = authPayload?.user?.email || authForm.email || verifyForm.email;
    if (saveAccountInfo && accountEmail) {
      localStorage.setItem(SAVED_EMAIL_KEY, accountEmail);
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
    if (showSuccessMessage && inviteAcceptToken) {
      setMessage(
        successMessage ||
          uiGuideMessage(
            "인증이 완료되었습니다.",
            inviteAcceptToken ? "협업 탭에서 초대를 수락해 주세요." : "원하는 메뉴를 선택해 계속 진행해 주세요."
          )
      );
    } else {
      setMessage("");
    }
  }

  async function verifyEmailTokenFromLink(verifyToken) {
    const tokenText = String(verifyToken || "").trim();
    if (!tokenText || autoVerifyTokenRef.current === tokenText) {
      return;
    }
    const isCurrentVerifyDeepLink = () =>
      activeDeepLinkFlowRef.current.type === "verify" && activeDeepLinkFlowRef.current.token === tokenText;
    autoVerifyTokenRef.current = tokenText;
    setLoading(true);
    setMessage("인증 링크를 확인하고 있습니다...");
    try {
      await loadClientConfig();
      const payload = await api(`${API_PREFIX}/auth/verify-email`, {
        method: "POST",
        body: JSON.stringify({
          token: tokenText,
          remember_me: keepSignedIn,
        }),
      });
      if (!isCurrentVerifyDeepLink()) {
        return;
      }
      await finishAuthFlow(
        payload,
        uiGuideMessage("회원가입이 완료되었습니다.", "Money Flow Service로 바로 이동했습니다.")
      );
    } catch (error) {
      if (!isCurrentVerifyDeepLink()) {
        return;
      }
      autoVerifyTokenRef.current = "";
      setAuthMode("verify");
      if (isRegistrationPasswordSetupRequired(error)) {
        setVerifyForm((prev) => ({
          ...prev,
          token: tokenText,
          verification_code: "",
          password: "",
          password_confirm: "",
          requires_password_setup: true,
          password_setup_reason: "token",
        }));
        setMessage(registrationPasswordSetupMessage());
        return;
      }
      setMessage(formatAuthError(error, "verify"));
    } finally {
      if (isCurrentVerifyDeepLink()) {
        setLoading(false);
      }
    }
  }

  function validateAuthEmail(value, label = "이메일") {
    const email = String(value || "").trim();
    if (!email) {
      return `${label}을 입력해 주세요.`;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return `올바른 ${label} 주소를 입력해 주세요.`;
    }
    return "";
  }

  function validateRequiredText(value, message) {
    return String(value || "").trim() ? "" : message;
  }

  function validateDecimalInput(value, label, { min = 0, allowZero = false } = {}) {
    const text = stripGrouping(value);
    if (!text) {
      return `${label}을 입력해 주세요.`;
    }
    const amount = Number(text);
    if (!Number.isFinite(amount)) {
      return `${label}을 숫자로 입력해 주세요.`;
    }
    if (allowZero ? amount < min : amount <= min) {
      return allowZero
        ? `${label}은 ${min} 이상으로 입력해 주세요.`
        : `${label}은 ${min}보다 크게 입력해 주세요.`;
    }
    return "";
  }

  function validateTransactionAmountInput(value) {
    const decimalMessage = validateDecimalInput(value, "금액");
    if (decimalMessage) {
      return decimalMessage;
    }
    return hasDecimalSeparatorInput(value) ? KRW_TRANSACTION_INTEGER_AMOUNT_MESSAGE : "";
  }

  function handleTransactionAmountInput(event, setForm, field = "amount") {
    const rawValue = String(event.currentTarget.value || "");
    handleGroupedDecimalInput(event, setForm, field);
    setMessage((prev) => {
      if (hasDecimalSeparatorInput(rawValue)) {
        return KRW_TRANSACTION_INTEGER_AMOUNT_MESSAGE;
      }
      return prev === KRW_TRANSACTION_INTEGER_AMOUNT_MESSAGE ? "" : prev;
    });
  }

  function handleTransactionEntryAmountInput(event) {
    const rawValue = String(event.currentTarget.value || "");
    setTxDraftTouched(true);
    handleTransactionAmountInput(event, setTxForm);
    setTxFormErrors((prev) => {
      const amountMessage = hasDecimalSeparatorInput(rawValue) ? KRW_TRANSACTION_INTEGER_AMOUNT_MESSAGE : "";
      return prev.amount === amountMessage ? prev : { ...prev, amount: amountMessage };
    });
  }

  function handleHoldingEntryDecimalInput(event, field) {
    setHoldingDraftTouched(true);
    handleGroupedDecimalInput(event, setHoldingForm, field);
  }

  function validateLoginForm(form) {
    const emailMessage = validateAuthEmail(form.email);
    if (emailMessage) {
      return emailMessage;
    }
    if (!String(form.password || "")) {
      return "비밀번호를 입력해 주세요.";
    }
    return "";
  }

  function validateRegisterForm(form) {
    const emailMessage = validateAuthEmail(form.email);
    if (emailMessage) {
      return emailMessage;
    }
    const password = String(form.password || "");
    const passwordConfirm = String(form.password_confirm || "");
    if (!password) {
      return "비밀번호를 입력해 주세요.";
    }
    if (password.length < 8) {
      return "비밀번호는 8자 이상이어야 합니다.";
    }
    if (!passwordConfirm) {
      return "비밀번호 확인을 입력해 주세요.";
    }
    if (password !== passwordConfirm) {
      return "비밀번호 확인이 일치하지 않습니다.";
    }
    if (!String(form.display_name || "").trim()) {
      return "본명을 입력해 주세요.";
    }
    return "";
  }

  function validateInviteForm(form) {
    return validateAuthEmail(form.email, "초대할 이메일");
  }

  function getTransactionFormErrors(form) {
    const errors = createTransactionFormErrors();
    const dateMessage = validateRequiredText(form.occurred_on, "일자를 입력해 주세요.");
    if (dateMessage) {
      errors.occurred_on = dateMessage;
    }
    errors.amount = validateTransactionAmountInput(form.amount);
    return errors;
  }

  function firstTransactionFormError(errors) {
    return errors.occurred_on || errors.amount || "";
  }

  function validateTransactionForm(form) {
    return firstTransactionFormError(getTransactionFormErrors(form));
  }

  function validateCategoryDraftForm() {
    if (categoryDraftMajorSelect === "__custom__" && !String(categoryDraft.major || "").trim()) {
      return "새 대분류를 입력해 주세요.";
    }
    if (categoryDraftMinorSelect === "__custom__" && !String(categoryDraft.minor || "").trim()) {
      return "첫 중분류를 입력해 주세요.";
    }
    return "";
  }

  function validateInlineCategoryCreateDraft(draft) {
    if (!String(draft?.major || "").trim()) {
      return "새 대분류를 입력해 주세요.";
    }
    if (!String(draft?.minor || "").trim()) {
      return "첫 중분류를 입력해 주세요.";
    }
    return "";
  }

  function validateHoldingForm(form, { tracked, showAverageCost }) {
    const nameMessage = validateRequiredText(form.name, "자산명을 입력해 주세요.");
    if (nameMessage) {
      return nameMessage;
    }
    if (tracked) {
      const symbolMessage = validateRequiredText(form.symbol, "심볼을 입력해 주세요.");
      if (symbolMessage) {
        return symbolMessage;
      }
      const quantityMessage = validateDecimalInput(form.quantity, "수량");
      if (quantityMessage) {
        return quantityMessage;
      }
    }
    if (showAverageCost) {
      const averageCostLabel = tracked ? "평균단가" : "평가금액";
      const averageCostMessage = validateDecimalInput(form.average_cost, averageCostLabel, { allowZero: true });
      if (averageCostMessage) {
        return averageCostMessage;
      }
    }
    const currencyMessage = validateRequiredText(form.currency, "통화를 입력해 주세요.");
    if (currencyMessage) {
      return currencyMessage;
    }
    return "";
  }

  function validateHoldingTypeDraftForm() {
    const nextKey = normalizeHoldingTypeKey(holdingTypeDraft.key || holdingTypeDraft.label);
    const nextLabel = String(holdingTypeDraft.label || "").trim();
    if (!nextKey && !nextLabel) {
      return "유형 키와 이름을 입력해 주세요.";
    }
    if (!nextKey) {
      return "유형 키를 입력해 주세요.";
    }
    if (!nextLabel) {
      return "유형 이름을 입력해 주세요.";
    }
    return "";
  }

  function getValidationFieldLabel(target) {
    const labelElement = target?.labels?.[0] || target?.closest?.("label");
    const directLabelText =
      labelElement && typeof Node !== "undefined"
        ? Array.from(labelElement.childNodes || [])
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent || "")
            .join(" ")
        : "";
    const fallbackText =
      target?.getAttribute?.("aria-label") ||
      target?.getAttribute?.("placeholder") ||
      directLabelText ||
      labelElement?.textContent ||
      target?.name ||
      "필수 입력값";
    return String(fallbackText || "필수 입력값")
      .replace(/\*/g, "")
      .replace(/\s+/g, " ")
      .trim() || "필수 입력값";
  }

  function getObjectParticle(text) {
    const lastChar = Array.from(String(text || "").trim()).pop();
    if (!lastChar) {
      return "을";
    }
    const code = lastChar.charCodeAt(0);
    if (code < 0xac00 || code > 0xd7a3) {
      return "을";
    }
    return (code - 0xac00) % 28 === 0 ? "를" : "을";
  }

  function getNativeValidationMessage(target) {
    if (!target?.validity) {
      return "";
    }
    const label = getValidationFieldLabel(target);
    const validity = target.validity;
    if (validity.valueMissing) {
      return `${label}${getObjectParticle(label)} 입력해 주세요.`;
    }
    if (validity.typeMismatch && target.type === "email") {
      return `올바른 ${label.includes("이메일") ? label : "이메일"} 주소를 입력해 주세요.`;
    }
    if (validity.patternMismatch) {
      return `${label} 형식을 확인해 주세요.`;
    }
    if (validity.rangeUnderflow) {
      return `${label}은 최소값 이상으로 입력해 주세요.`;
    }
    if (validity.rangeOverflow) {
      return `${label}은 최대값 이하로 입력해 주세요.`;
    }
    if (validity.stepMismatch || validity.badInput) {
      return `${label} 값을 확인해 주세요.`;
    }
    return "";
  }

  function handleInvalidFormField(event) {
    const target = event.target;
    if (typeof target?.setCustomValidity !== "function") {
      return;
    }
    const validationMessage = getNativeValidationMessage(target);
    if (validationMessage) {
      target.setCustomValidity(validationMessage);
    }
  }

  function clearNativeValidationMessage(event) {
    const target = event.target;
    if (typeof target?.setCustomValidity === "function") {
      target.setCustomValidity("");
    }
  }

  async function runAuth(event) {
    event.preventDefault();
    const currentMode = authMode;
    if (currentMode === "login") {
      const validationMessage = validateLoginForm(authForm);
      if (validationMessage) {
        setMessage(validationMessage);
        return;
      }
    }
    if (currentMode === "register" || currentMode === "verify") {
      const activeForm = currentMode === "verify" ? verifyForm : authForm;
      if (currentMode === "verify") {
        const verifyToken = String(verifyForm.token || "").trim();
        const verificationCode = String(verifyForm.verification_code || "").trim();
        const requiresPasswordSetup = Boolean(verifyForm.requires_password_setup);
        if (!verifyToken && !verificationCode) {
          setMessage("메일의 인증 링크를 열거나 6자리 인증번호를 입력해 주세요.");
          return;
        }
        if (verificationCode && !String(verifyForm.email || "").trim()) {
          setMessage("6자리 인증번호로 인증하려면 이메일을 입력해 주세요.");
          return;
        }
        if (verifyToken && verificationCode) {
          setMessage("인증 토큰과 6자리 인증번호 중 하나만 입력해 주세요.");
          return;
        }
        if (verificationCode && !/^\d{6}$/.test(verificationCode)) {
          setMessage("6자리 숫자 인증번호를 입력해 주세요.");
          return;
        }
        if (requiresPasswordSetup) {
          const password = String(activeForm.password || "");
          const passwordConfirm = String(activeForm.password_confirm || "");
          if (password.length < 8) {
            setMessage("새 비밀번호는 8자 이상이어야 합니다.");
            return;
          }
          if (password !== passwordConfirm) {
            setMessage("새 비밀번호 확인이 일치하지 않습니다.");
            return;
          }
        }
      } else {
        const validationMessage = validateRegisterForm(activeForm);
        if (validationMessage) {
          setMessage(validationMessage);
          return;
        }
      }
    }
    setLoading(true);
    setMessage("");
    try {
      await loadClientConfig();
      if (currentMode === "verify") {
        const verifyToken = String(verifyForm.token || "").trim();
        const verificationCode = String(verifyForm.verification_code || "").trim();
        const verifyPayload = {
          remember_me: keepSignedIn,
        };
        if (verifyForm.requires_password_setup) {
          verifyPayload.password = verifyForm.password;
        }
        if (verifyToken) {
          verifyPayload.token = verifyToken;
        } else {
          verifyPayload.email = verifyForm.email;
          verifyPayload.verification_code = verificationCode;
        }
        const verifyResp = await api(`${API_PREFIX}/auth/verify-email`, {
          method: "POST",
          body: JSON.stringify(verifyPayload),
        });
        await finishAuthFlow(verifyResp);
        return;
      } else if (currentMode === "login") {
        await api(`${API_PREFIX}/auth/login`, {
          method: "POST",
          body: JSON.stringify({
            email: String(authForm.email || "").trim(),
            password: authForm.password,
            remember_me: keepSignedIn,
          }),
        });
      } else {
        const registerResp = await api(`${API_PREFIX}/auth/register`, {
          method: "POST",
          body: JSON.stringify({
            email: String(authForm.email || "").trim(),
            password: authForm.password,
            display_name: String(authForm.display_name || "").trim(),
            remember_me: keepSignedIn,
          }),
        });
        if (registerResp?.status === "verification_required") {
          const debugToken = String(registerResp?.debug_verification_token || "").trim();
          const sentAt = Date.now();
          setVerificationMeta({
            ...verificationMetaFromPayload(registerResp, createVerificationMeta(), sentAt),
            lastResendAt: sentAt,
            resendUsedCount: 0,
          });
          setNowTick(sentAt);
          setAuthMode("verify");
          setVerifyForm({
            email: String(registerResp?.email || authForm.email || ""),
            token: DEBUG_TOKEN_OPT_IN ? debugToken : "",
            verification_code: "",
            password: "",
            password_confirm: "",
            requires_password_setup: false,
            password_setup_reason: "",
          });
          setMessage("");
          return;
        }
      }

      await finishAuthFlow(null, null, { showSuccessMessage: currentMode !== "login" });
    } catch (error) {
      setActiveHouseholdId("");
      setToken("");
      if (currentMode === "verify" && isRegistrationPasswordSetupRequired(error)) {
        setVerifyForm((prev) => ({
          ...prev,
          password: "",
          password_confirm: "",
          requires_password_setup: true,
          password_setup_reason: prev.token ? "token" : "code",
        }));
        setMessage(registrationPasswordSetupMessage());
        return;
      }
      setMessage(formatAuthError(error, currentMode));
    } finally {
      setLoading(false);
    }
  }

  async function resendVerification() {
    const email = String(verifyForm.email || authForm.email || "").trim();
    if (!email) {
      setMessage(uiGuideMessage("이메일을 입력해 주세요.", "인증 메일을 받을 이메일 주소를 입력한 뒤 재전송해 주세요."));
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      await loadClientConfig();
      const payload = await api(`${API_PREFIX}/auth/resend-verification`, {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      const debugToken = String(payload?.debug_verification_token || "").trim();
      if (debugToken && DEBUG_TOKEN_OPT_IN) {
        setVerifyForm((prev) => ({
          ...prev,
          token: debugToken,
          verification_code: "",
          password: "",
          password_confirm: "",
          requires_password_setup: false,
          password_setup_reason: "",
        }));
      }
      setVerifyForm((prev) => ({
        ...prev,
        email: String(payload?.email || prev.email || email),
        password: "",
        password_confirm: "",
        requires_password_setup: false,
        password_setup_reason: "",
      }));
      const sentAt = Date.now();
      setVerificationMeta((prev) => {
        const next = verificationMetaFromPayload(payload, prev, sentAt);
        const resendLimit = Number(next.resendLimit || 0);
        const usedCount = Math.max(0, Number(prev.resendUsedCount || 0) + 1);
        return {
          ...next,
          lastResendAt: sentAt,
          resendUsedCount: resendLimit > 0 ? Math.min(resendLimit, usedCount) : usedCount,
        };
      });
      setNowTick(sentAt);
      setMessage("");
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
      setActiveHouseholdId(householdId);
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
    const validationMessage = validateInviteForm(inviteForm);
    if (validationMessage) {
      setInviteFormErrors({ email: validationMessage });
      inviteEmailInputRef.current?.setCustomValidity?.(validationMessage);
      inviteEmailInputRef.current?.focus({ preventScroll: true });
      setMessage(validationMessage);
      return;
    }
    setInviteFormErrors({ email: "" });
    inviteEmailInputRef.current?.setCustomValidity?.("");
    setLoading(true);
    setMessage("");
    try {
      const payload = await api(
        `${API_PREFIX}/household/invitations`,
        {
          method: "POST",
          body: JSON.stringify({
            email: String(inviteForm.email || "").trim(),
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
      setInviteFormErrors({ email: "" });
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
    if (!canEditRecords) {
      setMessage(uiGuideMessage("현재 권한으로는 거래를 저장할 수 없습니다.", "가계 소유자에게 편집자 이상 권한을 요청해 주세요."));
      return;
    }
    const transactionErrors = getTransactionFormErrors(txForm);
    const validationMessage = firstTransactionFormError(transactionErrors);
    setTxFormErrors(transactionErrors);
    if (validationMessage) {
      setMessage(validationMessage);
      focusFirstTransactionFormError(transactionErrors);
      return;
    }
    setTxFormSubmitting(true);
    setLoading(true);
    setMessage("");
    try {
      const keepQuickEntryOpen = isCompactViewport && showTransactionForm && txEntrySheetStep === "form";
      const payload = buildTransactionPayloadFromForm(txForm);
      const isAnchoredInsert = Boolean(payload.anchor_transaction_id && payload.insert_position);
      const repeatForm = createRepeatTransactionForm(
        txForm,
        normalizeIsoDateKey(payload.occurred_on, transactionLocalTodayRef.current || todayIso())
      );
      const createdTransaction = await api(
        `${API_PREFIX}/transactions`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
        token
      );
      setTxForm(repeatForm);
      setTxFormErrors(createTransactionFormErrors());
      setTxCategoryRestore(null);
      setTxDraftTouched(false);
      setShowTransactionEntryBanner(false);
      setTxEntrySheetStep("form");
      setShowTransactionQuickResume(false);
      await revealSavedTransactionInList(createdTransaction, payload.occurred_on, { alignToEnd: !isAnchoredInsert });
      focusTransactionAmountForRepeatEntry();
      setMessage(
        keepQuickEntryOpen
          ? ""
          : isAnchoredInsert
            ? uiGuideMessage("선택한 위치에 거래를 삽입했습니다.", "같은 기준으로 다음 거래 금액을 바로 입력할 수 있습니다.")
            : uiGuideMessage("거래를 등록했습니다.", "필터를 초기화하고 저장한 거래를 표시했습니다. 다음 거래 금액을 바로 입력할 수 있습니다.")
      );
    } catch (error) {
      setMessage(formatApiError(error, "transaction_submit"));
    } finally {
      setTxFormSubmitting(false);
      setLoading(false);
    }
  }

  function holdingPayloadFromForm(form) {
    const tracked = isMarketTrackedAssetType(form.asset_type);
    const fallbackSymbol = buildLocalHoldingSymbol(form);
    const symbol = tracked ? String(form.symbol || "").trim() : fallbackSymbol;
    const marketSymbol = tracked ? String(form.market_symbol || symbol).trim() : fallbackSymbol;
    const normalizedTypeKey = normalizeHoldingTypeKey(form.type_key || form.asset_type || "other") || "other";
    const parsedDisplayOrder = Number(form.display_order);
    return {
      asset_type: form.asset_type,
      type_key: normalizedTypeKey,
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
      display_order: Number.isFinite(parsedDisplayOrder) && parsedDisplayOrder > 0 ? parsedDisplayOrder : undefined,
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

  function legacyOwnerCountText(row) {
    const parts = [];
    if (row.transactions.length > 0) {
      parts.push(`거래 ${fmt(row.transactions.length)}건`);
    }
    if (row.holdings.length > 0) {
      parts.push(`자산 ${fmt(row.holdings.length)}건`);
    }
    return parts.join(" · ");
  }

  async function applyLegacyOwnerRemap(rowKey) {
    if (!canEditRecords) {
      setMessage(uiGuideMessage("현재 권한으로는 소유자를 매핑할 수 없습니다.", "가계 소유자에게 편집자 이상 권한을 요청해 주세요."));
      return;
    }
    const row = legacyOwnerCleanupRows.find((item) => item.key === rowKey);
    if (!row) {
      return;
    }
    const targetValue = ownerRemapTargets[row.key] || defaultOwnerRemapOption?.value || "";
    const target = ownerMemberOptions.find((option) => option.value === targetValue);
    if (!target) {
      setMessage(uiGuideMessage("매핑할 현재 구성원을 선택해 주세요.", "대상 구성원을 선택한 뒤 다시 실행해 주세요."));
      return;
    }
    setOwnerRemappingKey(row.key);
    setLoading(true);
    setMessage("");
    try {
      const remapResult = await api(
        `${API_PREFIX}/household/legacy-owner-remap`,
        {
          method: "POST",
          body: JSON.stringify({
            owner_name: row.ownerName,
            target_owner_user_id: target.value,
          }),
        },
        token
      );
      await refreshData(false);
      await loadOwnerCleanupTransactions(token);
      const total = Number(remapResult?.remapped_transactions || 0) + Number(remapResult?.remapped_holdings || 0);
      const targetDisplayName = remapResult?.target_owner_name || target.displayName;
      setMessage(
        uiGuideMessage(
          "기존 소유자를 현재 구성원으로 매핑했습니다.",
          `${remapResult?.source_owner_name || row.ownerName} ${fmt(total)}건을 ${targetDisplayName}으로 연결했습니다.`
        )
      );
    } catch (error) {
      setMessage(formatApiError(error, "owner_remap"));
    } finally {
      setOwnerRemappingKey("");
      setLoading(false);
    }
  }

  function renderLegacyOwnerRemapHelper({ ownerUserId = "", ownerName = "", disabled = false, onApply }) {
    const normalizedOwnerName = normalizeOwnerName(ownerName);
    if (!isLegacyOwnerIdentity(ownerUserId, normalizedOwnerName)) {
      return null;
    }
    const target = defaultOwnerRemapOption;
    return (
      <div className="owner-legacy-helper">
        <span>기존 값은 현재 가계 구성원과 연결되지 않은 과거/가져오기 소유자명입니다.</span>
        {target && (
          <button
            type="button"
            className="secondary inline-owner-remap-btn"
            onClick={() => onApply?.(target)}
            disabled={disabled}
          >
            현재 구성원으로 매핑
          </button>
        )}
      </div>
    );
  }

  function notifyTransactionEditPermissionDenied() {
    setMessage(uiGuideMessage("현재 권한으로는 거래를 수정할 수 없습니다.", "가계 소유자에게 편집자 이상 권한을 요청해 주세요."));
  }

  function openTransactionInlineEditor(item) {
    if (!item) {
      return;
    }
    if (!canEditRecords) {
      notifyTransactionEditPermissionDenied();
      return;
    }
    const category = categoryById.get(String(item.category_id || ""));
    setTxInlineEdit({
      id: item.id,
      version: item.version,
      occurred_on: item.occurred_on,
      flow_type: item.flow_type,
      amount: normalizeDecimalInputValue(item.amount),
      category_id: item.category_id || "",
      category_major: category?.major || "",
      memo: item.memo || "",
      owner_user_id: item.owner_user_id || "",
      owner_name: item.owner_name || "",
      mode: "edit",
      anchor_transaction_id: "",
      insert_position: "",
    });
  }

  function createAnchoredTransactionDraft(anchor, position) {
    const category = categoryById.get(String(anchor?.category_id || ""));
    return {
      ...createTransactionForm(anchor?.occurred_on || transactionEntryContextDate()),
      id: anchor?.id || "",
      version: anchor?.version || 0,
      occurred_on: anchor?.occurred_on || transactionEntryContextDate(),
      flow_type: anchor?.flow_type || "expense",
      amount: "",
      category_id: anchor?.category_id || "",
      category_major: category?.major || "",
      memo: "",
      owner_user_id: anchor?.owner_user_id || "",
      owner_name: anchor?.owner_name || "",
      anchor_id: anchor?.id || "",
      anchor_transaction_id: anchor?.id || "",
      insert_position: position,
      mode: "insert",
    };
  }

  function openSelectedTransactionEdit() {
    if (!singleSelectedTransaction) {
      return;
    }
    openTransactionInlineEditor(singleSelectedTransaction);
  }

  function openSelectedTransactionInsert(position) {
    if (!singleSelectedTransaction || !canEditRecords) {
      return;
    }
    const draft = createAnchoredTransactionDraft(singleSelectedTransaction, position);
    if (isTransactionLedgerCompactViewport) {
      setTxForm(draft);
      setTxFormErrors(createTransactionFormErrors());
      setTxCategoryMajor(draft.category_major || "");
      setTxCategoryRestore(null);
      setTxDraftTouched(false);
      setShowTransactionEntryBanner(false);
      setShowTransactionQuickResume(false);
      setTxInlineEdit(null);
      openTransactionEntrySheet("form");
      focusTransactionAmountForRepeatEntry();
      return;
    }
    setTxInlineEdit(draft);
  }

  async function removeSelectedTransactions() {
    if (!canEditRecords) {
      setMessage(uiGuideMessage("현재 권한으로는 거래를 삭제할 수 없습니다.", "가계 소유자에게 편집자 이상 권한을 요청해 주세요."));
      return;
    }
    const ids = selectedTransactionItems.map((item) => String(item.id || "").trim()).filter(Boolean);
    if (ids.length === 0) {
      return;
    }
    if (ids.length === 1) {
      await removeTx(ids[0]);
      return;
    }
    const confirmed = await requestConfirmDialog({
      title: "선택한 거래를 삭제할까요?",
      action: `${ids.length}건을 한 번에 삭제합니다. 삭제하려면 선택 삭제를 눌러 주세요.`,
      confirmLabel: "선택 삭제",
    });
    if (!confirmed) {
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const result = await api(
        `${API_PREFIX}/transactions/bulk-delete`,
        {
          method: "POST",
          body: JSON.stringify({ transaction_ids: ids }),
        },
        token
      );
      const deletedIds = new Set((result?.deleted_ids || ids).map((id) => String(id || "").trim()).filter(Boolean));
      setSelectedTransactionIds((prev) => {
        const next = new Set(prev);
        for (const id of deletedIds) {
          next.delete(id);
        }
        return next;
      });
      setTransactions((prev) =>
        Array.isArray(prev) ? prev.filter((item) => !deletedIds.has(String(item?.id || "").trim())) : prev
      );
      try {
        await refreshData(false);
      } catch (refreshError) {
        setMessage(
          uiGuideMessage(
            "선택한 거래를 삭제했지만 목록 새로고침에 실패했습니다.",
            formatApiError(refreshError, "transaction_delete")
          )
        );
        return;
      }
      setMessage(uiGuideMessage("선택한 거래를 삭제했습니다.", `${deletedIds.size}건을 목록에서 제거했습니다.`));
    } catch (error) {
      setMessage(formatApiError(error, "transaction_delete"));
    } finally {
      setLoading(false);
    }
  }

  function applyTransactionOwnerOption(option) {
    setTxQuickOwnerTouched(true);
    setTxDraftTouched(true);
    setTxForm((prev) => ({
      ...prev,
      owner_user_id: option.value,
      owner_name: option.displayName || "",
    }));
  }

  function applyHoldingOwnerOption(option) {
    setHoldingOwnerTouched(true);
    setHoldingDraftTouched(true);
    setHoldingForm((prev) => ({
      ...prev,
      owner_user_id: option.value,
      owner_name: option.displayName || "",
    }));
  }

  function renderOwnerQuickSelect({ ownerLabel, testId, selectedValue = "", disabled = false, onSelect }) {
    if (ownerMemberOptions.length === 0) {
      return null;
    }
    const normalizedSelectedValue = String(selectedValue || "").trim();
    return (
      <div className="owner-quick-select" data-testid={testId} role="group" aria-label={`${ownerLabel} 빠른 선택`}>
        {ownerMemberOptions.map((option) => {
          const displayName = option.displayName || option.label;
          const selected = option.value === normalizedSelectedValue;
          return (
            <button
              key={option.value}
              type="button"
              className={`owner-quick-chip${selected ? " selected" : ""}`}
              aria-label={`${displayName} ${ownerLabel} 선택`}
              aria-pressed={selected ? "true" : "false"}
              title={option.email ? `${displayName} (${option.email})` : displayName}
              onClick={() => onSelect?.(option)}
              disabled={disabled}
            >
              <span className="owner-quick-chip-name">{displayName}</span>
            </button>
          );
        })}
      </div>
    );
  }

  async function submitHolding(event) {
    event.preventDefault();
    if (!canEditRecords) {
      setMessage(uiGuideMessage("현재 권한으로는 자산을 저장할 수 없습니다.", "가계 소유자에게 편집자 이상 권한을 요청해 주세요."));
      return;
    }
    const validationMessage = validateHoldingForm(holdingForm, {
      tracked: holdingFormTracked,
      showAverageCost: holdingFormShowAverageCost,
    });
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }
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
      const nextForm = {
        ...createHoldingForm(holdingForm.asset_type, holdingForm.type_key, holdingFormType?.label),
        owner_user_id: holdingForm.owner_user_id,
        owner_name: holdingForm.owner_name,
      };
      setHoldingForm(nextForm);
      setHoldingDraftTouched(false);
      setHoldingOwnerTouched(
        holdingOwnerTouched || Boolean(nextForm.owner_user_id || nextForm.owner_name)
      );
      closeHoldingEntrySheet({ skipDraftGuard: true });
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
    if (txInlineEditSubmittingRef.current) {
      return;
    }
    if (!canEditRecords) {
      setMessage(uiGuideMessage("현재 권한으로는 거래를 수정할 수 없습니다.", "가계 소유자에게 편집자 이상 권한을 요청해 주세요."));
      return;
    }
    if (!txInlineEdit?.id) return;
    const validationMessage = validateTransactionForm(txInlineEdit);
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }
    txInlineEditSubmittingRef.current = true;
    setTxInlineEditSubmitting(true);
    setLoading(true);
    setMessage("");
    try {
      const payload = buildTransactionPayloadFromForm(txInlineEdit);
      if (txInlineEdit.mode === "insert") {
        const createdTransaction = await api(
          `${API_PREFIX}/transactions`,
          {
            method: "POST",
            body: JSON.stringify(payload),
          },
          token
        );
        closeTxInlineEdit();
        await revealSavedTransactionInList(createdTransaction, payload.occurred_on || txInlineEdit.occurred_on, {
          alignToEnd: false,
        });
        setMessage(uiGuideMessage("선택한 위치에 거래를 삽입했습니다.", "삽입한 거래를 목록에서 확인할 수 있습니다."));
        return;
      }
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
      const updatedTransaction = await api(
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
      await revealSavedTransactionInList(
        updatedTransaction,
        dirtyPatch.occurred_on || txInlineEdit.occurred_on || transactionLocalTodayRef.current || todayIso(),
        { alignToEnd: true }
      );
      setMessage(uiGuideMessage("거래를 수정했습니다.", "필터를 초기화하고 수정한 거래를 표시했습니다."));
    } catch (error) {
      setMessage(formatApiError(error, "transaction_submit"));
    } finally {
      txInlineEditSubmittingRef.current = false;
      setTxInlineEditSubmitting(false);
      setLoading(false);
    }
  }

  async function submitHoldingInlineEdit(event) {
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    if (!canEditRecords) {
      setMessage(uiGuideMessage("현재 권한으로는 자산을 수정할 수 없습니다.", "가계 소유자에게 편집자 이상 권한을 요청해 주세요."));
      return;
    }
    if (!holdingInlineEdit?.id) {
      return;
    }
    const inlineType =
      holdingTypeByKey.get(normalizeHoldingTypeKey(holdingInlineEdit.type_key || holdingInlineEdit.asset_type || "")) || holdingFormType;
    const validationMessage = validateHoldingForm(holdingInlineEdit, {
      tracked: Boolean(inlineType?.tracked ?? isMarketTrackedAssetType(holdingInlineEdit.asset_type)),
      showAverageCost: Boolean(inlineType?.show_average_cost ?? true),
    });
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const payload = holdingPayloadFromForm(holdingInlineEdit);
      const originalHolding = holdingById.get(holdingInlineEdit.id);
      const patchPayload = {
        type_key: payload.type_key,
        market_symbol: payload.market_symbol,
        name: payload.name,
        category: payload.category,
        owner_user_id: payload.owner_user_id,
        owner_name: payload.owner_name,
        account_name: payload.account_name,
        quantity: payload.quantity,
        average_cost: payload.average_cost,
        currency: payload.currency,
        display_order: payload.display_order,
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
        holding_settings: normalizeHoldingSettings(householdSettingsForm.holding_settings),
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
        holding_settings: normalizeHoldingSettings(nextSettings?.holding_settings),
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
    const validationMessage = validateCategoryDraftForm();
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const createdCategory = await api(
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
      setCategoryDraftMajorSelect("__custom__");
      setCategoryDraftMinorSelect("__custom__");
      setCategoryQuickSelectedId(String(createdCategory?.id || "").trim());
      await loadAuthContext(token);
      setMessage(uiGuideMessage("카테고리를 추가했습니다.", "거래 입력 폼 옵션에도 즉시 반영되었습니다."));
    } catch (error) {
      setMessage(formatApiError(error, "category_create"));
    } finally {
      setLoading(false);
    }
  }

  async function createAndApplyTransactionCategory(draft) {
    const validationMessage = validateInlineCategoryCreateDraft(draft);
    if (validationMessage) {
      setMessage(validationMessage);
      return false;
    }
    const flowType = String(txForm.flow_type || "expense").trim() || "expense";
    setLoading(true);
    setMessage("");
    try {
      const createdCategory = await api(
        `${API_PREFIX}/categories`,
        {
          method: "POST",
          body: JSON.stringify({
            flow_type: flowType,
            major: String(draft.major || "").trim(),
            minor: String(draft.minor || "").trim(),
          }),
        },
        token
      );
      const createdId = String(createdCategory?.id || "").trim();
      setCategoryQuickSelectedId(createdId);
      await loadAuthContext(token);
      applyTransactionCategory(createdId, createdCategory);
      setMessage(uiGuideMessage("카테고리를 추가했습니다.", "새 카테고리를 현재 거래 초안에 바로 적용했습니다."));
      focusTransactionAfterCategoryCreate();
      return createdCategory;
    } catch (error) {
      setMessage(formatApiError(error, "category_create"));
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function createAndApplyTxInlineCategory(draft) {
    if (!txInlineEdit) {
      setMessage("수정 중인 거래가 없습니다.");
      return false;
    }
    const validationMessage = validateInlineCategoryCreateDraft(draft);
    if (validationMessage) {
      setMessage(validationMessage);
      return false;
    }
    const editId = txInlineEdit.id;
    const flowType = String(txInlineEdit.flow_type || "expense").trim() || "expense";
    setLoading(true);
    setMessage("");
    try {
      const createdCategory = await api(
        `${API_PREFIX}/categories`,
        {
          method: "POST",
          body: JSON.stringify({
            flow_type: flowType,
            major: String(draft.major || "").trim(),
            minor: String(draft.minor || "").trim(),
          }),
        },
        token
      );
      const createdId = String(createdCategory?.id || "").trim();
      setCategoryQuickSelectedId(createdId);
      await loadAuthContext(token);
      setTxInlineEdit((prev) =>
        prev && prev.id === editId
          ? {
              ...prev,
              category_id: createdId,
              category_major: String(createdCategory?.major || draft.major || "").trim(),
          }
          : prev
      );
      setMessage(uiGuideMessage("카테고리를 추가했습니다.", "새 카테고리를 수정 중인 거래에 바로 적용했습니다."));
      focusTxInlineAfterCategoryCreate();
      return createdCategory;
    } catch (error) {
      setMessage(formatApiError(error, "category_create"));
      return false;
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
      setCategoryQuickSelectedId((prev) => (prev === category.id ? "" : prev));
      setCategoryUsageExpanded((prev) => ({ ...prev, [category.id]: false }));
      setCategoryUsageById((prev) => {
        if (!prev || !Object.prototype.hasOwnProperty.call(prev, category.id)) {
          return prev;
        }
        const next = { ...prev };
        delete next[category.id];
        return next;
      });
      setMessage(uiGuideMessage("카테고리를 삭제했습니다.", "사용 중이지 않은 카테고리만 정리했습니다."));
    } catch (error) {
      setMessage(formatApiError(error, "category_delete"));
    } finally {
      setLoading(false);
    }
  }

  async function toggleCategoryUsageDetails(category) {
    const categoryId = String(category?.id || "").trim();
    if (!categoryId) {
      return;
    }
    const nextExpanded = !categoryUsageExpanded[categoryId];
    setCategoryUsageExpanded((prev) => ({
      ...prev,
      [categoryId]: nextExpanded,
    }));
    if (!nextExpanded || categoryUsageById[categoryId]) {
      return;
    }
    setCategoryUsageLoadingId(categoryId);
    try {
      const payload = await api(`${API_PREFIX}/categories/${categoryId}/usage`, {}, token);
      setCategoryUsageById((prev) => ({
        ...prev,
        [categoryId]: Array.isArray(payload) ? payload : [],
      }));
    } catch (error) {
      setMessage(formatApiError(error, "category_usage"));
    } finally {
      setCategoryUsageLoadingId((prev) => (prev === categoryId ? "" : prev));
    }
  }

  function editSelectedCategoryQuick() {
    const selected = categories.find((item) => String(item.id) === String(categoryQuickSelectedId));
    if (!selected) {
      setMessage("수정할 카테고리를 먼저 선택해 주세요.");
      return;
    }
    setCategoryEditId(selected.id);
    setCategoryEditForm({ major: selected.major, minor: selected.minor });
  }

  function deleteSelectedCategoryQuick() {
    const selected = categories.find((item) => String(item.id) === String(categoryQuickSelectedId));
    if (!selected) {
      setMessage("삭제할 카테고리를 먼저 선택해 주세요.");
      return;
    }
    void deleteCategoryPair(selected);
  }

  function dismissOnboardingGuide() {
    const seenKey = onboardingSeenKey(user?.id, household?.id);
    if (seenKey) {
      localStorage.setItem(seenKey, "1");
    }
    setShowOnboardingGuide(false);
  }

  function startOnboardingFlow() {
    if (!canEditRecords) {
      setShowOnboardingGuide(false);
      setTab("transactions");
      notifyTransactionEditPermissionDenied();
      return;
    }
    dismissOnboardingGuide();
    setShowTransactionEntryBanner(true);
    setTab("transactions");
    openNormalTransactionEntrySheet("form");
  }

  async function copyImportReportCsv() {
    if (!importReportVisibleRows.length) {
      setMessage("복사할 정리 표 행이 없습니다.");
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(importReportCsv);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = importReportCsv;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setMessage("정리 표 CSV를 클립보드에 복사했습니다.");
    } catch {
      setMessage("브라우저 권한 때문에 CSV 복사에 실패했습니다. 다운로드를 사용하세요.");
    }
  }

  function downloadImportReportCsv() {
    if (!importReportVisibleRows.length) {
      setMessage("내보낼 정리 표 행이 없습니다.");
      return;
    }
    const blob = new Blob(["\uFEFF", importReportCsv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `import-report-issues-${todayIso()}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    setMessage("정리 표 CSV를 다운로드했습니다.");
  }

  async function showImportedTransactions({ startEdit = false } = {}) {
    if (importAppliedTransactionRefs.length === 0) {
      setMessage("가져온 거래가 없습니다.");
      return;
    }
    const ids = importAppliedTransactionRefs.map((item) => item.id);
    const firstRef = importAppliedTransactionRefs[0];
    const targetMonth = getImportRefMonth(firstRef) || yearMonthRef.current;
    setRecentImportTransactionIds(new Set(ids));
    setRecentSavedTransactionIds(new Set());
    setRecentImportHoldingIds(new Set());
    clearTxListFilter();
    setFilterMode("month");
    filterModeRef.current = "month";
    setYearMonth(targetMonth);
    yearMonthRef.current = targetMonth;
    appliedYearMonthRef.current = targetMonth;
    setMonthFilterPending(false);
    transactionLatestAnchorSuppressedRef.current = true;
    transactionLatestAnchorPendingRef.current = false;
    if (startEdit) {
      setPendingImportEditTransactionId(firstRef.id);
    }
    try {
      setTab("transactions");
      await refreshDataWithUiFeedback({ filterMode: "month", yearMonth: targetMonth });
      transactionLatestAnchorPendingRef.current = false;
      scrollToDataRow("data-transaction-id", firstRef.id);
    } finally {
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            transactionLatestAnchorSuppressedRef.current = false;
          });
        });
      } else {
        transactionLatestAnchorSuppressedRef.current = false;
      }
    }
  }

  function showImportedHoldings({ startEdit = false } = {}) {
    if (importAppliedHoldingRefs.length === 0) {
      setMessage("가져온 자산이 없습니다.");
      return;
    }
    const ids = importAppliedHoldingRefs.map((item) => item.id);
    const firstRef = importAppliedHoldingRefs[0];
    setRecentImportHoldingIds(new Set(ids));
    setRecentImportTransactionIds(new Set());
    setRecentSavedTransactionIds(new Set());
    setHoldingListTab("all");
    setHoldingTypeFilter("all");
    if (startEdit) {
      setPendingImportEditHoldingId(firstRef.id);
    }
    setTab("holdings");
    scrollToDataRow("data-holding-id", firstRef.id);
  }

  async function startImportedCorrection() {
    if (importAppliedTransactionRefs.length > 0) {
      await showImportedTransactions({ startEdit: true });
      return;
    }
    showImportedHoldings({ startEdit: true });
  }

  async function doImport(mode) {
    if (!canEditRecords) {
      setMessage(uiGuideMessage("현재 권한으로는 데이터를 가져올 수 없습니다.", "가계 소유자에게 편집자 이상 권한을 요청해 주세요."));
      return;
    }
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
        setRecentImportTransactionIds(new Set(normalizeImportAppliedTransactionRefs(report).map((item) => item.id)));
        setRecentSavedTransactionIds(new Set());
        setRecentImportHoldingIds(new Set(normalizeImportAppliedHoldingRefs(report).map((item) => item.id)));
        await loadAuthContext(token);
        await refreshData(false);
      } else {
        setRecentImportTransactionIds(new Set());
        setRecentSavedTransactionIds(new Set());
        setRecentImportHoldingIds(new Set());
        setPendingImportEditTransactionId("");
        setPendingImportEditHoldingId("");
      }
      setMessage(`${IMPORT_MODE_LABELS[mode] || mode} 완료`);
    } catch (error) {
      setMessage(formatImportError(error, mode));
    } finally {
      setImportLoadingMode("");
      setLoading(false);
    }
  }

  async function exportMigrationPackage() {
    if (!canEditRecords) {
      setMessage(uiGuideMessage("현재 권한으로는 이식 패키지를 추출할 수 없습니다.", "가계 소유자에게 편집자 이상 권한을 요청해 주세요."));
      return;
    }
    setMigrationExporting(true);
    setLoading(true);
    setMessage("이식 패키지를 생성하는 중입니다. 잠시만 기다려 주세요.");
    try {
      const path = `${API_PREFIX}/imports/migration-package/export`;
      const response = await api(
        path,
        {
          method: "GET",
          responseType: "blob",
        },
        token
      );
      const blob = await response.blob();
      const disposition = String(response.headers.get("content-disposition") || "");
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const filename = String(match?.[1] || "").trim() || `moneyflow-transfer-${Date.now()}.zip`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setMessage(uiGuideMessage("이식 패키지를 다운로드했습니다.", "운영 환경에서 패키지 업로드로 dry-run 후 적용할 수 있습니다."));
    } catch (error) {
      setMessage(formatMigrationError(error, "export"));
    } finally {
      setMigrationExporting(false);
      setLoading(false);
    }
  }

  async function doMigrationImport(mode) {
    if (!canEditRecords) {
      setMessage(uiGuideMessage("현재 권한으로는 이식 패키지를 적용할 수 없습니다.", "가계 소유자에게 편집자 이상 권한을 요청해 주세요."));
      return;
    }
    if (!migrationPackageFile) {
      setMessage("업로드할 이식 패키지 파일(.zip)을 먼저 선택해 주세요.");
      return;
    }
    let replaceExisting = false;
    if (mode === "apply") {
      const confirmed = await requestConfirmDialog({
        title: "현재 가계 데이터를 이식 패키지로 교체할까요?",
        action: "적용 시 현재 거래/보유/카테고리 데이터가 교체됩니다.",
        confirmLabel: "교체 적용",
      });
      if (!confirmed) {
        return;
      }
      replaceExisting = true;
    }

    setMigrationLoadingMode(mode);
    setLoading(true);
    setMessage(`${IMPORT_MODE_LABELS[mode] || mode} 요청을 처리 중입니다. 잠시만 기다려 주세요.`);
    try {
      const formData = new FormData();
      formData.append("file", migrationPackageFile);
      const report = await api(
        `${API_PREFIX}/imports/migration-package/upload?mode=${mode}&replace_existing=${replaceExisting ? "true" : "false"}`,
        {
          method: "POST",
          body: formData,
        },
        token
      );
      setMigrationReport(report);
      if (mode === "apply") {
        await loadAuthContext(token);
        await refreshData(false);
      }
      setMessage(`${IMPORT_MODE_LABELS[mode] || mode} 완료`);
    } catch (error) {
      setMessage(formatMigrationError(error, mode));
    } finally {
      setMigrationLoadingMode("");
      setLoading(false);
    }
  }

  function updateTossPreviewRow(rowId, patch) {
    setTossPreview((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        rows: recomputeTossDuplicateRows(
          (prev.rows || []).map((row) =>
            String(row.row_id) === String(rowId) ? patchTossRowWithInference(row, patch, categories) : row
          )
        ),
      };
    });
  }

  function prepareTossRowsForApply(rows) {
    return rows.map((row) => {
      const amount = decimalPayload(row.amount);
      return {
        ...row,
        amount,
        signed_amount: signedAmountPayload(row, amount),
        balance: decimalPayload(row.balance),
        category_id: String(row.category_id || "").trim() || null,
        detail: String(row.detail || "").trim(),
        item_name: String(row.item_name || "").trim(),
      };
    });
  }

  function setTossImportFiles(files) {
    setTossFiles(normalizeFileArray(files));
    setTossPreview(null);
    setTossApplyReport(null);
  }

  async function doTossPreview() {
    if (!canEditRecords) {
      setMessage(uiGuideMessage("현재 권한으로는 데이터를 가져올 수 없습니다.", "가계 소유자에게 편집자 이상 권한을 요청해 주세요."));
      return;
    }
    if (tossFiles.length === 0) {
      setMessage("토스 스크린샷 이미지를 먼저 업로드해 주세요.");
      return;
    }
    setTossLoadingMode("preview");
    setLoading(true);
    setImportReport(null);
    setTossApplyReport(null);
    setMessage("토스 스크린샷을 로컬 OCR로 읽고 있습니다.");
    try {
      const formData = new FormData();
      for (const file of tossFiles) {
        formData.append("files", file);
      }
      const preview = await api(
        `${API_PREFIX}/imports/toss-screenshots/preview`,
        {
          method: "POST",
          body: formData,
        },
        token
      );
      setTossPreview(preview);
      const parsedRows = Number(preview?.summary?.parsed_rows || 0);
      const excludedRows = Number(preview?.summary?.excluded_candidates || 0);
      setMessage(`토스 거래 ${fmt(parsedRows)}건을 검토 표에 올렸습니다. 제외 후보 ${fmt(excludedRows)}건`);
    } catch (error) {
      setMessage(formatImportError(error, "toss_preview"));
    } finally {
      setTossLoadingMode("");
      setLoading(false);
    }
  }

  async function doTossApply() {
    if (!canEditRecords) {
      setMessage(uiGuideMessage("현재 권한으로는 데이터를 가져올 수 없습니다.", "가계 소유자에게 편집자 이상 권한을 요청해 주세요."));
      return;
    }
    if (!tossPreview || tossRows.length === 0) {
      setMessage("먼저 토스 스크린샷 미리보기를 생성해 주세요.");
      return;
    }
    if (tossIncludedCount === 0) {
      setMessage("적용할 행이 없습니다. 필요한 행을 포함으로 바꾼 뒤 다시 시도해 주세요.");
      return;
    }
    setTossLoadingMode("apply");
    setLoading(true);
    setMessage("검토 표에 포함된 토스 거래를 적용 중입니다.");
    try {
      const result = await api(
        `${API_PREFIX}/imports/toss-screenshots/apply`,
        {
          method: "POST",
          body: JSON.stringify({ rows: prepareTossRowsForApply(tossRows) }),
        },
        token
      );
      setTossApplyReport(result);
      if (Number(result?.applied_transactions || 0) > 0) {
        await refreshData(false);
      }
      setMessage(
        `토스 거래 적용 완료: 추가 ${fmt(result?.applied_transactions || 0)}건, 제외/중복 ${fmt(result?.skipped_transactions || 0)}건`
      );
    } catch (error) {
      setMessage(formatImportError(error, "toss_apply"));
    } finally {
      setTossLoadingMode("");
      setLoading(false);
    }
  }

  function startCategoryDraftFromTossRecommendation(row) {
    const recommendation = row?.category_recommendation;
    if (!recommendation) {
      return;
    }
    setCategoryDraft({
      flow_type: row.flow_type || "expense",
      major: recommendation.suggested_major || "",
      minor: recommendation.suggested_minor || "",
    });
    setCategoryDraftMajorSelect("__custom__");
    setCategoryDraftMinorSelect("__custom__");
    setTab("settings");
    setMessage("추천 카테고리 초안을 채웠습니다. 저장 후 가져오기 탭에서 해당 행에 선택할 수 있습니다.");
  }

  async function refreshPriceNow() {
    const shouldPreserveTransactionScroll = tabRef.current === "transactions";
    const transactionDocumentScroll = shouldPreserveTransactionScroll ? captureDocumentScrollPosition() : null;
    setLoading(true);
    try {
      const refreshResp = await requestPriceRefresh({ silent: false, origin: "manual" });
      if (refreshResp && !refreshResp?.in_progress) {
        await refreshDataByKinds(new Set(["holding"]), token, { silent: true });
      }
    } finally {
      setLoading(false);
      if (transactionDocumentScroll && tabRef.current === "transactions") {
        restoreDocumentScrollPosition(transactionDocumentScroll);
      }
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
      const inProgress = Boolean(refreshResp?.in_progress);
      setPriceRefreshPolling(inProgress);
      setPriceStatus((current) => (
        current ? { ...current, refresh_in_progress: inProgress } : current
      ));
      if (inProgress) {
        priceRefreshPollFailureCountRef.current = 0;
      } else {
        releasePriceRefreshLock();
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
    if (!canEditRecords) {
      setMessage(uiGuideMessage("현재 권한으로는 거래를 삭제할 수 없습니다.", "가계 소유자에게 편집자 이상 권한을 요청해 주세요."));
      return;
    }
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
    if (!canEditRecords) {
      setMessage(uiGuideMessage("현재 권한으로는 자산을 삭제할 수 없습니다.", "가계 소유자에게 편집자 이상 권한을 요청해 주세요."));
      return;
    }
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

  function applyHoldingSettingsLocal(nextHoldingSettings, nextPayload = {}) {
    const normalizedSettings = normalizeHoldingSettings(nextHoldingSettings);
    setHouseholdSettings((prev) => ({
      ...prev,
      ...nextPayload,
      transaction_row_colors: normalizeTransactionRowColors(nextPayload?.transaction_row_colors || prev?.transaction_row_colors),
      holding_settings: normalizedSettings,
    }));
    setHouseholdSettingsForm((prev) => ({
      ...prev,
      holding_settings: normalizedSettings,
    }));
  }

  async function persistHoldingSettings(nextHoldingSettings, successMessage = "") {
    setLoading(true);
    setMessage("");
    try {
      const payload = await api(
        `${API_PREFIX}/household/settings`,
        {
          method: "PATCH",
          body: JSON.stringify({
            holding_settings: normalizeHoldingSettings(nextHoldingSettings),
          }),
        },
        token
      );
      applyHoldingSettingsLocal(payload?.holding_settings, payload);
      if (successMessage) {
        setMessage(successMessage);
      }
    } catch (error) {
      setMessage(formatApiError(error, "household_settings"));
    } finally {
      setLoading(false);
    }
  }

  async function moveHoldingDisplayOrder(item, direction) {
    if (!canEditRecords) {
      return;
    }
    const orderedItems = [...holdingItems].sort((left, right) => Number(left.display_order || 0) - Number(right.display_order || 0));
    const currentIndex = orderedItems.findIndex((entry) => entry.holding_id === item.holding_id);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= orderedItems.length) {
      return;
    }
    const targetItem = orderedItems[targetIndex];
    const currentRow = holdingById.get(item.holding_id);
    const targetRow = holdingById.get(targetItem.holding_id);
    if (!currentRow || !targetRow) {
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      await api(
        `${API_PREFIX}/holdings/${currentRow.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            base_version: currentRow.version,
            display_order: Number(targetRow.display_order || targetItem.display_order || 100),
          }),
        },
        token
      );
      await api(
        `${API_PREFIX}/holdings/${targetRow.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            base_version: targetRow.version,
            display_order: Number(currentRow.display_order || item.display_order || 100),
          }),
        },
        token
      );
      await refreshData(false);
      setMessage(uiGuideMessage("자산 순서를 변경했습니다.", "목록 순서가 즉시 반영되었습니다."));
    } catch (error) {
      setMessage(formatApiError(error, "holding_order"));
    } finally {
      setLoading(false);
    }
  }

  function editHoldingType(typeItem) {
    setHoldingTypeEditKey(typeItem.key);
    setHoldingTypeDraft({
      key: typeItem.key,
      label: typeItem.label,
      asset_type: typeItem.asset_type,
      tracked: Boolean(typeItem.tracked),
      show_average_cost: Boolean(typeItem.show_average_cost),
      show_gain_loss: Boolean(typeItem.show_gain_loss),
    });
  }

  function clearHoldingTypeDraft() {
    setHoldingTypeEditKey("");
    setHoldingTypeDraft({
      key: "",
      label: "",
      asset_type: "other",
      tracked: false,
      show_average_cost: true,
      show_gain_loss: false,
    });
  }

  async function saveHoldingTypeDefinition(event) {
    event.preventDefault();
    const validationMessage = validateHoldingTypeDraftForm();
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }
    const nextKey = normalizeHoldingTypeKey(holdingTypeDraft.key || holdingTypeDraft.label);
    const nextLabel = String(holdingTypeDraft.label || "").trim();
    if (!nextKey || !nextLabel) {
      setMessage("유형 키와 이름을 입력해 주세요.");
      return;
    }
    const nextType = {
      key: nextKey,
      label: nextLabel,
      asset_type: holdingTypeDraft.asset_type,
      tracked: Boolean(holdingTypeDraft.tracked),
      show_average_cost: Boolean(holdingTypeDraft.show_average_cost),
      show_gain_loss: Boolean(holdingTypeDraft.show_gain_loss),
    };
    const nextTypes = [...holdingTypeOptions];
    const existingIndex = nextTypes.findIndex((item) => normalizeHoldingTypeKey(item.key) === nextKey);
    if (holdingTypeEditKey) {
      const editIndex = nextTypes.findIndex((item) => normalizeHoldingTypeKey(item.key) === normalizeHoldingTypeKey(holdingTypeEditKey));
      if (editIndex < 0) {
        setMessage("수정할 유형을 찾지 못했습니다.");
        return;
      }
      if (existingIndex >= 0 && existingIndex !== editIndex) {
        setMessage("같은 유형 키가 이미 존재합니다.");
        return;
      }
      nextTypes.splice(editIndex, 1, nextType);
    } else {
      if (existingIndex >= 0) {
        setMessage("같은 유형 키가 이미 존재합니다.");
        return;
      }
      nextTypes.push(nextType);
    }
    const nextSettings = normalizeHoldingSettings({
      ...normalizedHoldingSettings,
      types: nextTypes,
    });
    await persistHoldingSettings(nextSettings, uiGuideMessage("자산 유형 설정을 저장했습니다.", "유형 드롭다운과 표시 규칙이 업데이트되었습니다."));
    clearHoldingTypeDraft();
  }

  async function removeHoldingTypeDefinition(typeKey) {
    const normalizedKey = normalizeHoldingTypeKey(typeKey);
    if (!normalizedKey) {
      return;
    }
    const inUse = holdingItems.some(
      (item) => (normalizeHoldingTypeKey(item.type_key || item.asset_type || "other") || "other") === normalizedKey
    );
    if (inUse) {
      setMessage("사용 중인 유형은 삭제할 수 없습니다. 먼저 자산의 유형을 변경해 주세요.");
      return;
    }
    const nextTypes = holdingTypeOptions.filter(
      (item) => (normalizeHoldingTypeKey(item.key || item.asset_type || "other") || "other") !== normalizedKey
    );
    if (nextTypes.length === 0) {
      setMessage("유형은 최소 1개 이상 유지해야 합니다.");
      return;
    }
    const nextSettings = normalizeHoldingSettings({
      ...normalizedHoldingSettings,
      types: nextTypes,
    });
    await persistHoldingSettings(nextSettings, uiGuideMessage("자산 유형을 삭제했습니다.", "목록과 입력 옵션이 갱신되었습니다."));
    if (normalizeHoldingTypeKey(holdingTypeEditKey) === normalizedKey) {
      clearHoldingTypeDraft();
    }
  }

  async function moveHoldingTypeOrder(typeKey, direction) {
    const normalizedKey = normalizeHoldingTypeKey(typeKey);
    const nextTypes = [...holdingTypeOptions];
    const currentIndex = nextTypes.findIndex(
      (item) => (normalizeHoldingTypeKey(item.key || item.asset_type || "other") || "other") === normalizedKey
    );
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= nextTypes.length) {
      return;
    }
    const swap = nextTypes[currentIndex];
    nextTypes[currentIndex] = nextTypes[targetIndex];
    nextTypes[targetIndex] = swap;
    const nextSettings = normalizeHoldingSettings({
      ...normalizedHoldingSettings,
      types: nextTypes,
    });
    await persistHoldingSettings(nextSettings, uiGuideMessage("유형 순서를 변경했습니다.", "자산 입력 드롭다운 순서에 반영됩니다."));
  }

  async function moveHoldingCategoryOrder(categoryName, direction) {
    const categories = groupedHoldingSections.map(([name]) => name);
    if (!categories.length) {
      return;
    }
    const mergedOrder = [
      ...new Set([
        ...(normalizedHoldingSettings.category_order || []),
        ...categories,
      ]),
    ].filter((item) => categories.includes(item));
    const currentIndex = mergedOrder.findIndex((item) => item === categoryName);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= mergedOrder.length) {
      return;
    }
    const swap = mergedOrder[currentIndex];
    mergedOrder[currentIndex] = mergedOrder[targetIndex];
    mergedOrder[targetIndex] = swap;
    const nextSettings = normalizeHoldingSettings({
      ...normalizedHoldingSettings,
      category_order: mergedOrder,
    });
    await persistHoldingSettings(nextSettings, uiGuideMessage("카테고리 순서를 변경했습니다.", "자산 탭의 그룹 순서에 반영됩니다."));
  }

  function renderHoldingRow(item, rowKey) {
    const row = holdingById.get(item.holding_id);
    const isEditing = Boolean(row && holdingInlineEdit?.id === row.id);
    const editForm = isEditing ? holdingInlineEdit : null;
    const itemTypeKey = normalizeHoldingTypeKey(item.type_key || item.asset_type || "other") || "other";
    const itemType = holdingTypeByKey.get(itemTypeKey);
    const typeLabel = itemType?.label || item.category || itemTypeKey;
    const showGainLoss = Boolean(itemType?.show_gain_loss ?? true);
    const editTypeKey = normalizeHoldingTypeKey(editForm?.type_key || editForm?.asset_type || "other") || "other";
    const editType = holdingTypeByKey.get(editTypeKey) || itemType || holdingTypeOptions[0] || DEFAULT_HOLDING_TYPES[0];
    const editTracked = Boolean(editForm && (editType?.tracked ?? isMarketTrackedAssetType(editForm.asset_type)));
    const editShowAverageCost = Boolean(editType?.show_average_cost ?? true);
    const editShowGainLoss = Boolean(editType?.show_gain_loss ?? editTracked);
    const editOwnerOptions = ownerOptionsWithFallback(editForm?.owner_user_id || "", editForm?.owner_name || "");
    const ownerColor = resolveSemanticColor(
      item.owner_name || typeLabel,
      normalizedHoldingSettings.owner_colors?.[String(item.owner_name || "").trim()] || "",
      { saturation: 72, lightness: 42 }
    );
    const categoryColor = resolveSemanticColor(
      item.category || typeLabel,
      normalizedHoldingSettings.category_colors?.[String(item.category || "").trim()] || "",
      { saturation: 78, lightness: 54 }
    );
    const typeColor = resolveSemanticColor(
      itemTypeKey || typeLabel,
      normalizedHoldingSettings.type_colors?.[itemTypeKey] || "",
      { saturation: 68, lightness: 50 }
    );
    const rowColor = holdingColorMode === "owner" ? ownerColor : holdingColorMode === "category" ? categoryColor : holdingColorMode === "type" ? typeColor : categoryColor;
    const ownerInitial = extractVisibleInitial(item.owner_name);
    const holdingCompactMeta = item.category || typeLabel || "-";
    const isExpanded = expandedHoldingRows.has(item.holding_id);
    const isRecentlyImported = recentImportHoldingIds.has(item.holding_id);
    const holdingMobilePriority = (fieldKey) => getWorkSurfaceMobilePriority("holdings", fieldKey);
    const holdingOrderScope = "전체 자산 순서";
    const holdingMoveUpLabel = `${item.name} ${holdingOrderScope}에서 위로 이동`;
    const holdingMoveDownLabel = `${item.name} ${holdingOrderScope}에서 아래로 이동`;
    const holdingMoveUpTitle = `${item.name}을(를) ${holdingOrderScope} 기준으로 위로 이동합니다.`;
    const holdingMoveDownTitle = `${item.name}을(를) ${holdingOrderScope} 기준으로 아래로 이동합니다.`;
    const handleHoldingEditToggle = () => {
      if (!canEditRecords) {
        return;
      }
      if (!row) {
        return;
      }
      if (isEditing) {
        setHoldingInlineEdit(null);
        return;
      }
      setHoldingInlineEdit(createHoldingInlineEditForm(row));
    };
    return (
      <Fragment key={rowKey}>
        <tr
          className={`holding-row ${isEditing ? "holding-row-editing" : ""} ${isExpanded ? "mobile-row-expanded" : ""} ${isRecentlyImported ? "holding-row-imported" : ""}`}
          data-holding-id={item.holding_id}
          data-import-highlight={isRecentlyImported ? "true" : undefined}
          style={rowColor ? {
            "--holding-row-cue": rowColor,
            "--holding-row-wash-strong": withAlpha(rowColor, holdingColorMode === "none" ? 0.22 : 0.3),
            "--holding-row-wash": withAlpha(rowColor, holdingColorMode === "none" ? 0.17 : 0.23),
            "--holding-row-wash-soft": withAlpha(rowColor, holdingColorMode === "none" ? 0.1 : 0.15),
            "--holding-row-border": withAlpha(rowColor, holdingColorMode === "none" ? 0.2 : 0.28),
            "--holding-owner-color": ownerColor,
            "--holding-owner-chip-bg": withAlpha(ownerColor, 0.08),
            "--holding-owner-chip-ring": withAlpha(ownerColor, 0.22),
          } : undefined}
        >
          <td data-label="선택" className="holding-col-select" data-mobile-priority="hidden">
            <input
              type="checkbox"
              checked={selectedHoldingIds.has(item.holding_id)}
              onChange={() => toggleHoldingSelection(item.holding_id)}
              aria-label={`${item.name} 자산 선택`}
            />
          </td>
          <td data-label="이름" className="holding-col-name holding-name-cell" data-field-key="name" data-mobile-priority={holdingMobilePriority("name")}>
            <span className="holding-name-text">
              <span className="holding-name-dot" aria-hidden="true" />
              <span className="holding-name-label">{item.name}</span>
            </span>
          </td>
          <td data-label="유형" className="holding-col-type" data-field-key="type_category_summary" data-mobile-priority={holdingMobilePriority("type_category_summary")}>
            <span className="holding-type-label">{typeLabel}</span>
            <span className="holding-type-category-hint">{item.category || "-"}</span>
            <span className="holding-mobile-meta">{holdingCompactMeta || "-"}</span>
            {ownerInitial ? (
              <span className="holding-owner-chip" title={item.owner_name || ""} aria-label={item.owner_name || ""}>
                {ownerInitial}
              </span>
            ) : null}
          </td>
          <td data-label="보유자" className="holding-col-owner holding-mobile-detail-cell" data-field-key="owner_name" data-mobile-priority={holdingMobilePriority("owner_name")}>
            <span className="holding-mobile-detail-label">보유자</span>
            <span className="holding-mobile-detail-value">{item.owner_name || "-"}</span>
          </td>
          <td data-label="카테고리" className="holding-col-category" data-field-key="category" data-mobile-priority={holdingMobilePriority("category")}>{item.category}</td>
          <td data-label="수량" className="holding-col-quantity holding-mobile-detail-cell" data-field-key="quantity" data-mobile-priority={holdingMobilePriority("quantity")}>
            <span className="holding-mobile-detail-label">수량</span>
            <span className="holding-mobile-detail-value">{fmt(item.quantity)}</span>
          </td>
          <td data-label="평균단가" className="holding-col-average holding-mobile-detail-cell" data-field-key="average_cost" data-mobile-priority={holdingMobilePriority("average_cost")}>
            <span className="holding-mobile-detail-label">평균단가</span>
            <span className="holding-mobile-detail-value">{itemType?.show_average_cost ?? true ? fmt(item.average_cost) : "-"}</span>
          </td>
          <td data-label="평가(KRW)" className="holding-col-market" data-field-key="market_value_krw" data-mobile-priority={holdingMobilePriority("market_value_krw")}>{fmtKrw(item.market_value_krw)}</td>
          <td data-label="손익(KRW)" className="holding-col-gain holding-mobile-detail-cell" data-field-key="gain_loss_krw" data-mobile-priority={holdingMobilePriority("gain_loss_krw")}>
            <span className="holding-mobile-detail-label">손익</span>
            <span className="holding-mobile-detail-value">{showGainLoss ? fmtKrw(item.gain_loss_krw) : "-"}</span>
          </td>
          <td data-label="최종 수정일" className="holding-col-updated holding-mobile-detail-cell" data-field-key="updated_at" data-mobile-priority={holdingMobilePriority("updated_at")}>
            <span className="holding-mobile-detail-label">최종 수정일</span>
            <span className="holding-mobile-detail-value">{fmtDate(holdingUpdatedAtById.get(item.holding_id))}</span>
          </td>
          <td data-label="동작" className="holding-col-actions" data-mobile-priority="action">
            <div className="inline">
              <button
                type="button"
                className="secondary row-order-btn"
                aria-label={holdingMoveUpLabel}
                title={holdingMoveUpTitle}
                disabled={!canEditRecords || loading}
                onClick={() => moveHoldingDisplayOrder(item, -1).catch(() => undefined)}
              >
                ↑
              </button>
              <button
                type="button"
                className="secondary row-order-btn"
                aria-label={holdingMoveDownLabel}
                title={holdingMoveDownTitle}
                disabled={!canEditRecords || loading}
                onClick={() => moveHoldingDisplayOrder(item, 1).catch(() => undefined)}
              >
                ↓
              </button>
              <button
                type="button"
                className="secondary mobile-toggle-btn"
                aria-label={isExpanded ? "자산 세부 접기" : "자산 세부 보기"}
                aria-expanded={isExpanded ? "true" : "false"}
                onClick={() => toggleExpandedHoldingRow(item.holding_id)}
              >
                <span className="mobile-toggle-icon" aria-hidden="true">
                  <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
                    <path d="M5 3.75L10 8L5 12.25" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </button>
              <button
                type="button"
                className={`row-edit-btn ${isEditing ? "primary" : "secondary"}`}
                disabled={!canEditRecords || loading}
                onClick={handleHoldingEditToggle}
              >
                {isEditing ? "수정 중" : "수정"}
              </button>
              <button type="button" className="danger row-delete-btn" disabled={!canEditRecords || loading} onClick={() => removeHolding(item.holding_id)}>
                삭제
              </button>
            </div>
          </td>
        </tr>
        {isExpanded && (
          <tr
            className="holding-mobile-expanded-actions-row"
            style={rowColor ? {
              "--holding-row-cue": rowColor,
              "--holding-row-wash-strong": withAlpha(rowColor, holdingColorMode === "none" ? 0.22 : 0.3),
              "--holding-row-wash": withAlpha(rowColor, holdingColorMode === "none" ? 0.17 : 0.23),
              "--holding-row-wash-soft": withAlpha(rowColor, holdingColorMode === "none" ? 0.1 : 0.15),
              "--holding-row-border": withAlpha(rowColor, holdingColorMode === "none" ? 0.2 : 0.28),
              "--holding-owner-color": ownerColor,
              "--holding-owner-chip-bg": withAlpha(ownerColor, 0.08),
              "--holding-owner-chip-ring": withAlpha(ownerColor, 0.22),
            } : undefined}
          >
            <td colSpan={11}>
              <div className="holding-mobile-expanded-actions">
                <button
                  type="button"
                  className="secondary"
                  aria-label={holdingMoveUpLabel}
                  title={holdingMoveUpTitle}
                  disabled={!canEditRecords || loading}
                  onClick={() => moveHoldingDisplayOrder(item, -1).catch(() => undefined)}
                >
                  위로
                </button>
                <button
                  type="button"
                  className="secondary"
                  aria-label={holdingMoveDownLabel}
                  title={holdingMoveDownTitle}
                  disabled={!canEditRecords || loading}
                  onClick={() => moveHoldingDisplayOrder(item, 1).catch(() => undefined)}
                >
                  아래로
                </button>
                <button
                  type="button"
                  className={isEditing ? "primary" : "secondary"}
                  disabled={!canEditRecords || loading}
                  onClick={handleHoldingEditToggle}
                >
                  {isEditing ? "수정 중" : "수정"}
                </button>
                <button type="button" className="danger" disabled={!canEditRecords || loading} onClick={() => removeHolding(item.holding_id)}>
                  삭제
                </button>
              </div>
            </td>
          </tr>
        )}
        {isEditing && editForm && (
          <tr key={`${rowKey}-editor`} className="holding-inline-editor-row">
            <td colSpan={11}>
              <form className="form-grid holdings-inline-editor" onSubmit={submitHoldingInlineEdit} noValidate>
                <label>
                  유형
                  <select
                    value={editForm.type_key}
                    disabled={!canEditRecords}
                    onChange={(event) => {
                      const nextTypeKey = normalizeHoldingTypeKey(event.target.value || "");
                      const nextType = holdingTypeByKey.get(nextTypeKey) || holdingTypeOptions[0] || DEFAULT_HOLDING_TYPES[0];
                      const previousType =
                        holdingTypeByKey.get(normalizeHoldingTypeKey(editForm.type_key || editForm.asset_type || "")) ||
                        editType;
                      if (shouldExplainHoldingValueReset(editForm.average_cost, previousType, nextType)) {
                        setMessage(
                          uiGuideMessage(
                            "자산 유형을 변경했습니다.",
                            "평가금액과 평균단가의 의미가 달라 금액 입력값을 비웠습니다."
                          )
                        );
                      }
                      setHoldingInlineEdit((prev) => ({
                        ...prev,
                        type_key: nextType.key,
                        asset_type: nextType.asset_type,
                        category: resolveHoldingCategoryOnTypeChange(
                          prev.category,
                          previousType,
                          nextType
                        ),
                        average_cost: nextAverageCostForHoldingTypeChange(prev.average_cost, previousType, nextType),
                      }));
                    }}
                  >
                    {holdingTypeOptions.map((typeItem) => (
                      <option key={typeItem.key} value={typeItem.key}>
                        {typeItem.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  자산명
                  <textarea
                    rows={2}
                    value={editForm.name}
                    onChange={(event) =>
                      setHoldingInlineEdit((prev) => ({ ...prev, name: event.target.value }))
                    }
                    disabled={!canEditRecords}
                    required
                  />
                </label>
                <div className="settings-preview">
                  선택 유형: <strong>{editType?.label || "-"}</strong>
                </div>
                <label>
                  카테고리
                  <input
                    value={editForm.category}
                    onChange={(event) =>
                      setHoldingInlineEdit((prev) => ({ ...prev, category: event.target.value }))
                    }
                    disabled={!canEditRecords}
                  />
                </label>
                <label>
                  보유자
                  <select
                    value={ownerSelectValue(editForm.owner_user_id, editForm.owner_name)}
                    disabled={!canEditRecords}
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
                {renderLegacyOwnerRemapHelper({
                  ownerUserId: editForm.owner_user_id,
                  ownerName: editForm.owner_name,
                  disabled: !canEditRecords,
                  onApply: (target) =>
                    setHoldingInlineEdit((prev) => ({
                      ...prev,
                      owner_user_id: target.value,
                      owner_name: target.displayName,
                    })),
                })}
                <label>
                  계좌
                  <input
                    value={editForm.account_name}
                    onChange={(event) =>
                      setHoldingInlineEdit((prev) => ({ ...prev, account_name: event.target.value }))
                    }
                    disabled={!canEditRecords}
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
                        disabled={!canEditRecords}
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
                        disabled={!canEditRecords}
                        required
                      />
                    </label>
                    {editShowAverageCost && (
                      <label>
                        평균단가
                        <input
                          type="text"
                          inputMode="decimal"
                          value={editForm.average_cost}
                          onChange={(event) => handleGroupedDecimalInput(event, setHoldingInlineEdit, "average_cost")}
                          disabled={!canEditRecords}
                          required
                        />
                      </label>
                    )}
                  </>
                ) : (
                  editShowAverageCost ? (
                    <label>
                      평가금액
                      <input
                        type="text"
                        inputMode={holdingValuationInputMode(editForm.currency)}
                        value={editForm.average_cost}
                        onChange={(event) => handleGroupedDecimalInput(event, setHoldingInlineEdit, "average_cost")}
                        disabled={!canEditRecords}
                        required
                      />
                    </label>
                  ) : (
                    <div className="settings-preview">평균단가 입력 없음</div>
                  )
                )}
                {!editShowGainLoss && <div className="settings-preview">해당 유형은 손익 계산을 숨김 처리합니다.</div>}
                <label>
                  통화
                  <input
                    value={editForm.currency}
                    onChange={(event) =>
                      setHoldingInlineEdit((prev) => ({ ...prev, currency: event.target.value.toUpperCase() }))
                    }
                    disabled={!canEditRecords}
                    required
                  />
                </label>
                <div className="inline form-actions">
                  <button type="submit" disabled={!canEditRecords}>저장</button>
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
    roleNoticeStateRef.current = { householdId: "", role: "" };
    setHouseholdList([]);
    setHouseholdMembers([]);
    setHouseholdInvites([]);
    setReceivedHouseholdInvites([]);
    setInviteForm({ email: "", role: "viewer" });
    setInviteFormErrors({ email: "" });
    setInviteAcceptToken("");
    setInviteAcceptanceNotice(null);
    setRecentInviteIds([]);
    setCategories([]);
    setOverview(null);
    setTransactions([]);
    setOwnerCleanupTransactions([]);
    setOwnerCleanupTransactionsLoaded(false);
    setHoldings([]);
    setPortfolio(null);
    setPriceStatus(null);
    setImportReport(null);
    setRecentImportTransactionIds(new Set());
    setRecentSavedTransactionIds(new Set());
    setRecentImportHoldingIds(new Set());
    setPendingImportEditTransactionId("");
    setPendingImportEditHoldingId("");
    setImportMode("workbook");
    setImportFile(null);
    setImportLoadingMode("");
    setMigrationReport(null);
    setMigrationPackageFile(null);
    setMigrationLoadingMode("");
    setMigrationExporting(false);
    setTossFiles([]);
    setTossPreview(null);
    setTossApplyReport(null);
    setTossLoadingMode("");
    setMessage(logoutWarning);
    setPriceRefreshPolling(false);
    setDashboardLoading(false);
    setDashboardLoaded(false);
    clearSavedTabId();
    setTab("dashboard");
    setFilterMode("month");
    filterModeRef.current = "month";
    const resetMonth = currentMonth();
    yearMonthRef.current = resetMonth;
    appliedYearMonthRef.current = resetMonth;
    setMonthFilterPending(false);
    setYearMonth(resetMonth);
    const resetRange = yearMonthFullDateRange(resetMonth);
    rangeRef.current = resetRange;
    setRange(resetRange);
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
    setTxFormErrors(createTransactionFormErrors());
    setTxDraftTouched(false);
    setHoldingForm(createHoldingForm("cash"));
    setHoldingOwnerTouched(false);
    setHoldingDraftTouched(false);
    setHoldingInlineEdit(null);
    setShowTransactionForm(false);
    setShowHoldingForm(false);
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
    priceRefreshPollFailureCountRef.current = 0;
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

  const checkClientVersion = useCallback(async () => {
    if (clientVersionCheckInFlightRef.current) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    clientVersionCheckInFlightRef.current = true;
    try {
      const response = await fetch(`${API_PREFIX}/system/client-version`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Cache-Control": "no-cache",
        },
      });
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      setClientVersionState(
        resolveClientVersionState({
          bundledVersion: APP_VERSION,
          serverVersion: payload?.version,
        })
      );
    } catch {
      // Version checks are advisory; a later focus/interval retry can recover.
    } finally {
      clientVersionCheckInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      checkClientVersion().catch(() => undefined);
    };
    tick();
    const timerId = window.setInterval(tick, CLIENT_VERSION_CHECK_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        tick();
      }
    };
    const onFocus = () => tick();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      clearInterval(timerId);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      window.removeEventListener("focus", onFocus);
    };
  }, [checkClientVersion]);

  useEffect(() => {
    if (!token || !priceRefreshPolling) return;
    let stopped = false;
    const timer = setInterval(async () => {
      if (stopped) return;
      try {
        const statusResp = await api(`${API_PREFIX}/prices/status`, {}, token);
        if (stopped) return;
        const nextStatus = applyPriceStatus(statusResp);
        if (!statusResp?.refresh_in_progress) {
          void refreshDataByKinds(new Set(["holding"]), token, { silent: true }).catch(() => undefined);
        } else if (nextStatus?.refresh_in_progress) {
          priceRefreshPollFailureCountRef.current = 0;
        }
      } catch {
        priceRefreshPollFailureCountRef.current += 1;
        if (priceRefreshPollFailureCountRef.current >= PRICE_REFRESH_STATUS_FAILURE_LIMIT) {
          const wasManualRefresh = priceRefreshOriginRef.current === "manual";
          releasePriceRefreshLock();
          if (wasManualRefresh) {
            setMessage(
              uiGuideMessage(
                "시세 갱신 상태 확인이 지연되고 있습니다.",
                "시세 상태를 다시 확인한 뒤 필요하면 갱신을 다시 시도해 주세요.",
              ),
            );
          }
        }
      }
    }, PRICE_REFRESH_POLL_INTERVAL_MS);
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
    let cancelled = false;
    const syncCollaborationTab = async () => {
      if (cancelled) {
        return;
      }
      try {
        await loadAuthContext(token);
        await refreshCollaborationData(token);
      } catch (error) {
        if (!cancelled) {
          setMessage(formatApiError(error, "household_members"));
        }
      }
    };
    syncCollaborationTab().catch(() => undefined);
    const timerId = window.setInterval(() => {
      syncCollaborationTab().catch(() => undefined);
    }, COLLAB_ACTIVE_SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timerId);
    };
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
              if (eventName === "transaction.deleted") {
                const deletedId = String(payload?.entity_id || "").trim();
                if (deletedId) {
                  setSelectedTransactionIds((prev) => {
                    if (!prev.has(deletedId)) {
                      return prev;
                    }
                    const next = new Set(prev);
                    next.delete(deletedId);
                    return next;
                  });
                }
              } else if (eventName === "transaction.bulk_deleted") {
                const deletedIds = new Set(
                  (payload?.entity_ids || []).map((id) => String(id || "").trim()).filter(Boolean)
                );
                if (deletedIds.size > 0) {
                  setSelectedTransactionIds((prev) => {
                    const next = new Set(prev);
                    for (const id of deletedIds) {
                      next.delete(id);
                    }
                    return next.size === prev.size ? prev : next;
                  });
                }
              }
            } else if (eventName.startsWith("holding.")) {
              kind = "holding";
            } else if (
              eventName.startsWith("household.") ||
              eventName.startsWith("member.") ||
              eventName.startsWith("invitation.") ||
              eventName.startsWith("profile.")
            ) {
              kind = "collaboration";
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
  const dashboardPortfolioChartSource = useMemo(() => {
    return buildPortfolioChartSourceForMode(dashboardPortfolioViewMode, {
      overviewTotals: overview?.totals,
      holdingTypeTotals,
    });
  }, [dashboardPortfolioViewMode, holdingTypeTotals, overview?.totals]);
  const holdingPortfolioChartSource = holdingSummarySource;
  const dashboardPortfolioChartData = useMemo(() => {
    return buildPortfolioChartData(dashboardPortfolioChartSource);
  }, [dashboardPortfolioChartSource]);
  const holdingPortfolioChartData = useMemo(() => {
    return buildPortfolioChartData(holdingPortfolioChartSource);
  }, [holdingPortfolioChartSource]);
  const dashboardFlowTrendRows = useMemo(() => {
    const rows = Array.isArray(overview?.trend) ? overview.trend : [];
    return rows.map((item) => ({
      month: item.month,
      income: Number(item.income || 0),
      expense: Number(item.expense || 0),
      investment: Number(item.investment || 0),
    }));
  }, [overview?.trend]);
  const lineChartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
    }),
    []
  );
  const donutChartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      cutout: `${DONUT_CUTOUT_PERCENT}%`,
      plugins: {
        legend: {
          display: false,
        },
      },
    }),
    []
  );
  const dashboardPortfolioViewLabel = PORTFOLIO_VIEW_LABELS[dashboardPortfolioViewMode] || dashboardPortfolioViewMode;
  const dashboardFlowChartDescription = "월별 수입, 지출, 투자 추이";
  const dashboardPortfolioChartDescription = `${dashboardPortfolioChartSource?.title || "차트"} 기준 ${dashboardPortfolioViewLabel}`;
  const holdingPortfolioChartDescription = `${holdingPortfolioChartSource?.title || "자산 포트폴리오"} 기준 평가금액`;
  const dashboardPortfolioCenterLabel = useMemo(
    () => {
      if (dashboardPortfolioViewMode === "holding_type") {
        const total = Number(portfolio?.total_market_value_krw || 0);
        const safeTotal = Number.isFinite(total) ? total : 0;
        return {
          primaryText: "총 자산",
          secondaryText: fmtKrw(safeTotal),
          ariaText: `총 자산 ${fmtKrw(safeTotal)}`,
        };
      }
      const items = Array.isArray(dashboardPortfolioChartSource?.items)
        ? dashboardPortfolioChartSource.items
        : [];
      const visibleItems = items.filter((item) => Number(item?.value || 0) > 0);
      const selectedMonth = Number(yearMonth?.month || 0);
      const primaryText = filterMode === "range"
        ? "기간 거래"
        : `${selectedMonth || currentMonth().month}월 거래`;
      const secondaryText = visibleItems.length > 0
        ? `${visibleItems.length}개 유형`
        : "거래내역";
      return {
        primaryText,
        secondaryText,
        ariaText: `${primaryText} ${secondaryText}`,
      };
    },
    [
      dashboardPortfolioChartSource,
      dashboardPortfolioViewMode,
      filterMode,
      portfolio?.total_market_value_krw,
      yearMonth?.month,
    ]
  );
  const holdingPortfolioCenterLabel = useMemo(
    () => {
      const total = Number(portfolio?.total_market_value_krw || 0);
      const safeTotal = Number.isFinite(total) ? total : 0;
      return {
        primaryText: "총 자산",
        secondaryText: fmtKrw(safeTotal),
        ariaText: `총 자산 ${fmtKrw(safeTotal)}`,
      };
    },
    [portfolio?.total_market_value_krw]
  );
  const holdingPortfolioReturnRatio = useMemo(() => {
    const invested = Number(portfolio?.total_invested_krw || 0);
    const gainLoss = Number(portfolio?.total_gain_loss_krw || 0);
    if (!Number.isFinite(invested) || invested <= 0 || !Number.isFinite(gainLoss)) {
      return null;
    }
    return (gainLoss / invested) * 100;
  }, [portfolio?.total_gain_loss_krw, portfolio?.total_invested_krw]);
  const holdingPortfolioGainTone = Number(portfolio?.total_gain_loss_krw || 0) >= 0 ? "positive" : "negative";
  const dashboardPortfolioBreakdownItems = useMemo(
    () => buildPortfolioBreakdownItems(dashboardPortfolioChartSource, "dashboard-portfolio"),
    [dashboardPortfolioChartSource]
  );
  const holdingPortfolioBreakdownItems = useMemo(() => {
    return buildPortfolioBreakdownItems(holdingPortfolioChartSource, "asset");
  }, [holdingPortfolioChartSource]);
  const holdingPortfolioBreakdownCanFilter = holdingSummaryViewMode === "type";
  const txFlowSummaryTotal = useMemo(
    () => txFlowCategorySummary.reduce((sum, item) => sum + Number(item.total || 0), 0),
    [txFlowCategorySummary]
  );
  const txFlowSummaryCards = useMemo(
    () =>
      txFlowCategorySummary.map((flowSummary) => {
        const total = Number(flowSummary.total || 0);
        const totalShare = txFlowSummaryTotal > 0 ? (total / txFlowSummaryTotal) * 100 : 0;
        const leadingCategory = flowSummary.categories[0] || null;
        const leadingShare = total > 0 && leadingCategory ? (Number(leadingCategory.amount || 0) / total) * 100 : 0;
        return {
          ...flowSummary,
          totalShare,
          totalShareText: formatSharePercent(totalShare),
          leadingCategoryLabel: leadingCategory?.label || "집계 없음",
          leadingCategoryShareText: formatSharePercent(leadingShare),
        };
      }),
    [txFlowCategorySummary, txFlowSummaryTotal]
  );
  const isDashboardInitialLoading = dashboardLoading && !dashboardLoaded;
  const isDashboardRefreshing = dashboardLoading && dashboardLoaded;
  const socketStatusLabel = SOCKET_STATUS_LABELS[socketStatus] || socketStatus;
  const realtimeChipLabel = isDashboardRefreshing ? "동기화 중" : socketStatusLabel;
  const realtimeChipAriaLabel = isDashboardRefreshing
    ? `실시간 연결: ${socketStatusLabel}, 최신 데이터 동기화 중`
    : `실시간 연결: ${socketStatusLabel}`;
  const clientUpdateAvailable = clientVersionState.kind === "update_available";
  const clientVersionStatusLabel = clientUpdateAvailable
    ? `새 버전 ${clientVersionState.serverVersion} 사용 가능`
    : `현재 버전 ${clientVersionState.bundledVersion}`;
  const { minMonth, maxMonth } = getMonthBounds();
  const isPrevMonthDisabled = compareYearMonth(yearMonth, minMonth) <= 0;
  const isNextMonthDisabled = compareYearMonth(yearMonth, maxMonth) >= 0;
  const isPriceRefreshActive = priceRefreshPolling || Boolean(priceStatus?.refresh_in_progress);
  const refreshStateLabel = isPriceRefreshActive
    ? "진행 중"
    : priceStatus?.refresh_finished_at
      ? "완료"
      : "대기";
  const topbarRefreshStatus = dashboardLoading ? "새로고침 불러오는 중" : "새로고침 대기";
  const topbarPriceRefreshStatus = isPriceRefreshActive ? "시세 갱신 중" : "시세 갱신 대기";
  const latestRefreshAt = priceStatus?.refresh_finished_at || priceStatus?.updated_at || null;
  const dashboardGainLossRatioText = fmtSignedPercent(holdingPortfolioReturnRatio ?? 0);
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
  const dashboardKpiCards = financialSummaryRows.map((item) => {
    const rawValueByLabel = {
      수입: overview?.totals?.income,
      지출: overview?.totals?.expense,
      투자: overview?.totals?.investment,
      순현금흐름: overview?.totals?.net_cashflow,
      "총자산(KRW)": portfolio?.total_market_value_krw,
      "평가손익(KRW)": portfolio?.total_gain_loss_krw,
    };
    const rawValue = Number(rawValueByLabel[item.label] || 0);
    const tone =
      item.label === "지출"
        ? "negative"
        : item.label === "수입" || item.label === "투자" || item.label === "총자산(KRW)"
          ? "positive"
          : rawValue > 0
            ? "positive"
            : rawValue < 0
              ? "negative"
              : "neutral";
    const helperByLabel = {
      수입: "이번 조회 기간 유입",
      지출: "이번 조회 기간 유출",
      투자: "투자성 거래 합계",
      순현금흐름: "수입·지출·투자 반영",
      "총자산(KRW)": "평가금액 기준",
      "평가손익(KRW)": "보유자산 평가 차이",
    };
    return {
      ...item,
      tone,
      helper: helperByLabel[item.label] || "조회 기준 집계",
      meta: item.label === "평가손익(KRW)" ? dashboardGainLossRatioText : "",
    };
  });
  const dashboardPriceTone = isPriceRefreshActive
    ? "warning"
    : Number(priceStatus?.stale_count || 0) > 0
      ? "negative"
      : "positive";
  const dashboardRecentTransactions = useMemo(() => {
    return [...transactions]
      .sort((left, right) => compareTransactionsByLedgerOrder(left, right, -1))
      .slice(0, 5);
  }, [transactions]);
  const dashboardHoldingHighlights = useMemo(() => {
    return [...holdingItems]
      .sort((left, right) => Number(right?.market_value_krw || 0) - Number(left?.market_value_krw || 0))
      .slice(0, 5);
  }, [holdingItems]);
  const holdingFormType =
    holdingTypeByKey.get(normalizeHoldingTypeKey(holdingForm.type_key || holdingForm.asset_type || "")) ||
    holdingTypeOptions[0] ||
    DEFAULT_HOLDING_TYPES[0];
  const holdingFormTracked = Boolean(holdingFormType?.tracked ?? isMarketTrackedAssetType(holdingForm.asset_type));
  const holdingFormShowAverageCost = Boolean(holdingFormType?.show_average_cost ?? true);
  const transactionOwnerOptions = ownerOptionsWithFallback(txForm.owner_user_id, txForm.owner_name);
  const holdingFormOwnerOptions = ownerOptionsWithFallback(holdingForm.owner_user_id, holdingForm.owner_name);
  const canEditHouseholdData = householdRole === "owner" || householdRole === "co_owner" || householdRole === "editor";
  const canEditRecords = canEditHouseholdData;
  const canManageHousehold = householdRole === "owner" || householdRole === "co_owner";
  const canAssignOwner = householdRole === "owner";
  const importBusy = Boolean(importLoadingMode || tossLoadingMode || migrationLoadingMode || migrationExporting);
  const workbookMissingFile = !importFile;
  const workbookActionsDisabled = importBusy || !canEditRecords || workbookMissingFile;
  const packageMissingFile = !migrationPackageFile;
  const packageActionsDisabled =
    Boolean(migrationLoadingMode) || migrationExporting || !canEditRecords || packageMissingFile;
  const workbookUploadPlaceholder = isCompactViewport
    ? "탭해서 엑셀 파일을 선택하세요. 파일 앱 또는 기기 저장소에서 업로드할 수 있습니다."
    : "엑셀 파일을 이곳에 드래그 앤 드롭 하거나 클릭하여 업로드하세요.";
  const tossUploadPlaceholder = isCompactViewport
    ? "탭해서 토스 거래내역 이미지를 선택하세요. 사진 앱 또는 기기 저장소에서 업로드할 수 있습니다."
    : "토스 거래내역 이미지를 이곳에 드래그 앤 드롭 하거나 클릭하여 업로드하세요.";
  const migrationPackageUploadPlaceholder = isCompactViewport
    ? "탭해서 추출한 패키지(.zip)를 선택하세요. 파일 앱 또는 기기 저장소에서 업로드할 수 있습니다."
    : "추출한 패키지(.zip) 파일을 클릭하여 업로드하세요.";
  const memberRoleOptions = canAssignOwner
    ? COLLAB_ROLE_OPTIONS
    : COLLAB_ROLE_OPTIONS.filter((item) => item.value !== "owner");
  const householdSwitchDisabled = loading || householdList.length === 0;
  const handleHouseholdSwitchChange = (event) => {
    const nextId = String(event.target.value || "");
    if (!nextId || nextId === household?.id) {
      return;
    }
    selectActiveHousehold(nextId).catch(() => undefined);
  };
  const inviteAcceptanceCanSwitch =
    Boolean(inviteAcceptanceNotice?.householdId) &&
    household?.id !== inviteAcceptanceNotice?.householdId &&
    householdList.some((entry) => entry.household.id === inviteAcceptanceNotice?.householdId);
  const mySentInvites = useMemo(
    () =>
      householdInvites.filter(
        (invite) => String(invite?.inviter_user_id || "").trim() === currentUserId
      ),
    [currentUserId, householdInvites]
  );
  const receivedNewInvites = useMemo(
    () => receivedHouseholdInvites.filter((invite) => String(invite?.status || "") === "pending"),
    [receivedHouseholdInvites]
  );
  const receivedPastInvites = useMemo(
    () => receivedHouseholdInvites.filter((invite) => String(invite?.status || "") !== "pending"),
    [receivedHouseholdInvites]
  );
  const sentNewInvites = useMemo(
    () => mySentInvites.filter((invite) => String(invite?.status || "") === "pending"),
    [mySentInvites]
  );
  const sentPastInvites = useMemo(
    () => mySentInvites.filter((invite) => String(invite?.status || "") !== "pending"),
    [mySentInvites]
  );
  const visibleReceivedInvites = receivedInviteTab === "new" ? receivedNewInvites : receivedPastInvites;
  const visibleSentInvites = sentInviteTab === "new" ? sentNewInvites : sentPastInvites;
  const householdRoleLabel = COLLAB_ROLE_LABELS[householdRole] || householdRole || "-";
  const settingsPermissionLabel = canManageHousehold
    ? "관리 권한"
    : canEditHouseholdData
      ? "편집 권한"
      : "조회 권한";
  const profileDisplayModeLabel =
    DISPLAY_NAME_MODE_OPTIONS.find((option) => option.value === profileForm.display_name_mode)?.label ||
    profileForm.display_name_mode;
  const categoryMajorCount = new Set(
    categories.map((item) => `${String(item?.flow_type || "").trim()}:${String(item?.major || "").trim()}`)
  ).size;
  const collaborationInviteSummary = `받은 신규 ${receivedNewInvites.length}건 · 보낸 대기 ${sentNewInvites.length}건`;
  const importStateLabel = importLoadingMode
    ? `${IMPORT_MODE_LABELS[importLoadingMode] || "처리"} 진행 중`
    : importReport
      ? "최근 결과 표시"
      : "파일 대기";
  const migrationStateLabel = migrationExporting
    ? "패키지 추출 중"
    : migrationLoadingMode
      ? `${IMPORT_MODE_LABELS[migrationLoadingMode] || "이식"} 진행 중`
      : migrationReport
        ? "최근 결과 표시"
        : "패키지 대기";
  const dashboardImportStatus = importLoadingMode
    ? `${IMPORT_MODE_LABELS[importLoadingMode] || "가져오기"} 처리 중`
    : importReport
      ? `최근 보고서 · 거래 ${fmt(importReport.applied_transactions)}건 / 보유 ${fmt(
          Number(importReport.applied_holdings_added || 0) + Number(importReport.applied_holdings_updated || 0)
        )}건`
      : "대기 중";
  const transactionInlineValidationMessage =
    showTransactionForm && txEntrySheetStep === "form" ? firstTransactionFormError(txFormErrors) : "";
  const shouldShowGlobalMessage =
    Boolean(message) && !(transactionInlineValidationMessage && message === transactionInlineValidationMessage);

  useEffect(() => {
    if (canEditRecords) {
      return;
    }
    closeTxInlineEdit();
    setHoldingInlineEdit(null);
  }, [canEditRecords]);

  const transactionEntryBanner = showTransactionEntryBanner ? (
    <div className="tx-entry-banner" role="status">
      <span>금액과 카테고리만 정하면 바로 저장할 수 있습니다. 날짜와 거래자는 기본값을 사용합니다.</span>
      <button type="button" className="secondary" onClick={() => setShowTransactionEntryBanner(false)}>
        닫기
      </button>
    </div>
  ) : null;

  const renderDonutCenterLabel = (centerLabel, { testId, labelPrefix = "포트폴리오 비중" } = {}) => {
    if (!centerLabel) {
      return null;
    }
    const primaryText = centerLabel.primaryText || centerLabel.shareText;
    const secondaryText = centerLabel.secondaryText || centerLabel.label;
    return (
      <div
        className="portfolio-donut-center-label"
        data-testid={testId}
        aria-label={`${labelPrefix} ${centerLabel.ariaText || `${secondaryText} ${primaryText}`}`}
      >
        <strong>{primaryText}</strong>
        <span>{secondaryText}</span>
      </div>
    );
  };

  const renderDonutSliceLabels = (items, { testId, labelPrefix = "포트폴리오 세그먼트" } = {}) => {
    const labels = buildDonutSliceLabelMeta(items);
    if (labels.length === 0) {
      return null;
    }
    return (
      <div className="portfolio-donut-slice-labels" aria-hidden="true">
        {labels.map((item) => (
          <span
            key={`${item.label}:${item.index}`}
            className="portfolio-donut-slice-label"
            data-testid={testId}
            data-donut-angle={item.angleDeg.toFixed(3)}
            data-donut-radius={(item.radius * 2).toFixed(3)}
            data-donut-share={item.share.toFixed(3)}
            title={`${labelPrefix} ${item.label} ${item.shareText}`}
            style={{
              left: `${item.left}%`,
              top: `${item.top}%`,
              "--slice-label-color": item.color,
            }}
          >
            <strong>{item.shareText}</strong>
            <small>{item.label}</small>
          </span>
        ))}
      </div>
    );
  };

  const renderTransactionQuickEntryForm = () => {
    const transactionFormDisabled = !canEditRecords || txFormSubmitting;
    const selectedCategoryId = String(txForm.category_id || "").trim();
    const selectedCategory = categoryById.get(selectedCategoryId);
    const selectedCategoryLabel = selectedCategory ? toCategoryPairLabel(selectedCategory) : "미선택";
    const selectedOwnerValue = ownerSelectValue(txForm.owner_user_id, txForm.owner_name);
    const selectedOwnerOption = transactionOwnerOptions.find(
      (option) => String(option.value || "") === selectedOwnerValue
    );
    const selectedOwnerLabel = selectedOwnerOption?.label || txForm.owner_name || "미선택";
    const ownerChoiceOptions = [
      { value: "", label: "선택 안함", displayName: "" },
      ...transactionOwnerOptions,
    ];
    if (selectedOwnerValue && !ownerChoiceOptions.some((option) => String(option.value || "") === selectedOwnerValue)) {
      ownerChoiceOptions.push({ value: selectedOwnerValue, label: selectedOwnerLabel, displayName: selectedOwnerLabel });
    }
    const chooseCategoryMajor = (major) => {
      setTxDraftTouched(true);
      setTxCategoryMajor(major);
      setTxCategoryRestore(null);
      setTxForm((prev) => {
        const currentCategory = categoryById.get(String(prev.category_id || ""));
        const keepCurrentCategory = currentCategory && String(currentCategory.major || "") === String(major || "");
        return { ...prev, category_id: keepCurrentCategory ? prev.category_id : "" };
      });
    };
    const chooseOwner = (option) => {
      setTxQuickOwnerTouched(true);
      setTxDraftTouched(true);
      setTxForm((prev) => ({
        ...prev,
        ...ownerSelectionFromValue(option.value, transactionOwnerOptions),
      }));
    };

    return (
      <form
        ref={txQuickFormRef}
        className="transaction-quick-form transaction-entry-sheet-form"
        data-testid="transaction-quick-form"
        onSubmit={submitTransaction}
        noValidate
        onFocusCapture={(event) => handleTransactionQuickFieldFocus(event.target)}
        onKeyDownCapture={handleTransactionQuickFormKeyDown}
        onPointerDownCapture={rememberActiveTransactionQuickField}
      >
        <div className="transaction-quick-primary-stack" data-testid="transaction-quick-primary-path">
          <div className="transaction-quick-primary-fields">
            <label className="date-field transaction-quick-date-field">
              일자
              <div className="date-input-wrap">
                <IsoDateInput
                  ref={txDateInputRef}
                  data-testid="transaction-quick-date"
                  enterKeyHint="next"
                  value={txForm.occurred_on}
                  onValueChange={(value) => {
                    clearTransactionFormError("occurred_on");
                    setTxDraftTouched(true);
                    setTxForm((prev) => ({ ...prev, occurred_on: value }));
                  }}
                  aria-invalid={txFormErrors.occurred_on ? "true" : undefined}
                  aria-describedby={txFormErrors.occurred_on ? "transaction-quick-date-error" : undefined}
                  disabled={transactionFormDisabled}
                  required
                />
                <button
                  type="button"
                  className="secondary today-btn"
                  onClick={() => {
                    clearTransactionFormError("occurred_on");
                    setTxDraftTouched(true);
                    setTxForm((prev) => ({ ...prev, occurred_on: transactionEntryTodayDate() }));
                  }}
                  disabled={transactionFormDisabled}
                >
                  오늘
                </button>
              </div>
              {txFormErrors.occurred_on && (
                <p id="transaction-quick-date-error" className="field-helper field-error" role="alert">
                  {txFormErrors.occurred_on}
                </p>
              )}
            </label>

            <label className="transaction-quick-amount-field">
              <span>금액</span>
              <input
                ref={txAmountInputRef}
                data-testid="transaction-quick-amount"
                type="text"
                inputMode="numeric"
                enterKeyHint="next"
                autoComplete="off"
                placeholder="0"
                value={txForm.amount}
                onChange={handleTransactionEntryAmountInput}
                onKeyDown={handleTransactionQuickAmountKeyDown}
                aria-invalid={txFormErrors.amount ? "true" : undefined}
                aria-describedby={txFormErrors.amount ? "transaction-quick-amount-error" : undefined}
                disabled={transactionFormDisabled}
                required
              />
              {txFormErrors.amount && (
                <p id="transaction-quick-amount-error" className="field-helper field-error" role="alert">
                  {txFormErrors.amount}
                </p>
              )}
            </label>
          </div>

          <section className="transaction-choice-section transaction-staged-category" data-testid="transaction-staged-category">
            <div className="transaction-choice-section-title">
              <span>유형</span>
              <small>{FLOW_TYPE_LABELS[txForm.flow_type] || txForm.flow_type || "지출"}</small>
            </div>
            <div className="transaction-choice-grid transaction-flow-choice-grid" role="group" aria-label="유형 선택">
              {FLOW_TYPE_OPTIONS.map((item) => {
                const selected = item.value === txForm.flow_type;
                return (
                  <button
                    key={item.value}
                    type="button"
                    className={`transaction-choice-chip${selected ? " selected" : ""}`}
                    data-testid="transaction-flow-choice"
                    data-flow-type={item.value}
                    aria-pressed={selected ? "true" : "false"}
                    onClick={() => changeTransactionFlowType(item.value)}
                    disabled={transactionFormDisabled}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
            {renderTransactionCategoryRestoreNotice()}

            <TransactionCategoryQuickPicker
              categories={categoryOptions}
              quickOptions={[]}
              selectedCategoryId={txForm.category_id}
              disabled={transactionFormDisabled}
              allowCreate={canEditHouseholdData}
              createDisabled={!canEditHouseholdData}
              onSelect={applyTransactionCategory}
              onCreate={createAndApplyTransactionCategory}
              title="카테고리 검색"
              selectedEmptyText="미선택 저장 가능"
              showExistingSelect={false}
              searchMode="toggle"
              searchToggleLabel="카테고리 선택"
              createMode="toggle"
              createToggleVisibility="on-query"
              maxOptions={6}
              rootClassName="transaction-category-picker-staged"
              rootTestId=""
              optionTestId="transaction-category-search-option"
              toCategoryMajorLabel={toCategoryMajorLabel}
              toCategoryMinorLabel={toCategoryMinorLabel}
            />

            <div className="transaction-choice-section-title">
              <span>그룹</span>
              <small>{txCategoryMajor ? toCategoryMajorLabel(txCategoryMajor) : "미선택"}</small>
            </div>
            {categoryMajorOptions.length > 0 ? (
              <div className="transaction-choice-grid transaction-category-group-grid" role="group" aria-label="카테고리 그룹 선택">
                {categoryMajorOptions.map((major) => {
                  const selected = major === txCategoryMajor;
                  return (
                    <button
                      key={major}
                      type="button"
                      className={`transaction-choice-chip${selected ? " selected" : ""}`}
                      data-testid="transaction-category-group-choice"
                      data-category-major={major}
                      aria-pressed={selected ? "true" : "false"}
                      onClick={() => chooseCategoryMajor(major)}
                      disabled={transactionFormDisabled}
                    >
                      {toCategoryMajorLabel(major)}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="transaction-choice-empty">등록된 그룹이 없습니다.</p>
            )}

            {txCategoryMajor && (
              <>
                <div className="transaction-choice-section-title">
                  <span>카테고리</span>
                  <small>{selectedCategoryLabel}</small>
                </div>
                {categoryMinorOptions.length > 0 ? (
                  <div className="transaction-choice-grid transaction-category-choice-grid" role="group" aria-label="카테고리 선택">
                    {categoryMinorOptions.map((item) => {
                      const selected = String(item.id || "") === selectedCategoryId;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`transaction-choice-chip${selected ? " selected" : ""}`}
                          data-testid="transaction-category-choice"
                          data-category-id={item.id}
                          aria-pressed={selected ? "true" : "false"}
                          onClick={() => applyTransactionCategory(String(item.id || ""), item)}
                          disabled={transactionFormDisabled}
                        >
                          {toCategoryMinorLabel(item.minor)}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="transaction-choice-empty">선택한 그룹에 카테고리가 없습니다.</p>
                )}
              </>
            )}
          </section>

          <section className="transaction-choice-section transaction-owner-choice-section">
            <div className="transaction-choice-section-title">
              <span>거래자</span>
              <small>{selectedOwnerLabel}</small>
            </div>
            <div className="transaction-choice-grid transaction-owner-choice-grid" role="group" aria-label="거래자 선택">
              {ownerChoiceOptions.map((option) => {
                const normalizedValue = String(option.value || "");
                const selected = normalizedValue === selectedOwnerValue;
                return (
                  <button
                    key={normalizedValue || "__none__"}
                    type="button"
                    className={`transaction-choice-chip transaction-owner-choice${selected ? " selected" : ""}`}
                    data-testid="transaction-owner-choice"
                    data-owner-value={normalizedValue}
                    aria-pressed={selected ? "true" : "false"}
                    title={option.email ? `${option.label} (${option.email})` : option.label}
                    onClick={() => chooseOwner(option)}
                    disabled={transactionFormDisabled}
                  >
                    {option.displayName || option.label}
                  </button>
                );
              })}
            </div>
          </section>

          <label className="transaction-quick-memo-field">
            메모
            <input
              ref={txQuickMemoInputRef}
              enterKeyHint="done"
              value={txForm.memo}
              placeholder="선택 입력"
              onChange={(e) => {
                setTxDraftTouched(true);
                setTxForm((prev) => ({ ...prev, memo: e.target.value }));
              }}
              onKeyDown={handleTransactionQuickMemoKeyDown}
              disabled={transactionFormDisabled}
            />
          </label>
        </div>

        <div className="transaction-quick-actions">
          <button
            type="button"
            className="secondary"
            data-testid="transaction-quick-reset"
            onClick={resetTransactionDraft}
            disabled={transactionFormDisabled}
          >
            초기화
          </button>
          <button type="submit" data-testid="transaction-quick-save" disabled={transactionFormDisabled}>
            거래 등록
          </button>
        </div>
      </form>
    );
  };

  const renderTransactionFormFields = ({ sheetMode = false } = {}) => {
    const transactionFormDisabled = !canEditRecords || txFormSubmitting;
    if (sheetMode) {
      return renderTransactionQuickEntryForm();
    }
    return (
      <form
        className={`form-grid transactions-form-grid${sheetMode ? " transaction-entry-sheet-form" : ""}`}
        onSubmit={submitTransaction}
        noValidate
      >
      <label className="date-field">
        일자
        <div className="date-input-wrap">
          <IsoDateInput
            ref={txDateInputRef}
            enterKeyHint="next"
            value={txForm.occurred_on}
            onValueChange={(value) => {
              clearTransactionFormError("occurred_on");
              setTxDraftTouched(true);
              setTxForm((prev) => ({ ...prev, occurred_on: value }));
            }}
            aria-invalid={txFormErrors.occurred_on ? "true" : undefined}
            aria-describedby={txFormErrors.occurred_on ? "transaction-form-date-error" : undefined}
            disabled={transactionFormDisabled}
            required
          />
          <button
            type="button"
            className="secondary today-btn"
            onClick={() => {
              clearTransactionFormError("occurred_on");
              setTxDraftTouched(true);
              setTxForm((prev) => ({ ...prev, occurred_on: transactionEntryTodayDate() }));
            }}
            disabled={transactionFormDisabled}
          >
            오늘
          </button>
        </div>
        {txFormErrors.occurred_on && (
          <p id="transaction-form-date-error" className="field-helper field-error" role="alert">
            {txFormErrors.occurred_on}
          </p>
        )}
      </label>
      <label>
        유형
        <select
          enterKeyHint="next"
          value={txForm.flow_type}
          disabled={transactionFormDisabled}
          onChange={(e) => changeTransactionFlowType(e.target.value)}
        >
          {FLOW_TYPE_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      {renderTransactionCategoryRestoreNotice()}
      <label>
        금액
        <input
          ref={txAmountInputRef}
          type="text"
          inputMode="numeric"
          enterKeyHint="next"
          value={txForm.amount}
          onChange={handleTransactionEntryAmountInput}
          aria-invalid={txFormErrors.amount ? "true" : undefined}
          aria-describedby={txFormErrors.amount ? "transaction-form-amount-error" : undefined}
          disabled={transactionFormDisabled}
          required
        />
        {txFormErrors.amount && (
          <p id="transaction-form-amount-error" className="field-helper field-error" role="alert">
            {txFormErrors.amount}
          </p>
        )}
      </label>
      <TransactionCategoryQuickPicker
        categories={categoryOptions}
        quickOptions={[]}
        selectedCategoryId={txForm.category_id}
        disabled={transactionFormDisabled}
        allowCreate={canEditHouseholdData}
        createDisabled={!canEditHouseholdData}
        onSelect={applyTransactionCategory}
        onCreate={createAndApplyTransactionCategory}
        title="카테고리 빠른 선택"
        rootClassName="transaction-category-picker-desktop"
        toCategoryMajorLabel={toCategoryMajorLabel}
        toCategoryMinorLabel={toCategoryMinorLabel}
      />
      <label>
        카테고리 그룹
        <select
          enterKeyHint="next"
          value={txCategoryMajor}
          disabled={transactionFormDisabled}
          onChange={(e) => {
            setTxDraftTouched(true);
            setTxCategoryMajor(e.target.value);
            setTxCategoryRestore(null);
            setTxForm((prev) => ({ ...prev, category_id: "" }));
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
        카테고리
        <select
          enterKeyHint="next"
          value={txForm.category_id}
          disabled={transactionFormDisabled || !txCategoryMajor}
          onChange={(e) => {
            setTxDraftTouched(true);
            setTxCategoryRestore(null);
            setTxForm((prev) => ({ ...prev, category_id: e.target.value }));
          }}
        >
          <option value="">(선택 안함)</option>
          {categoryMinorOptions.map((item) => (
            <option key={item.id} value={item.id}>
              {toCategoryMinorLabel(item.minor)}
            </option>
          ))}
        </select>
      </label>
      <label>
        메모
        <input
          ref={txMemoInputRef}
          enterKeyHint="next"
          value={txForm.memo}
          onChange={(e) => {
            setTxDraftTouched(true);
            setTxForm((prev) => ({ ...prev, memo: e.target.value }));
          }}
          disabled={transactionFormDisabled}
        />
      </label>
      <label>
        거래자
        <select
          enterKeyHint="done"
          value={ownerSelectValue(txForm.owner_user_id, txForm.owner_name)}
          disabled={transactionFormDisabled}
          onChange={(event) => {
            const nextOwner = ownerSelectionFromValue(event.target.value, transactionOwnerOptions);
            setTxQuickOwnerTouched(true);
            setTxDraftTouched(true);
            setTxForm((prev) => ({ ...prev, ...nextOwner }));
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
      {renderOwnerQuickSelect({
        ownerLabel: "거래자",
        testId: "transaction-owner-quick-select",
        selectedValue: txForm.owner_user_id,
        disabled: transactionFormDisabled,
        onSelect: applyTransactionOwnerOption,
      })}
      {renderLegacyOwnerRemapHelper({
        ownerUserId: txForm.owner_user_id,
        ownerName: txForm.owner_name,
        disabled: transactionFormDisabled,
        onApply: (target) => {
          setTxQuickOwnerTouched(true);
          setTxDraftTouched(true);
          setTxForm((prev) => ({
            ...prev,
            owner_user_id: target.value,
            owner_name: target.displayName,
          }));
        },
      })}
      <div className="inline form-actions">
        <button
          type="button"
          className="secondary"
          onClick={resetTransactionDraft}
          disabled={transactionFormDisabled}
        >
          초기화
        </button>
        <button type="submit" disabled={transactionFormDisabled}>
          거래 등록
        </button>
      </div>
    </form>
    );
  };

  const renderTransactionCategoryManagerContent = ({ sheetMode = false } = {}) => (
    <div
      className={`transaction-category-manager-content${sheetMode ? " transaction-category-manager-content-sheet" : ""}`}
      data-testid={sheetMode ? "transaction-category-sheet-step" : undefined}
    >
      <form className="form-grid settings-form-grid category-create-form" onSubmit={createCategoryPair} noValidate>
        <div className="settings-preview category-manager-guide">
          <strong>새 카테고리 만들기</strong>
          <span>{categoryDraftGuideText}</span>
          <span>생성 예정: {categoryDraftSummaryText}</span>
        </div>
        <label>
          유형
          <select
            value={categoryDraft.flow_type}
            onChange={(event) => {
              const nextFlowType = event.target.value;
              setCategoryDraft((prev) => ({ ...prev, flow_type: nextFlowType, major: "", minor: "" }));
              setCategoryDraftMajorSelect("__custom__");
              setCategoryDraftMinorSelect("__custom__");
              setCategoryQuickSelectedId("");
            }}
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
          <select
            value={categoryDraftMajorSelect}
            onChange={(event) => {
              const nextMajorSelect = event.target.value;
              setCategoryDraftMajorSelect(nextMajorSelect);
              setCategoryDraftMinorSelect("__custom__");
              if (nextMajorSelect === "__custom__") {
                setCategoryDraft((prev) => ({ ...prev, major: "", minor: "" }));
              } else {
                setCategoryDraft((prev) => ({ ...prev, major: nextMajorSelect, minor: "" }));
              }
            }}
            disabled={!canEditHouseholdData}
          >
            <option value="__custom__">직접 입력</option>
            {categoryDraftMajorOptions.map((major) => (
              <option key={major} value={major}>
                {toCategoryMajorLabel(major)}
              </option>
            ))}
          </select>
        </label>
        <label>
          첫 중분류
          <select
            value={categoryDraftMinorSelect}
            onChange={(event) => {
              const nextMinorSelect = event.target.value;
              setCategoryDraftMinorSelect(nextMinorSelect);
              if (nextMinorSelect === "__custom__") {
                setCategoryDraft((prev) => ({ ...prev, minor: "" }));
              } else {
                setCategoryDraft((prev) => ({ ...prev, minor: nextMinorSelect }));
              }
            }}
            disabled={!canEditHouseholdData || (categoryDraftMajorSelect === "__custom__" && !String(categoryDraft.major || "").trim())}
          >
            <option value="__custom__">직접 입력</option>
            {categoryDraftMinorOptions.map((minor) => (
              <option key={minor} value={minor}>
                {toCategoryMinorLabel(minor)}
              </option>
            ))}
          </select>
        </label>
        {categoryDraftMajorSelect === "__custom__" && (
          <label>
            새 대분류 입력
            <input
              value={categoryDraft.major}
              onChange={(event) => setCategoryDraft((prev) => ({ ...prev, major: event.target.value }))}
              placeholder="예: 생활비"
              required
              disabled={!canEditHouseholdData}
            />
          </label>
        )}
        {categoryDraftMinorSelect === "__custom__" && (
          <label>
            첫 중분류 입력
            <input
              value={categoryDraft.minor}
              onChange={(event) => setCategoryDraft((prev) => ({ ...prev, minor: event.target.value }))}
              placeholder="예: 식비"
              required
              disabled={!canEditHouseholdData}
            />
          </label>
        )}
        <div className="inline form-actions settings-actions">
          <button type="submit" disabled={!canEditHouseholdData}>
            카테고리 추가
          </button>
        </div>
      </form>
      <div className="form-grid settings-form-grid category-create-form category-create-form-spaced">
        <div className="settings-preview category-manager-guide">
          <strong>기존 카테고리 빠른 정리</strong>
          <span>{categoryQuickActionText}</span>
        </div>
        <label>
          기존 카테고리 선택
          <select
            value={categoryQuickSelectedId}
            onChange={(event) => setCategoryQuickSelectedId(event.target.value)}
            disabled={!canEditHouseholdData}
          >
            <option value="">(선택 안함)</option>
            {categoryQuickOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="inline form-actions settings-actions">
          <button
            type="button"
            className="secondary"
            disabled={!canEditHouseholdData || !categoryQuickSelectedId}
            onClick={editSelectedCategoryQuick}
          >
            선택 수정
          </button>
          <button
            type="button"
            className="danger"
            disabled={!canEditHouseholdData || !categoryQuickSelectedId || categoryQuickSelectionInUse}
            title={categoryQuickSelectionInUse ? "사용 중인 카테고리는 삭제할 수 없습니다." : undefined}
            onClick={deleteSelectedCategoryQuick}
          >
            선택 삭제
          </button>
        </div>
      </div>
    </div>
  );

  if (!authReady) {
    return (
      <main
        className="auth-shell"
        translate="no"
        onInvalidCapture={handleInvalidFormField}
        onInputCapture={clearNativeValidationMessage}
        onChangeCapture={clearNativeValidationMessage}
      >
        <div className="auth-card">
          <h1>Money Flow</h1>
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
    const resendCooldownMs = Math.max(0, Number(verificationMeta.resendCooldownSeconds || 0) * 1000);
    const resendRemainingMs =
      authMode === "verify" && resendCooldownMs > 0 && verificationMeta.lastResendAt
        ? Math.max(0, verificationMeta.lastResendAt + resendCooldownMs - nowTick)
        : 0;
    const resendRemainingSeconds = Math.ceil(resendRemainingMs / 1000);
    const expiresAtMs = Math.max(0, Number(verificationMeta.expiresAtMs || 0));
    const expiresRemainingSeconds =
      authMode === "verify" && expiresAtMs
        ? Math.max(0, Math.ceil((expiresAtMs - nowTick) / 1000))
        : Math.max(0, Number(verificationMeta.expiresInSeconds || 0));
    const resendLimit = Math.max(0, Number(verificationMeta.resendLimit || 0));
    const resendUsedCount = Math.max(0, Number(verificationMeta.resendUsedCount || 0));
    const resendRemainingCount = resendLimit > 0 ? Math.max(0, resendLimit - resendUsedCount) : null;
    const resendEmailReady = Boolean(String(verifyForm.email || authForm.email || "").trim());
    const resendDisabled = loading || !resendEmailReady || resendRemainingSeconds > 0 || resendRemainingCount === 0;
    const resendWaitText = resendRemainingSeconds > 0 ? `${formatDurationKo(resendRemainingSeconds)} 후 가능` : "지금 가능";
    const requiresVerificationPasswordSetup = authMode === "verify" && Boolean(verifyForm.requires_password_setup);
    const verifyTokenText = String(verifyForm.token || "").trim();
    const verificationCodeText = String(verifyForm.verification_code || "").trim();
    const verificationEmailText = String(verifyForm.email || "").trim();
    const verificationCodeReady = Boolean(verificationEmailText) && /^\d{6}$/.test(verificationCodeText);
    const verificationSubmitReady =
      authMode !== "verify" || requiresVerificationPasswordSetup || Boolean(verifyTokenText || verificationCodeReady);
    const verifySubmitHelperId = "auth-verify-submit-helper";
    const resendEmailHelperId = "auth-resend-email-helper";
    const authDescription =
      authMode === "verify"
        ? hasPendingInviteToken
          ? "인증 후 협업 탭에서 초대를 수락할 수 있습니다."
          : "메일 인증으로 가입을 마무리합니다."
        : hasPendingInviteToken
          ? "로그인 후 초대를 수락할 수 있습니다."
          : authMode === "register"
            ? "가입 정보를 입력하고 이메일을 확인합니다."
            : "이메일과 비밀번호로 로그인합니다.";
    const authModeTitle =
      authMode === "login"
        ? "로그인"
        : authMode === "register"
          ? "회원가입"
          : requiresVerificationPasswordSetup
            ? "비밀번호 설정"
            : "메일 인증";
    const authModeKicker =
      authMode === "login"
        ? "로그인"
        : authMode === "register"
          ? "회원가입"
          : "인증";
    return (
      <main
        className="auth-shell"
        translate="no"
        onInvalidCapture={handleInvalidFormField}
        onInputCapture={clearNativeValidationMessage}
        onChangeCapture={clearNativeValidationMessage}
      >
        <div className="auth-layout">
          <section className="auth-hero-panel" aria-hidden="true">
            <div className="auth-brand-lockup">
              <span className="auth-brand-mark">M</span>
              <span>
                <strong>Money Flow</strong>
                <small>가계 금융 워크스페이스</small>
              </span>
            </div>
            <div className="auth-hero-copy">
              <h2>가계 흐름을 빠르게 시작합니다.</h2>
              <p>계정 보호와 협업 준비를 간결한 흐름으로 이어갑니다.</p>
            </div>
          </section>
          <form className={`auth-card auth-card-${authMode}`} onSubmit={runAuth} noValidate>
            <div className="auth-card-header">
              <span className="auth-mode-pill">{authModeKicker}</span>
              <h1>Money Flow</h1>
              <h2>{authModeTitle}</h2>
              <p>{authDescription}</p>
            </div>
          {hasPendingInviteToken && (
            <div className="auth-pending-invite" role="status">
              <strong>초대 토큰을 감지했습니다.</strong>
              <span>아직 초대 유효성은 확인되지 않았습니다. 로그인 또는 회원가입 후 협업 탭에서 초대를 확인하고 수락해 주세요.</span>
            </div>
          )}
          {authMode === "verify" ? (
            <>
              <div className="auth-pending-invite" role="status">
                <strong>{requiresVerificationPasswordSetup ? "다른 브라우저에서 인증 링크를 열었습니다." : "인증 메일을 확인해 주세요."}</strong>
                {requiresVerificationPasswordSetup ? (
                  <>
                    <span>
                      회원가입을 시작했던 브라우저와 현재 브라우저가 달라, 이전에 입력한 비밀번호를 보안상 그대로 사용할 수 없습니다.
                    </span>
                    <span>이메일 소유 확인은 이어서 진행할 수 있으니, 이 브라우저에서 사용할 비밀번호를 다시 설정해 주세요.</span>
                  </>
                ) : (
                  <span>
                    메일의 버튼을 열거나 아래 6자리 인증번호를 입력해 주세요.
                  </span>
                )}
                {expiresRemainingSeconds || verificationMeta.resendLimit ? (
                  <div className="auth-verification-meta" aria-label="인증 상태">
                    {expiresRemainingSeconds ? (
                      <span>
                        <b>남은 유효시간</b>
                        <strong>{formatDurationKo(expiresRemainingSeconds)}</strong>
                      </span>
                    ) : null}
                    {verificationMeta.resendLimit ? (
                      <>
                        <span>
                          <b>재전송 대기</b>
                          <strong>{resendWaitText}</strong>
                        </span>
                        <span>
                          <b>남은 재전송</b>
                          <strong>{resendRemainingCount}회</strong>
                        </span>
                      </>
                    ) : null}
                  </div>
                ) : null}
                {verificationMeta.resendLimit ? (
                  <span className="auth-verification-note">
                    제한: {formatDurationKo(verificationMeta.resendWindowSeconds || 300)} 동안 최대 {verificationMeta.resendLimit}회
                    {verificationMeta.resendCooldownSeconds ? `, ${formatDurationKo(verificationMeta.resendCooldownSeconds)} 간격` : ""}
                  </span>
                ) : null}
              </div>
              {requiresVerificationPasswordSetup ? (
                <>
                  <label>
                    새 비밀번호
                    <input
                      type="password"
                      value={verifyForm.password}
                      onChange={(e) => setVerifyForm({ ...verifyForm, password: e.target.value })}
                      required
                    />
                  </label>
                  <label>
                    새 비밀번호 확인
                    <input
                      type="password"
                      value={verifyForm.password_confirm}
                      onChange={(e) => setVerifyForm({ ...verifyForm, password_confirm: e.target.value })}
                      required
                    />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    이메일
                    <input
                      type="email"
                      value={verifyForm.email}
                      onChange={(e) => setVerifyForm({ ...verifyForm, email: e.target.value })}
                    />
                  </label>
                  {!resendEmailReady && (
                    <p id={resendEmailHelperId} className="field-helper auth-submit-helper">
                      이메일을 입력하면 인증 메일 재전송이 가능합니다.
                    </p>
                  )}
                  <label>
                    6자리 인증번호
                    <input
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={verifyForm.verification_code}
                      onChange={(e) =>
                        setVerifyForm({
                          ...verifyForm,
                          verification_code: e.target.value.replace(/\D/g, "").slice(0, 6),
                          token: e.target.value ? "" : verifyForm.token,
                        })
                      }
                      placeholder="메일에 표시된 6자리 숫자"
                    />
                  </label>
                </>
              )}
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
              {authMode === "login" && (
                <div className="auth-recovery-callout" role="note">
                  <strong>비밀번호를 잊으셨나요?</strong>
                  <span>현재는 관리자 재설정으로 계정 복구를 지원합니다. 가입 이메일을 함께 보내 주세요.</span>
                  <a className="text-button" href={PASSWORD_RECOVERY_MAILTO}>
                    관리자에게 재설정 요청
                  </a>
                </div>
              )}
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
          {authMode === "verify" && !requiresVerificationPasswordSetup && !verificationSubmitReady && (
            <p id={verifySubmitHelperId} className="field-helper auth-submit-helper">
              메일 버튼으로 접속하거나 6자리 인증번호를 입력하면 인증 완료 버튼이 활성화됩니다.
            </p>
          )}
          <button
            disabled={loading || !verificationSubmitReady}
            type="submit"
            aria-describedby={
              authMode === "verify" && !requiresVerificationPasswordSetup && !verificationSubmitReady ? verifySubmitHelperId : undefined
            }
          >
            {loading
              ? "처리 중..."
              : authMode === "login"
                ? "로그인하기"
                : authMode === "register"
                  ? "회원가입하고 시작"
                  : requiresVerificationPasswordSetup
                    ? "비밀번호 설정하고 가입 완료"
                    : "이메일 인증 완료"}
          </button>
          {authMode === "verify" && !requiresVerificationPasswordSetup && (
            <button
              type="button"
              className="secondary"
              onClick={() => resendVerification().catch(() => undefined)}
              disabled={resendDisabled}
              aria-describedby={!resendEmailReady ? resendEmailHelperId : undefined}
            >
              {resendRemainingCount === 0
                ? "재전송 횟수 소진"
                : resendRemainingSeconds > 0
                  ? `재전송 ${formatDurationKo(resendRemainingSeconds)} 후 가능`
                  : "인증 메일 재전송"}
            </button>
          )}
          <div className="auth-switch">
            {authMode === "login" ? (
              <>
                <span>처음이신가요?</span>
                <button type="button" className="text-button" onClick={() => switchPublicAuthMode("register")}>
                  회원가입
                </button>
              </>
            ) : authMode === "register" ? (
              <>
                <span>이미 계정이 있나요?</span>
                <button type="button" className="text-button" onClick={() => switchPublicAuthMode("login")}>
                  로그인으로 돌아가기
                </button>
              </>
            ) : (
              <>
                <span>인증 링크가 없나요?</span>
                <button type="button" className="text-button" onClick={() => switchPublicAuthMode("login")}>
                  로그인으로 돌아가기
                </button>
              </>
            )}
          </div>
          {message && (
            <div className="message" role="status">
              <span>{message}</span>
              <button type="button" className="message-close secondary" onClick={dismissMessage}>
                닫기
              </button>
            </div>
          )}
          </form>
        </div>
        <div className="app-copyright" aria-hidden="true">
          {COPYRIGHT_TEXT}
        </div>
      </main>
    );
  }

  const dashboardPageProps = {
    constants: {
      COLLAB_ROLE_LABELS,
      FINANCIAL_SUMMARY_LABELS,
      FLOW_TYPE_LABELS,
      PORTFOLIO_VIEW_OPTIONS,
      SOCKET_STATUS_LABELS,
    },
    filters: {
      applyMonthFilter,
      filterMode,
      handleMoveToCurrentMonth,
      handleRangeInputChange,
      handleRangePreset,
      handleShiftYearMonth,
      handleSwitchToRangeFilter,
      handleYearMonthInputKeyDown,
      isMonthFilterPending,
      isNextMonthDisabled,
      isPrevMonthDisabled,
      range,
      updateYearMonthInput,
      yearMonth,
    },
    summary: {
      categoryById,
      dashboardFlowTrendRows,
      dashboardGainLossRatioText,
      dashboardHoldingHighlights,
      dashboardImportStatus,
      dashboardKpiCards,
      dashboardLoading,
      dashboardPriceTone,
      dashboardRecentTransactions,
      householdMembers,
      importReport,
      isDashboardInitialLoading,
      latestRefreshAt,
      priceSummaryRows,
      refreshStateLabel,
      socketStatus,
    },
    portfolioView: {
      dashboardPortfolioBreakdownItems,
      dashboardPortfolioCenterLabel,
      dashboardPortfolioChartData,
      dashboardPortfolioChartDescription,
      dashboardPortfolioChartSource,
      dashboardPortfolioViewMode,
      portfolio,
      updateDashboardPortfolioViewMode: (nextMode) => setDashboardPortfolioViewMode(nextMode),
    },
    charts: {
      dashboardFlowChartDescription,
      donutChartOptions,
      lineChartOptions,
      trendChartData,
    },
    formatters: {
      extractVisibleInitial,
      fmt,
      fmtDate,
      fmtDateTime,
      fmtKrw,
      toCategoryPairLabel,
    },
    renderers: {
      renderDonutCenterLabel,
      renderDonutSliceLabels,
    },
    navigation: {
      navigateToTab: (nextTab) => setTab(nextTab),
    },
  };

  const transactionsPageProps = {
    constants: {
      DEFAULT_TRANSACTION_ROW_COLORS,
      FLOW_TYPE_LABELS,
      FLOW_TYPE_OPTIONS,
    },
    permissions: {
      canEditHouseholdData,
      canEditRecords,
      isCompactViewport,
      isLedgerCompactViewport: isTransactionLedgerCompactViewport,
      loading,
    },
    monthFilter: {
      handleMoveToCurrentMonth,
      handleShiftYearMonth,
      handleYearMonthInputKeyDown,
      isMonthFilterPending,
      isNextMonthDisabled,
      isPrevMonthDisabled,
      maxMonth,
      minMonth,
      updateYearMonthInput,
      yearMonth,
    },
    listState: {
      expandedTransactionRows,
      isTransactionFilterActive,
      recentImportTransactionIds,
      recentSavedTransactionIds,
      selectedTransactionSummary,
      showTransactionFilterPanel,
      showTransactionScrollTop,
      sortedTransactions,
      transactionFilterFocusTarget,
      transactionSortSummary,
      transactionLedgerItems,
      transactionsMobileStickyActive,
      txListFilter,
      txSortDirection,
    },
    listRefs: {
      transactionListCardRef,
      transactionListHeadingRef,
      transactionStickyToolbarRef,
    },
    listLookups: {
      categoryById,
      householdSettings,
      normalizeTransactionRowColors,
      renderCategoryCell,
    },
    listActions: {
      clearTxListFilter,
      selectTransactionRows,
      scrollTransactionListToTop,
      toggleExpandedTransactionRow,
      toggleTxSortDirection,
      updateShowTransactionFilterPanel: (nextOpen) => setShowTransactionFilterPanel(nextOpen),
      updateTransactionFilterFocusTarget: (nextTarget) => setTransactionFilterFocusTarget(nextTarget),
      updateTransactionRowsExpanded: (transactionIds, expanded) => setTransactionRowsExpanded(transactionIds, expanded),
      updateTransactionRowsSelected: (transactionIds, selected) => setTransactionRowsSelected(transactionIds, selected),
      updateTxListFilter: (nextFilter) => setTxListFilter(nextFilter),
    },
    selection: {
      areAllFilteredTransactionsSelected,
      openSelectedTransactionEdit,
      openSelectedTransactionInsert,
      removeSelectedTransactions,
      selectedTransactionIds,
      toggleAllFilteredTransactionSelection,
      toggleTransactionSelection,
      updateSelectedTransactionIds: (nextIds) => setSelectedTransactionIds(nextIds),
    },
    entrySheet: {
      closeTransactionEntrySheet,
      openNormalTransactionEntrySheet,
      renderTransactionFormFields,
      showTransactionForm,
      transactionDesktopAddActionRef,
      transactionEntryBanner,
      transactionFabRef,
      txEntrySheetStep,
      updateTxEntrySheetStep: (nextStep) => setTxEntrySheetStep(nextStep),
    },
    inlineEdit: {
      closeTxInlineEdit,
      createAndApplyTxInlineCategory,
      handleGroupedDecimalInput,
      handleTransactionAmountInput,
      handleTxInlineEditKeyDown,
      openTransactionInlineEditor,
      notifyTransactionEditPermissionDenied,
      submitTxInlineEdit,
      txInlineEdit,
      txInlineEditSubmitting,
      updateTxInlineEdit: (nextEdit) => setTxInlineEdit(nextEdit),
    },
    categoryManager: {
      renderLegacyOwnerRemapHelper,
      renderTransactionCategoryManagerContent,
      showTxCategoryManager,
      toggleTransactionCategoryManager,
      txCategoryManagerRef,
      txInlineCategoryMajor,
      txInlineCategoryMajorOptions,
      txInlineCategoryMinorOptions,
      txInlineCategoryOptions,
      txInlineCategoryQuickChips,
      updateShowTxCategoryManager: (nextOpen) => setShowTxCategoryManager(nextOpen),
    },
    support: {
      transactionSupportDetailsRef,
      transactionSupportOpen,
      updateTransactionSupportOpen: (nextOpen) => setTransactionSupportOpen(nextOpen),
    },
    breakdown: {
      txFlowBreakdownExpanded,
      txFlowSummaryCards,
      updateTxFlowBreakdownExpanded: (nextExpanded) => setTxFlowBreakdownExpanded(nextExpanded),
    },
    ownerHelpers: {
      ownerOptionsWithFallback,
      ownerSelectValue,
      ownerSelectionFromValue,
    },
    formatters: {
      fmtDate,
      fmtKrw,
      formatSharePercent,
      toCategoryMajorLabel,
      toCategoryMinorLabel,
      toYearMonthKey,
    },
  };

  const holdingsPageProps = {
    constants: {
      DEFAULT_HOLDING_TYPES,
    },
    permissions: {
      canEditRecords,
      isCompactViewport,
      loading,
    },
    entryState: {
      holdingEntryActionRef,
      holdingForm,
      holdingFormOwnerOptions,
      holdingFormShowAverageCost,
      holdingFormTracked,
      holdingFormType,
      holdingNameInputRef,
      showHoldingForm,
    },
    entryActions: {
      applyHoldingOwnerOption,
      closeHoldingEntrySheet,
      createHoldingForm,
      handleHoldingEntryDecimalInput,
      nextAverageCostForHoldingTypeChange,
      openHoldingEntrySheet,
      ownerSelectionFromValue,
      resolveHoldingCategoryOnTypeChange,
      shouldExplainHoldingValueReset,
      submitHolding,
      uiGuideMessage,
      updateHoldingDraftTouched: (nextTouched) => setHoldingDraftTouched(nextTouched),
      updateHoldingForm: (nextForm) => setHoldingForm(nextForm),
      updateHoldingOwnerTouched: (nextTouched) => setHoldingOwnerTouched(nextTouched),
      notifyMessage: (nextMessage) => setMessage(nextMessage),
    },
    entryLookups: {
      holdingTypeByKey,
      holdingTypeOptions,
      holdingValuationInputMode,
      normalizeHoldingTypeKey,
      ownerSelectValue,
    },
    listState: {
      activeHoldingTabLabel,
      activeHoldingTypeFilterLabel,
      dynamicHoldingTabs,
      filteredHoldingItems,
      groupedHoldingSections,
      holdingColorMode,
      holdingColorModeLabel,
      holdingColumnWidths,
      holdingGroupByColor,
      holdingItems,
      holdingListTab,
      holdingListTabAriaLabel,
      holdingSortSummary,
      holdingTypeFilter,
      selectedHoldingSummary,
      sortedHoldingItems,
    },
    listActions: {
      moveHoldingCategoryOrder,
      scrollToHoldingSummary,
      updateHoldingColumnWidth,
      updateHoldingColorMode: (nextMode) => setHoldingColorMode(nextMode),
      updateHoldingGroupByColor: (nextValue) => setHoldingGroupByColor(nextValue),
      updateHoldingListTab: (nextTab) => setHoldingListTab(nextTab),
      updateHoldingTypeFilter: (nextType) => setHoldingTypeFilter(nextType),
      updateSelectedHoldingIds: (nextIds) => setSelectedHoldingIds(nextIds),
    },
    portfolioSummary: {
      donutChartOptions,
      handleHoldingSummarySummaryClick,
      handleHoldingSummaryToggle,
      holdingPortfolioBreakdownCanFilter,
      holdingPortfolioBreakdownItems,
      holdingPortfolioCenterLabel,
      holdingPortfolioChartData,
      holdingPortfolioChartDescription,
      holdingPortfolioChartSource,
      holdingPortfolioGainTone,
      holdingPortfolioReturnRatio,
      holdingSummaryCardRef,
      holdingSummaryOpen,
      holdingSummarySource,
      holdingSummaryViewMode,
      portfolio,
      updateHoldingSummaryViewMode: (nextMode) => setHoldingSummaryViewMode(nextMode),
    },
    formatters: {
      fmtKrw,
      fmtSignedPercent,
    },
    renderers: {
      renderDonutCenterLabel,
      renderDonutSliceLabels,
      renderHoldingRow,
      renderHoldingSortAria,
      renderHoldingSortHeader,
      renderLegacyOwnerRemapHelper,
      renderOwnerQuickSelect,
    },
  };

  const settingsPageProps = {
    constants: {
      ASSET_TYPE_OPTIONS,
      COLLAB_ROLE_LABELS,
      DEFAULT_TRANSACTION_ROW_COLORS,
      DISPLAY_NAME_MODE_OPTIONS,
      FLOW_TYPE_LABELS,
      FLOW_TYPE_OPTIONS,
    },
    permissions: {
      canEditHouseholdData,
      canManageHousehold,
    },
    profile: {
      profileDisplayModeLabel,
      profileForm,
      saveProfileSettings,
      user,
      updateProfileForm: (nextForm) => setProfileForm(nextForm),
    },
    householdAdmin: {
      handleHouseholdSwitchChange,
      household,
      householdList,
      householdRole,
      householdRoleLabel,
      householdSettings,
      householdSettingsForm,
      householdSwitchDisabled,
      saveHouseholdSettings,
      updateHouseholdSettingsForm: (nextForm) => setHouseholdSettingsForm(nextForm),
    },
    holdingTypes: {
      clearHoldingTypeDraft,
      editHoldingType,
      holdingCategoryNames,
      holdingOwnerNames,
      holdingTypeDraft,
      holdingTypeEditKey,
      holdingTypeOptions,
      moveHoldingTypeOrder,
      removeHoldingTypeDefinition,
      saveHoldingTypeDefinition,
      updateHoldingColorInForm: (section, key, color) => setHoldingColorInForm(section, key, color),
      updateHoldingTypeDraft: (nextDraft) => setHoldingTypeDraft(nextDraft),
    },
    categoryDrafts: {
      categoryDraft,
      categoryDraftGuideText,
      categoryDraftMajorOptions,
      categoryDraftMajorSelect,
      categoryDraftMinorOptions,
      categoryDraftMinorSelect,
      categoryDraftSummaryText,
      categoryEditForm,
      categoryEditId,
      majorRenameDrafts,
    },
    categoryLists: {
      categories,
      categoryGroups,
      categoryMajorCount,
      categoryQuickActionText,
      categoryQuickOptions,
      categoryQuickSelectedId,
      categoryQuickSelectionInUse,
      categoryUsageById,
      categoryUsageExpanded,
      categoryUsageLoadingId,
      settingsPermissionLabel,
    },
    categoryActions: {
      createCategoryPair,
      deleteCategoryPair,
      deleteSelectedCategoryQuick,
      editSelectedCategoryQuick,
      renameCategoryMajorGroup,
      renderBreakableInlineText,
      saveCategoryEdit,
      toCategoryMajorLabel,
      toCategoryMinorLabel,
      toCategoryPairLabel,
      toggleCategoryUsageDetails,
      updateCategoryDraft: (nextDraft) => setCategoryDraft(nextDraft),
      updateCategoryDraftMajorSelect: (nextMajor) => setCategoryDraftMajorSelect(nextMajor),
      updateCategoryDraftMinorSelect: (nextMinor) => setCategoryDraftMinorSelect(nextMinor),
      updateCategoryEditForm: (nextForm) => setCategoryEditForm(nextForm),
      updateCategoryEditId: (nextId) => setCategoryEditId(nextId),
      updateCategoryQuickSelectedId: (nextId) => setCategoryQuickSelectedId(nextId),
      updateMajorRenameDrafts: (nextDrafts) => setMajorRenameDrafts(nextDrafts),
    },
    formatters: {
      fmtKrw,
    },
  };

  const collaborationPageProps = {
    constants: {
      COLLAB_ROLE_LABELS,
      COLLAB_ROLE_OPTIONS,
      INVITATION_STATUS_LABELS,
    },
    permissions: {
      canAssignOwner,
      canManageHousehold,
      loading,
    },
    householdContext: {
      compactHouseholdSelectOptionName,
      handleHouseholdSwitchChange,
      household,
      householdList,
      householdMembers,
      householdRole,
      householdRoleLabel,
      householdSwitchDisabled,
      selectActiveHousehold,
    },
    inviteAcceptance: {
      acceptHouseholdInvite,
      inviteAcceptToken,
      inviteAcceptanceCanSwitch,
      inviteAcceptanceNotice,
      updateInviteAcceptToken: (nextToken) => setInviteAcceptToken(nextToken),
    },
    inviteFormState: {
      createHouseholdInvite,
      inviteEmailInputRef,
      inviteForm,
      inviteFormErrors,
      updateInviteForm: (nextForm) => setInviteForm(nextForm),
      updateInviteFormErrors: (nextErrors) => setInviteFormErrors(nextErrors),
    },
    receivedInvites: {
      acceptReceivedHouseholdInvite,
      receivedHouseholdInvites,
      receivedInviteSectionRef,
      receivedInviteTab,
      receivedNewInvites,
      receivedPastInvites,
      recentInviteIds,
      visibleReceivedInvites,
      updateReceivedInviteTab: (nextTab) => setReceivedInviteTab(nextTab),
    },
    sentInvites: {
      mySentInvites,
      revokeHouseholdInvite,
      sentInviteTab,
      sentNewInvites,
      sentPastInvites,
      visibleSentInvites,
      updateSentInviteTab: (nextTab) => setSentInviteTab(nextTab),
    },
    members: {
      changeMemberRole,
      memberRoleOptions,
      removeHouseholdMember,
    },
    formatters: {
      fmtDateTime,
    },
    userContext: {
      user,
      collaborationInviteSummary,
    },
  };

  const importPageProps = {
    constants: {
      FLOW_TYPE_OPTIONS,
      IMPORT_MODE_LABELS,
      IMPORT_REPORT_SORT_OPTIONS,
      IMPORT_SOURCE_MODES,
      TOSS_IMAGE_ACCEPT,
    },
    permissions: {
      canEditRecords,
    },
    workbook: {
      doImport,
      importFile,
      importFileInputRef,
      importLoadingMode,
      importMode,
      importStateLabel,
      workbookActionsDisabled,
      workbookMissingFile,
      workbookUploadPlaceholder,
      updateImportFile: (nextFile) => setImportFile(nextFile),
      updateImportMode: (nextMode) => setImportMode(nextMode),
    },
    reportState: {
      importAppliedHoldingRefs,
      importAppliedTransactionRefs,
      importBusy,
      importIssuePreview,
      importMismatchPreview,
      importReport,
      importReportRows,
      importReportSearch,
      importReportSeverityFilter,
      importReportSeverityOptions,
      importReportSort,
      importReportTypeFilter,
      importReportTypeOptions,
      importReportVisibleRows,
    },
    reportActions: {
      copyImportReportCsv,
      downloadImportReportCsv,
      formatTechnicalReportJson,
      hasImportPostApplyTargets,
      showImportedHoldings,
      showImportedTransactions,
      startImportedCorrection,
      updateImportReportSearch: (nextSearch) => setImportReportSearch(nextSearch),
      updateImportReportSeverityFilter: (nextFilter) => setImportReportSeverityFilter(nextFilter),
      updateImportReportSort: (nextSort) => setImportReportSort(nextSort),
      updateImportReportTypeFilter: (nextFilter) => setImportReportTypeFilter(nextFilter),
    },
    migration: {
      doMigrationImport,
      exportMigrationPackage,
      migrationExporting,
      migrationIssuePreview,
      migrationLoadingMode,
      migrationPackageFile,
      migrationPackageInputRef,
      migrationPackageUploadPlaceholder,
      migrationReport,
      migrationStateLabel,
      packageActionsDisabled,
      packageMissingFile,
      updateMigrationPackageFile: (nextFile) => setMigrationPackageFile(nextFile),
    },
    ownerCleanup: {
      applyLegacyOwnerRemap,
      defaultOwnerRemapOption,
      legacyOwnerCleanupRows,
      legacyOwnerCountText,
      ownerMemberOptions,
      ownerRemapTargets,
      ownerRemappingKey,
      updateOwnerRemapTargets: (nextTargets) => setOwnerRemapTargets(nextTargets),
    },
    toss: {
      doTossApply,
      doTossPreview,
      startCategoryDraftFromTossRecommendation,
      tossApplyReport,
      tossDuplicateCount,
      tossExcludedCandidates,
      tossFileInputRef,
      tossFiles,
      tossIncludedCount,
      tossLoadingMode,
      tossPreview,
      tossRows,
      tossUploadPlaceholder,
      updateTossPreviewRow,
      updateTossImportFiles: (nextFiles) => setTossImportFiles(nextFiles),
    },
    helpers: {
      categories,
      categoryById,
      displayImportFileName,
      fmt,
      toCategoryPairLabel,
    },
    dragDrop: {
      isDragOver,
      updateIsDragOver: (nextIsDragOver) => setIsDragOver(nextIsDragOver),
    },
  };

  return (
    <AppShell
      userName={user?.display_name}
      householdName={household?.name}
      socketStatus={socketStatus}
      socketStatusLabel={socketStatusLabel}
      realtimeChipLabel={realtimeChipLabel}
      realtimeChipAriaLabel={realtimeChipAriaLabel}
      isDashboardRefreshing={isDashboardRefreshing}
      clientUpdateAvailable={clientUpdateAvailable}
      clientVersionState={clientVersionState}
      clientVersionStatusLabel={clientVersionStatusLabel}
      onClientVersionReload={() => window.location.reload()}
      dashboardLoading={dashboardLoading}
      topbarRefreshStatus={topbarRefreshStatus}
      onRefreshData={() => refreshDataWithUiFeedback().catch(() => undefined)}
      priceRefreshDisabled={loading || dashboardLoading || isPriceRefreshActive}
      isPriceRefreshActive={isPriceRefreshActive}
      topbarPriceRefreshStatus={topbarPriceRefreshStatus}
      onRefreshPrice={refreshPriceNow}
      onLogout={() => logout().catch(() => undefined)}
      tab={tab}
      onTabChange={setTab}
      collaborationInvitePulse={collaborationInvitePulse}
      receivedNewInviteCount={receivedNewInvites.length}
      topbarTabsRef={topbarTabsRef}
      onInvalidCapture={handleInvalidFormField}
      onInputCapture={clearNativeValidationMessage}
      onChangeCapture={clearNativeValidationMessage}
    >
      <div className="app-content">
      {shouldShowGlobalMessage && (
        <div className="message" role="status">
          <span>{message}</span>
          <button type="button" className="message-close secondary" onClick={dismissMessage}>
            닫기
          </button>
        </div>
      )}
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

      {tab === "dashboard" && <DashboardPage {...dashboardPageProps} />}

      {tab === "transactions" && <TransactionsPage {...transactionsPageProps} />}

      {tab === "holdings" && <HoldingsPage {...holdingsPageProps} />}

      {tab === "settings" && <SettingsPage {...settingsPageProps} />}

      {tab === "collaboration" && <CollaborationPage {...collaborationPageProps} />}

      {tab === "import" && <ImportPage {...importPageProps} />}
      </div>
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
    </AppShell>
  );
}

export default App;
