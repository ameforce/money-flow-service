const TAB_LABELS = {
  dashboard: "대시보드",
  transactions: "거래",
  holdings: "자산",
  settings: "설정",
  collaboration: "협업",
  import: "데이터 가져오기",
};

const TAB_NAV_META = {
  dashboard: { helper: "요약", mobileLabel: "요약" },
  transactions: { helper: "흐름", mobileLabel: "거래" },
  holdings: { helper: "자산", mobileLabel: "자산" },
  collaboration: { helper: "공유", mobileLabel: "협업" },
  import: { helper: "가져오기", mobileLabel: "가져오기" },
  settings: { helper: "설정", mobileLabel: "설정" },
};

const TAB_GROUPS = {
  left: ["dashboard", "transactions", "holdings"],
  right: ["collaboration", "import", "settings"],
};

export const TAB_IDS = new Set([...TAB_GROUPS.left, ...TAB_GROUPS.right]);

function TabNavIcon({ tabId }) {
  const commonProps = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.9",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    focusable: "false",
  };
  if (tabId === "transactions") {
    return (
      <svg {...commonProps}>
        <path d="M5 7h14" />
        <path d="m15 3 4 4-4 4" />
        <path d="M19 17H5" />
        <path d="m9 13-4 4 4 4" />
      </svg>
    );
  }
  if (tabId === "holdings") {
    return (
      <svg {...commonProps}>
        <path d="M12 3 4 8l8 5 8-5-8-5Z" />
        <path d="m4 13 8 5 8-5" />
      </svg>
    );
  }
  if (tabId === "collaboration") {
    return (
      <svg {...commonProps}>
        <path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
        <path d="M16 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
        <path d="M3.5 20a4.5 4.5 0 0 1 9 0" />
        <path d="M13.5 19a3.5 3.5 0 0 1 7 0" />
      </svg>
    );
  }
  if (tabId === "import") {
    return (
      <svg {...commonProps}>
        <path d="M12 4v10" />
        <path d="m8 10 4 4 4-4" />
        <path d="M5 18h14" />
      </svg>
    );
  }
  if (tabId === "settings") {
    return (
      <svg {...commonProps}>
        <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
        <path d="M12 3v2" />
        <path d="M12 19v2" />
        <path d="M4.2 7.5 5.9 8.5" />
        <path d="m18.1 15.5 1.7 1" />
        <path d="m4.2 16.5 1.7-1" />
        <path d="m18.1 8.5 1.7-1" />
      </svg>
    );
  }
  return (
    <svg {...commonProps}>
      <path d="M4 11.5 12 5l8 6.5" />
      <path d="M6.5 10.5V19h11v-8.5" />
      <path d="M10 19v-5h4v5" />
    </svg>
  );
}

function TopbarActionIcon({ action }) {
  const commonProps = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.9",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    focusable: "false",
    "aria-hidden": "true",
  };
  if (action === "price-refresh") {
    return (
      <svg {...commonProps}>
        <path d="M7 6.5 9.2 18 12 10l2.8 8L17 6.5" />
        <path d="M6 10h12" />
        <path d="M6.8 13.5h10.4" />
      </svg>
    );
  }
  if (action === "logout") {
    return (
      <svg {...commonProps}>
        <path d="M12 4v7" />
        <path d="M7.2 7.5a7 7 0 1 0 9.6 0" />
      </svg>
    );
  }
  return (
    <svg {...commonProps}>
      <path d="M20 12a8 8 0 0 1-13.7 5.6" />
      <path d="M4 12A8 8 0 0 1 17.7 6.4" />
      <path d="M18 3.8v3h-3" />
      <path d="M6 20.2v-3h3" />
    </svg>
  );
}

