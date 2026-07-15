import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TimeInput24 from "@/components/ui/TimeInput24";

describe("TimeInput24", () => {
  it("separa un value 'HH:MM' en los selects de hora y minutos", () => {
    render(<TimeInput24 value="08:45" onChange={vi.fn()} />);
    expect(screen.getByLabelText("Hora")).toHaveValue("08");
    expect(screen.getByLabelText("Minutos")).toHaveValue("45");
  });

  it("con value vacío, ambos selects quedan sin selección (placeholder)", () => {
    render(<TimeInput24 value="" onChange={vi.fn()} />);
    expect(screen.getByLabelText("Hora")).toHaveValue("");
    expect(screen.getByLabelText("Minutos")).toHaveValue("");
  });

  it("al cambiar la hora, llama a onChange combinando la nueva hora con los minutos existentes", () => {
    const onChange = vi.fn();
    render(<TimeInput24 value="08:45" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Hora"), { target: { value: "14" } });
    expect(onChange).toHaveBeenCalledWith("14:45");
  });

  it("al cambiar los minutos, llama a onChange combinando la hora existente con los nuevos minutos", () => {
    const onChange = vi.fn();
    render(<TimeInput24 value="08:45" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Minutos"), { target: { value: "05" } });
    expect(onChange).toHaveBeenCalledWith("08:05");
  });

  it("usa '00' como valor por defecto para la parte que aún no fue elegida", () => {
    const onChange = vi.fn();
    render(<TimeInput24 value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Hora"), { target: { value: "09" } });
    expect(onChange).toHaveBeenCalledWith("09:00");
  });

  it("propaga el prop 'required' a ambos selects", () => {
    render(<TimeInput24 value="" onChange={vi.fn()} required />);
    expect(screen.getByLabelText("Hora")).toBeRequired();
    expect(screen.getByLabelText("Minutos")).toBeRequired();
  });

  it("renderiza las 24 opciones de hora y las 60 de minutos (más el placeholder)", () => {
    render(<TimeInput24 value="" onChange={vi.fn()} />);
    const hourOptions = screen.getByLabelText("Hora").querySelectorAll("option");
    const minuteOptions = screen.getByLabelText("Minutos").querySelectorAll("option");
    expect(hourOptions).toHaveLength(25); // 24 horas + placeholder "HH"
    expect(minuteOptions).toHaveLength(61); // 60 minutos + placeholder "MM"
  });
});
