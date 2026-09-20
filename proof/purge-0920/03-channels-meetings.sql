.mode list
.headers off
CREATE TEMP TABLE T AS SELECT id FROM profiles WHERE username LIKE 'zz-proof-%';
SELECT '=== channels touched by T (via channel_members) ===';
SELECT DISTINCT channel_id FROM channel_members WHERE profile_id IN (SELECT id FROM T);
SELECT '=== per-channel: total members vs T members vs channel type/name ===';
SELECT c.id || ' | type=' || c.type || ' | name=' || COALESCE(c.name,'') ||
  ' | total_members=' || (SELECT count(*) FROM channel_members cm2 WHERE cm2.channel_id=c.id) ||
  ' | T_members=' || (SELECT count(*) FROM channel_members cm3 WHERE cm3.channel_id=c.id AND cm3.profile_id IN (SELECT id FROM T)) ||
  ' | messages_total=' || (SELECT count(*) FROM messages m WHERE m.channel_id=c.id) ||
  ' | messages_by_nonT=' || (SELECT count(*) FROM messages m WHERE m.channel_id=c.id AND m.author_id NOT IN (SELECT id FROM T))
FROM channels c
WHERE c.id IN (SELECT DISTINCT channel_id FROM channel_members WHERE profile_id IN (SELECT id FROM T));
SELECT '=== meetings organizer/video_ended in T ===';
SELECT m.id || ' | title=' || COALESCE(m.title,'') || ' | organizer_id=' || COALESCE(m.organizer_id,'') || ' | video_ended_by=' || COALESCE(m.video_ended_by,'') ||
  ' | organizer_in_T=' || (CASE WHEN m.organizer_id IN (SELECT id FROM T) THEN 1 ELSE 0 END) ||
  ' | total_participants=' || (SELECT count(*) FROM meeting_participants mp WHERE mp.meeting_id=m.id) ||
  ' | T_participants=' || (SELECT count(*) FROM meeting_participants mp2 WHERE mp2.meeting_id=m.id AND mp2.profile_id IN (SELECT id FROM T)) ||
  ' | channel_id=' || COALESCE(m.channel_id,'')
FROM meetings m
WHERE m.organizer_id IN (SELECT id FROM T) OR m.video_ended_by IN (SELECT id FROM T)
   OR m.id IN (SELECT meeting_id FROM meeting_participants WHERE profile_id IN (SELECT id FROM T));
SELECT '=== meeting_participants for those meetings, ALL rows (to see non-T participants) ===';
SELECT mp.meeting_id || ' | profile_id=' || mp.profile_id || ' | in_T=' || (CASE WHEN mp.profile_id IN (SELECT id FROM T) THEN 1 ELSE 0 END)
FROM meeting_participants mp
WHERE mp.meeting_id IN (
  SELECT id FROM meetings WHERE organizer_id IN (SELECT id FROM T) OR video_ended_by IN (SELECT id FROM T)
     OR id IN (SELECT meeting_id FROM meeting_participants WHERE profile_id IN (SELECT id FROM T))
)
ORDER BY mp.meeting_id;
SELECT '=== private_feeds for T ===';
SELECT id || ' | profile_id=' || profile_id FROM private_feeds WHERE profile_id IN (SELECT id FROM T);
SELECT '=== notifications.recipient_id in T (sample types) ===';
SELECT type || ': ' || count(*) FROM notifications WHERE recipient_id IN (SELECT id FROM T) GROUP BY type;
SELECT '=== read_state.profile_id in T (channel refs) ===';
SELECT channel_id || ' | profile_id=' || profile_id FROM read_state WHERE profile_id IN (SELECT id FROM T);
