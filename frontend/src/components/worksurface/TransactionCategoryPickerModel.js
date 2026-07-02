export function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function categoryIdOf(category) {
  return String(category?.id || "").trim();
}

export function buildCategoryMap(categories) {
  return new Map(categories.map((category) => [categoryIdOf(category), category]).filter(([id]) => id));
}

export function buildCategoryPickerOptions({
  categories,
  categoryMap,
  quickOptions,
  toCategoryMajorLabel,
  toCategoryMinorLabel,
}) {
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
}

function normalizeSearch(value) {
  return normalizeText(value).toLocaleLowerCase("ko-KR");
}

export function selectedCategoryText({ categoryMap, selectedEmptyText, selectedId, toCategoryMajorLabel, toCategoryMinorLabel }) {
  const selectedCategory = categoryMap.get(selectedId);
  return selectedCategory
    ? `${toCategoryMajorLabel(selectedCategory.major)} / ${toCategoryMinorLabel(selectedCategory.minor)}`
    : selectedEmptyText;
}

export function visibleCategoryOptions(options, query, maxOptions) {
  const normalizedQuery = normalizeSearch(query);
  return {
    normalizedQuery,
    visibleOptions: options
      .filter((option) => {
        if (!normalizedQuery) {
          return true;
        }
        const searchText = normalizeSearch(
          [option.label, option.majorLabel, option.minorLabel, option.category?.major, option.category?.minor].join(" ")
        );
        return searchText.includes(normalizedQuery);
      })
      .slice(0, normalizedQuery ? Math.max(maxOptions, 10) : maxOptions),
  };
}
