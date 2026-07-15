import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useHasMounted } from "@/hooks/useHasMounted";

describe("useHasMounted", () => {
  it("devuelve true una vez montado en el cliente (jsdom)", () => {
    const { result } = renderHook(() => useHasMounted());
    expect(result.current).toBe(true);
  });

  it("se mantiene en true en renders subsecuentes", () => {
    const { result, rerender } = renderHook(() => useHasMounted());
    rerender();
    expect(result.current).toBe(true);
  });
});
