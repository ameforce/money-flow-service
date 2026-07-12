export function CollaborationCommandCard({
  constants,
  permissions,
  householdContext,
  inviteAcceptance,
  inviteFormState,
  receivedInvites,
  sentInvites,
  userContext,
}) {
  const { COLLAB_ROLE_LABELS, COLLAB_ROLE_OPTIONS } = constants;
  const { canManageHousehold, loading } = permissions;
  const {
    compactHouseholdSelectOptionName,
    handleHouseholdSwitchChange,
    household,
    householdList,
    householdMembers,
    householdRole,
    householdRoleLabel,
    householdSwitchDisabled,
    selectActiveHousehold,
  } = householdContext;
  const {
    acceptHouseholdInvite,
    inviteAcceptToken,
    inviteAcceptanceCanSwitch,
    inviteAcceptanceNotice,
    updateInviteAcceptToken,
  } = inviteAcceptance;
  const {
    createHouseholdInvite,
    inviteEmailInputRef,
    inviteForm,
    inviteFormErrors,
    updateInviteForm,
    updateInviteFormErrors,
  } = inviteFormState;
  const { receivedNewInvites, receivedInviteSectionRef, updateReceivedInviteTab } = receivedInvites;
  const { sentNewInvites } = sentInvites;
  const { collaborationInviteSummary } = userContext;

  return (
    <article className="card secondary-surface-card collaboration-command-card">
      <div className="secondary-surface-header collaboration-surface-header">
        <div className="work-surface-title">
          <span className="surface-eyebrow">협업 컨트롤</span>
          <h2>가계 협업 관리</h2>
        </div>
        <div className="surface-control-strip secondary-control-strip" role="group" aria-label="협업 관리 상태" tabIndex={0}>
          <span className="surface-chip surface-chip-strong">내 권한 {householdRoleLabel}</span>
          <span className="surface-chip">멤버 {householdMembers.length}명</span>
          <span className={`surface-chip${receivedNewInvites.length > 0 || sentNewInvites.length > 0 ? " surface-chip-strong" : " surface-chip-muted"}`}>
            {collaborationInviteSummary}
          </span>
        </div>
      </div>
      <div className="collaboration-toolbar">
        <label>
          작업 가계
          <select id="collaboration-household-select" className="household-select" value={household?.id || ""} onChange={handleHouseholdSwitchChange} disabled={householdSwitchDisabled} aria-describedby="collaboration-household-select-summary">
            {householdList.length === 0 && <option value="">선택 가능한 가계 없음</option>}
            {householdList.map((entry) => (
              <option key={entry.household.id} value={entry.household.id} aria-label={entry.household.name} title={entry.household.name}>
                {compactHouseholdSelectOptionName(entry.household.name)}
              </option>
            ))}
          </select>
        </label>
        <p className="table-summary" id="collaboration-household-select-summary">
          현재 가계: {household?.name || "-"} / 내 권한: {COLLAB_ROLE_LABELS[householdRole] || householdRole || "-"}
        </p>
      </div>

      {receivedNewInvites.length > 0 && (
        <div className="invite-arrival-banner" role="status">
          <div className="invite-arrival-copy">
            <strong>신규 초대 {receivedNewInvites.length}건이 도착했습니다.</strong>
            <span>새 초대를 먼저 확인하고 필요하면 바로 수락할 수 있습니다.</span>
          </div>
          <div className="inline invite-banner-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => {
                updateReceivedInviteTab("new");
                window.setTimeout(() => {
                  receivedInviteSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                }, 0);
              }}
            >
              받은 초대 보기
            </button>
          </div>
        </div>
      )}

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
            <div className="inline invite-banner-actions">
              <button type="button" onClick={() => selectActiveHousehold(inviteAcceptanceNotice.householdId).catch(() => undefined)} disabled={loading}>
                작업 가계로 전환
              </button>
            </div>
          )}
        </div>
      )}

      <form className="form-grid collaboration-form-grid" onSubmit={createHouseholdInvite} noValidate>
        <label className="form-field">
          초대할 이메일
          <input
            ref={inviteEmailInputRef}
            type="email"
            value={inviteForm.email}
            onChange={(event) => {
              event.target.setCustomValidity("");
              updateInviteFormErrors({ email: "" });
              updateInviteForm((prev) => ({ ...prev, email: event.target.value }));
            }}
            placeholder="example@email.com"
            disabled={loading || !canManageHousehold}
            required
            aria-invalid={inviteFormErrors.email ? "true" : undefined}
            aria-describedby={inviteFormErrors.email ? "collaboration-invite-email-error" : undefined}
          />
          {inviteFormErrors.email && (
            <p id="collaboration-invite-email-error" className="field-helper field-error" role="alert">
              {inviteFormErrors.email}
            </p>
          )}
        </label>
        <label>
          권한
          <select value={inviteForm.role} onChange={(event) => updateInviteForm((prev) => ({ ...prev, role: event.target.value }))} disabled={loading || !canManageHousehold}>
            {COLLAB_ROLE_OPTIONS.filter((item) => item.value !== "owner").map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <div className="inline form-actions">
          <button type="submit" disabled={loading || !canManageHousehold}>초대 발송</button>
        </div>
      </form>
      {!canManageHousehold && (
        <p className="table-summary">초대 발송/권한 변경은 공동 소유자 이상 권한에서만 가능합니다.</p>
      )}

      <form className="form-grid collaboration-accept-grid" onSubmit={acceptHouseholdInvite}>
        <div className="form-field invite-token-field">
          <label>
            초대 수락 토큰
            <input value={inviteAcceptToken} onChange={(event) => updateInviteAcceptToken(event.target.value)} placeholder="초대 token" aria-describedby="invite-accept-token-helper" />
          </label>
          <p id="invite-accept-token-helper" className="field-helper invite-token-helper">
            메일 초대 링크에서 token 값을 복사해 붙여 넣으세요.
          </p>
        </div>
        <div className="inline form-actions">
          <button type="submit" className="secondary" disabled={loading || !String(inviteAcceptToken || "").trim()}>
            초대 수락
          </button>
        </div>
      </form>
    </article>
  );
}
