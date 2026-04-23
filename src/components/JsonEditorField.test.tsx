// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { JsonEditorField } from "./JsonEditorField";

describe("JsonEditorField", () => {
  it("keeps incomplete JSON visible while showing validation", () => {
    const onValidChange = vi.fn();

    render(
      <JsonEditorField label="Headers JSON" value={{ hello: "world" }} fallback={{}} onValidChange={onValidChange} />,
    );

    const field = screen.getByLabelText("Headers JSON");
    fireEvent.change(field, { target: { value: "{" } });

    expect(field).toHaveValue("{");
    expect(screen.getByText("Invalid JSON")).toBeInTheDocument();
    expect(onValidChange).not.toHaveBeenCalled();
  });

  it("emits parsed JSON once the input becomes valid", () => {
    const onValidChange = vi.fn();

    render(
      <JsonEditorField label="Body JSON" value={{ hello: "world" }} fallback={{}} onValidChange={onValidChange} />,
    );

    fireEvent.change(screen.getByLabelText("Body JSON"), { target: { value: '{"hello":"moon"}' } });

    expect(onValidChange).toHaveBeenCalledWith({ hello: "moon" });
  });
});
