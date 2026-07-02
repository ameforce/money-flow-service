import { useMemo, useRef, useState } from "react";

import {
  TransactionCategoryCreateControls,
  TransactionCategoryOptionList,
  TransactionCategoryPickerTitle,
  TransactionCategorySearchControls,
} from "./TransactionCategoryPickerControls";
import {
  buildCategoryMap,
  buildCategoryPickerOptions,
  normalizeText,
  selectedCategoryText,
  visibleCategoryOptions,
} from "./TransactionCategoryPickerModel";

export function TransactionCategoryQuickPicker({
  categories = [],
  quickOptions = [],
  selectedCategoryId = "",
  disabled = false,
  allowCreate = false,
  createDisabled = false,
  onSelect,
  onCreate,
  title = "추천 카테고리",
  selectedEmptyText = "카테고리를 검색하거나 추천 항목을 선택하세요.",
  searchLabel = "카테고리 검색",
  searchPlaceholder = "카테고리 검색",
  searchMode = "always",
  searchToggleLabel = "카테고리 찾기",
  createMajorLabel = "새 대분류",
  createMajorPlaceholder = "예: 식비",
  createMinorLabel = "새 중분류",
  createMinorPlaceholder = "예: 점심",
  createButtonLabel = "추가",
  createMode = "inline",
  createToggleLabel = "새 카테고리",
  createToggleVisibility = "always",
  maxOptions = 8,
  rootClassName = "",
  titleClassName = "transaction-category-picker-title",
  optionsClassName = "transaction-category-picker-options",
  optionClassName = "transaction-category-option",
  optionTestId = "transaction-category-option",
  toCategoryMajorLabel = (value) => normalizeText(value),
  toCategoryMinorLabel = (value) => normalizeText(value),
}) {
  const [query, setQuery] = useState("");
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [createMajor, setCreateMajor] = useState("");
  const [createMinor, setCreateMinor] = useState("");
  const [createExpanded, setCreateExpanded] = useState(false);
  const [createPending, setCreatePending] = useState(false);
  const selectedId = String(selectedCategoryId || "").trim();
  const normalizedCreateMajor = normalizeText(createMajor);
  const normalizedCreateMinor = normalizeText(createMinor);
  const isCreateDisabled =
    disabled || createDisabled || createPending || !normalizedCreateMajor || !normalizedCreateMinor || typeof onCreate !== "function";
  const categoryMap = useMemo(() => buildCategoryMap(categories), [categories]);
  const normalizedOptions = useMemo(
    () =>
      buildCategoryPickerOptions({
        categories,
        categoryMap,
        quickOptions,
        toCategoryMajorLabel,
        toCategoryMinorLabel,
      }),
    [categories, categoryMap, quickOptions, toCategoryMajorLabel, toCategoryMinorLabel]
  );
  const selectedText = selectedCategoryText({
    categoryMap,
    selectedEmptyText,
    selectedId,
    toCategoryMajorLabel,
    toCategoryMinorLabel,
  });
  const { normalizedQuery, visibleOptions } = useMemo(
    () => visibleCategoryOptions(normalizedOptions, query, maxOptions),
    [maxOptions, normalizedOptions, query]
  );

  const rootClass = ["transaction-category-picker", rootClassName].filter(Boolean).join(" ");
  const searchInputRef = useRef(null);
  const searchIsToggle = searchMode === "toggle";
  const showSearchInput = !searchIsToggle || searchExpanded || Boolean(query);
  const showSearchToggle = searchIsToggle && !showSearchInput;
  const createIsToggle = createMode === "toggle";
  const hasSearchText = Boolean(normalizedQuery);
  const hasVisibleOptions = visibleOptions.length > 0;
  const showNoResults = showSearchInput && hasSearchText && !hasVisibleOptions;
  const showOptions = hasVisibleOptions || showNoResults;
  const showCreateToggle =
    allowCreate &&
    createIsToggle &&
    (createToggleVisibility !== "on-query" || createExpanded || hasSearchText);
  const showCreateFields = allowCreate && (!createIsToggle || createExpanded);

  const handleCreate = async () => {
    if (isCreateDisabled) {
      return;
    }
    setCreatePending(true);
    try {
      const result = await onCreate?.({
        major: normalizedCreateMajor,
        minor: normalizedCreateMinor,
      });
      if (result !== false) {
        setCreateMajor("");
        setCreateMinor("");
        setQuery("");
        if (createIsToggle) {
          setCreateExpanded(false);
        }
      }
    } finally {
      setCreatePending(false);
    }
  };

  const openSearch = () => {
    setSearchExpanded(true);
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus?.({ preventScroll: true });
    });
  };

  const handleCreateInputKeyDown = (event) => {
    if (event.key !== "Enter" || event.isComposing) {
      return;
    }
    event.preventDefault();
    void handleCreate();
  };

  return (
    <section className={rootClass} data-testid="transaction-category-quick-picker" aria-label={title}>
      <TransactionCategoryPickerTitle titleClassName={titleClassName} title={title} selectedText={selectedText} />
      <TransactionCategorySearchControls
        disabled={disabled}
        inputRef={searchInputRef}
        query={query}
        searchLabel={searchLabel}
        searchPlaceholder={searchPlaceholder}
        searchToggleLabel={searchToggleLabel}
        showSearchInput={showSearchInput}
        showSearchToggle={showSearchToggle}
        onOpenSearch={openSearch}
        onQueryChange={setQuery}
      />
      <TransactionCategoryOptionList
        disabled={disabled}
        hasVisibleOptions={hasVisibleOptions}
        optionClassName={optionClassName}
        optionTestId={optionTestId}
        optionsClassName={optionsClassName}
        selectedId={selectedId}
        showOptions={showOptions}
        visibleOptions={visibleOptions}
        onSelectOption={(option) => {
          onSelect?.(option.id, option.category);
          setQuery("");
          if (searchIsToggle) {
            setSearchExpanded(false);
          }
        }}
      />
      <TransactionCategoryCreateControls
        createButtonLabel={createButtonLabel}
        createDisabled={createDisabled}
        createExpanded={createExpanded}
        createMajor={createMajor}
        createMajorLabel={createMajorLabel}
        createMajorPlaceholder={createMajorPlaceholder}
        createMinor={createMinor}
        createMinorLabel={createMinorLabel}
        createMinorPlaceholder={createMinorPlaceholder}
        createPending={createPending}
        createToggleLabel={createToggleLabel}
        disabled={disabled}
        isCreateDisabled={isCreateDisabled}
        showCreateFields={showCreateFields}
        showCreateToggle={showCreateToggle}
        onCreate={() => void handleCreate()}
        onCreateInputKeyDown={handleCreateInputKeyDown}
        onCreateMajorChange={setCreateMajor}
        onCreateMinorChange={setCreateMinor}
        onToggleCreate={() => setCreateExpanded((prev) => !prev)}
      />
    </section>
  );
}
