import { useEffect, useState } from "react";

import { adminUsersService } from "../../../api/adminUsersService";

export function UsersList() {
  const [users, setUsers] = useState([]);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    adminUsersService
      .list()
      .then((data) => {
        setUsers(data.results ?? data);
        setStatus("ok");
      })
      .catch(() => setStatus("error"));
  }, []);

  if (status === "loading") return <div className="container mt-4">Cargando usuarios...</div>;
  if (status === "error") {
    return <div className="container mt-4 alert alert-danger">No se pudo cargar el listado.</div>;
  }

  return (
    <div className="container mt-4">
      <h2>Usuarios</h2>
      <table className="table table-striped">
        <thead>
          <tr>
            <th>Usuario</th>
            <th>Email</th>
            <th>Estado</th>
            <th>Roles</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.username}</td>
              <td>{user.email}</td>
              <td>{user.status}</td>
              <td>{user.roles?.map((role) => role.name).join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
