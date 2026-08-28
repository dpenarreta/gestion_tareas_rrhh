import { apiClient } from "./client";

export const rolesService = {
  list() {
    return apiClient.get("/admin/roles/").then((res) => res.data);
  },
};
