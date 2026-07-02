export function displayImportFileName(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "-";
  }
  const parts = text.split(/[\\/]/u).filter(Boolean);
  return parts.at(-1) || text;
}

function isLocalPathLike(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z]:[\\/]/u.test(text) || /^\\\\[^\\/]+[\\/][^\\/]+/u.test(text) || /^\/(?:Users|home|var|tmp|private)\//u.test(text);
}

function redactTechnicalReportPayload(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redactTechnicalReportPayload(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        typeof item === "string" && (/(?:^|_)(?:path|dir|directory)(?:$|_)/iu.test(key) || isLocalPathLike(item))
          ? "[redacted-path]"
          : redactTechnicalReportPayload(item),
      ])
    );
  }
  return typeof value === "string" && isLocalPathLike(value) ? "[redacted-path]" : value;
}

export function formatTechnicalReportJson(report) {
  return JSON.stringify(redactTechnicalReportPayload(report), null, 2);
}
