import { useEffect, useState } from "react";

export function useCompactViewport(breakpointPx, landscapeBreakpointPx, landscapeMaxHeightPx) {
  const [isCompactViewport, setIsCompactViewport] = useState(
    () => typeof window !== "undefined" && (
      window.innerWidth <= breakpointPx ||
      (window.innerWidth <= landscapeBreakpointPx && window.innerHeight <= landscapeMaxHeightPx)
    )
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const mediaQuery = window.matchMedia(
      `(max-width: ${breakpointPx}px), (max-width: ${landscapeBreakpointPx}px) and (max-height: ${landscapeMaxHeightPx}px)`
    );
    const syncViewportMode = (event) => {
      setIsCompactViewport(Boolean(event?.matches ?? mediaQuery.matches));
    };
    const syncViewportModeFromResize = () => syncViewportMode(mediaQuery);

    syncViewportMode(mediaQuery);
    window.addEventListener("resize", syncViewportModeFromResize);

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncViewportMode);
      return () => {
        window.removeEventListener("resize", syncViewportModeFromResize);
        mediaQuery.removeEventListener("change", syncViewportMode);
      };
    }

    mediaQuery.addListener(syncViewportMode);
    return () => {
      window.removeEventListener("resize", syncViewportModeFromResize);
      mediaQuery.removeListener(syncViewportMode);
    };
  }, [breakpointPx, landscapeBreakpointPx, landscapeMaxHeightPx]);

  return isCompactViewport;
}
