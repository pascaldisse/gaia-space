.mode list
.headers off
SELECT '=== T (zz-proof profiles) ===';
SELECT id || ' | ' || username FROM profiles WHERE username LIKE 'zz-proof-%' ORDER BY username;
SELECT '=== T count ===';
SELECT count(*) FROM profiles WHERE username LIKE 'zz-proof-%';
