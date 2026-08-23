//! Per-format registry protocol coordinates (KB §03 §2.2).
//!
//! Maven and npm already own their wire protocols in `pipelines.rs`; this module adds the
//! remaining formats Space supports as *real* registries: NuGet (V3 flat-container),
//! PyPI (PEP 503 simple index), Composer (packagist `p2` metadata) and OCI/container
//! (distribution-spec v2 name/reference addressing).
//!
//! Each format contributes three things and nothing more:
//!   1. a **normalized key** — the identity a client resolves by, per that ecosystem's rule
//!      (PEP 503 for PyPI, lower-case id for NuGet/Composer/OCI). Storage keeps the
//!      publisher's spelling; lookups go through the normalized key.
//!   2. **path → coordinates** — parsing the format's URL layout into
//!      `(package_name, version, filename)` the shared package store already speaks.
//!   3. a **listing/resolve document** built from the versions actually stored — never
//!      fetched or guessed from an upstream registry.
use crate::db;
use rusqlite::params;
use serde_json::{json, Value};

type Result<T> = std::result::Result<T, String>;

/// Formats with a protocol implementation in this module.
pub const PROTOCOL_FORMATS: [&str; 4] = ["nuget", "pypi", "composer", "container"];

/// The identity a client resolves by. Unknown formats are returned unchanged: a format
/// without a documented normalization rule must not have one invented for it.
pub fn normalized_key(format: &str, package_name: &str) -> String {
    match format {
        "pypi" => pypi_normalized_name(package_name),
        // NuGet ids are case-insensitive on the wire (V3 paths are lower-cased);
        // Composer `vendor/package` and OCI repository names are lower-case by spec.
        "nuget" | "composer" | "container" => package_name.to_ascii_lowercase(),
        _ => package_name.to_string(),
    }
}

/// PEP 503: runs of `-`, `_` and `.` collapse to a single `-`, then lower-case.
pub fn pypi_normalized_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut in_separator = false;
    for ch in name.chars() {
        if matches!(ch, '-' | '_' | '.') {
            in_separator = true;
            continue;
        }
        if in_separator && !out.is_empty() {
            out.push('-');
        }
        in_separator = false;
        out.push(ch.to_ascii_lowercase());
    }
    out
}

/// Rejects path expressions before any segment becomes a lookup key.
fn segments(path: &str) -> Result<Vec<&str>> {
    let parts: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if parts.iter().any(|s| *s == "." || *s == "..") {
        return Err("registry path must not contain traversal segments".into());
    }
    if parts.is_empty() {
        return Err("registry path is empty".into());
    }
    Ok(parts)
}

/// NuGet V3 flat container: `{lower-id}/{lower-version}/{file}`, plus the
/// artifact-level `{lower-id}/index.json` version listing.
/// Returns `(package_name, version, filename)`; `version` is `None` for the index.
pub fn nuget_coordinates(path: &str) -> Result<(String, Option<String>, String)> {
    let parts = segments(path)?;
    match parts.as_slice() {
        [id, "index.json"] => Ok((
            normalized_key("nuget", id),
            None,
            "index.json".to_string(),
        )),
        [id, version, file] => Ok((
            normalized_key("nuget", id),
            Some(version.to_ascii_lowercase()),
            (*file).to_string(),
        )),
        _ => Err("nuget path must be {id}/index.json or {id}/{version}/{file}".into()),
    }
}

/// The `.nupkg` filename NuGet clients fetch for a resolved version.
pub fn nuget_nupkg_filename(package_name: &str, version: &str) -> String {
    format!(
        "{}.{}.nupkg",
        normalized_key("nuget", package_name),
        version.to_ascii_lowercase()
    )
}

/// PyPI simple index: `{name}/` (project page) or `{name}/{file}` (distribution).
pub fn pypi_coordinates(path: &str) -> Result<(String, Option<String>)> {
    let parts = segments(path)?;
    match parts.as_slice() {
        [name] => Ok((pypi_normalized_name(name), None)),
        [name, file] => Ok((pypi_normalized_name(name), Some((*file).to_string()))),
        _ => Err("pypi path must be {name}/ or {name}/{filename}".into()),
    }
}

