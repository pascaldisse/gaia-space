.mode list
.headers off
SELECT '=== deps for profile-04161e8d5a1f ===';
SELECT 'read_state: ' || count(*) FROM read_state WHERE profile_id='profile-04161e8d5a1f';
SELECT 'channel_members: ' || count(*) FROM channel_members WHERE profile_id='profile-04161e8d5a1f';
SELECT 'private_feeds: ' || count(*) FROM private_feeds WHERE profile_id='profile-04161e8d5a1f';
SELECT 'notifications: ' || count(*) FROM notifications WHERE recipient_id='profile-04161e8d5a1f';
SELECT 'messages: ' || count(*) FROM messages WHERE author_id='profile-04161e8d5a1f';
BEGIN IMMEDIATE;
DELETE FROM read_state WHERE profile_id='profile-04161e8d5a1f';
DELETE FROM channel_members WHERE profile_id='profile-04161e8d5a1f';
DELETE FROM channels WHERE id='private-feed:profile-04161e8d5a1f';
DELETE FROM private_feeds WHERE profile_id='profile-04161e8d5a1f';
DELETE FROM notifications WHERE recipient_id='profile-04161e8d5a1f';
DELETE FROM profiles WHERE id='profile-04161e8d5a1f';
COMMIT;
SELECT '=== post ===';
SELECT count(*) FROM profiles WHERE id='profile-04161e8d5a1f';
PRAGMA foreign_key_check;
