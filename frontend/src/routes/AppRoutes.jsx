import { Navigate, Route, Routes } from "react-router-dom";

import { RequirePermission } from "../components/common/RequirePermission/RequirePermission";
import { Forbidden } from "../pages/Errors/Forbidden";
import { NotFound } from "../pages/Errors/NotFound";
import { Home } from "../pages/Home/Home";
import { Login } from "../pages/Login/Login";
import { RolesList } from "../pages/Admin/Roles/RolesList";
import { UsersList } from "../pages/Admin/Users/UsersList";

const USUARIOS_VER = "usuarios.ver";
const ROLES_VER = "roles.ver";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/403" element={<Forbidden />} />

      <Route
        path="/admin/users"
        element={
          <RequirePermission permission={USUARIOS_VER}>
            <UsersList />
          </RequirePermission>
        }
      />
      <Route
        path="/admin/roles"
        element={
          <RequirePermission permission={ROLES_VER}>
            <RolesList />
          </RequirePermission>
        }
      />
      <Route path="/admin" element={<Navigate to="/admin/users" replace />} />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
