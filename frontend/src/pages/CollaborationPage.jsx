import { CollaborationCommandCard } from "./collaboration/CollaborationCommandCard";
import { CollaborationInviteTables } from "./collaboration/CollaborationInviteTables";
import { CollaborationMembersTable } from "./collaboration/CollaborationMembersTable";

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
      <CollaborationCommandCard
        constants={{ COLLAB_ROLE_LABELS, COLLAB_ROLE_OPTIONS }}
        permissions={{ canManageHousehold, loading }}
        householdContext={{
          compactHouseholdSelectOptionName,
          handleHouseholdSwitchChange,
          household,
          householdList,
          householdMembers,
          householdRole,
          householdRoleLabel,
          householdSwitchDisabled,
          selectActiveHousehold,
        }}
        inviteAcceptance={{
          acceptHouseholdInvite,
          inviteAcceptToken,
          inviteAcceptanceCanSwitch,
          inviteAcceptanceNotice,
          updateInviteAcceptToken,
        }}
        inviteFormState={{
          createHouseholdInvite,
          inviteEmailInputRef,
          inviteForm,
          inviteFormErrors,
          updateInviteForm,
          updateInviteFormErrors,
        }}
        receivedInvites={{ receivedNewInvites, receivedInviteSectionRef, updateReceivedInviteTab }}
        sentInvites={{ sentNewInvites }}
        userContext={{ collaborationInviteSummary }}
      />
      <CollaborationInviteTables
        constants={{ COLLAB_ROLE_LABELS, INVITATION_STATUS_LABELS }}
        permissions={{ canManageHousehold, loading }}
        householdContext={{ household, selectActiveHousehold }}
        inviteAcceptance={{ inviteAcceptanceNotice }}
        receivedInvites={{
          acceptReceivedHouseholdInvite,
          receivedHouseholdInvites,
          receivedInviteSectionRef,
          receivedInviteTab,
          receivedNewInvites,
          receivedPastInvites,
          recentInviteIds,
          visibleReceivedInvites,
          updateReceivedInviteTab,
        }}
        sentInvites={{
          mySentInvites,
          revokeHouseholdInvite,
          sentInviteTab,
          sentNewInvites,
          sentPastInvites,
          visibleSentInvites,
          updateSentInviteTab,
        }}
        formatters={{ fmtDateTime }}
      />
      <CollaborationMembersTable
        constants={{ COLLAB_ROLE_LABELS }}
        permissions={{ canAssignOwner, canManageHousehold, loading }}
        householdContext={{ householdMembers }}
        members={{ changeMemberRole, memberRoleOptions, removeHouseholdMember }}
        formatters={{ fmtDateTime }}
        userContext={{ user }}
      />
    </section>
  );
}
