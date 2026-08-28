import { Navigate } from "react-router-dom";

import { useAuth } from "../../../hooks/useAuth";

export function RequirePermission({ permission, children }) {
  const { user, isAuthenticated, isInitializing } = useAuth();

  if (isInitializing) {
    return null;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (!user?.permissions?.includes(permission)) {
    return <Navigate to="/403" replace />;
  }
  return children;
}