/// Composer metadata: `p2/{vendor}/{package}.json` (packagist v2 layout) or `packages.json`
/// (the root service document). Returns `Some(package_name)` for the former.
pub fn composer_coordinates(path: &str) -> Result<Option<String>> {
    let parts = segments(path)?;
    match parts.as_slice() {
        ["packages.json"] => Ok(None),
        ["p2", vendor, package] => {
            let name = package
                .strip_suffix(".json")
                .ok_or_else(|| "composer p2 path must end in .json".to_string())?;
            Ok(Some(normalized_key("composer", &format!("{vendor}/{name}"))))
        }
        _ => Err("composer path must be packages.json or p2/{vendor}/{package}.json".into()),
    }
}

/// What an OCI distribution request addresses.
#[derive(Debug, PartialEq, Eq)]
pub enum OciTarget {
    /// `/v2/{name}/manifests/{reference}` — reference is a tag or a digest.
    Manifest { reference: String },
    /// `/v2/{name}/blobs/{digest}`.
    Blob { digest: String },
    /// `/v2/{name}/blobs/uploads/` — session start (POST), possibly monolithic with `?digest=`.
    BlobUploadStart,
    /// `/v2/{name}/blobs/uploads/{session}` — the PUT that closes a session.
    BlobUpload { session: String },
    /// `/v2/{name}/tags/list`.
    TagList,
    /// `/v2/{name}/referrers/{digest}` — OCI artifact attachments (subject).
    Referrers { digest: String },
}

/// OCI distribution-spec v2 path → `(repository name, target)`. The name is multi-segment
/// (`library/nginx`), so the split is driven by the trailing verb, not by segment count.
pub fn oci_coordinates(path: &str) -> Result<(String, OciTarget)> {
    let parts = segments(path)?;
    let verb_at = parts
        .iter()
        .rposition(|s| matches!(*s, "manifests" | "blobs" | "tags" | "referrers"))
        .ok_or_else(|| "oci path must contain manifests/blobs/tags/referrers".to_string())?;
    if verb_at == 0 {
        return Err("oci path requires a repository name".into());
    }
    let name = normalized_key("container", &parts[..verb_at].join("/"));
    let rest = &parts[verb_at..];
    let target = match rest {
        ["manifests", reference] => OciTarget::Manifest {
            reference: (*reference).to_string(),
        },
        ["blobs", "uploads"] => OciTarget::BlobUploadStart,
        ["blobs", "uploads", session] => OciTarget::BlobUpload {
            session: (*session).to_string(),
        },
        ["blobs", digest] => OciTarget::Blob {
            digest: (*digest).to_string(),
        },
        ["tags", "list"] => OciTarget::TagList,
        ["referrers", digest] => OciTarget::Referrers {
            digest: (*digest).to_string(),
        },
        _ => return Err("unsupported oci path".into()),
    };
    Ok((name, target))
}

// ---------- listing / resolve documents, built from stored versions ----------

/// One stored package version row, as the protocol documents below read it.
#[derive(Debug, Clone)]
pub struct StoredVersion {
    pub package_name: String,
    pub version: String,
    pub metadata_json: Option<String>,
    pub created_at: i64,
}

