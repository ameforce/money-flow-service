import { useRef } from "react";

const INVITE_TABS = [
  { value: "new", label: "신규" },
  { value: "history", label: "이전" },
];

export function InviteTabs({ idPrefix, label, activeTab, counts, onChange }) {
  const tabRefs = useRef([]);

  const activateTab = (index) => {
    onChange(INVITE_TABS[index].value);
    tabRefs.current[index]?.focus();
  };

  const handleKeyDown = (event, index) => {
    const targetIndexes = {
      ArrowRight: (index + 1) % INVITE_TABS.length,
      ArrowLeft: (index - 1 + INVITE_TABS.length) % INVITE_TABS.length,
      Home: 0,
      End: INVITE_TABS.length - 1,
    };
    if (!(event.key in targetIndexes)) {
      return;
    }
    event.preventDefault();
    activateTab(targetIndexes[event.key]);
  };

  return (
    <div className="tabs sub-tabs" role="tablist" aria-label={label} aria-orientation="horizontal">
      {INVITE_TABS.map((tab, index) => {
        const selected = activeTab === tab.value;
        const count = counts[tab.value] || 0;
        return (
          <button
            key={tab.value}
            ref={(element) => { tabRefs.current[index] = element; }}
            id={`${idPrefix}-${tab.value}-tab`}
            type="button"
            role="tab"
            className={selected ? "active" : ""}
            aria-controls={`${idPrefix}-${tab.value}-panel`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span>{tab.label}</span>
            {count > 0 && <span className="sub-tab-badge" aria-hidden="true">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function InviteTabPanels({ idPrefix, activeTab, children }) {
  return INVITE_TABS.map((tab) => {
    const selected = activeTab === tab.value;
    return (
      <div
        key={tab.value}
        id={`${idPrefix}-${tab.value}-panel`}
        className="invite-tab-panel"
        role="tabpanel"
        aria-labelledby={`${idPrefix}-${tab.value}-tab`}
        hidden={!selected}
        tabIndex={selected ? 0 : -1}
      >
        {selected ? children : null}
      </div>
    );
  });
}
