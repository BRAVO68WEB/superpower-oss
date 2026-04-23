import { useEffect, useMemo, useRef, useState } from "react";

export function JsonEditorField({
  label,
  value,
  fallback,
  rows = 4,
  onValidChange,
}: {
  label: string;
  value: unknown;
  fallback: unknown;
  rows?: number;
  onValidChange: (value: unknown) => void;
}) {
  const serializedValue = useMemo(() => JSON.stringify(value ?? fallback, null, 2), [fallback, value]);
  const [rawValue, setRawValue] = useState(serializedValue);
  const [error, setError] = useState<string | null>(null);
  const lastSubmittedCanonicalValue = useRef<string | null>(null);

  useEffect(() => {
    if (lastSubmittedCanonicalValue.current === serializedValue) {
      return;
    }

    setRawValue(serializedValue);
    setError(null);
  }, [serializedValue]);

  return (
    <label className="field field-span">
      <span>{label}</span>
      <textarea
        rows={rows}
        value={rawValue}
        onChange={(event) => {
          const nextValue = event.target.value;

          setRawValue(nextValue);

          try {
            const parsedValue = JSON.parse(nextValue);
            lastSubmittedCanonicalValue.current = JSON.stringify(parsedValue, null, 2);
            setError(null);
            onValidChange(parsedValue);
          } catch {
            setError("Invalid JSON");
          }
        }}
      />
      {error ? <small className="field-error">{error}</small> : null}
    </label>
  );
}
