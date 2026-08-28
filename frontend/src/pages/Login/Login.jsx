import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "../../components/common/Button/Button";
import { useAuth } from "../../hooks/useAuth";

export function Login() {
  const { login, isLoading, error } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ identifier: "", password: "" });

  function handleChange(event) {
    setForm({ ...form, [event.target.name]: event.target.value });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    try {
      // Nota: el gate real de must_change_password lo exige el backend
      // (SessionAuthentication.authenticate) en cada request; la pantalla
      // dedicada para completarlo desde el frontend es alcance de una fase
      // posterior (ver plan de Fase 1) — por ahora solo se navega a inicio.
      await login(form);
      navigate("/");
    } catch {
      // El mensaje de error ya se expone vía useAuth().error
    }
  }

  return (
    <div className="container" style={{ paddingTop: "3rem" }}>
      <h2>Iniciar sesión</h2>
      <form onSubmit={handleSubmit} className="col-12 col-md-4">
        {error && <div className="alert alert-danger">{error}</div>}
        <div className="mb-3">
          <label className="form-label" htmlFor="identifier">
            Usuario o correo
          </label>
          <input
            id="identifier"
            name="identifier"
            className="form-control"
            value={form.identifier}
            onChange={handleChange}
            required
          />
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="password">
            Contraseña
          </label>
          <input
            id="password"
            name="password"
            type="password"
            className="form-control"
            value={form.password}
            onChange={handleChange}
            required
          />
        </div>
        <Button type="submit" isLoading={isLoading}>
          Entrar
        </Button>
      </form>
    </div>
  );
}
