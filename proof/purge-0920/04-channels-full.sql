.mode list
.headers off
CREATE TEMP TABLE T AS SELECT id FROM profiles WHERE username LIKE 'zz-proof-%';
SELECT '=== per-channel composition (channels touched by T members) ===';
SELECT c.id || ' | content_type=' || c.content_type || ' | name=' || COALESCE(c.name,'') ||
  ' | total_members=' || (SELECT count(*) FROM channel_members cm2 WHERE cm2.channel_id=c.id) ||
  ' | T_members=' || (SELECT count(*) FROM channel_members cm3 WHERE cm3.channel_id=c.id AND cm3.profile_id IN (SELECT id FROM T)) ||
  ' | messages_total=' || (SELECT count(*) FROM messages m WHERE m.channel_id=c.id) ||
  ' | messages_by_nonT=' || (SELECT count(*) FROM messages m WHERE m.channel_id=c.id AND m.author_id NOT IN (SELECT id FROM T)) ||
  ' | is_orphan=' || (CASE WHEN (SELECT count(*) FROM channel_members cm4 WHERE cm4.channel_id=c.id AND cm4.profile_id NOT IN (SELECT id FROM T)) = 0 THEN 'YES' ELSE 'NO' END)
FROM channels c
WHERE c.id IN (SELECT DISTINCT channel_id FROM channel_members WHERE profile_id IN (SELECT id FROM T));
SELECT '=== private_feeds rows for T (profile_id, channel_id) ===';
SELECT profile_id || ' -> ' || channel_id FROM private_feeds WHERE profile_id IN (SELECT id FROM T);
SELECT '=== notifications event_type breakdown for T recipients ===';
SELECT event_type || ': ' || count(*) FROM notifications WHERE recipient_id IN (SELECT id FROM T) GROUP BY event_type;
SELECT '=== notifications entity_id cross-check: any pointing at non-proof entities? ===';
SELECT id || ' | recipient=' || recipient_id || ' | event=' || event_type || ' | entity_type=' || COALESCE(entity_type,'') || ' | entity_id=' || COALESCE(entity_id,'') FROM notifications WHERE recipient_id IN (SELECT id FROM T);
SELECT '=== message_attachments in T channels (any) ===';
SELECT count(*) FROM message_attachments WHERE message_id IN (SELECT id FROM messages WHERE channel_id IN (SELECT DISTINCT channel_id FROM channel_members WHERE profile_id IN (SELECT id FROM T)));
SELECT '=== channel_notification_preferences/channel_subscriptions/channel_typing for these channels (any nonT?) - sanity, already 0 globally for T but check table exists with data for these channels ===';
SELECT count(*) FROM channel_notification_preferences WHERE channel_id IN (SELECT DISTINCT channel_id FROM channel_members WHERE profile_id IN (SELECT id FROM T));
