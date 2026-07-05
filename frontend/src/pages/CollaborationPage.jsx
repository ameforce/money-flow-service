// SIZE_OK issue-248 collaboration-page; maxPureLoc=443; transitional page shell must split before it grows.
export function CollaborationPage({
  constants,
  permissions,
  householdContext,
  inviteAcceptance,
  inviteFormState,
  receivedInvites,
  sentInvites,
  members,
  formatters,
  userContext,
}) {
  const {
    COLLAB_ROLE_LABELS,
    COLLAB_ROLE_OPTIONS,
    INVITATION_STATUS_LABELS,
  } = constants;
  const {
    canAssignOwner,
    canManageHousehold,
    loading,
  } = permissions;
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
  const {
    acceptReceivedHouseholdInvite,
    receivedHouseholdInvites,
    receivedInviteSectionRef,
    receivedInviteTab,
    receivedNewInvites,
    receivedPastInvites,
    recentInviteIds,
    visibleReceivedInvites,
    updateReceivedInviteTab,
  } = receivedInvites;
  const {
    mySentInvites,
    revokeHouseholdInvite,
    sentInviteTab,
    sentNewInvites,
    sentPastInvites,
    visibleSentInvites,
    updateSentInviteTab,
  } = sentInvites;
  const {
    changeMemberRole,
    memberRoleOptions,
    removeHouseholdMember,
  } = members;
  const {
    fmtDateTime,
  } = formatters;
  const {
    user,
    collaborationInviteSummary,
  } = userContext;

  return (
    <section className="grid-1 secondary-surface-grid collaboration-surface-grid">
              <article className="card secondary-surface-card collaboration-command-card">
                <div className="secondary-surface-header collaboration-surface-header">
                  <div className="work-surface-title">
                    <span className="surface-eyebrow">협업 컨트롤</span>
                    <h2>가계 협업 관리</h2>
                  </div>
                  <div className="surface-control-strip secondary-control-strip" aria-label="협업 관리 상태">
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
                    <select
                      id="collaboration-household-select"
                      className="household-select"
                      value={household?.id || ""}
                      onChange={handleHouseholdSwitchChange}
                      disabled={householdSwitchDisabled}
                      aria-describedby="collaboration-household-select-summary"
                    >
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
                    <select
                      value={inviteForm.role}
                      onChange={(event) => updateInviteForm((prev) => ({ ...prev, role: event.target.value }))}
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
                  <div className="form-field invite-token-field">
                    <label>
                      초대 수락 토큰
                      <input
                        value={inviteAcceptToken}
                        onChange={(event) => updateInviteAcceptToken(event.target.value)}
                        placeholder="초대 token"
                        aria-describedby="invite-accept-token-helper"
                      />
                    </label>
                    <p id="invite-accept-token-helper" className="field-helper invite-token-helper">
                      메일 초대 링크에서 token 값을 복사해 붙여 넣으세요.
                    </p>
                  </div>
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

              <article
                ref={receivedInviteSectionRef}
                className={`card table-card secondary-surface-card secondary-table-card${receivedNewInvites.length > 0 ? " invite-section-attention" : ""}`}
              >
                <div className="secondary-table-heading">
                  <div className="work-surface-title">
                    <span className="surface-eyebrow">초대 인박스</span>
                    <h2>받은 초대</h2>
                  </div>
                  <p className="table-summary">전체 {receivedHouseholdInvites.length}건 · 신규 {receivedNewInvites.length}건</p>
                </div>
                <div className="tabs sub-tabs" role="tablist" aria-label="받은 초대 분류">
                  <button type="button" role="tab" className={receivedInviteTab === "new" ? "active" : ""} onClick={() => updateReceivedInviteTab("new")}>
                    <span>신규</span>
                    {receivedNewInvites.length > 0 && <span className="sub-tab-badge" aria-hidden="true">{receivedNewInvites.length}</span>}
                  </button>
                  <button type="button" role="tab" className={receivedInviteTab === "history" ? "active" : ""} onClick={() => updateReceivedInviteTab("history")}>
                    <span>이전</span>
                    {receivedPastInvites.length > 0 && <span className="sub-tab-badge" aria-hidden="true">{receivedPastInvites.length}</span>}
                  </button>
                </div>
                <table>
                  <thead>
                    <tr><th>가계</th><th>초대한 사람</th><th>권한</th><th>상태</th><th>시각</th><th>동작</th></tr>
                  </thead>
                  <tbody>
                    {visibleReceivedInvites.length === 0 && (
                      <tr>
                        <td colSpan={6} className="empty-state">받은 초대가 없습니다.</td>
                      </tr>
                    )}
                    {visibleReceivedInvites.map((invite) => {
                      const pending = invite.status === "pending";
                      const accepted = invite.status === "accepted";
                      const canSwitchToInviteHousehold = accepted && invite.household_id && invite.household_id !== household?.id;
                      const isRecentlyAccepted = inviteAcceptanceNotice?.invitationId === invite.id;
                      const isNewInvite = pending && recentInviteIds.includes(String(invite.id));
                      return (
                        <tr key={invite.id} className={`${isRecentlyAccepted ? "invite-row-highlight" : ""} ${isNewInvite ? "invite-row-new" : ""}`}>
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
                            <div className="inline invite-table-actions">
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

              <article className="card table-card secondary-surface-card secondary-table-card">
                <div className="secondary-table-heading">
                  <div className="work-surface-title">
                    <span className="surface-eyebrow">권한 매트릭스</span>
                    <h2>멤버 목록</h2>
                  </div>
                  <p className="table-summary">총 {householdMembers.length}명</p>
                </div>
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
                      const roleSelectDisabled = !canManageHousehold || loading || isSelf;
                      const memberRoleLabel = `${member.display_name || member.email || "구성원"} 권한 변경`;
                      return (
                        <tr key={member.member_id}>
                          <td data-label="이름">{member.display_name || "-"}</td>
                          <td data-label="이메일">{member.email || "-"}</td>
                          <td data-label="권한">
                            <select
                              aria-label={memberRoleLabel}
                              value={member.role}
                              disabled={roleSelectDisabled}
                              title={isSelf ? "본인 권한은 다른 공동 소유자가 변경해야 합니다." : undefined}
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

              <article className="card table-card secondary-surface-card secondary-table-card">
                <div className="secondary-table-heading">
                  <div className="work-surface-title">
                    <span className="surface-eyebrow">발송 큐</span>
                    <h2>보낸 초대 현황(내 액션)</h2>
                  </div>
                  <p className="table-summary">전체 {mySentInvites.length}건 · 신규 {sentNewInvites.length}건</p>
                </div>
                <div className="tabs sub-tabs" role="tablist" aria-label="보낸 초대 분류">
                  <button type="button" role="tab" className={sentInviteTab === "new" ? "active" : ""} onClick={() => updateSentInviteTab("new")}>
                    <span>신규</span>
                    {sentNewInvites.length > 0 && <span className="sub-tab-badge" aria-hidden="true">{sentNewInvites.length}</span>}
                  </button>
                  <button type="button" role="tab" className={sentInviteTab === "history" ? "active" : ""} onClick={() => updateSentInviteTab("history")}>
                    <span>이전</span>
                    {sentPastInvites.length > 0 && <span className="sub-tab-badge" aria-hidden="true">{sentPastInvites.length}</span>}
                  </button>
                </div>
                <table>
                  <thead>
                    <tr><th>이메일</th><th>권한</th><th>상태</th><th>초대한 사람</th><th>만료일</th><th>동작</th></tr>
                  </thead>
                  <tbody>
                    {visibleSentInvites.length === 0 && (
                      <tr>
                        <td colSpan={6} className="empty-state">진행 중인 초대가 없습니다.</td>
                      </tr>
                    )}
                    {visibleSentInvites.map((invite) => {
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
                            <div className="inline invite-table-actions">
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
  );
}
