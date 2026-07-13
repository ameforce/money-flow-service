import { useCallback, useEffect, useState } from "react";

const EMPTY_FEEDBACK = Object.freeze({
  dismissAfterMs: null,
  id: 0,
  kind: "status",
  text: "",
});

function normalizeFeedbackText(value) {
  return String(value || "").trim();
}

export function useFeedbackMessage() {
  const [feedback, setFeedback] = useState(EMPTY_FEEDBACK);

  const showFeedback = useCallback((kind, nextText, options = {}) => {
    setFeedback((previous) => {
      const text = normalizeFeedbackText(
        typeof nextText === "function" ? nextText(previous.text) : nextText
      );
      if (!text) {
        return previous.text ? { ...EMPTY_FEEDBACK, id: previous.id } : previous;
      }
      const dismissAfterMs = Object.hasOwn(options, "dismissAfterMs")
        ? options.dismissAfterMs
        : kind === "status"
          ? 3_800
          : null;
      return {
        dismissAfterMs,
        id: previous.id + 1,
        kind,
        text,
      };
    });
  }, []);

  const showStatusMessage = useCallback(
    (nextText, options) => showFeedback("status", nextText, options),
    [showFeedback]
  );
  const showErrorMessage = useCallback(
    (nextText, options) => showFeedback("error", nextText, options),
    [showFeedback]
  );
  const clearFeedback = useCallback(() => {
    setFeedback((previous) => (
      previous.text ? { ...EMPTY_FEEDBACK, id: previous.id } : previous
    ));
  }, []);
  const updateFeedbackText = useCallback((updateText) => {
    setFeedback((previous) => {
      const text = normalizeFeedbackText(
        typeof updateText === "function" ? updateText(previous.text) : updateText
      );
      if (text === previous.text) {
        return previous;
      }
      if (!text) {
        return { ...EMPTY_FEEDBACK, id: previous.id };
      }
      return {
        ...previous,
        id: previous.id + 1,
        text,
      };
    });
  }, []);

  useEffect(() => {
    if (!feedback.text || !Number.isFinite(feedback.dismissAfterMs) || feedback.dismissAfterMs <= 0) {
      return undefined;
    }
    const feedbackId = feedback.id;
    const timer = window.setTimeout(() => {
      setFeedback((previous) => (
        previous.id === feedbackId ? { ...EMPTY_FEEDBACK, id: previous.id } : previous
      ));
    }, feedback.dismissAfterMs);
    return () => window.clearTimeout(timer);
  }, [feedback.dismissAfterMs, feedback.id, feedback.text]);

  return {
    clearFeedback,
    feedback,
    message: feedback.text,
    showErrorMessage,
    showStatusMessage,
    updateFeedbackText,
  };
}
