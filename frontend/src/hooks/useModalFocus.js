import { useLayoutEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "object",
  "embed",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const modalStack = [];
const inertElements = new Map();

function isVisibleFocusable(element) {
  if (!(element instanceof HTMLElement) || element.closest("[inert], [aria-hidden='true']")) {
    return false;
  }
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
}

function focusableElements(dialog) {
  return Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isVisibleFocusable);
}

function setElementInert(element) {
  const existing = inertElements.get(element);
  if (existing) {
    existing.count += 1;
    return;
  }
  inertElements.set(element, {
    count: 1,
    hadAttribute: element.hasAttribute("inert"),
    previousInert: Boolean(element.inert),
  });
  element.inert = true;
  element.setAttribute("inert", "");
}

function restoreElementInert(element) {
  const existing = inertElements.get(element);
  if (!existing) {
    return;
  }
  existing.count -= 1;
  if (existing.count > 0) {
    return;
  }
  inertElements.delete(element);
  element.inert = existing.previousInert;
  if (existing.hadAttribute) {
    element.setAttribute("inert", "");
  } else {
    element.removeAttribute("inert");
  }
}

function collectBackgroundElements(activeRoots) {
  const activePath = new Set();
  for (const root of activeRoots) {
    let current = root;
    while (current instanceof HTMLElement) {
      activePath.add(current);
      current = current.parentElement;
    }
  }

  const background = new Set();
  for (const root of activeRoots) {
    let current = root;
    while (current instanceof HTMLElement && current !== document.body) {
      const parent = current.parentElement;
      if (!parent) {
        break;
      }
      for (const sibling of parent.children) {
        if (!(sibling instanceof HTMLElement) || activePath.has(sibling)) {
          continue;
        }
        if (["LINK", "SCRIPT", "STYLE"].includes(sibling.tagName)) {
          continue;
        }
        background.add(sibling);
      }
      current = parent;
    }
  }
  return Array.from(background);
}

function scheduleInitialFocus(entry, preservedTarget = null, force = false) {
  let focusSettled = false;
  const focus = () => {
    if (modalStack.at(-1) !== entry || !entry.dialog.isConnected) {
      return;
    }
    const active = document.activeElement;
    if (entry.dialog.contains(active) && isVisibleFocusable(active) && (!force || focusSettled)) {
      return;
    }
    const preferred = isVisibleFocusable(preservedTarget) && entry.dialog.contains(preservedTarget)
      ? preservedTarget
      : entry.getInitialFocus?.();
    const target = isVisibleFocusable(preferred) ? preferred : focusableElements(entry.dialog)[0];
    target?.focus?.({ preventScroll: true });
    focusSettled = entry.dialog.contains(document.activeElement);
  };

  window.cancelAnimationFrame(entry.focusFrameId || 0);
  window.clearTimeout(entry.focusTimerId || 0);
  focus();
  entry.focusFrameId = window.requestAnimationFrame(focus);
  entry.focusTimerId = window.setTimeout(focus, 0);
}

function removeFromStack(entry) {
  const index = modalStack.lastIndexOf(entry);
  if (index >= 0) {
    modalStack.splice(index, 1);
  }
}

