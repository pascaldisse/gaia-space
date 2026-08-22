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

export type DirectoryUser = Pick<User, "username" | "display_name" | "profile_id">;

export const authApi = {
  me: () => req<{ user: User }>("api/auth/me"),
  directory: () => req<DirectoryUser[]>("api/directory"),
  login: (username: string, password: string, totp_code?: string) =>
    req<{ user: User }>("api/auth/login", { method: "POST", body: JSON.stringify({ username, password, totp_code }) }),
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
export type PermanentToken = { id: string; name: string; created_at: number; expires_at: number | null; last_used_at: number | null };
export const permanentTokensApi = {
  list: () => req<PermanentToken[]>("api/auth/tokens"),
  create: (name: string, expires_at?: number) => req<{ token: string; record: PermanentToken }>("api/auth/tokens", { method: "POST", body: JSON.stringify({ name, expires_at }) }),
  revoke: (id: string) => req<void>(`api/auth/tokens/${id}`, { method: "DELETE" }),
};
export const twoFactorApi = {
  status: () => req<{ enabled: boolean }>("api/auth/2fa"),
  enroll: () => req<{ secret: string; otpauth_uri: string }>("api/auth/2fa/enroll", { method: "POST" }),
  confirm: (code: string) => req<void>("api/auth/2fa/confirm", { method: "POST", body: JSON.stringify({ code }) }),
  disable: (code: string) => req<void>("api/auth/2fa/disable", { method: "POST", body: JSON.stringify({ code }) }),
};
export const invitationsApi = {
  accept: (token: string, username: string, display_name: string, password: string) => req<{ user_id: string }>("api/invitations/accept", { method: "POST", body: JSON.stringify({ token, username, display_name, password }) }),
};
