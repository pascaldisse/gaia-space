// Web-mode-only auth + user-management REST endpoints (not part of the invoke/cmd
// bridge — these are plain HTTP under {BASE}api/auth/* and {BASE}api/users*).
// Never called in Tauri mode.

export type Role = "admin" | "member";
export type User = {
  id: string;
  username: string;
  display_name: string;
  profile_id: string;
  role: Role;
  active: boolean;
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const base = import.meta.env.BASE_URL;
  const res = await fetch(`${base}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // no/invalid JSON body (e.g. 204 on logout/delete) — fine for 2xx.
  }
  if (!res.ok) {
    const err = body as { error?: string; message?: string } | null;
    throw new Error(err?.error ?? err?.message ?? `HTTP ${res.status}`);
  }
  return body as T;
}

export const authApi = {
  me: () => req<{ user: User }>("api/auth/me"),
  login: (username: string, password: string) =>
    req<{ user: User }>("api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => req<void>("api/auth/logout", { method: "POST" }),
  changePassword: (current: string, next: string) =>
    req<void>("api/auth/password", { method: "POST", body: JSON.stringify({ current, next }) }),
};

export type CreateUserInput = {
  username: string;
  display_name: string;
  password: string;
  role: Role;
  profile_id?: string | null;
};
export type UpdateUserInput = Partial<Pick<User, "display_name" | "role" | "active">> & { password?: string };

export const usersApi = {
  list: () => req<User[]>("api/users"),
  create: (input: CreateUserInput) => req<User>("api/users", { method: "POST", body: JSON.stringify(input) }),
  update: (id: string, patch: UpdateUserInput) =>
    req<User>(`api/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  remove: (id: string) => req<void>(`api/users/${id}`, { method: "DELETE" }),
};
