import { forwardRef } from "react";

function normalizeIsoDateInput(value) {
  const digits = String(value || "")
    .replace(/\D/g, "")
    .slice(0, 8);

  if (digits.length <= 4) {
    return digits;
  }
  if (digits.length <= 6) {
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  }
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

export const IsoDateInput = forwardRef(function IsoDateInput(
  { className = "", onChange, onValueChange, placeholder = "YYYY-MM-DD", ...props },
  ref
) {
  const handleChange = (event) => {
    const normalizedValue = normalizeIsoDateInput(event.target.value);
    if (event.target.value !== normalizedValue) {
      event.target.value = normalizedValue;
    }
    onValueChange?.(normalizedValue);
    onChange?.(event);
  };

  return (
    <input
      ref={ref}
      {...props}
      type="text"
      inputMode="numeric"
      pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}"
      maxLength={10}
      autoComplete="off"
      placeholder={placeholder}
      className={`iso-date-input${className ? ` ${className}` : ""}`}
      onChange={handleChange}
    />
  );
});
