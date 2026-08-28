import { apiClient } from "./client";

export const adminUsersService = {
  list(params) {
    return apiClient.get("/admin/users/", { params }).then((res) => res.data);
  },
};
