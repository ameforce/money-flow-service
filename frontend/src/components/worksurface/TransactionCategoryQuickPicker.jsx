import { useMemo, useState } from "react";

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeSearch(value) {
  return normalizeText(value).toLocaleLowerCase("ko-KR");
}

function categoryIdOf(category) {
  return String(category?.id || "").trim();
}

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
  createMajorLabel = "새 대분류",
  createMajorPlaceholder = "예: 식비",
  createMinorLabel = "새 중분류",
  createMinorPlaceholder = "예: 점심",
  createButtonLabel = "추가",
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
  const [createMajor, setCreateMajor] = useState("");
  const [createMinor, setCreateMinor] = useState("");
  const [createPending, setCreatePending] = useState(false);
  const selectedId = String(selectedCategoryId || "").trim();
  const normalizedCreateMajor = normalizeText(createMajor);
  const normalizedCreateMinor = normalizeText(createMinor);
  const isCreateDisabled =
    disabled || createDisabled || createPending || !normalizedCreateMajor || !normalizedCreateMinor || typeof onCreate !== "function";
  const categoryMap = useMemo(
    () => new Map(categories.map((category) => [categoryIdOf(category), category]).filter(([id]) => id)),
    [categories]
  );
  const normalizedOptions = useMemo(() => {
    const quickById = new Map(
      quickOptions
        .map((option) => {
          const id = String(option?.id || "").trim();
          const category = categoryMap.get(id);
          return id && category
            ? [
                id,
                {
                  id,
                  category,
                  label: normalizeText(option.label) || `${toCategoryMajorLabel(category.major)} / ${toCategoryMinorLabel(category.minor)}`,
                  count: Number(option.count || 0),
                  quick: true,
                },
              ]
            : null;
        })
        .filter(Boolean)
    );

    const allOptions = categories
      .map((category) => {
        const id = categoryIdOf(category);
        if (!id) {
          return null;
        }
        const majorLabel = toCategoryMajorLabel(category.major);
        const minorLabel = toCategoryMinorLabel(category.minor);
        return {
          id,
          category,
          label: `${majorLabel} / ${minorLabel}`,
          majorLabel,
          minorLabel,
          count: 0,
          quick: false,
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        const majorOrder = left.majorLabel.localeCompare(right.majorLabel, "ko");
        if (majorOrder) {
          return majorOrder;
        }
        const minorOrder = left.minorLabel.localeCompare(right.minorLabel, "ko");
        return minorOrder || left.id.localeCompare(right.id);
      });

    return [
      ...Array.from(quickById.values()).map((option) => ({
        ...option,
        majorLabel: toCategoryMajorLabel(option.category.major),
        minorLabel: toCategoryMinorLabel(option.category.minor),
      })),
      ...allOptions.filter((option) => !quickById.has(option.id)),
    ];
  }, [categories, categoryMap, quickOptions, toCategoryMajorLabel, toCategoryMinorLabel]);

  const selectedCategory = categoryMap.get(selectedId);
  const selectedText = selectedCategory
    ? `${toCategoryMajorLabel(selectedCategory.major)} / ${toCategoryMinorLabel(selectedCategory.minor)}`
    : selectedEmptyText;
  const normalizedQuery = normalizeSearch(query);
  const visibleOptions = normalizedOptions
    .filter((option) => {
      if (!normalizedQuery) {
        return true;
      }
      const searchText = normalizeSearch(
        [
          option.label,
          option.majorLabel,
          option.minorLabel,
          option.category?.major,
          option.category?.minor,
        ].join(" ")
      );
      return searchText.includes(normalizedQuery);
    })
    .slice(0, normalizedQuery ? Math.max(maxOptions, 10) : maxOptions);

  const rootClass = ["transaction-category-picker", rootClassName].filter(Boolean).join(" ");

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
      }
    } finally {
      setCreatePending(false);
    }
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
      <div className={titleClassName}>
        <span>{title}</span>
        <small>{selectedText}</small>
      </div>
      <label className="transaction-category-picker-search">
        <span>{searchLabel}</span>
        <input
          type="search"
          data-testid="transaction-category-search"
          data-skip-enter-flow="true"
          value={query}
          placeholder={searchPlaceholder}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
            }
          }}
        />
      </label>
      {allowCreate && (
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
              onChange={(event) => setCreateMajor(event.target.value)}
              onKeyDown={handleCreateInputKeyDown}
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
              onChange={(event) => setCreateMinor(event.target.value)}
              onKeyDown={handleCreateInputKeyDown}
            />
          </label>
          <button
            type="button"
            className="secondary transaction-category-create-submit"
            data-testid="transaction-category-create-submit"
            disabled={isCreateDisabled}
            onClick={() => void handleCreate()}
          >
            {createPending ? "추가 중" : createButtonLabel}
          </button>
        </div>
      )}
      <div className={optionsClassName}>
        {visibleOptions.length > 0 ? (
          visibleOptions.map((option) => {
            const isSelected = selectedId === option.id;
            return (
              <button
                key={option.id}
                type="button"
                className={`${optionClassName}${isSelected ? " selected" : ""}`}
                data-testid={optionTestId}
                aria-pressed={isSelected}
                onClick={() => {
                  onSelect?.(option.id, option.category);
                  setQuery("");
                }}
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
    </section>
  );
}
