import { createResource, createRoot, createSignal } from "solid-js";
import { platformApi, type Profile, type Project } from "./api/platform";

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

  const [profiles, { refetch: reloadProfiles }] = createResource<Profile[]>(() =>
    platformApi.profiles(),
  );
  const [projects, { refetch: reloadProjects }] = createResource<Project[]>(() =>
    platformApi.projects(),
  );

  // Default to the first available entry so nothing starts in an unusable state.
  const ensureDefaults = () => {
    const p = profiles()?.filter((x) => !x.archived);
    if (p?.length && !p.some((x) => x.id === profileId())) setProfileId(p[0].id);
    const pr = projects()?.filter((x) => !x.archived);
    if (pr?.length && !pr.some((x) => x.id === projectId())) setProjectId(pr[0].id);
  };

  return {
    profileId, setProfileId, profiles, reloadProfiles,
    projectId, setProjectId, projects, reloadProjects,
    ensureDefaults,
  };
});

export const {
  profileId, setProfileId, profiles, reloadProfiles,
  projectId, setProjectId, projects, reloadProjects,
  ensureDefaults,
} = session;

/** Turn raw backend/SQLite failures into something a human can act on. */
export function humanError(reason: unknown): string {
  const text = String((reason as { message?: string })?.message ?? reason);
  if (/FOREIGN KEY constraint failed/i.test(text))
    return "That record points at a profile/project/entity that does not exist. Pick an existing one from the dropdown (or create it in Members / Projects first).";
  if (/UNIQUE constraint failed/i.test(text))
    return "A record with that identifier already exists.";
  if (/NOT NULL constraint failed: ([^\s]+)/i.test(text))
    return `Missing required field: ${text.match(/NOT NULL constraint failed: ([^\s]+)/i)![1]}`;
  return text.replace(/^Error:\s*/, "");
}
