import { createContext, useCallback, useEffect, useMemo, useState } from "react";

import { authService } from "../api/authService";
import { getAccessToken, setTokens } from "../api/client";

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  // Evita que rutas protegidas por permiso (RequirePermission) redirijan de
  // forma prematura mientras se recupera el perfil de un token persistido.
  const [isInitializing, setIsInitializing] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!getAccessToken()) {
      setIsInitializing(false);
      return;
    }
    authService
      .me()
      .then(setUser)
      .catch(() => setTokens(null, null))
      .finally(() => setIsInitializing(false));
  }, []);

  const login = useCallback(async (credentials) => {
    setIsLoading(true);
    setError(null);
    try {
      const tokens = await authService.login(credentials);
      setTokens(tokens.access, tokens.refresh);
      const me = await authService.me();
      setUser(me);
      return me;
    } catch (err) {
      // Mensaje genérico definido por el backend: nunca revela si el
      // usuario existe, si la contraseña era incorrecta o si la cuenta
      // está deshabilitada.
      setError(err.response?.data?.error?.message || "No se pudo iniciar sesión.");
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } catch {
      // Si el backend ya no puede revocar la sesión (p. ej. token ya
      // expirado), igual se limpia la sesión localmente.
    } finally {
      setTokens(null, null);
      setUser(null);
    }
  }, []);

  const logoutAll = useCallback(async () => {
    try {
      await authService.logoutAll();
    } finally {
      setTokens(null, null);
      setUser(null);
    }
  }, []);

  // Refresca el perfil en memoria sin pasar por login — usado tras completar
  // un cambio de contraseña obligatorio (must_change_password) para que el
  // gate de rutas deje de redirigir.
  const refreshUser = useCallback(async () => {
    const me = await authService.me();
    setUser(me);
    return me;
  }, []);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user || getAccessToken()),
      isLoading,
      isInitializing,
      error,
      login,
      logout,
      logoutAll,
      refreshUser,
    }),
    [user, isLoading, isInitializing, error, login, logout, logoutAll, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
