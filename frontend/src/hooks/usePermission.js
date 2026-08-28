import { useAuth } from "./useAuth";

export function usePermission(codename) {
  const { user } = useAuth();
  return Boolean(user?.permissions?.includes(codename));
}
