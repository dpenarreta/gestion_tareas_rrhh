import { Link } from "react-router-dom";

export function Forbidden() {
  return (
    <div className="container text-center" style={{ paddingTop: "4rem" }}>
      <h1>403</h1>
      <h2>Acceso denegado</h2>
      <p className="text-muted">No tiene los permisos necesarios para ver esta página.</p>
      <Link to="/" className="btn btn-primary">
        Volver al inicio
      </Link>
    </div>
  );
}
