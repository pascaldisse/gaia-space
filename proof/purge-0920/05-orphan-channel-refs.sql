.mode list
.headers off
CREATE TEMP TABLE T AS SELECT id FROM profiles WHERE username LIKE 'zz-proof-%';
CREATE TEMP TABLE OC AS SELECT DISTINCT channel_id AS id FROM channel_members WHERE profile_id IN (SELECT id FROM T);
SELECT 'OC count: ' || count(*) FROM OC;
SELECT 'message_drafts.channel_id: ' || count(*) FROM message_drafts WHERE channel_id IN (SELECT id FROM OC);
SELECT 'message_polls.channel_id: ' || count(*) FROM message_polls WHERE channel_id IN (SELECT id FROM OC);
SELECT 'channel_notes.channel_id: ' || count(*) FROM channel_notes WHERE channel_id IN (SELECT id FROM OC);
SELECT 'channel_notification_preferences.channel_id: ' || count(*) FROM channel_notification_preferences WHERE channel_id IN (SELECT id FROM OC);
SELECT 'channel_subscriptions.channel_id: ' || count(*) FROM channel_subscriptions WHERE channel_id IN (SELECT id FROM OC);
SELECT 'channel_typing.channel_id: ' || count(*) FROM channel_typing WHERE channel_id IN (SELECT id FROM OC);
SELECT 'review_discussions.channel_id: ' || count(*) FROM review_discussions WHERE channel_id IN (SELECT id FROM OC);
SELECT 'reviews.channel_id: ' || count(*) FROM reviews WHERE channel_id IN (SELECT id FROM OC);
SELECT 'document_discussions.channel_id: ' || count(*) FROM document_discussions WHERE channel_id IN (SELECT id FROM OC);
SELECT 'scheduled_messages.channel_id: ' || count(*) FROM scheduled_messages WHERE channel_id IN (SELECT id FROM OC);
SELECT 'thread_channels.parent_channel_id: ' || count(*) FROM thread_channels WHERE parent_channel_id IN (SELECT id FROM OC);
SELECT 'thread_channels.channel_id: ' || count(*) FROM thread_channels WHERE channel_id IN (SELECT id FROM OC);
SELECT 'locations.channel_id: ' || count(*) FROM locations WHERE channel_id IN (SELECT id FROM OC);
SELECT 'meetings.channel_id (not already organizer-captured): ' || count(*) FROM meetings WHERE channel_id IN (SELECT id FROM OC) AND organizer_id NOT IN (SELECT id FROM T);
SELECT 'messages.channel_id total: ' || count(*) FROM messages WHERE channel_id IN (SELECT id FROM OC);
SELECT 'messages.channel_id author NOT in T: ' || count(*) FROM messages WHERE channel_id IN (SELECT id FROM OC) AND author_id NOT IN (SELECT id FROM T);
SELECT 'private_feeds.channel_id total: ' || count(*) FROM private_feeds WHERE channel_id IN (SELECT id FROM OC);
SELECT 'private_feeds.profile_id NOT in T: ' || count(*) FROM private_feeds WHERE channel_id IN (SELECT id FROM OC) AND profile_id NOT IN (SELECT id FROM T);
SELECT 'read_state.channel_id total: ' || count(*) FROM read_state WHERE channel_id IN (SELECT id FROM OC);
SELECT 'read_state.profile_id NOT in T: ' || count(*) FROM read_state WHERE channel_id IN (SELECT id FROM OC) AND profile_id NOT IN (SELECT id FROM T);
SELECT 'channel_members.channel_id total: ' || count(*) FROM channel_members WHERE channel_id IN (SELECT id FROM OC);
