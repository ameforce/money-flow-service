export async function startReactScan(enabled, loadScanner) {
  if (!enabled || typeof loadScanner !== "function") {
    return false;
  }

  try {
    const scanner = await loadScanner();
    if (typeof scanner.scan !== "function") {
      return false;
    }
    scanner.scan();
    return true;
  } catch {
    return false;
  }
}
