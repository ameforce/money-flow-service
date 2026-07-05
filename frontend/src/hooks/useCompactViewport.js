import { useEffect, useState } from "react";

export function useCompactViewport(breakpointPx) {
  const [isCompactViewport, setIsCompactViewport] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= breakpointPx
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const mediaQuery = window.matchMedia(`(max-width: ${breakpointPx}px)`);
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
  }, [breakpointPx]);

  return isCompactViewport;
}
