import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="container text-center" style={{ paddingTop: "4rem" }}>
      <h1>404</h1>
      <h2>Página no encontrada</h2>
      <p className="text-muted">La página que buscás no existe o fue movida.</p>
      <Link to="/" className="btn btn-primary">
        Volver al inicio
      </Link>
    </div>
  );
}