export function useModalFocus({
  activeOutsideRefs = [],
  dialogRef,
  focusKey,
  getInitialFocus,
  getReturnFocus,
  isolationRef,
  onEscape,
  open,
  surfaceOpen = open,
}) {
  const entryRef = useRef(null);
  const activeOutsideRefsRef = useRef(activeOutsideRefs);
  const focusKeyRef = useRef(focusKey);
  const getInitialFocusRef = useRef(getInitialFocus);
  const getReturnFocusRef = useRef(getReturnFocus);
  const lastSurfaceFocusRef = useRef(null);
  const onEscapeRef = useRef(onEscape);
  const surfaceOpenRef = useRef(surfaceOpen);

  useLayoutEffect(() => {
    activeOutsideRefsRef.current = activeOutsideRefs;
    focusKeyRef.current = focusKey;
    getInitialFocusRef.current = getInitialFocus;
    getReturnFocusRef.current = getReturnFocus;
    onEscapeRef.current = onEscape;
    surfaceOpenRef.current = surfaceOpen;
  });

  useLayoutEffect(() => {
    if (!surfaceOpen || typeof document === "undefined") {
      lastSurfaceFocusRef.current = null;
      return undefined;
    }

    const rememberSurfaceFocus = (event) => {
      const dialog = dialogRef.current;
      if (dialog instanceof HTMLElement && event.target instanceof HTMLElement && dialog.contains(event.target)) {
        lastSurfaceFocusRef.current = event.target;
      }
    };
    rememberSurfaceFocus({ target: document.activeElement });
    document.addEventListener("focusin", rememberSurfaceFocus, true);
    return () => document.removeEventListener("focusin", rememberSurfaceFocus, true);
  }, [dialogRef, surfaceOpen]);

  useLayoutEffect(() => {
    if (!open || typeof document === "undefined") {
      return undefined;
    }
    const dialog = dialogRef.current;
    if (!(dialog instanceof HTMLElement)) {
      return undefined;
    }

    const focusedAtOpen = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const lastSurfaceFocus = lastSurfaceFocusRef.current;
    const preservedTarget = dialog.contains(focusedAtOpen) && isVisibleFocusable(focusedAtOpen)
      ? focusedAtOpen
      : dialog.contains(lastSurfaceFocus) && isVisibleFocusable(lastSurfaceFocus)
        ? lastSurfaceFocus
        : null;
    const requestedReturnFocus = getReturnFocusRef.current?.();
    const returnFocusTarget = requestedReturnFocus instanceof HTMLElement ? requestedReturnFocus : focusedAtOpen;
    const isolationRoot = isolationRef?.current instanceof HTMLElement ? isolationRef.current : dialog;
    const activeRoots = [isolationRoot, ...activeOutsideRefsRef.current.map((ref) => ref?.current)].filter(
      (element) => element instanceof HTMLElement
    );
    const backgroundElements = collectBackgroundElements(activeRoots);
    backgroundElements.forEach(setElementInert);

    const entry = {
      dialog,
      focusFrameId: 0,
      focusTimerId: 0,
      focusKey: focusKeyRef.current,
      getInitialFocus: () => getInitialFocusRef.current?.(),
    };
    entryRef.current = entry;
    modalStack.push(entry);

    const handleKeyDown = (event) => {
      if (modalStack.at(-1) !== entry) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onEscapeRef.current?.(event);
        return;
      }
      if (event.key !== "Tab") {
        return;
      }

      const focusables = focusableElements(dialog);
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    scheduleInitialFocus(entry, preservedTarget);

    return () => {
      const focusedAtClose = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      document.removeEventListener("keydown", handleKeyDown, true);
      window.cancelAnimationFrame(entry.focusFrameId || 0);
      window.clearTimeout(entry.focusTimerId || 0);
      removeFromStack(entry);
      backgroundElements.forEach(restoreElementInert);
      entryRef.current = null;

      window.setTimeout(() => {
        if (surfaceOpenRef.current) {
          if (isVisibleFocusable(focusedAtClose) && dialog.contains(focusedAtClose)) {
            focusedAtClose.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
          }
          return;
        }
        if (!isVisibleFocusable(returnFocusTarget)) {
          return;
        }
        const topModal = modalStack.at(-1);
        if (topModal && !topModal.dialog.contains(returnFocusTarget)) {
          return;
        }
        const active = document.activeElement;
        const canRestore =
          !active ||
          active === focusedAtClose ||
          active === document.body ||
          active === document.documentElement ||
          !active.isConnected;
        if (canRestore) {
          returnFocusTarget.focus({ preventScroll: true });
          if (document.activeElement === returnFocusTarget) {
            returnFocusTarget.classList.add("modal-return-focus");
            returnFocusTarget.addEventListener("blur", () => {
              returnFocusTarget.classList.remove("modal-return-focus");
            }, { once: true });
          }
        }
      }, 0);
    };
  }, [dialogRef, isolationRef, open]);

  useLayoutEffect(() => {
    if (open && entryRef.current && entryRef.current.focusKey !== focusKey) {
      entryRef.current.focusKey = focusKey;
      scheduleInitialFocus(entryRef.current, null, true);
    }
  }, [focusKey, open]);
}
