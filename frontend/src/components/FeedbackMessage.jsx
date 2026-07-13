import { useLayoutEffect, useRef } from "react";

const PROTECTED_TARGET_SELECTOR = "button, a[href], input, select, textarea, [role='button'], [role='tab']";

export function FeedbackMessage({ feedback, onDismiss }) {
  const messageRef = useRef(null);
  const [summary, ...detailLines] = String(feedback?.text || "").split("\n");
  const detail = detailLines.join("\n").trim();

  useLayoutEffect(() => {
    const messageElement = messageRef.current;
    if (!messageElement || getComputedStyle(messageElement).position !== "fixed") {
      return;
    }
    let animationFrame = 0;
    const visualViewport = window.visualViewport;
    const reposition = () => {
      messageElement.style.removeProperty("top");
      messageElement.style.removeProperty("bottom");
      delete messageElement.dataset.feedbackPlacement;

      const messageBox = messageElement.getBoundingClientRect();
      const clearance = 8;
      const viewportTop = visualViewport?.offsetTop || 0;
      const viewportBottom = viewportTop + (visualViewport?.height || window.innerHeight);
      const protectedIntervals = Array.from(document.querySelectorAll(PROTECTED_TARGET_SELECTOR))
        .filter((element) => element instanceof HTMLElement && !messageElement.contains(element))
        .map((element) => {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          const rendered =
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            box.width > 0 &&
            box.height > 0 &&
            box.bottom > viewportTop &&
            box.top < viewportBottom &&
            box.right > messageBox.left &&
            box.left < messageBox.right;
          return rendered
            ? {
                bottom: Math.min(viewportBottom, box.bottom + clearance),
                top: Math.max(viewportTop, box.top - clearance),
              }
            : null;
        })
        .filter(Boolean)
        .sort((left, right) => left.top - right.top);

      const mergedIntervals = [];
      for (const interval of protectedIntervals) {
        const previous = mergedIntervals.at(-1);
        if (previous && interval.top <= previous.bottom) {
          previous.bottom = Math.max(previous.bottom, interval.bottom);
        } else {
          mergedIntervals.push({ ...interval });
        }
      }

      const availableGaps = [];
      let cursor = viewportTop + clearance;
      for (const interval of mergedIntervals) {
        if (interval.top - cursor >= messageBox.height) {
          availableGaps.push({ bottom: interval.top, top: cursor });
        }
        cursor = Math.max(cursor, interval.bottom);
      }
      if (viewportBottom - clearance - cursor >= messageBox.height) {
        availableGaps.push({ bottom: viewportBottom - clearance, top: cursor });
      }

      const placement = availableGaps
        .map((gap) => {
          const top = Math.min(Math.max(messageBox.top, gap.top), gap.bottom - messageBox.height);
          return { distance: Math.abs(top - messageBox.top), top };
        })
        .sort((left, right) => left.distance - right.distance)[0];
      if (!placement) {
        messageElement.dataset.feedbackPlacement = "inline";
        return;
      }
      if (Math.abs(placement.top - messageBox.top) > 0.5) {
        messageElement.style.setProperty("top", `${placement.top}px`, "important");
        messageElement.style.setProperty("bottom", "auto", "important");
        messageElement.dataset.feedbackPlacement = "adaptive";
      }
    };
    const scheduleReposition = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(reposition);
    };
    const resizeObserver = new ResizeObserver(scheduleReposition);
    resizeObserver.observe(messageElement);
    window.addEventListener("resize", scheduleReposition);
    visualViewport?.addEventListener("resize", scheduleReposition);
    visualViewport?.addEventListener("scroll", scheduleReposition);
    reposition();
    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleReposition);
      visualViewport?.removeEventListener("resize", scheduleReposition);
      visualViewport?.removeEventListener("scroll", scheduleReposition);
    };
  }, [feedback?.id]);

  if (!feedback?.text) {
    return null;
  }

  const isError = feedback.kind === "error";
  const isPersistent = !Number.isFinite(feedback.dismissAfterMs) || feedback.dismissAfterMs <= 0;
  return (
    <div
      ref={messageRef}
      className={`message ${isError ? "message-error" : "message-status"}${isPersistent ? " message-persistent" : ""}`}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      aria-atomic="true"
      aria-label={feedback.text}
      data-feedback-id={feedback.id}
      data-feedback-kind={feedback.kind}
    >
      <span className="feedback-copy" aria-hidden="true">
        <span className="feedback-summary">{summary}</span>
        {detail && <span className="feedback-detail">{detail}</span>}
      </span>
      <button type="button" className="message-close secondary" onClick={onDismiss}>
        닫기
      </button>
    </div>
  );
}
