import { apiClient } from "./client";

export const authService = {
  login(payload) {
    return apiClient.post("/auth/login/", payload).then((res) => res.data);
  },
  me() {
    return apiClient.get("/auth/me/").then((res) => res.data);
  },
  logout() {
    return apiClient.post("/auth/logout/").then((res) => res.data);
  },
  logoutAll() {
    return apiClient.post("/auth/logout-all/").then((res) => res.data);
  },
  requestPasswordReset(identifier) {
    return apiClient
      .post("/auth/password-reset/request/", { identifier })
      .then((res) => res.data);
  },
  confirmPasswordReset(payload) {
    return apiClient.post("/auth/password-reset/confirm/", payload).then((res) => res.data);
  },
  changePassword(payload) {
    return apiClient.post("/auth/password/change/", payload).then((res) => res.data);
  },
};
