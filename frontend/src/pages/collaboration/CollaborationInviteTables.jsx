import { InviteTabPanels, InviteTabs } from "./InviteTabs";

export function CollaborationInviteTables({
  constants,
  permissions,
  householdContext,
  inviteAcceptance,
  receivedInvites,
  sentInvites,
  formatters,
}) {
  return (
    <>
      <ReceivedInvitesTable
        constants={constants}
        permissions={permissions}
        householdContext={householdContext}
        inviteAcceptance={inviteAcceptance}
        receivedInvites={receivedInvites}
        formatters={formatters}
      />
      <SentInvitesTable
        constants={constants}
        permissions={permissions}
        sentInvites={sentInvites}
        formatters={formatters}
      />
    </>
  );
}

function ReceivedInvitesTable({ constants, permissions, householdContext, inviteAcceptance, receivedInvites, formatters }) {
  const { COLLAB_ROLE_LABELS, INVITATION_STATUS_LABELS } = constants;
  const { loading } = permissions;
  const { household, selectActiveHousehold } = householdContext;
  const { inviteAcceptanceNotice } = inviteAcceptance;
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
  const { fmtDateTime } = formatters;

  return (
    <article ref={receivedInviteSectionRef} className={`card table-card secondary-surface-card secondary-table-card${receivedNewInvites.length > 0 ? " invite-section-attention" : ""}`}>
      <div className="secondary-table-heading">
        <div className="work-surface-title">
          <span className="surface-eyebrow">초대 인박스</span>
          <h2>받은 초대</h2>
        </div>
        <p className="table-summary">전체 {receivedHouseholdInvites.length}건 · 신규 {receivedNewInvites.length}건</p>
      </div>
      <InviteTabs
        idPrefix="received-invites"
        label="받은 초대 분류"
        activeTab={receivedInviteTab}
        counts={{ new: receivedNewInvites.length, history: receivedPastInvites.length }}
        onChange={updateReceivedInviteTab}
      />
      <InviteTabPanels idPrefix="received-invites" activeTab={receivedInviteTab}>
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
                      <button type="button" className="secondary" disabled={loading} onClick={() => acceptReceivedHouseholdInvite(invite.id).catch(() => undefined)}>
                        초대 수락
                      </button>
                    )}
                    {!pending && canSwitchToInviteHousehold && (
                      <button type="button" disabled={loading} onClick={() => selectActiveHousehold(invite.household_id).catch(() => undefined)}>
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
      </InviteTabPanels>
    </article>
  );
}

function SentInvitesTable({ constants, permissions, sentInvites, formatters }) {
  const { COLLAB_ROLE_LABELS, INVITATION_STATUS_LABELS } = constants;
  const { canManageHousehold, loading } = permissions;
  const {
    mySentInvites,
    revokeHouseholdInvite,
    sentInviteTab,
    sentNewInvites,
    sentPastInvites,
    visibleSentInvites,
    updateSentInviteTab,
  } = sentInvites;
  const { fmtDateTime } = formatters;

  return (
    <article className="card table-card secondary-surface-card secondary-table-card">
      <div className="secondary-table-heading">
        <div className="work-surface-title">
          <span className="surface-eyebrow">발송 큐</span>
          <h2>보낸 초대 현황(내 액션)</h2>
        </div>
        <p className="table-summary">전체 {mySentInvites.length}건 · 신규 {sentNewInvites.length}건</p>
      </div>
      <InviteTabs
        idPrefix="sent-invites"
        label="보낸 초대 분류"
        activeTab={sentInviteTab}
        counts={{ new: sentNewInvites.length, history: sentPastInvites.length }}
        onChange={updateSentInviteTab}
      />
      <InviteTabPanels idPrefix="sent-invites" activeTab={sentInviteTab}>
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
                    <button type="button" className="danger" disabled={!canManageHousehold || loading || !pending} onClick={() => revokeHouseholdInvite(invite.id).catch(() => undefined)}>
                      {pending ? "초대 취소" : "-"}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </InviteTabPanels>
    </article>
  );
}
