import { createEffect, createRoot, createSignal } from "solid-js";
import { platformApi, type Profile, type Project } from "./api/platform";
import { authApi, type User } from "./api/auth";

/** True when running in a plain browser (web build), false inside the Tauri app. */
export const isWeb = (): boolean =>
  typeof window !== "undefined" && window.__TAURI_INTERNALS__ === undefined;

/** App-wide identity/context: who am I acting as, which project am I in. */
const session = createRoot(() => {
  const [profileId, setId] = createSignal(localStorage.getItem("space.profile") ?? "");
  const [projectId, setPid] = createSignal(localStorage.getItem("space.project") ?? "");

  const setProfileId = (value: string) => {
    setId(value);
    localStorage.setItem("space.profile", value);
  };
  const setProjectId = (value: string) => {
    setPid(value);
    localStorage.setItem("space.project", value);
  };

  // Lazy by design: web mode must authenticate before these API calls. Pickers
  // already reload on mount, so eager resources only poison the accessors with
  // an initial 401 and prevent Solid from mounting the post-login shell.
  const [profiles, setProfiles] = createSignal<Profile[]>();
  const [projects, setProjects] = createSignal<Project[]>();
  const reloadProfiles = async () => {
    const value = await platformApi.profiles();
    setProfiles(value);
    return value;
  };
  const reloadProjects = async () => {
    const value = await platformApi.projects();
    setProjects(value);
    return value;
  };

  // Create a project via the existing platform API, refresh the cache, and make
  // it the active project so the caller can open it immediately.
  const createProject = async (input: { name: string; key: string; description?: string; deadline?: string }) => {
    const id = (crypto.randomUUID?.() ?? `proj-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const project: Project = {
      id, name: input.name.trim(), key: input.key.trim(),
      description: input.description?.trim() || null, created_by: null, archived: false,
      deadline: input.deadline?.trim() || null,
    };
    await platformApi.createProject(project);
    await reloadProjects();
    setProjectId(id);
    return project;
  };

  // Default to the first available entry so nothing starts in an unusable state.
  const ensureDefaults = () => {
    const p = profiles()?.filter((x) => !x.archived);
    if (p?.length && !p.some((x) => x.id === profileId())) setProfileId(p[0].id);
    const pr = projects()?.filter((x) => !x.archived);
    if (pr?.length && !pr.some((x) => x.id === projectId())) setProjectId(pr[0].id);
  };

  return {
    profileId, setProfileId, profiles, reloadProfiles,
    projectId, setProjectId, projects, reloadProjects, createProject,
    ensureDefaults,
  };
});

export const {
  profileId, setProfileId, profiles, reloadProfiles,
  projectId, setProjectId, projects, reloadProjects, createProject,
  ensureDefaults,
} = session;

/** Web-mode auth session: who is logged in, and gating for the login screen. */
const auth = createRoot(() => {
  const [currentUser, setCurrentUser] = createSignal<User | null>(null);
  const [authChecked, setAuthChecked] = createSignal(!isWeb()); // Tauri: nothing to check.

  const checkAuth = async () => {
    if (!isWeb()) { setAuthChecked(true); return; }
    try {
      const { user } = await authApi.me();
      setCurrentUser(user);
    } catch {
      setCurrentUser(null);
    } finally {
      setAuthChecked(true);
    }
  };

  const login = async (username: string, password: string) => {
    const { user } = await authApi.login(username, password);
    setCurrentUser(user);
    return user;
  };

  const logout = async () => {
    try { await authApi.logout(); } finally { setCurrentUser(null); }
  };

  const changePassword = async (current: string, next: string) => {
    await authApi.changePassword(current, next);
    // The server invalidates every session after a password change.
    setCurrentUser(null);
  };

  // Acting-as profile is forced to the logged-in user's profile on login
  // (and on every boot while logged in); ProfilePicker locks it for members.
  createEffect(() => {
    const user = currentUser();
    if (user) setProfileId(user.profile_id);
  });

  return { currentUser, authChecked, checkAuth, login, logout, changePassword };
});

export const { currentUser, authChecked, checkAuth, login, logout, changePassword } = auth;

/** Locked = acting-as profile can't be changed by the user (web member). */
export const profileLocked = (): boolean => isWeb() && currentUser()?.role === "member";

/** Turn raw backend/SQLite failures into something a human can act on. */
export function humanError(reason: unknown): string {
  const text = String((reason as { message?: string })?.message ?? reason);
  if (/FOREIGN KEY constraint failed/i.test(text))
    return "That record points at a profile/project/entity that does not exist. Pick an existing one from the dropdown (or create it in Members / Projects first).";
  if (/UNIQUE constraint failed/i.test(text))
    return "A record with that identifier already exists.";
  if (/NOT NULL constraint failed: ([^\s]+)/i.test(text))
    return `Missing required field: ${text.match(/NOT NULL constraint failed: ([^\s]+)/i)![1]}`;
  if (/no such table: (\w+)/i.test(text))
    return `The local database is missing the "${text.match(/no such table: (\w+)/i)![1]}" table — its schema is out of date. Restart the app to run migrations; if it persists, the database needs repair.`;
  return text.replace(/^Error:\s*/, "");
}
