import React, { createContext, useContext, useMemo, useState } from "react";
import { apiClient, demoLogin as requestDemoLogin } from "../api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  const value = useMemo(
    () => ({
      user,
      async login(email, password) {
        const response = await apiClient.post("/auth/login", { email, password });
        const { accessToken, user: authenticatedUser } = response.data.data;
        apiClient.defaults.headers.common.Authorization = `Bearer ${accessToken}`;
        setUser(authenticatedUser);
        return authenticatedUser;
      },
      async loginDemo(role) {
        const response = await requestDemoLogin(role);
        const { accessToken, user: authenticatedUser } = response.data;
        apiClient.defaults.headers.common.Authorization = `Bearer ${accessToken}`;
        setUser(authenticatedUser);
        return authenticatedUser;
      },
      async logout() {
        delete apiClient.defaults.headers.common.Authorization;
        setUser(null);
      }
    }),
    [user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
