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
      const protectedBoxes = Array.from(document.querySelectorAll(PROTECTED_TARGET_SELECTOR))
        .filter((element) => element instanceof HTMLElement && !messageElement.contains(element))
        .map((element) => {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            box.width > 0 &&
            box.height > 0 &&
            box.bottom > viewportTop &&
            box.top < viewportBottom &&
            box.right > messageBox.left &&
            box.left < messageBox.right
          ) ? box : null;
        })
        .filter(Boolean);
      const maxTop = viewportBottom - clearance - messageBox.height;
      const candidates = [
        messageBox.top,
        viewportTop + clearance,
        (viewportTop + maxTop) / 2,
        maxTop,
      ].filter((top, index, values) => top >= viewportTop + clearance && top <= maxTop && values.indexOf(top) === index);
      const top = candidates
        .filter((candidate) => protectedBoxes.every((box) => candidate + messageBox.height <= box.top || candidate >= box.bottom))
        .sort((left, right) => Math.abs(left - messageBox.top) - Math.abs(right - messageBox.top))[0];
      if (!Number.isFinite(top)) {
        messageElement.dataset.feedbackPlacement = "inline";
        return;
      }
      if (Math.abs(top - messageBox.top) > 0.5) {
        messageElement.style.setProperty("top", `${top}px`, "important");
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
        {summary}
        {detail && <><br /><span className="feedback-detail">{detail}</span></>}
      </span>
      <button type="button" className="message-close secondary" onClick={onDismiss}>
        닫기
      </button>
    </div>
  );
}
