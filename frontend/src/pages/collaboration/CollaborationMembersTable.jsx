export function CollaborationMembersTable({
  constants,
  permissions,
  householdContext,
  members,
  formatters,
  userContext,
}) {
  const { COLLAB_ROLE_LABELS } = constants;
  const { canAssignOwner, canManageHousehold, loading } = permissions;
  const { householdMembers } = householdContext;
  const { changeMemberRole, memberRoleOptions, removeHouseholdMember } = members;
  const { fmtDateTime } = formatters;
  const { user } = userContext;

  return (
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
                    onChange={(event) => changeMemberRole(member.member_id, event.target.value).catch(() => undefined)}
                  >
                    {memberRoleOptions.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
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
  );
}
