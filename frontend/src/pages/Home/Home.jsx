import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { apiClient } from "../../api/client";
import { env } from "../../config/env";
import { useAuth } from "../../hooks/useAuth";

export function Home() {
  const [status, setStatus] = useState("checking");
  const { isAuthenticated, user, logout } = useAuth();

  useEffect(() => {
    apiClient
      .get("/health/")
      .then(() => setStatus("ok"))
      .catch(() => setStatus("unavailable"));
  }, []);

  return (
    <div className="container" style={{ paddingTop: "3rem" }}>
      <h1>Bienvenido a {env.appName}</h1>
      <p className="text-muted">
        Estado del backend:{" "}
        <span className={`badge ${status === "ok" ? "bg-success" : "bg-secondary"}`}>{status}</span>
      </p>
      {isAuthenticated ? (
        <>
          <p>
            Sesión: <strong>{user?.username}</strong>
          </p>
          <div className="d-flex gap-2">
            <Link to="/admin/users" className="btn btn-primary">
              Usuarios
            </Link>
            <Link to="/admin/roles" className="btn btn-primary">
              Roles
            </Link>
            <button type="button" className="btn btn-outline-secondary" onClick={logout}>
              Cerrar sesión
            </button>
          </div>
        </>
      ) : (
        <Link to="/login" className="btn btn-primary">
          Iniciar sesión
        </Link>
      )}
    </div>
  );
}