/// Stored versions of one package, newest first, matched by normalized key so a client that
/// asks with a different spelling still resolves.
pub fn stored_versions(
    format: &str,
    repository_id: &str,
    package_name: &str,
) -> Result<Vec<StoredVersion>> {
    let key = normalized_key(format, package_name);
    let c = db::conn()?;
    let mut statement = c
        .prepare("SELECT package_name,version,metadata_json,created_at FROM package_versions WHERE repository_id=?1 ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(params![repository_id], |r| {
            Ok(StoredVersion {
                package_name: r.get(0)?,
                version: r.get(1)?,
                metadata_json: r.get(2)?,
                created_at: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .filter(|row| normalized_key(format, &row.package_name) == key)
        .collect())
}

/// Distinct package names in a repository, newest publish first.
pub fn stored_packages(repository_id: &str) -> Result<Vec<String>> {
    let c = db::conn()?;
    let mut statement = c
        .prepare("SELECT package_name FROM package_versions WHERE repository_id=?1 GROUP BY package_name ORDER BY MAX(created_at) DESC")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(params![repository_id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// NuGet V3 service index — the entry document `nuget.exe`/`dotnet` fetch first.
/// `registry_base` is this repository's NuGet root as the client reached it.
pub fn nuget_service_index(registry_base: &str) -> Value {
    let base = registry_base.trim_end_matches('/');
    json!({
        "version": "3.0.0",
        "resources": [
            {"@id": format!("{base}/"), "@type": "PackageBaseAddress/3.0.0"},
            {"@id": format!("{base}/"), "@type": "PackagePublish/2.0.0"},
        ]
    })
}

/// NuGet flat-container version list (`{id}/index.json`). Lower-cased, oldest first —
/// the order clients expect for range resolution.
pub fn nuget_version_index(repository_id: &str, package_name: &str) -> Result<Value> {
    let mut versions: Vec<String> = stored_versions("nuget", repository_id, package_name)?
        .into_iter()
        .map(|row| row.version.to_ascii_lowercase())
        .collect();
    if versions.is_empty() {
        return Err("nuget package not found".into());
    }
    versions.reverse();
    Ok(json!({ "versions": versions }))
}

/// PEP 503 project page. Links are relative to the project page itself, which is what the
/// simple API requires and keeps this independent of the caller-visible host.
pub fn pypi_simple_project(repository_id: &str, package_name: &str) -> Result<String> {
    let rows = stored_versions("pypi", repository_id, package_name)?;
    if rows.is_empty() {
        return Err("pypi project not found".into());
    }
    let name = pypi_normalized_name(package_name);
    let mut links = String::new();
    for row in &rows {
        for file in pypi_files(row.metadata_json.as_deref(), &row.package_name, &row.version) {
            links.push_str(&format!("    <a href=\"{file}\">{file}</a><br/>\n"));
        }
    }
    Ok(format!(
        "<!DOCTYPE html>\n<html>\n  <head><title>Links for {name}</title></head>\n  <body>\n    <h1>Links for {name}</h1>\n{links}  </body>\n</html>\n"
    ))
}

/// Distribution filenames for one version: the publisher's `files` projection when present,
/// otherwise the sdist name PEP 625 prescribes. Never a guessed wheel tag.
fn pypi_files(metadata: Option<&str>, package_name: &str, version: &str) -> Vec<String> {
    let declared = metadata
        .and_then(|m| serde_json::from_str::<Value>(m).ok())
        .and_then(|value| {
            value
                .get("formatMetadata")
                .or(Some(&value))
                .and_then(|v| v.get("files"))
                .and_then(Value::as_array)
                .cloned()
        })
        .unwrap_or_default();
    let names: Vec<String> = declared
        .iter()
        .filter_map(|file| {
            file.as_str()
                .map(str::to_owned)
                .or_else(|| file.get("name").and_then(Value::as_str).map(str::to_owned))
        })
        .collect();
    if names.is_empty() {
        vec![format!(
            "{}-{version}.tar.gz",
            pypi_normalized_name(package_name).replace('-', "_")
        )]
    } else {
        names
    }
}

/// Composer root service document: points clients at the `p2` metadata layout.
pub fn composer_packages_json(registry_base: &str) -> Value {
    let base = registry_base.trim_end_matches('/');
    json!({
        "metadata-url": format!("{base}/p2/%package%.json"),
        "providers-api": format!("{base}/p2/%package%.json"),
        "available-packages": Value::Array(vec![]),
    })
}

/// Composer `p2/{vendor}/{package}.json`: one entry per stored version, carrying the
/// publisher's composer.json projection plus the coordinates Composer resolves by.
pub fn composer_package_metadata(repository_id: &str, package_name: &str) -> Result<Value> {
    let rows = stored_versions("composer", repository_id, package_name)?;
    if rows.is_empty() {
        return Err("composer package not found".into());
    }
    let name = normalized_key("composer", package_name);
    let entries: Vec<Value> = rows
        .iter()
        .map(|row| {
            let mut entry = row
                .metadata_json
                .as_deref()
                .and_then(|m| serde_json::from_str::<Value>(m).ok())
                .and_then(|v| v.get("formatMetadata").cloned().or(Some(v)))
                .unwrap_or_else(|| json!({}));
            if !entry.is_object() {
                entry = json!({});
            }
            let object = entry.as_object_mut().expect("entry is an object");
            object.insert("name".into(), json!(name));
            object.insert("version".into(), json!(row.version));
            object.insert("time".into(), json!(row.created_at));
            entry
        })
        .collect();
    Ok(json!({ "packages": { name: entries } }))
}

/// OCI tag list (`/v2/{name}/tags/list`). Tags are the stored version strings — this registry
/// addresses manifests by tag; digest addressing needs a content store it does not yet have.
pub fn oci_tag_list(repository_id: &str, package_name: &str) -> Result<Value> {
    let mut tags: Vec<String> = stored_versions("container", repository_id, package_name)?
        .into_iter()
        .map(|row| row.version)
        .collect();
    if tags.is_empty() {
        return Err("container repository not found".into());
    }
    tags.reverse();
    Ok(json!({ "name": normalized_key("container", package_name), "tags": tags }))
}

/// OCI referrers list (`/v2/{name}/referrers/{digest}`): stored versions whose
/// `subjectReferrers`/`subject` projection points at this digest. An empty list is a valid
/// answer per spec, so an unknown digest is not an error.
pub fn oci_referrers(repository_id: &str, package_name: &str, digest: &str) -> Result<Value> {
    let rows = stored_versions("container", repository_id, package_name)?;
    let manifests: Vec<Value> = rows
        .iter()
        .filter_map(|row| {
            let value: Value = serde_json::from_str(row.metadata_json.as_deref()?).ok()?;
            let projection = value.get("formatMetadata").unwrap_or(&value);
            let subject = projection.get("subject").and_then(Value::as_str);
            let referenced = subject == Some(digest)
                || projection
                    .get("subjectReferrers")
                    .and_then(Value::as_array)
                    .is_some_and(|list| list.iter().any(|r| r.as_str() == Some(digest)));
            referenced.then(|| json!({"reference": row.version, "digest": digest}))
        })
        .collect();
    Ok(json!({
        "schemaVersion": 2,
        "mediaType": "application/vnd.oci.image.index.v1+json",
        "manifests": manifests,
    }))
}

// ---------- OCI content-addressed blob store ----------
//
// Blobs are addressed by their own content digest, so the store is a pure function of the
// bytes: `{package base dir}/_blobs/{repository}/{algo}/{aa}/{hex}`. Nothing is written under
// a client-supplied name, and a digest that does not match the bytes is refused rather than
// stored under a lie.
use std::fs;
use std::path::{Path, PathBuf};
/// The one digest algorithm this store accepts. Adding another means adding a real
/// implementation for it — an unknown algorithm is rejected, never silently treated as sha256.
pub const BLOB_DIGEST_ALGORITHM: &str = "sha256";
/// `sha256:{64 lower-case hex}` → `(algorithm, hex)`.
pub fn parse_digest(digest: &str) -> Result<(String, String)> {
    let (algorithm, hex) = digest
        .split_once(':')
        .ok_or_else(|| "digest must be {algorithm}:{hex}".to_string())?;
    if algorithm != BLOB_DIGEST_ALGORITHM {
        return Err(format!("unsupported digest algorithm '{algorithm}'"));
    }
    if hex.len() != 64 || !hex.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) {
        return Err("sha256 digest must be 64 lower-case hex characters".into());
    }
    Ok((algorithm.to_string(), hex.to_string()))
}
/// The digest of these bytes, in the wire form clients send back.
pub fn compute_digest(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{BLOB_DIGEST_ALGORITHM}:{}", hex::encode(Sha256::digest(bytes)))
}
fn safe_repository(repository_id: &str) -> Result<()> {
    if repository_id.is_empty()
        || !repository_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        || repository_id.starts_with('.')
    {
        return Err("invalid repository id for blob storage".into());
    }
    Ok(())
}
/// Where a digest lives. Path components come from the *validated* digest, never from a path
/// the client wrote, so traversal has no surface here.
pub fn blob_path(base_dir: &Path, repository_id: &str, digest: &str) -> Result<PathBuf> {
    safe_repository(repository_id)?;
    let (algorithm, hex) = parse_digest(digest)?;
    Ok(base_dir
        .join("_blobs")
        .join(repository_id)
        .join(algorithm)
        .join(&hex[..2])
        .join(hex))
}
/// Writes bytes under their own digest. `expected` (the client's `?digest=`) must match the
/// bytes actually received; a mismatch is the spec's `DIGEST_INVALID`, not a stored blob.
/// Re-uploading an identical blob is a no-op — content addressing makes it idempotent.
pub fn store_blob(
    base_dir: &Path,
    repository_id: &str,
    bytes: &[u8],
    expected: Option<&str>,
) -> Result<String> {
    let digest = compute_digest(bytes);
    if let Some(expected) = expected {
        let (_, expected_hex) = parse_digest(expected)?;
        if !digest.ends_with(&expected_hex) {
            return Err(format!("digest mismatch: bytes hash to {digest}"));
        }
    }
    let path = blob_path(base_dir, repository_id, &digest)?;
    if path.exists() {
        return Ok(digest);
    }
    let parent = path
        .parent()
        .ok_or_else(|| "blob path has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("cannot create blob directory: {e}"))?;
    // Write-then-rename: a reader never sees a half-written blob under a digest that promises
    // the whole content.
    let staging = parent.join(format!(".{}.partial", &digest[digest.len() - 32..]));
    fs::write(&staging, bytes).map_err(|e| format!("cannot write blob: {e}"))?;
    fs::rename(&staging, &path).map_err(|e| format!("cannot commit blob: {e}"))?;
    Ok(digest)
}
/// Reads a blob and re-verifies it against the digest it was asked for. The check is done on
/// the bytes read from disk, not on the path that produced them — a corrupted or swapped file
/// fails here instead of being served as if it were the requested content.
pub fn read_blob(base_dir: &Path, repository_id: &str, digest: &str) -> Result<Vec<u8>> {
    let path = blob_path(base_dir, repository_id, digest)?;
    let bytes = fs::read(&path).map_err(|_| "blob not found".to_string())?;
    if compute_digest(&bytes) != digest {
        return Err("stored blob does not match its digest".into());
    }
    Ok(bytes)
}
/// Whether a digest is present (the `HEAD` / mount-check answer), without reading it.
pub fn blob_exists(base_dir: &Path, repository_id: &str, digest: &str) -> bool {
    blob_path(base_dir, repository_id, digest).is_ok_and(|path| path.is_file())
}
/// Size in bytes of a stored blob — what a `HEAD` response reports as `Content-Length`.
pub fn blob_size(base_dir: &Path, repository_id: &str, digest: &str) -> Result<u64> {
    let path = blob_path(base_dir, repository_id, digest)?;
    fs::metadata(&path)
        .map(|meta| meta.len())
        .map_err(|_| "blob not found".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pep503_normalization_collapses_separator_runs() {
        assert_eq!(pypi_normalized_name("Zope.Interface"), "zope-interface");
        assert_eq!(pypi_normalized_name("my__pkg--name"), "my-pkg-name");
        assert_eq!(pypi_normalized_name("simple"), "simple");
    }

    #[test]
    fn nuget_paths_map_to_lowercase_coordinates() {
        assert_eq!(
            nuget_coordinates("Newtonsoft.Json/13.0.1/Newtonsoft.Json.13.0.1.nupkg").unwrap(),
            (
                "newtonsoft.json".into(),
                Some("13.0.1".into()),
                "Newtonsoft.Json.13.0.1.nupkg".into()
            )
        );
        assert_eq!(
            nuget_coordinates("Newtonsoft.Json/index.json").unwrap(),
            ("newtonsoft.json".into(), None, "index.json".into())
        );
        assert!(nuget_coordinates("only-id").is_err());
        assert!(nuget_coordinates("../etc/1.0/x.nupkg").is_err());
        assert_eq!(
            nuget_nupkg_filename("Newtonsoft.Json", "13.0.1"),
            "newtonsoft.json.13.0.1.nupkg"
        );
    }

    #[test]
    fn pypi_and_composer_paths_parse() {
        assert_eq!(
            pypi_coordinates("Flask_Login/").unwrap(),
            ("flask-login".into(), None)
        );
        assert_eq!(
            pypi_coordinates("flask/flask-2.0.tar.gz").unwrap(),
            ("flask".into(), Some("flask-2.0.tar.gz".into()))
        );
        assert_eq!(composer_coordinates("packages.json").unwrap(), None);
        assert_eq!(
            composer_coordinates("p2/Monolog/Monolog.json").unwrap(),
            Some("monolog/monolog".into())
        );
        assert!(composer_coordinates("p2/monolog/monolog.xml").is_err());
    }

    #[test]
    fn oci_paths_split_on_the_verb_not_the_segment_count() {
        assert_eq!(
            oci_coordinates("Library/Nginx/manifests/1.25").unwrap(),
            (
                "library/nginx".into(),
                OciTarget::Manifest {
                    reference: "1.25".into()
                }
            )
        );
        assert_eq!(
            oci_coordinates("nginx/tags/list").unwrap(),
            ("nginx".into(), OciTarget::TagList)
        );
        assert_eq!(
            oci_coordinates("nginx/referrers/sha256:ab").unwrap(),
            (
                "nginx".into(),
                OciTarget::Referrers {
                    digest: "sha256:ab".into()
                }
            )
        );
        assert!(oci_coordinates("manifests/1.0").is_err());
        assert!(oci_coordinates("nginx/unknown/1.0").is_err());
    }

    #[test]
    fn service_documents_use_the_caller_visible_base() {
        let index = nuget_service_index("https://space.example/api/registry/repo/nuget/");
        assert_eq!(index["version"], "3.0.0");
        assert_eq!(
            index["resources"][0]["@id"],
            "https://space.example/api/registry/repo/nuget/"
        );
        let composer = composer_packages_json("https://space.example/api/registry/repo/composer");
        assert_eq!(
            composer["metadata-url"],
            "https://space.example/api/registry/repo/composer/p2/%package%.json"
        );
    }

    fn blob_test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "gaia-space-blobstore-test-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or_default()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }
    #[test]
    fn digests_are_parsed_strictly() {
        assert!(parse_digest(&format!("sha256:{}", "a".repeat(64))).is_ok());
        assert!(parse_digest("sha256:abc").is_err());
        assert!(parse_digest(&format!("sha512:{}", "a".repeat(64))).is_err());
        assert!(parse_digest(&format!("sha256:{}", "A".repeat(64))).is_err());
        assert!(parse_digest("nocolon").is_err());
        assert_eq!(
            compute_digest(b""),
            "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }
    #[test]
    fn blobs_round_trip_by_digest_and_reject_a_lying_digest() {
        let dir = blob_test_dir("round-trip");
        let digest = store_blob(&dir, "repo-1", b"layer-bytes", None).unwrap();
        // Independent check: the digest the store returned must equal an outside sha256 of the
        // same bytes, computed without going through store_blob.
        {
            use sha2::{Digest, Sha256};
            assert_eq!(
                digest,
                format!("sha256:{}", hex::encode(Sha256::digest(b"layer-bytes")))
            );
        }
        assert_eq!(read_blob(&dir, "repo-1", &digest).unwrap(), b"layer-bytes");
        assert!(blob_exists(&dir, "repo-1", &digest));
        assert_eq!(blob_size(&dir, "repo-1", &digest).unwrap(), 11);
        // Same bytes again: idempotent, same digest, no error.
        assert_eq!(
            store_blob(&dir, "repo-1", b"layer-bytes", Some(&digest)).unwrap(),
            digest
        );
        // A declared digest that does not describe the bytes is refused.
        assert!(store_blob(&dir, "repo-1", b"other", Some(&digest))
            .unwrap_err()
            .contains("digest mismatch"));
        // Blobs are per repository: another repository does not see it.
        assert!(!blob_exists(&dir, "repo-2", &digest));
        assert!(read_blob(&dir, "repo-2", &digest).is_err());
        // No partial files survive a successful write.
        let stored = blob_path(&dir, "repo-1", &digest).unwrap();
        let leftovers: Vec<_> = fs::read_dir(stored.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with('.'))
            .collect();
        assert!(leftovers.is_empty(), "staging files must not survive");
        let _ = fs::remove_dir_all(&dir);
    }
    #[test]
    fn blob_paths_cannot_escape_the_store() {
        let dir = blob_test_dir("escape");
        assert!(blob_path(&dir, "../etc", &compute_digest(b"x")).is_err());
        assert!(blob_path(&dir, "repo", "sha256:../../etc/passwd").is_err());
        assert!(blob_path(&dir, "", &compute_digest(b"x")).is_err());
        let ok = blob_path(&dir, "repo", &compute_digest(b"x")).unwrap();
        assert!(ok.starts_with(dir.join("_blobs").join("repo").join("sha256")));
        let _ = fs::remove_dir_all(&dir);
    }
    #[test]
    fn oci_upload_paths_parse() {
        assert_eq!(
            oci_coordinates("library/nginx/blobs/uploads").unwrap(),
            ("library/nginx".into(), OciTarget::BlobUploadStart)
        );
        assert_eq!(
            oci_coordinates("nginx/blobs/uploads/session-1").unwrap(),
            (
                "nginx".into(),
                OciTarget::BlobUpload {
                    session: "session-1".into()
                }
            )
        );
        assert_eq!(
            oci_coordinates(&format!("nginx/blobs/sha256:{}", "a".repeat(64))).unwrap(),
            (
                "nginx".into(),
                OciTarget::Blob {
                    digest: format!("sha256:{}", "a".repeat(64))
                }
            )
        );
    }
    #[test]
    fn pypi_filenames_fall_back_to_pep625_sdist_name() {
        assert_eq!(
            pypi_files(None, "Flask-Login", "0.6.3"),
            vec!["flask_login-0.6.3.tar.gz".to_string()]
        );
        assert_eq!(
            pypi_files(
                Some(r#"{"formatMetadata":{"files":["flask-2.0-py3-none-any.whl"]}}"#),
                "flask",
                "2.0"
            ),
            vec!["flask-2.0-py3-none-any.whl".to_string()]
        );
    }
}
