//! Git LFS for hosted repositories — ported from GitLab (`LfsObject` + `LfsObjectsProject`,
//! `Lfs::FinalizeUploadService`, `Lfs::{Lock,Unlock}FileService`, `LfsFileLockEntity`).
//! Objects are content-addressed ONCE under `data_dir/lfs/objects/aa/bb/<oid>`; a repository
//! reaches an object only through its link row (GitLab `project_allowed_access?`).
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub type Result<T> = std::result::Result<T, String>;

/// GitLab route constraint `oid: /[a-f0-9]{64}/`.
pub fn valid_oid(oid: &str) -> bool {
    oid.len() == 64 && oid.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// GitLab `LfsObjectUploader` layout: `aa/bb/<rest>` fan-out.
pub fn object_path(data_dir: &Path, oid: &str) -> Result<PathBuf> {
    if !valid_oid(oid) {
        return Err("invalid LFS oid".into());
    }
    Ok(data_dir.join("lfs").join("objects").join(&oid[0..2]).join(&oid[2..4]).join(&oid[4..]))
}

pub fn repo_id(conn: &Connection, project: &str, repo: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT id FROM hosted_repositories WHERE project_id=?1 AND name=?2",
        params![project, repo],
        |r| r.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// Linked + present on disk → size (GitLab: `lfs_objects.for_oids` ∧ `file.exists?`).
pub fn linked_size(conn: &Connection, data_dir: &Path, repo_id: &str, oid: &str) -> Result<Option<i64>> {
    let size: Option<i64> = conn
        .query_row(
            "SELECT o.size FROM lfs_objects o JOIN lfs_objects_repos l ON l.oid=o.oid WHERE l.repo_id=?1 AND o.oid=?2",
            params![repo_id, oid],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(size.filter(|_| object_path(data_dir, oid).is_ok_and(|p| p.is_file())))
}

/// `Lfs::FinalizeUploadService`: size + sha256 must match, store once, link to the repo.
/// Err("SHA256 or size mismatch") is the caller's 400.
pub fn finalize_upload(conn: &Connection, data_dir: &Path, repo_id: &str, oid: &str, size: i64, bytes: &[u8]) -> Result<()> {
    let path = object_path(data_dir, oid)?;
    if size < 0 || bytes.len() as i64 != size || hex::encode(Sha256::digest(bytes)) != oid {
        return Err("SHA256 or size mismatch".into());
    }
    if !path.is_file() {
        // GitLab `replace_file!`: a row whose file vanished is re-filled, never trusted.
        let dir = path.parent().ok_or("bad object path")?;
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let tmp = dir.join(format!(".{oid}.{}.tmp", std::process::id()));
        std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    }
    conn.execute("INSERT OR IGNORE INTO lfs_objects(oid,size) VALUES(?1,?2)", params![oid, size])
        .map_err(|e| e.to_string())?;
    conn.execute("INSERT OR IGNORE INTO lfs_objects_repos(repo_id,oid) VALUES(?1,?2)", params![repo_id, oid])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Service result in GitLab's shape: (http status, payload).
pub type LockResult = (u16, Value);

const LOCK_SELECT: &str = "SELECT l.id,l.path,strftime('%Y-%m-%dT%H:%M:%SZ',l.created_at,'unixepoch'),COALESCE(u.username,l.user_id),l.user_id FROM lfs_file_locks l LEFT JOIN users u ON u.id=l.user_id";

/// `LfsFileLockEntity`: {id (string), path, locked_at (iso8601), owner{name}} + owner id.
fn read_lock(r: &rusqlite::Row) -> rusqlite::Result<(Value, String)> {
    let id: i64 = r.get(0)?;
    Ok((
        json!({"id": id.to_string(), "path": r.get::<_, String>(1)?, "locked_at": r.get::<_, String>(2)?, "owner": {"name": r.get::<_, String>(3)?}}),
        r.get(4)?,
    ))
}

fn locks_where(conn: &Connection, filter: &str, p: &[&dyn rusqlite::ToSql]) -> Result<Vec<(Value, String)>> {
    let mut s = conn.prepare(&format!("{LOCK_SELECT} WHERE {filter} ORDER BY l.id")).map_err(|e| e.to_string())?;
    let rows = s.query_map(p, read_lock).map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())
}

/// `Lfs::LocksFinderService` (index): optional id / path filter.
pub fn list_locks(conn: &Connection, repo_id: &str, id: Option<&str>, path: Option<&str>) -> Result<Vec<Value>> {
    let mut all = locks_where(conn, "l.repo_id=?1", &[&repo_id])?;
    all.retain(|(v, _)| id.is_none_or(|i| v["id"] == i) && path.is_none_or(|p| v["path"] == p));
    Ok(all.into_iter().map(|(v, _)| v).collect())
}

/// `verify`: split by owner → {ours, theirs}.
pub fn verify_locks(conn: &Connection, repo_id: &str, user_id: &str) -> Result<Value> {
    let (ours, theirs): (Vec<_>, Vec<_>) =
        locks_where(conn, "l.repo_id=?1", &[&repo_id])?.into_iter().partition(|(_, owner)| owner == user_id);
    let strip = |v: Vec<(Value, String)>| v.into_iter().map(|(v, _)| v).collect::<Vec<_>>();
    Ok(json!({"ours": strip(ours), "theirs": strip(theirs)}))
}

/// `Lfs::LockFileService`: 201 {lock} · 409 {lock, message:"already locked"}.
pub fn create_lock(conn: &Connection, repo_id: &str, user_id: &str, path: &str) -> Result<LockResult> {
    if path.is_empty() {
        return Ok((422, json!({"message": "path is required"})));
    }
    let inserted = conn
        .execute("INSERT OR IGNORE INTO lfs_file_locks(repo_id,path,user_id) VALUES(?1,?2,?3)", params![repo_id, path, user_id])
        .map_err(|e| e.to_string())?;
    let lock = locks_where(conn, "l.repo_id=?1 AND l.path=?2", &[&repo_id, &path])?.into_iter().next().map(|(v, _)| v);
    Ok(if inserted == 1 {
        (201, json!({"lock": lock}))
    } else {
        (409, json!({"lock": lock, "message": "already locked"}))
    })
}

/// `Lfs::UnlockFileService` + `LfsFileLock#can_be_unlocked_by?`: owner, or forced by an admin
/// (GitLab: maintainer).
pub fn unlock(conn: &Connection, repo_id: &str, user_id: &str, admin: bool, id: &str, force: bool) -> Result<LockResult> {
    let Some((lock, owner)) = locks_where(conn, "l.repo_id=?1 AND l.id=?2", &[&repo_id, &id])?.into_iter().next() else {
        return Ok((404, json!({"message": "Lock not found"})));
    };
    if owner == user_id || (force && admin) {
        conn.execute("DELETE FROM lfs_file_locks WHERE repo_id=?1 AND id=?2", params![repo_id, id]).map_err(|e| e.to_string())?;
        Ok((200, json!({"lock": lock})))
    } else if force {
        Ok((403, json!({"message": "You must have maintainer access to force delete a lock"})))
    } else {
        Ok((403, json!({"message": format!("'{}' is locked by @{}", lock["path"].as_str().unwrap_or(""), lock["owner"]["name"].as_str().unwrap_or(""))})))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (crate::db::TempDb, Connection, PathBuf, String) {
        let db = crate::db::TempDb::new("git-lfs");
        let conn = crate::db::open_at(db.path()).unwrap();
        crate::db::migrate(&conn).unwrap();
        conn.execute("INSERT INTO projects(id,name,key,created_at) VALUES('p','P','P',1)", []).unwrap();
        let data = db.path().parent().unwrap().join("data");
        let r = crate::git_hosting::create_at(&conn, &data, "p", "r", None, "main").unwrap();
        (db, conn, data, r.id)
    }

    #[test]
    fn upload_verifies_sha_and_size_stores_once_and_links_per_repo() {
        let (_db, conn, data, repo) = setup();
        let body = b"hello lfs";
        let oid = hex::encode(Sha256::digest(body));
        assert_eq!(finalize_upload(&conn, &data, &repo, &oid, 8, body).unwrap_err(), "SHA256 or size mismatch");
        assert!(finalize_upload(&conn, &data, &repo, &"0".repeat(64), 9, body).is_err());
        assert_eq!(linked_size(&conn, &data, &repo, &oid).unwrap(), None);
        finalize_upload(&conn, &data, &repo, &oid, 9, body).unwrap();
        finalize_upload(&conn, &data, &repo, &oid, 9, body).unwrap();
        assert_eq!(linked_size(&conn, &data, &repo, &oid).unwrap(), Some(9));
        assert_eq!(std::fs::read(object_path(&data, &oid).unwrap()).unwrap(), body);
        // another repo does NOT see it until it uploads (link), and storage stays single
        let other = crate::git_hosting::create_at(&conn, &data, "p", "o", None, "main").unwrap().id;
        assert_eq!(linked_size(&conn, &data, &other, &oid).unwrap(), None);
        // vanished file → not served, re-upload refills
        std::fs::remove_file(object_path(&data, &oid).unwrap()).unwrap();
        assert_eq!(linked_size(&conn, &data, &repo, &oid).unwrap(), None);
        finalize_upload(&conn, &data, &repo, &oid, 9, body).unwrap();
        assert_eq!(linked_size(&conn, &data, &repo, &oid).unwrap(), Some(9));
        assert!(!valid_oid("../../etc/passwd") && !valid_oid(&"A".repeat(64)));
    }

    #[test]
    fn locks_follow_gitlab_semantics() {
        let (_db, conn, _data, repo) = setup();
        let (s, v) = create_lock(&conn, &repo, "u1", "a.psd").unwrap();
        assert_eq!(s, 201);
        let id = v["lock"]["id"].as_str().unwrap().to_string();
        assert_eq!(create_lock(&conn, &repo, "u2", "a.psd").unwrap().0, 409);
        let ver = verify_locks(&conn, &repo, "u2").unwrap();
        assert_eq!((ver["ours"].as_array().unwrap().len(), ver["theirs"].as_array().unwrap().len()), (0, 1));
        assert_eq!(list_locks(&conn, &repo, None, Some("a.psd")).unwrap().len(), 1);
        assert_eq!(list_locks(&conn, &repo, None, Some("b")).unwrap().len(), 0);
        assert_eq!(unlock(&conn, &repo, "u2", false, &id, false).unwrap().0, 403);
        assert_eq!(unlock(&conn, &repo, "u2", false, &id, true).unwrap().0, 403);
        assert_eq!(unlock(&conn, &repo, "u2", true, &id, true).unwrap().0, 200);
        assert_eq!(unlock(&conn, &repo, "u1", false, &id, false).unwrap().0, 404);
        create_lock(&conn, &repo, "u1", "b").unwrap();
        // deleting the repository cascades its locks and links
        conn.execute("DELETE FROM hosted_repositories WHERE id=?1", [&repo]).unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM lfs_file_locks", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }
}
