export function FilePickerDropzone({
  accept,
  buttonLabel,
  children,
  className = "",
  disabled = false,
  inputLabel,
  inputRef,
  isDragOver = false,
  multiple = false,
  onChange,
  onDragActiveChange,
  onDrop,
}) {
  const openFileChooser = () => {
    if (!disabled) {
      inputRef.current?.click();
    }
  };
  const supportsDrop = typeof onDrop === "function";

  return (
    <div
      className={`file-drop-area${className ? ` ${className}` : ""}${isDragOver ? " drag-over" : ""}${disabled ? " is-disabled" : ""}`}
      aria-disabled={disabled || undefined}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest("button")) {
          return;
        }
        openFileChooser();
      }}
      onDragOver={supportsDrop ? (event) => {
        event.preventDefault();
        if (!disabled) {
          onDragActiveChange?.(true);
        }
      } : undefined}
      onDragLeave={supportsDrop ? (event) => {
        event.preventDefault();
        onDragActiveChange?.(false);
      } : undefined}
      onDrop={supportsDrop ? (event) => {
        event.preventDefault();
        onDragActiveChange?.(false);
        if (!disabled && event.dataTransfer.files?.length) {
          onDrop(event.dataTransfer.files);
        }
      } : undefined}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(event) => onChange(multiple ? event.target.files : event.target.files?.[0] || null)}
        onClick={(event) => event.stopPropagation()}
        className="visually-hidden-file-input"
        aria-label={inputLabel}
        disabled={disabled}
      />
      <div className="file-picker-status" role="status" aria-live="polite" aria-atomic="true">
        {children}
      </div>
      <button
        type="button"
        className="secondary file-picker-button"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          openFileChooser();
        }}
      >
        {buttonLabel}
      </button>
    </div>
  );
}