export function AppShell({
  children,
  userName,
  householdName,
  socketStatus,
  socketStatusLabel,
  realtimeChipLabel,
  realtimeChipAriaLabel,
  isDashboardRefreshing,
  clientUpdateAvailable,
  clientVersionState,
  clientVersionStatusLabel,
  onClientVersionReload,
  dashboardLoading,
  topbarRefreshStatus,
  onRefreshData,
  priceRefreshDisabled,
  isPriceRefreshActive,
  topbarPriceRefreshStatus,
  onRefreshPrice,
  onLogout,
  tab,
  onTabChange,
  collaborationInvitePulse,
  receivedNewInviteCount,
  topbarTabsRef,
  onInvalidCapture,
  onInputCapture,
  onChangeCapture,
}) {
  const renderTabButton = (item) => {
    const isActive = tab === item;
    const isCollaborationPulse = item === "collaboration" && collaborationInvitePulse && !isActive;
    const unreadInviteCount = item === "collaboration" ? receivedNewInviteCount : 0;
    const meta = TAB_NAV_META[item] || {};
    return (
      <button
        key={item}
        aria-label={TAB_LABELS[item] || item}
        aria-current={isActive ? "page" : undefined}
        className={`${isActive ? "active" : ""}${isCollaborationPulse ? " tab-invite-pulse" : ""}`}
        onClick={() => onTabChange(item)}
      >
        <span className="tab-icon" aria-hidden="true"><TabNavIcon tabId={item} /></span>
        <span className="tab-text-break" aria-hidden="true">{"\n"}</span>
        <span className="tab-copy" data-helper={meta.helper || undefined} aria-hidden="true">
          <span className="tab-label" data-mobile-label={meta.mobileLabel || TAB_LABELS[item] || item}>
            {TAB_LABELS[item] || item}
          </span>
        </span>
        {unreadInviteCount > 0 && <span className="tab-badge" aria-label={`새 초대 ${unreadInviteCount}건`}>{unreadInviteCount}</span>}
      </button>
    );
  };

  return (
    <main
      className="app-shell"
      translate="no"
      onInvalidCapture={onInvalidCapture}
      onInputCapture={onInputCapture}
      onChangeCapture={onChangeCapture}
    >
      <header className="topbar">
        <div className="topbar-identity">
          <span className="topbar-eyebrow">가계 금융 워크스페이스</span>
          <h1>Money Flow</h1>
          <div className="meta topbar-meta">
            <span>사용자: {userName}</span>
            <span>가계: {householdName}</span>
            <span
              className={`socket-chip socket-chip-${socketStatus}${isDashboardRefreshing ? " socket-chip-syncing" : ""}`}
              role="status"
              aria-live="polite"
              aria-label={realtimeChipAriaLabel}
            >
              <span className="socket-chip-text">
                <span className="socket-chip-prefix">실시간 연결: </span>
                <span className="socket-chip-status">{realtimeChipLabel}</span>
              </span>
            </span>
            {clientUpdateAvailable && (
              <span
                className="client-version-chip"
                role="status"
                aria-live="polite"
                aria-label={clientVersionStatusLabel}
              >
                <span className="client-version-chip-text">새 버전 {clientVersionState?.serverVersion}</span>
                <button type="button" className="client-version-reload-button" onClick={onClientVersionReload}>
                  새 버전 적용
                </button>
              </span>
            )}
          </div>
        </div>
        <div className="actions topbar-actions">
          <button
            className="secondary topbar-action-button topbar-refresh-action"
            onClick={onRefreshData}
            disabled={dashboardLoading}
            aria-label="새로고침"
            aria-describedby="topbar-refresh-status"
            title={dashboardLoading ? "새로고침 불러오는 중" : "새로고침"}
          >
            <span className="topbar-action-icon"><TopbarActionIcon action="refresh" /></span>
            <span className="topbar-action-label">{dashboardLoading ? "불러오는 중..." : "새로고침"}</span>
          </button>
          <span id="topbar-refresh-status" className="topbar-action-status" role="status" aria-live="polite" aria-atomic="true">
            {topbarRefreshStatus}
          </span>
          <button
            className={`secondary topbar-action-button topbar-price-refresh-action${isPriceRefreshActive ? " is-active" : ""}`}
            onClick={onRefreshPrice}
            disabled={priceRefreshDisabled}
            aria-label="시세 갱신"
            aria-describedby="topbar-price-refresh-status"
            title={isPriceRefreshActive ? "시세 갱신 중" : "시세 갱신"}
          >
            <span className="topbar-action-icon"><TopbarActionIcon action="price-refresh" /></span>
            <span className="topbar-action-label" aria-hidden="true">시세 갱신</span>
          </button>
          <span id="topbar-price-refresh-status" className="topbar-action-status" role="status" aria-live="polite" aria-atomic="true">
            {topbarPriceRefreshStatus}
          </span>
          <button
            className="danger topbar-action-button topbar-logout-action"
            onClick={onLogout}
            aria-label="로그아웃"
            title="로그아웃"
          >
            <span className="topbar-action-icon"><TopbarActionIcon action="logout" /></span>
            <span className="topbar-action-label">로그아웃</span>
          </button>
        </div>
      </header>

      <nav ref={topbarTabsRef} className="tabs topbar-tabs" aria-label="주요 메뉴">
        <div className="nav-brand" aria-hidden="true">
          <span className="nav-brand-mark">M</span>
          <span>
            <strong>Money Flow</strong>
            <small>가계 금융 워크스페이스</small>
          </span>
        </div>
        <div className="tabs-left">
          {TAB_GROUPS.left.map(renderTabButton)}
        </div>
        <div className="tabs-right">
          {TAB_GROUPS.right.map(renderTabButton)}
        </div>
        <div className="nav-status-card" aria-hidden="true">
          <span className={`nav-status-dot nav-status-dot-${socketStatus}`} />
          <span>{socketStatusLabel}</span>
        </div>
      </nav>

      {children}
    </main>
  );
}
