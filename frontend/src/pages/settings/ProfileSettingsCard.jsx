export function ProfileSettingsCard({ constants, profile }) {
  const { DISPLAY_NAME_MODE_OPTIONS } = constants;
  const { profileDisplayModeLabel, profileForm, saveProfileSettings, user, updateProfileForm } = profile;

  return (
    <article className="card secondary-surface-card settings-profile-card">
      <div className="secondary-surface-header">
        <div className="work-surface-title">
          <span className="surface-eyebrow">개인 설정</span>
          <h2>내 프로필</h2>
        </div>
        <div className="surface-control-strip secondary-control-strip" aria-label="프로필 설정 상태">
          <span className="surface-chip surface-chip-strong">{user?.display_name || "표시명 대기"}</span>
          <span className="surface-chip">{profileDisplayModeLabel}</span>
        </div>
      </div>
      <form className="form-grid settings-form-grid" onSubmit={saveProfileSettings}>
        <label>
          본명
          <input value={profileForm.real_name} onChange={(event) => updateProfileForm((prev) => ({ ...prev, real_name: event.target.value }))} required />
        </label>
        <label>
          닉네임
          <input value={profileForm.nickname} onChange={(event) => updateProfileForm((prev) => ({ ...prev, nickname: event.target.value }))} placeholder="선택 입력" />
        </label>
        <label>
          표시명 방식
          <select value={profileForm.display_name_mode} onChange={(event) => updateProfileForm((prev) => ({ ...prev, display_name_mode: event.target.value }))}>
            {DISPLAY_NAME_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <div className="settings-preview">현재 표시명: <strong>{user?.display_name || "-"}</strong></div>
        <div className="inline form-actions settings-actions"><button type="submit">프로필 저장</button></div>
      </form>
    </article>
  );
}
