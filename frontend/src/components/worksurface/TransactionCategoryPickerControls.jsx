export function TransactionCategoryPickerTitle({ titleClassName, title, selectedText }) {
  return (
    <div className={titleClassName}>
      <span>{title}</span>
      <small>{selectedText}</small>
    </div>
  );
}

export function TransactionCategorySearchControls({
  disabled,
  inputRef,
  query,
  searchLabel,
  searchPlaceholder,
  searchToggleLabel,
  showSearchInput,
  showSearchToggle,
  onOpenSearch,
  onQueryChange,
}) {
  return (
    <>
      {showSearchToggle && (
        <button
          type="button"
          className="secondary transaction-category-search-toggle"
          data-testid="transaction-category-search-toggle"
          disabled={disabled}
          onClick={onOpenSearch}
        >
          {searchToggleLabel}
        </button>
      )}
      {showSearchInput && (
        <label className="transaction-category-picker-search">
          <span>{searchLabel}</span>
          <input
            ref={inputRef}
            type="search"
            data-testid="transaction-category-search"
            data-skip-enter-flow="true"
            value={query}
            placeholder={searchPlaceholder}
            disabled={disabled}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
              }
            }}
          />
        </label>
      )}
    </>
  );
}

export function TransactionCategoryExistingSelect({
  disabled,
  label,
  options,
  placeholder,
  selectedId,
  onSelectOption,
}) {
  if (!options.length) {
    return null;
  }

  return (
    <label className="transaction-category-picker-select" data-testid="transaction-category-existing-select">
      <span>{label}</span>
      <select
        data-testid="transaction-category-list"
        value={selectedId}
        disabled={disabled}
        onChange={(event) => {
          if (!event.target.value) {
            onSelectOption(null);
            return;
          }
          const option = options.find((item) => item.id === event.target.value);
          if (option) {
            onSelectOption(option);
          }
        }}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TransactionCategoryOptionList({
  disabled,
  hasVisibleOptions,
  optionClassName,
  optionTestId,
  optionsClassName,
  selectedId,
  showOptions,
  visibleOptions,
  onSelectOption,
}) {
  if (!showOptions) {
    return null;
  }

  return (
    <div className={optionsClassName}>
      {hasVisibleOptions ? (
        visibleOptions.map((option) => {
          const isSelected = selectedId === option.id;
          return (
            <button
              key={option.id}
              type="button"
              className={`${optionClassName}${isSelected ? " selected" : ""}`}
              data-testid={optionTestId}
              aria-pressed={isSelected}
              onClick={() => onSelectOption(option)}
              disabled={disabled}
            >
              <span>{option.minorLabel || option.label}</span>
              <small>{option.count > 0 ? `최근 ${option.count}회` : option.majorLabel}</small>
            </button>
          );
        })
      ) : (
        <p className="table-summary">검색 결과가 없습니다.</p>
      )}
    </div>
  );
}

export function TransactionCategoryCreateControls({
  createButtonLabel,
  createDisabled,
  createExpanded,
  createMajor,
  createMajorLabel,
  createMajorPlaceholder,
  createMinor,
  createMinorLabel,
  createMinorPlaceholder,
  createPending,
  createToggleLabel,
  disabled,
  isCreateDisabled,
  showCreateFields,
  showCreateToggle,
  onCreate,
  onCreateInputKeyDown,
  onCreateMajorChange,
  onCreateMinorChange,
  onToggleCreate,
}) {
  return (
    <>
      {showCreateToggle && (
        <button
          type="button"
          className="secondary transaction-category-create-toggle"
          data-testid="transaction-category-create-toggle"
          aria-expanded={createExpanded}
          disabled={disabled || createDisabled || createPending}
          onClick={onToggleCreate}
        >
          {createExpanded ? "카테고리 추가 닫기" : createToggleLabel}
        </button>
      )}
      {showCreateFields && (
        <div className="transaction-category-create" data-testid="transaction-category-create">
          <label>
            <span>{createMajorLabel}</span>
            <input
              type="text"
              data-testid="transaction-category-create-major"
              data-skip-enter-flow="true"
              value={createMajor}
              placeholder={createMajorPlaceholder}
              disabled={disabled || createDisabled || createPending}
              onChange={(event) => onCreateMajorChange(event.target.value)}
              onKeyDown={onCreateInputKeyDown}
            />
          </label>
          <label>
            <span>{createMinorLabel}</span>
            <input
              type="text"
              data-testid="transaction-category-create-minor"
              data-skip-enter-flow="true"
              value={createMinor}
              placeholder={createMinorPlaceholder}
              disabled={disabled || createDisabled || createPending}
              onChange={(event) => onCreateMinorChange(event.target.value)}
              onKeyDown={onCreateInputKeyDown}
            />
          </label>
          <button
            type="button"
            className="secondary transaction-category-create-submit"
            data-testid="transaction-category-create-submit"
            disabled={isCreateDisabled}
            onClick={onCreate}
          >
            {createPending ? "추가 중" : createButtonLabel}
          </button>
        </div>
      )}
    </>
  );
}
