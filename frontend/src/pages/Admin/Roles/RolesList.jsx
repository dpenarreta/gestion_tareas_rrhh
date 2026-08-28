import { useEffect, useState } from "react";

import { rolesService } from "../../../api/rolesService";

export function RolesList() {
  const [roles, setRoles] = useState([]);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    rolesService
      .list()
      .then((data) => {
        setRoles(data.results ?? data);
        setStatus("ok");
      })
      .catch(() => setStatus("error"));
  }, []);

  if (status === "loading") return <div className="container mt-4">Cargando roles...</div>;
  if (status === "error") {
    return <div className="container mt-4 alert alert-danger">No se pudo cargar el listado.</div>;
  }

  return (
    <div className="container mt-4">
      <h2>Roles</h2>
      <table className="table table-striped">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Permisos asignados</th>
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => (
            <tr key={role.id}>
              <td>{role.name}</td>
              <td>{role.permission_codenames?.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
