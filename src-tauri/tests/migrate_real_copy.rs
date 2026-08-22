// One-off: run the full migration chain against a copy of a real install DB.
// Path comes from MIGRATE_CHECK_DB; test is a no-op without it.

#[test]
fn migrates_real_install_copy() {
    let Some(path) = std::env::var_os("MIGRATE_CHECK_DB") else { return };
    let conn = gaia_space_lib::db::open_at(&path).expect("open copy");
    gaia_space_lib::db::migrate(&conn).expect("migrate copy");
    let v: i64 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(v, gaia_space_lib::db::SCHEMA_VERSION);
}
