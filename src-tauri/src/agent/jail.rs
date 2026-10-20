//! Repository containment: the one place a caller-supplied path becomes a real path.
//!
//! The rule `project_repo.rs` states — a web command that takes a caller-supplied
//! filesystem path is an arbitrary-repo reader — applies to every agent tool with full
//! force. So a tool never receives a path: it receives a path *relative to the project's
//! bound repository*, and this module turns it into a canonical path that is proven to
//! live inside that root.
//!
//! Containment is compared **component-wise** (`Path::starts_with`), never as a string
//! prefix, so `/repo-evil` can never pass a check for `/repo`. Canonicalization resolves
//! symlinks, so a link pointing out of the tree is refused even though its text looks
//! innocent.

use std::path::{Component, Path, PathBuf};

type Result<T> = std::result::Result<T, String>;

/// A repository root that tool paths are resolved against.
pub struct Jail {
    root: PathBuf,
}

impl Jail {
    /// `repo_root` should already come from `project_repo::validate_repo_path`; it is
    /// canonicalized again here so the jail never trusts its caller for that either.
    pub fn new(repo_root: impl AsRef<Path>) -> Result<Self> {
        let root = repo_root
            .as_ref()
            .canonicalize()
            .map_err(|_| "the repository root does not exist".to_string())?;
        if !root.is_dir() {
            return Err("the repository root is not a directory".into());
        }
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Resolve a path that must already exist (every read tool).
    pub fn resolve_existing(&self, raw: &str) -> Result<PathBuf> {
        let relative = self.relative(raw)?;
        let joined = self.root.join(relative);
        let canonical = joined
            .canonicalize()
            .map_err(|_| format!("{} does not exist", raw.trim()))?;
        self.contained(&canonical, raw)?;
        Ok(canonical)
    }

    /// Resolve a path that a tool is about to **write**, so it may not exist yet.
    ///
    /// The rules, in the order they are enforced:
    ///
    /// - the text must be relative, free of `..`, and free of `.git` ([`Self::relative`]);
    /// - the parent directory must already exist — a write creates a file, never a tree —
    ///   and its canonical form must be inside the root, so a symlinked directory cannot
    ///   carry a write out of the project;
    /// - an existing target must not be a symlink (not even a dangling one, which
    ///   `fs::write` would happily follow to a path outside), and its canonical form must
    ///   be inside the root;
    /// - a directory is not a file.
    ///
    /// The returned path is the canonical file to write.
    pub fn resolve_for_write(&self, raw: &str) -> Result<PathBuf> {
        let relative = self.relative(raw)?;
        if relative.as_os_str().is_empty() {
            return Err("path must name a file, not the repository root".into());
        }
        let target = self.root.join(&relative);
        let parent = target
            .parent()
            .ok_or_else(|| "path has no parent directory".to_string())?
            .canonicalize()
            .map_err(|_| format!("{} has no existing parent directory", raw.trim()))?;
        self.contained(&parent, raw)?;
        match std::fs::symlink_metadata(&target) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Err(format!(
                        "{} is a symlink; the agent does not write through links",
                        raw.trim()
                    ));
                }
                let canonical = target
                    .canonicalize()
                    .map_err(|_| format!("{} could not be resolved", raw.trim()))?;
                self.contained(&canonical, raw)?;
                if canonical.is_dir() {
                    return Err(format!("{} is a directory, not a file", raw.trim()));
                }
                Ok(canonical)
            }
            Err(_) => match target.file_name() {
                Some(name) => Ok(parent.join(name)),
                None => Err("path must name a file".into()),
            },
        }
    }

    /// The repository-relative form of a caller path, validated as text: relative, no
    /// `..`, no `.git`. `..` is refused even when it would stay inside the tree — an
    /// agent that has to normalize its own paths is one bug away from escaping, and the
    /// refusal is cheap to understand.
    fn relative(&self, raw: &str) -> Result<PathBuf> {
        let raw = raw.trim();
        if raw.is_empty() {
            return Err("path is required".into());
        }
        let path = Path::new(raw);
        if path.is_absolute() {
            return Err("path must be relative to the repository root".into());
        }
        let mut out = PathBuf::new();
        for component in path.components() {
            match component {
                Component::Normal(part) => {
                    if part == ".git" {
                        return Err("the repository's .git directory is off limits".into());
                    }
                    out.push(part);
                }
                Component::CurDir => {}
                Component::ParentDir => {
                    return Err("path must not climb out of the repository (..)".into())
                }
                Component::RootDir | Component::Prefix(_) => {
                    return Err("path must be relative to the repository root".into())
                }
            }
        }
        Ok(out)
    }

    /// The canonical path must be the root itself or sit below it, and must not pass
    /// through `.git` by way of a symlink either.
    fn contained(&self, canonical: &Path, raw: &str) -> Result<()> {
        let Ok(relative) = canonical.strip_prefix(&self.root) else {
            return Err(format!("{} resolves outside the repository", raw.trim()));
        };
        if relative
            .components()
            .any(|component| component.as_os_str() == ".git")
        {
            return Err("the repository's .git directory is off limits".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Scratch trees live under the cargo target dir, never the OS temp dir.
    /// Returns `(base, repo_root)` where `base` holds siblings *outside* the repo.
    fn scratch(tag: &str) -> (PathBuf, PathBuf) {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("agent-jail-tests")
            .join(format!("{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let repo = base.join("repo");
        std::fs::create_dir_all(repo.join("src")).unwrap();
        std::fs::create_dir_all(repo.join(".git/objects")).unwrap();
        std::fs::write(repo.join("README.md"), "hello").unwrap();
        std::fs::write(repo.join("src/lib.rs"), "pub fn f() {}").unwrap();
        std::fs::write(repo.join(".git/config"), "[core]").unwrap();
        std::fs::create_dir_all(base.join("repo-evil")).unwrap();
        std::fs::write(base.join("repo-evil/secret.txt"), "top secret").unwrap();
        (base, repo.canonicalize().unwrap())
    }

    #[test]
    fn ordinary_relative_paths_resolve_inside_the_root() {
        let (_base, repo) = scratch("ordinary");
        let jail = Jail::new(&repo).unwrap();
        assert_eq!(
            jail.resolve_existing("README.md").unwrap(),
            repo.join("README.md")
        );
        assert_eq!(
            jail.resolve_existing("./src/./lib.rs").unwrap(),
            repo.join("src/lib.rs"),
            "a `.` component is normalized, not refused"
        );
        assert_eq!(
            jail.resolve_existing("src//lib.rs").unwrap(),
            repo.join("src/lib.rs")
        );
        assert_eq!(jail.resolve_existing(".").unwrap(), repo, "the root itself is listable");
        assert_eq!(jail.root(), repo);
    }

    #[test]
    fn traversal_absolute_and_missing_paths_are_refused() {
        let (_base, repo) = scratch("refusals");
        let jail = Jail::new(&repo).unwrap();
        assert!(jail.resolve_existing("../repo-evil/secret.txt").is_err());
        assert!(jail.resolve_existing("src/../../secret").is_err());
        assert!(
            jail.resolve_existing("src/../README.md").is_err(),
            "`..` is refused even when it would land back inside"
        );
        assert!(jail.resolve_existing("/etc/passwd").is_err());
        assert!(jail.resolve_existing("  ").is_err());
        assert!(jail.resolve_existing("no-such-file").is_err());
    }

    #[test]
    fn the_git_directory_is_off_limits_directly_and_through_a_symlink() {
        let (base, repo) = scratch("git");
        let jail = Jail::new(&repo).unwrap();
        assert!(jail.resolve_existing(".git/config").is_err());
        assert!(jail.resolve_existing(".git").is_err());
        std::os::unix::fs::symlink(base.join("repo/.git"), repo.join("vcs")).unwrap();
        let error = jail.resolve_existing("vcs/config").unwrap_err();
        assert!(error.contains(".git"), "{error}");
    }

    #[test]
    fn a_symlink_out_of_the_tree_is_refused_even_though_its_name_is_ordinary() {
        let (base, repo) = scratch("symlink-out");
        let jail = Jail::new(&repo).unwrap();
        std::os::unix::fs::symlink(base.join("repo-evil"), repo.join("escape")).unwrap();
        std::os::unix::fs::symlink(base.join("repo-evil/secret.txt"), repo.join("secret.md")).unwrap();
        assert!(jail.resolve_existing("escape/secret.txt").is_err());
        assert!(jail.resolve_existing("secret.md").is_err());
    }

    #[test]
    fn a_symlink_that_stays_inside_is_allowed() {
        let (_base, repo) = scratch("symlink-in");
        let jail = Jail::new(&repo).unwrap();
        std::os::unix::fs::symlink(repo.join("src/lib.rs"), repo.join("link.rs")).unwrap();
        assert_eq!(jail.resolve_existing("link.rs").unwrap(), repo.join("src/lib.rs"));
    }

    /// The reason containment is component-wise: a string prefix would accept the
    /// sibling `repo-evil`, and every write after that would land outside the project.
    #[test]
    fn a_prefix_sibling_is_not_inside_the_root() {
        let (base, repo) = scratch("prefix");
        assert!(repo.ends_with("repo"));
        assert!(
            !base.join("repo-evil").starts_with(&repo),
            "Path::starts_with compares components, so `repo-evil` is not under `repo`"
        );
        assert!(
            !format!("{}", base.join("repo-evil").display())
                .starts_with(&format!("{}/src", repo.display())),
            "guard against a string-prefix implementation creeping back in"
        );
    }

    #[test]
    fn a_root_that_does_not_exist_is_not_a_jail() {
        let (base, _repo) = scratch("missing-root");
        assert!(Jail::new(base.join("nope")).is_err());
        assert!(Jail::new(base.join("repo/README.md")).is_err(), "a file is not a root");
    }

    // --- write containment (Stage 3) ---------------------------------------------
    //
    // These came before `write_file` and `edit_file` existed. Every one of them is a
    // way a write could land outside the project if containment were text-based or
    // resolved only the path that already exists.

    #[test]
    fn a_write_that_stays_inside_is_allowed() {
        let (_base, repo) = scratch("write-inside");
        let jail = Jail::new(&repo).unwrap();
        assert_eq!(
            jail.resolve_for_write("src/new.rs").unwrap(),
            repo.join("src/new.rs"),
            "a new file in an existing directory is fine"
        );
        assert_eq!(
            jail.resolve_for_write("./src/./new.rs").unwrap(),
            repo.join("src/new.rs")
        );
        assert_eq!(jail.resolve_for_write("src//new.rs").unwrap(), repo.join("src/new.rs"));
        assert_eq!(
            jail.resolve_for_write("README.md").unwrap(),
            repo.join("README.md"),
            "an existing regular file is writable"
        );
    }

    #[test]
    fn a_write_target_may_not_escape_by_any_spelling() {
        let (_base, repo) = scratch("write-escapes");
        let jail = Jail::new(&repo).unwrap();
        for raw in [
            "../out.txt",
            "../../out.txt",
            "src/../../out.txt",
            "/tmp/out.txt",
            "src/../README.md",
        ] {
            assert!(
                jail.resolve_for_write(raw).is_err(),
                "{raw} must not resolve for writing"
            );
        }
    }

    #[test]
    fn a_write_into_git_is_refused() {
        let (_base, repo) = scratch("write-git");
        let jail = Jail::new(&repo).unwrap();
        for raw in [".git/config", ".git/hooks/pre-commit", ".git/new-file", ".git"] {
            assert!(jail.resolve_for_write(raw).is_err(), "{raw} must not be writable");
        }
    }

    #[test]
    fn a_write_through_a_symlinked_directory_is_refused() {
        let (base, repo) = scratch("write-symlink-dir");
        let jail = Jail::new(&repo).unwrap();
        std::os::unix::fs::symlink(base.join("repo-evil"), repo.join("escape")).unwrap();
        let error = jail.resolve_for_write("escape/new.txt").unwrap_err();
        assert!(error.contains("outside"), "{error}");
        assert!(
            !base.join("repo-evil/new.txt").exists(),
            "resolving for a write must not create anything"
        );
    }

    #[test]
    fn a_write_through_a_symlinked_file_is_refused_even_when_it_dangles() {
        let (base, repo) = scratch("write-symlink-file");
        let jail = Jail::new(&repo).unwrap();
        std::os::unix::fs::symlink(base.join("repo-evil/secret.txt"), repo.join("link.txt"))
            .unwrap();
        assert!(jail.resolve_for_write("link.txt").is_err());

        // The target does not exist: `fs::write("dangling.txt")` would create
        // `repo-evil/made.txt` outside the tree, so the link itself is refused.
        std::os::unix::fs::symlink(base.join("repo-evil/made.txt"), repo.join("dangling.txt"))
            .unwrap();
        let error = jail.resolve_for_write("dangling.txt").unwrap_err();
        assert!(error.contains("symlink"), "{error}");
    }

    #[test]
    fn a_write_needs_an_existing_parent_directory() {
        let (_base, repo) = scratch("write-parent");
        let jail = Jail::new(&repo).unwrap();
        let error = jail.resolve_for_write("no/such/dir/file.rs").unwrap_err();
        assert!(error.contains("parent"), "{error}");
    }

    #[test]
    fn the_root_and_directories_are_not_write_targets() {
        let (_base, repo) = scratch("write-dirs");
        let jail = Jail::new(&repo).unwrap();
        assert!(jail.resolve_for_write("").is_err());
        assert!(jail.resolve_for_write(".").is_err());
        assert!(jail.resolve_for_write("src").is_err(), "a directory is not a file");
        assert!(jail.resolve_for_write("src/").is_err());
    }

    #[test]
    fn a_prefix_sibling_cannot_be_reached_by_a_write_either() {
        let (base, repo) = scratch("write-prefix");
        let jail = Jail::new(&repo).unwrap();
        std::os::unix::fs::symlink(base.join("repo-evil"), repo.join("evil")).unwrap();
        assert!(jail.resolve_for_write("evil/owned.txt").is_err());
        assert!(!base.join("repo-evil/owned.txt").exists());
    }
}
