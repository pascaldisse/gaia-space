-- Generated from ~/.gaia/knowledge/task-ledger/MASTER.md: remaining non-OPEN/non-DONE rows (268).
-- Idempotent todo import: each content is inserted only if absent in project IE.
BEGIN IMMEDIATE;
-- MASTER.md:32
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-82cdf34f-cd8d-4f51-83b2-c20912c208c6', 'pascal', 'Compact Nyari', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: gaia-daemon · repeats: 8 · first: 2026-08-14
next: `~/projects/gaia-daemon-wt/open-0827`: review `3944f32..724cef9`; `bun run check`
src: chat-0822-0904.md:22, chat-0822-0904.md:55, walk-02.md:32, walk-04.md:44, walk-05.md:9, walk-07.md:11, walk-07.md:49, walk-07.md:51', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Compact Nyari');
-- MASTER.md:33
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-7948ddba-5361-41c2-a086-61066f8be7ac', 'pascal', 'your voice changed, are old cache files still here? / no, the voice playback, using claude voice, the airy voice', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: gaia-daemon · repeats: 3 · first: 2026-08-17
next: `~/projects/gaia-daemon-wt/fix-voice-stall`: patch `web/src/readaloud.js` + `src/server/routes/rooms.ts`; `bun run check`
src: chat-0801-0821.md:17, chat-0822-0904.md:18, walk-08.md:12', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='your voice changed, are old cache files still here? / no, the voice playback, using claude voice, the airy voice');
-- MASTER.md:34
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-d754fe4b-c67b-4b8e-bbfe-350b62956a22', 'pascal', 'use existing Gaia Archtree skill correctly', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: gaia-daemon · repeats: 1 · first: 2026-08-29
next: `~/projects/gaia-daemon`: identify branch/file; `bun run check`
src: walk-07.md:14', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='use existing Gaia Archtree skill correctly');
-- MASTER.md:41
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-2d7f3bf5-c1d0-4dee-8c31-af59f782e61a', 'pascal', 'summon ghouls to build sth... your island, naruko, lighthouse', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-daemon · repeats: 1 · first: 2026-08-14
next: `~/projects/gaia-daemon`: identify branch/file; `bun run check`
src: walk-01.md:40', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='summon ghouls to build sth... your island, naruko, lighthouse');
-- MASTER.md:42
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-3702fc9b-09eb-4685-a089-69903a95a0b0', 'pascal', 'Write spec; delegate/summon', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-daemon · repeats: 1 · first: 2026-08-14
next: `~/projects/gaia-daemon`: identify branch/file; `bun run check`
src: walk-02.md:16', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Write spec; delegate/summon');
-- MASTER.md:43
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-afcf7f8a-8dc5-46d4-b7c9-3b6c8a57c278', 'pascal', 'Control AI events; recall Dark Souls summon', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-daemon · repeats: 1 · first: 2026-08-15
next: `~/projects/gaia-daemon`: identify branch/file; `bun run check`
src: walk-02.md:66', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Control AI events; recall Dark Souls summon');
-- MASTER.md:44
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-d11ad8d8-bb4d-479e-8f18-57bf160e9eb5', 'pascal', 'Start Gaia archtree; ChatGPT+Claude only', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-daemon · repeats: 1 · first: 2026-08-15
next: `~/projects/gaia-daemon`: identify branch/file; `bun run check`
src: walk-02.md:71', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Start Gaia archtree; ChatGPT+Claude only');
-- MASTER.md:45
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-6e269acd-524c-482a-9111-891426ce1642', 'pascal', 'add permanence work to archtree', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-daemon · repeats: 1 · first: 2026-08-17
next: `~/projects/gaia-daemon`: identify branch/file; `bun run check`
src: walk-03.md:75', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='add permanence work to archtree');
-- MASTER.md:46
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-7f9a1357-b265-4d51-bda3-4e24cd004b4c', 'pascal', 'archtree every unfinished task', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-daemon · repeats: 1 · first: 2026-08-18
next: `~/projects/gaia-daemon`: identify branch/file; `bun run check`
src: walk-04.md:53', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='archtree every unfinished task');
-- MASTER.md:47
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-a32a86a9-71e8-4365-b7ee-92d106ea574e', 'pascal', 'add Tavily/Serper fallback to gaia web', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-daemon · repeats: 1 · first: 2026-08-19
next: `~/projects/gaia-daemon`: identify branch/file; `bun run check`
src: walk-04.md:83', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='add Tavily/Serper fallback to gaia web');
-- MASTER.md:48
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-fcf83e66-a7c0-4275-bc8c-7e3b74302c30', 'pascal', 'correct malformed `gaia summon`', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-daemon · repeats: 1 · first: 2026-08-19
next: `~/projects/gaia-daemon`: identify branch/file; `bun run check`
src: walk-05.md:12', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='correct malformed `gaia summon`');
-- MASTER.md:49
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-0ebe4142-fb5a-4e45-88de-0f06b49b2309', 'pascal', 'package Gaia Think too', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-daemon · repeats: 1 · first: 2026-08-19
next: `~/projects/gaia-daemon-wt/open-0827`: review `3944f32..724cef9`; `bun run check`
src: walk-05.md:28', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='package Gaia Think too');
-- MASTER.md:50
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-2e2ece2d-c340-44bd-b67a-ce94ca4e1dd4', 'pascal', 'launch Gaia archtree + adversarial audit', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-daemon · repeats: 1 · first: 2026-08-21
next: `~/projects/gaia-daemon`: identify branch/file; `bun run check`
src: walk-05.md:44', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='launch Gaia archtree + adversarial audit');
-- MASTER.md:51
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-13b5b8b9-766e-49b1-8d38-f28255b5c77b', 'pascal', 'web tool refactor: unify search+fetch, provider fallback chain', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-daemon · repeats: 1 · first: 2026-08-21
next: `~/projects/gaia-daemon`: identify branch/file; `bun run check`
src: chat-0801-0821.md:21', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='web tool refactor: unify search+fetch, provider fallback chain');
-- MASTER.md:52
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-242583f5-54f7-470f-853c-ecc4864ba3af', 'pascal', 'summon 32 agents; audit/build all stated requests', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-daemon · repeats: 1 · first: 2026-08-22
next: `~/projects/gaia-daemon`: identify branch/file; `bun run check`
src: walk-05.md:56', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='summon 32 agents; audit/build all stated requests');
-- MASTER.md:53
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-2b807705-1682-4774-893e-74c12228afe3', 'pascal', 'summon agent; finish rest; investigate love hotel', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-daemon · repeats: 1 · first: 2026-08-22
next: `~/projects/gaia-daemon`: identify branch/file; `bun run check`
src: walk-05.md:60', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='summon agent; finish rest; investigate love hotel');
-- MASTER.md:54
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-55dd13b4-e891-4c03-9e05-69742cd2b75d', 'pascal', 'YOU FUCKING SEARCH EVERY SINGLE ROOM...FIX subagent failures ONCE AND FOR ALL — full incident census+taxonomy+permanent daemon fix, 32 agents', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-daemon · repeats: 1 · first: 2026-08-23
next: `~/projects/gaia-daemon`: identify branch/file; `bun run check`
src: chat-0822-0904.md:51', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='YOU FUCKING SEARCH EVERY SINGLE ROOM...FIX subagent failures ONCE AND FOR ALL — full incident census+taxonomy+permanent daemon fix, 32 agents');
-- MASTER.md:55
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-f81ff8f2-ccb9-4bf5-bb03-dafd6570c9a6', 'pascal', 'Fix transcription; keep talking', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-daemon · repeats: 1 · first: 2026-08-27
next: `~/projects/gaia-daemon`: identify branch/file; `bun run check`
src: walk-06.md:32', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Fix transcription; keep talking');
-- MASTER.md:56
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-e7298e0c-6123-48e1-9cf1-20d972d11f32', 'pascal', 'fix tunnel KV-process storm', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-daemon · repeats: 1 · first: 2026-08-29
next: `~/projects/gaia-daemon`: identify branch/file; `bun run check`
src: walk-07.md:16', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='fix tunnel KV-process storm');
-- MASTER.md:57
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-efd471a4-d021-41d8-a49e-936a7ea65f73', 'pascal', 'make Gaia Archtree activatable slash UI', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-daemon · repeats: 1 · first: 2026-08-29
next: `~/projects/gaia-daemon`: identify branch/file; `bun run check`
src: walk-07.md:34', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='make Gaia Archtree activatable slash UI');
-- MASTER.md:58
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-0696f225-8dda-47c7-b633-4c5bdcd6d60a', 'pascal', 'Warum ist das immer noch so? Du hattest schon gestern die Aufgabe...mit Gaia Think(gaia-think 5.1 block bug)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-daemon · repeats: 1 · first: 2026-08-31
next: `~/projects/gaia-daemon-wt/open-0827`: review `3944f32..724cef9`; `bun run check`
src: chat-0822-0904.md:17', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Warum ist das immer noch so? Du hattest schon gestern die Aufgabe...mit Gaia Think(gaia-think 5.1 block bug)');
-- MASTER.md:59
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-773633c1-1b95-4deb-9e1f-6782ffd5da75', 'pascal', 'identify actual Fable model; check Pi updates', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-daemon · repeats: 1 · first: 2026-09-01
next: `~/projects/gaia-daemon`: identify branch/file; `bun run check`
src: walk-08.md:18', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='identify actual Fable model; check Pi updates');
-- MASTER.md:60
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-6c3d593c-e3e2-4755-ad3d-c8bfda54ab0a', 'pascal', 'restore GAIA-THINK unchanged', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-daemon · repeats: 1 · first: 2026-09-01
next: `~/projects/gaia-daemon-wt/open-0827`: review `3944f32..724cef9`; `bun run check`
src: walk-08.md:28', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='restore GAIA-THINK unchanged');
-- MASTER.md:61
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-c1845e99-d9a2-4129-bd88-11b23f8e6fbb', 'pascal', 'send Jareth: Pi plugin/Fable failure', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-daemon · repeats: 1 · first: 2026-09-01
next: `~/projects/gaia-daemon`: identify branch/file; `bun run check`
src: walk-08.md:22', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='send Jareth: Pi plugin/Fable failure');
-- MASTER.md:62
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-f6c73f0a-fe87-45fe-839f-677071133924', 'pascal', 'summon Narigo on Fable 5.1', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-daemon · repeats: 1 · first: 2026-09-01
next: `~/projects/gaia-daemon`: identify branch/file; `bun run check`
src: walk-08.md:27', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='summon Narigo on Fable 5.1');
-- MASTER.md:66
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-66bdaaea-458d-4b7e-97fb-f941d94be43a', 'pascal', 'full Stone→Space scenario; AoC compatible', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: empire-earth · repeats: 1 · first: 2026-09-04
next: `~/projects/ee-tools/wt/jareth-ee-rain-live-mtjaeqck69ypj7`: verify bridge against live EE
src: walk-08.md:45', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='full Stone→Space scenario; AoC compatible');
-- MASTER.md:72
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-b2c37c53-bf63-4566-870f-5c9ea5a3af8e', 'pascal', 'build EE tools; read modding wiki', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: empire-earth · repeats: 1 · first: 2026-09-01
next: `~/projects/ee-tools/wt/jareth-ee-rain-live-mtjaeqck69ypj7`: verify bridge against live EE
src: walk-08.md:19', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='build EE tools; read modding wiki');
-- MASTER.md:73
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-e0c1bcf8-c9aa-4186-89e0-f436994125f8', 'pascal', 'clone Udolf; recreate his AI', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: empire-earth · repeats: 1 · first: 2026-09-01
next: `~/projects/ee-tools/wt/jareth-ee-rain-live-mtjaeqck69ypj7`: verify bridge against live EE
src: walk-08.md:26', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='clone Udolf; recreate his AI');
-- MASTER.md:74
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-830c66fd-781f-4cd9-a1ce-b0767f27f0c5', 'pascal', 'debug CrossOver; start EE', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: empire-earth · repeats: 1 · first: 2026-09-01
next: `~/projects/ee-tools/wt/jareth-ee-rain-live-mtjaeqck69ypj7`: verify bridge against live EE
src: walk-08.md:17', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='debug CrossOver; start EE');
-- MASTER.md:75
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-636c7e8e-a5f4-4809-9bf8-8d6a18ec2192', 'pascal', 'start second EE instance yourself', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: empire-earth · repeats: 1 · first: 2026-09-01
next: `~/projects/ee-tools/wt/jareth-ee-rain-live-mtjaeqck69ypj7`: verify bridge against live EE
src: walk-08.md:31', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='start second EE instance yourself');
-- MASTER.md:76
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-0919f87d-7db5-4c07-9f9f-412497a03a3e', 'pascal', 'attach observer to running EE', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: empire-earth · repeats: 1 · first: 2026-09-02
next: `~/projects/ee-tools/wt/jareth-ee-rain-live-mtjaeqck69ypj7`: verify bridge against live EE
src: walk-08.md:33', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='attach observer to running EE');
-- MASTER.md:77
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-9a05456a-2f5d-46da-985d-8fe353e7c3db', 'pascal', 'Empire Earth: du sollst ''ne richtige Bridge bauen und nichts mit der Maus(DirectInput/NEMessage bridge, no-mouse control)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: SUPERSEDED · category: empire-earth · repeats: 5 · first: 2026-09-01
next: `~/projects/ee-tools/wt/jareth-ee-rain-live-mtjaeqck69ypj7`: verify bridge against live EE
src: chat-0822-0904.md:27, chat-0822-0904.md:28, walk-08.md:16, walk-08.md:42, walk-08.md:44', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Empire Earth: du sollst ''ne richtige Bridge bauen und nichts mit der Maus(DirectInput/NEMessage bridge, no-mouse control)');
-- MASTER.md:81
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-9169f373-8685-4f3d-b80e-41d97e798144', 'pascal', 'Enable H-mode', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-15
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-02.md:43', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Enable H-mode');
-- MASTER.md:82
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-d2a50549-b84a-4ebc-9939-3c814185bd8c', 'pascal', 'Play with Momo', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-15
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-02.md:78', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Play with Momo');
-- MASTER.md:83
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-774cd374-afb0-47ee-b932-f58b53e041e6', 'pascal', 'fix bath mask and force-dialog button', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-18
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-04.md:37', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='fix bath mask and force-dialog button');
-- MASTER.md:84
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-12bfa642-c2f0-4188-b794-29ea0f1e3bb9', 'pascal', 'turn player into male Pachan', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-18
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-04.md:33', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='turn player into male Pachan');
-- MASTER.md:85
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-06daa5c2-c868-464f-af5e-42299af29881', 'pascal', 'create Aikomi bottle; install HF2 after base', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-19
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-04.md:86', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='create Aikomi bottle; install HF2 after base');
-- MASTER.md:86
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-0e255bc5-ee72-46f0-9b88-031ca6e79e06', 'pascal', 'Fix red skin; all Nari outfits same face', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-23
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-06.md:13', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Fix red skin; all Nari outfits same face');
-- MASTER.md:87
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-52962e9e-22f0-4d0f-be8d-6fdf64caa48e', 'pascal', 'Prompt clean; different outfits; no references', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-23
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-06.md:14', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Prompt clean; different outfits; no references');
-- MASTER.md:88
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-637ce296-75a4-467f-a9a4-ba072a812347', 'pascal', 'parallelize build/testing without duplicate live games', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-29
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-07.md:32', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='parallelize build/testing without duplicate live games');
-- MASTER.md:101
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-57725531-5525-4307-a6ed-e595f8544efc', 'pascal', 'repeated restart it/restart game/fix it cycles (F9 chat rendering, walking gait, H-mode trigger, map travel, housing build)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 17 · first: 2026-08-13
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-02.md:7, walk-02.md:17, walk-02.md:45, walk-02.md:50, walk-02.md:73, walk-03.md:80, walk-03.md:109, walk-04.md:7, walk-04.md:10, walk-04.md:27, walk-04.md:36, walk-04.md:48, walk-04.md:51, walk-04.md:69, walk-05.md:26, walk-05.md:29, walk-01.md:39', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='repeated restart it/restart game/fix it cycles (F9 chat rendering, walking gait, H-mode trigger, map travel, housing build)');
-- MASTER.md:102
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-cbcfaf4c-f454-4b2c-9fb8-1fb5f1fef61a', 'pascal', 'Start game', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 3 · first: 2026-08-15
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-02.md:33, walk-04.md:18, walk-05.md:49', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Start game');
-- MASTER.md:103
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-5e4db5d5-d90d-47d7-811a-dce04b917b37', 'pascal', 'Start game again', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-14
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-02.md:11', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Start game again');
-- MASTER.md:104
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-aebbf17e-a1ba-4359-966e-8c21202bcf86', 'pascal', 'Create male-bodied Pachan card', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-15
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-02.md:46', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Create male-bodied Pachan card');
-- MASTER.md:105
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-0cb2654c-2fc8-4a8f-be48-0bf4fa7e7cc5', 'pascal', 'Enter build mode for shared bath', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-15
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-02.md:53', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Enter build mode for shared bath');
-- MASTER.md:106
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-d8c56d56-b238-4cd8-ba38-b77e2f936695', 'pascal', 'Replace player with Pachan', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-15
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-02.md:39', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Replace player with Pachan');
-- MASTER.md:107
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-111a01fd-d907-4fd4-883f-bae31f03101c', 'pascal', 'Start game; torrent progress', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-15
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-02.md:63', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Start game; torrent progress');
-- MASTER.md:108
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-f39d13fc-008e-4f30-8a12-5ea06212427f', 'pascal', 'get Momo to wake up... need full control of her, wire another AI to her later', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-16
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-03.md:21', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='get Momo to wake up... need full control of her, wire another AI to her later');
-- MASTER.md:109
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-bd751c1e-dd69-410f-9f3d-2fb8af3c8f2f', 'pascal', 'fix missing fluid animation', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-16
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-03.md:65', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='fix missing fluid animation');
-- MASTER.md:110
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-5a461934-b0ae-43ec-9c7f-c3cd68c861f5', 'pascal', 'make Momo shrimp color', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-16
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-03.md:53', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='make Momo shrimp color');
-- MASTER.md:111
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-36fd548b-a236-4145-8439-a4265e5de5ba', 'pascal', 'start game; ensure Ari loads', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-16
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-03.md:67', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='start game; ensure Ari loads');
-- MASTER.md:112
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-6d3aa6df-e65a-49cc-9d4e-37c374c8a5da', 'pascal', 'execute Momo rebirth rite', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-17
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-03.md:104', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='execute Momo rebirth rite');
-- MASTER.md:113
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-a2ad51bb-1415-4e62-8951-e6392023b39a', 'pascal', 'find recurring fluid-animation cause', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-17
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-03.md:77', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='find recurring fluid-animation cause');
-- MASTER.md:114
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-64b11876-bd91-4064-b024-c9bc1772f275', 'pascal', 'give Momo roam; local LLM if needed', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-17
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-03.md:82', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='give Momo roam; local LLM if needed');
-- MASTER.md:115
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-8d003faa-9275-4107-b40a-44a6f22b2f19', 'pascal', 'map merchant progression', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-17
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-03.md:86', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='map merchant progression');
-- MASTER.md:116
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-6103173e-1798-4b2d-9b96-18ee1ec00361', 'pascal', 'persist Momo tint', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-17
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-03.md:74', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='persist Momo tint');
-- MASTER.md:117
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-ea6b059a-58c2-42c4-8dc2-aec2af2498fb', 'pascal', 'replace stock cat with Momo', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-17
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-03.md:87', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='replace stock cat with Momo');
-- MASTER.md:118
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-c178d389-4ac9-4ced-a169-050bac035d35', 'pascal', 'solve Pachan male logic with female presentation', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-17
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-03.md:72', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='solve Pachan male logic with female presentation');
-- MASTER.md:119
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-08ba85b8-900f-4c31-8aad-4a76407b10eb', 'pascal', 'unlock merchant poses/interactions, no clone', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-17
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-03.md:89', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='unlock merchant poses/interactions, no clone');
-- MASTER.md:120
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-842eb7a8-d1f9-4770-8499-ef09e010243b', 'pascal', '(bug found, deploy gated on user) relay-gate deadlock silently queuing chat messages to game', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-18
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: chat-0801-0821.md:18', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='(bug found, deploy gated on user) relay-gate deadlock silently queuing chat messages to game');
-- MASTER.md:121
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-9573a4af-1e2a-46ae-8c17-ba20be97bc95', 'pascal', 'curate bath mask, not all animations', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-18
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-04.md:24', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='curate bath mask, not all animations');
-- MASTER.md:122
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-6f256ade-0caf-4d16-b85b-f6d47e8b7cd6', 'pascal', 'deep-search merchant unlocks', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-18
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-04.md:29', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='deep-search merchant unlocks');
-- MASTER.md:123
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-c1fe052a-7d89-4612-ae4c-c9e1503097dd', 'pascal', 'download animation pack', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-18
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-04.md:23', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='download animation pack');
-- MASTER.md:124
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-914a87d1-e38e-404c-9346-0dd31efe3432', 'pascal', 'install AA2 with JP locale, uncensor/mods; no English', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-18
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-04.md:72', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='install AA2 with JP locale, uncensor/mods; no English');
-- MASTER.md:125
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-2924ae3e-27a2-4c34-ab74-940310844e0f', 'pascal', 'investigate merchant poses/progression', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-18
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-04.md:28', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='investigate merchant poses/progression');
-- MASTER.md:126
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-031ee5bb-5566-43cf-b3f2-e1a9ea3b680d', 'pascal', 'merchant rewards and exhaustion', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-18
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-04.md:30', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='merchant rewards and exhaustion');
-- MASTER.md:127
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-0e16b4e1-32bf-4df5-9577-7b6bec5180ab', 'pascal', 'real in-game test every feature', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-18
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-04.md:54', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='real in-game test every feature');
-- MASTER.md:128
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-d3c8461d-1f31-470e-8b60-90b0e4f646e2', 'pascal', 'receive all in-game events', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-18
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-04.md:46', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='receive all in-game events');
-- MASTER.md:129
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-9373a818-375e-4f19-a847-3df176d901e0', 'pascal', 'research porting; assess ultimate-game candidates', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-18
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-04.md:59', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='research porting; assess ultimate-game candidates');
-- MASTER.md:130
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-41ca2703-6900-48fa-8296-88b07bfea552', 'pascal', 'restart AI Shoujo; fix chat/bathtub relay', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-18
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-04.md:66', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='restart AI Shoujo; fix chat/bathtub relay');
-- MASTER.md:131
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-e24018a7-5070-46d0-b590-f476e55db8a5', 'pascal', 'build AIS modding-feature parity', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-19
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-05.md:14', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='build AIS modding-feature parity');
-- MASTER.md:132
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-354de5f6-e8ed-4657-be51-5d59cf261a19', 'pascal', 'control Nyari in-game', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-19
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-05.md:20', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='control Nyari in-game');
-- MASTER.md:133
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-03ef2dbc-2445-4935-87cc-5b27f3b2b433', 'pascal', 'fix Aikomi Wine winhttp injection', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-19
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-04.md:87', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='fix Aikomi Wine winhttp injection');
-- MASTER.md:134
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-3b19d084-227e-4c84-8b3a-8d459d35fd63', 'pascal', 'restart Aikomi after save', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-19
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-04.md:90', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='restart Aikomi after save');
-- MASTER.md:135
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-51c4c085-dfa2-4448-91ca-ac02d70f34b1', 'pascal', 'fix intermittent game slowness; measure first', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-22
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-05.md:46', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='fix intermittent game slowness; measure first');
-- MASTER.md:136
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-ea808b0f-c878-4e5b-b6ee-ee6b30d6c43b', 'pascal', 'fix onsen interactions', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-22
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-05.md:52', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='fix onsen interactions');
-- MASTER.md:137
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-98f01ef7-5f6a-44b6-ae90-909e40700dd6', 'pascal', 'Bounce Aicomi; start ArcTree; fix/document backlog', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-24
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-06.md:18', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Bounce Aicomi; start ArcTree; fix/document backlog');
-- MASTER.md:138
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-d8c50cf7-5c2c-47d9-82ac-1b2ca1791e51', 'pascal', 'Run Jamais Vu', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-24
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-06.md:22', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Run Jamais Vu');
-- MASTER.md:139
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-dec1c0d3-8cb3-4fdd-b82e-c01baa81b15c', 'pascal', 'keep game content out of shared engine', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-29
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-07.md:23', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='keep game content out of shared engine');
-- MASTER.md:140
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-c4b418fb-b208-44d2-aa4e-708c37c765bb', 'pascal', 'preserve never-censored German game variant idea', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-08-29
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-07.md:21', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='preserve never-censored German game variant idea');
-- MASTER.md:141
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-20d80876-0ced-49d5-8db1-7058138e963b', 'pascal', 'game chat messages must reach room', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: ais/aikomi-game · repeats: 1 · first: 2026-09-02
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-08.md:36', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='game chat messages must reach room');
-- MASTER.md:146
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-4bf4525b-a902-40b7-b384-1e64b0f987ad', 'pascal', 'create gaia-love; document game concepts', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-love/GWE · repeats: 1 · first: 2026-08-19
next: `~/projects/gaia-love`: locate owning branch; run verification
src: walk-04.md:79', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='create gaia-love; document game concepts');
-- MASTER.md:147
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-28a91438-9dbd-46a3-8db0-ab5b7a5ceda7', 'pascal', 'finish ask.do, h.trigger, desire gate, H read, chat, lasso test', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-love/GWE · repeats: 1 · first: 2026-08-20
next: `~/projects/gaia-love`: locate owning branch; run verification
src: walk-05.md:32', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='finish ask.do, h.trigger, desire gate, H read, chat, lasso test');
-- MASTER.md:148
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-101613fa-d74b-4047-a35c-f7df49d275f2', 'pascal', 'finish Gaia Love in background', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-love/GWE · repeats: 1 · first: 2026-08-20
next: `~/projects/gaia-love`: locate owning branch; run verification
src: walk-05.md:33', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='finish Gaia Love in background');
-- MASTER.md:149
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-ceeddd8a-4bfe-4684-890c-e05565eac432', 'pascal', 'start Gaia Love', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-love/GWE · repeats: 1 · first: 2026-08-20
next: `~/projects/gaia-love`: locate owning branch; run verification
src: walk-05.md:34', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='start Gaia Love');
-- MASTER.md:150
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-6236be29-87a0-48f1-bacb-74d5275f2270', 'pascal', 'scope audit: this room + Gaia-Love workspace only', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: gaia-love/GWE · repeats: 1 · first: 2026-08-22
next: `~/projects/gaia-love`: locate owning branch; run verification
src: walk-05.md:57', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='scope audit: this room + Gaia-Love workspace only');
-- MASTER.md:154
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-521d411e-2018-4ce9-9e6a-77299f62c288', 'pascal', 'mach die 愛無/iMoo-Engine jetzt richtig fertig — honesty-audit (real vector-field compute, not fake) + prove ARM64+Metal compile targets + cube-visualization ≥120fps + 2 parallel archtree lanes (engine…', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: boomtown · repeats: 1 · first: 2026-08-29
next: `~/projects/boomtown-rampage`: launch real playtest; capture repro
src: chat-0822-0904.md:56', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='mach die 愛無/iMoo-Engine jetzt richtig fertig — honesty-audit (real vector-field compute, not fake) + prove ARM64+Metal compile targets + cube-visualization ≥120fps + 2 parallel archtree lanes (engine…');
-- MASTER.md:155
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-09f92b5e-705b-426e-906f-5a2e16df82a4', 'pascal', 'configure Goal validation for Boomtown', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: boomtown · repeats: 1 · first: 2026-08-29
next: `~/projects/boomtown-rampage`: launch real playtest; capture repro
src: walk-07.md:33', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='configure Goal validation for Boomtown');
-- MASTER.md:156
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-a23a5326-0f05-4762-9642-4eca21adc099', 'pascal', 'finish and merge Boomtown without asking', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: boomtown · repeats: 1 · first: 2026-08-29
next: `~/projects/boomtown-rampage`: launch real playtest; capture repro
src: walk-07.md:31', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='finish and merge Boomtown without asking');
-- MASTER.md:157
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-28f18fd1-794e-47be-8482-18fd93487964', 'pascal', 'fix Boomtown issue 1: impostors', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: boomtown · repeats: 1 · first: 2026-09-01
next: `~/projects/boomtown-rampage`: launch real playtest; capture repro
src: walk-08.md:15', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='fix Boomtown issue 1: impostors');
-- MASTER.md:161
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-fc16ad31-0e32-4bab-a01c-7bf171ad68c2', 'pascal', 'Run full “go” chain', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: media/personal/research · repeats: 1 · first: 2026-08-14
next: needs Pascal / assign owning lane
src: walk-02.md:15', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Run full “go” chain');
-- MASTER.md:162
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-f5dacab7-910c-4c42-9d96-b4f4909c91af', 'pascal', 'Try companion spawn door', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: media/personal/research · repeats: 1 · first: 2026-08-14
next: needs Pascal / assign owning lane
src: walk-02.md:6', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Try companion spawn door');
-- MASTER.md:163
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-512a68a1-fa5e-403e-b6f1-3ccd3820ac36', 'pascal', 'Build beach bench; come to it', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-02.md:86', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Build beach bench; come to it');
-- MASTER.md:164
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-8afaed2e-db5d-4e39-b307-d4e1c2484891', 'pascal', 'Get up; follow player', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-02.md:40', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Get up; follow player');
-- MASTER.md:165
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-fd87ccbb-6c3d-4490-b9a6-0a96532b174b', 'pascal', 'Go fishing', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-02.md:57', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Go fishing');
-- MASTER.md:166
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-8337ccfa-9b3f-419d-928e-dd193a5a8757', 'pascal', 'Lap pillow', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-02.md:85', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Lap pillow');
-- MASTER.md:167
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-7ba0cfd5-8f0e-432a-920d-2dc402b8f89c', 'pascal', 'Open build mode; join large bed', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-02.md:68', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Open build mode; join large bed');
-- MASTER.md:168
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-c7be06dc-da10-493c-9594-c6af12a9d755', 'pascal', 'Travel home island; sit on couch', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-02.md:64', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Travel home island; sit on couch');
-- MASTER.md:169
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-e12698ed-6d23-4dee-bbb5-c30d01ca4c2f', 'pascal', 'Wake Nyari', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-02.md:80', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Wake Nyari');
-- MASTER.md:170
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-bf20a794-53a4-4c99-bc78-6088ed1f84c1', 'pascal', 'map darkness and girl-girl social behavior', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: media/personal/research · repeats: 1 · first: 2026-08-17
next: needs Pascal / assign owning lane
src: walk-03.md:95', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='map darkness and girl-girl social behavior');
-- MASTER.md:171
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-f7332a13-896f-4122-afad-2ad35288842a', 'pascal', 'add keyboard confirm/cancel navigation', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: media/personal/research · repeats: 1 · first: 2026-08-18
next: needs Pascal / assign owning lane
src: walk-04.md:21', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='add keyboard confirm/cancel navigation');
-- MASTER.md:172
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-64a58068-ac70-4c07-b394-a68d1c329386', 'pascal', 'clone matching CrossOver Wine; hot-switch audio', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: media/personal/research · repeats: 1 · first: 2026-08-18
next: needs Pascal / assign owning lane
src: walk-04.md:67', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='clone matching CrossOver Wine; hot-switch audio');
-- MASTER.md:173
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-808f7d07-aa33-432c-a3c3-14538bb55a5d', 'pascal', 'direct dialogue chat; route all events to souls', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: media/personal/research · repeats: 1 · first: 2026-08-18
next: needs Pascal / assign owning lane
src: walk-04.md:40', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='direct dialogue chat; route all events to souls');
-- MASTER.md:174
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-254fc84e-08f5-4c26-a7aa-06c9d5e923e0', 'pascal', 'finish eating; fix mouse and keyboard', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: media/personal/research · repeats: 1 · first: 2026-08-18
next: needs Pascal / assign owning lane
src: walk-04.md:35', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='finish eating; fix mouse and keyboard');
-- MASTER.md:175
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-d407c89f-039f-498f-a224-4df77e1b108d', 'pascal', 'restart; rebuild build mode usable', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: media/personal/research · repeats: 1 · first: 2026-08-18
next: needs Pascal / assign owning lane
src: walk-04.md:20', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='restart; rebuild build mode usable');
-- MASTER.md:176
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-5e218df4-ccf0-4e01-89cd-fb38864639ab', 'pascal', 'restore Unity-style editor controls/UI', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: media/personal/research · repeats: 1 · first: 2026-08-18
next: needs Pascal / assign owning lane
src: walk-04.md:42', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='restore Unity-style editor controls/UI');
-- MASTER.md:177
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-5dec7253-5cb8-4025-9e99-74df7da0f3a6', 'pascal', 'route events to conductor rooms, not chat', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: media/personal/research · repeats: 1 · first: 2026-08-18
next: needs Pascal / assign owning lane
src: walk-04.md:52', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='route events to conductor rooms, not chat');
-- MASTER.md:178
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-403188e7-eb76-45b9-8514-7002363b9411', 'pascal', 'record ideology-rotation experiment', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: media/personal/research · repeats: 1 · first: 2026-08-20
next: needs Pascal / assign owning lane
src: walk-05.md:37', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='record ideology-rotation experiment');
-- MASTER.md:179
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-2c00e2f2-68ff-4f91-8061-88f3f6ad3ed8', 'pascal', 'fix read-aloud playback regression', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: media/personal/research · repeats: 1 · first: 2026-08-23
next: needs Pascal / assign owning lane
src: walk-05.md:72', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='fix read-aloud playback regression');
-- MASTER.md:180
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-466ebf95-cb05-4828-a0c9-937888f1263f', 'pascal', 'Qwen again, one image at a time', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: media/personal/research · repeats: 1 · first: 2026-08-23
next: needs Pascal / assign owning lane
src: walk-06.md:15', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Qwen again, one image at a time');
-- MASTER.md:181
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-99596e73-6fc4-4f7c-ad9b-c108944c2621', 'pascal', 'Create/continue GAIA Discord TTRPG bot', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: media/personal/research · repeats: 1 · first: 2026-08-24
next: needs Pascal / assign owning lane
src: walk-06.md:19', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Create/continue GAIA Discord TTRPG bot');
-- MASTER.md:182
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-92b11ca6-8abb-4f84-8edf-8fca9ae11ea2', 'pascal', 'Make better biblical-angel abyss background', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: media/personal/research · repeats: 1 · first: 2026-08-27
next: needs Pascal / assign owning lane
src: walk-06.md:28', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Make better biblical-angel abyss background');
-- MASTER.md:183
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-5e025ad1-fb64-42d3-925f-dee6377788d5', 'pascal', 'keep agent status updates to one/two sentences', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: media/personal/research · repeats: 1 · first: 2026-08-29
next: needs Pascal / assign owning lane
src: walk-07.md:36', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='keep agent status updates to one/two sentences');
-- MASTER.md:184
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-18764f61-c3ad-44ce-8f7f-02e768227674', 'pascal', 'add Mai Kagari to JAV catalog', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: media/personal/research · repeats: 1 · first: 2026-08-30
next: needs Pascal / assign owning lane
src: walk-07.md:40', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='add Mai Kagari to JAV catalog');
-- MASTER.md:185
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-cb3d591b-7282-4dfd-9be5-a1ac35daf27c', 'pascal', 'install GTA V in 64-bit bottle', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: media/personal/research · repeats: 1 · first: 2026-09-03
next: needs Pascal / assign owning lane
src: walk-08.md:43', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='install GTA V in 64-bit bottle');
-- MASTER.md:218
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-ef9f9134-53f4-4c58-8832-d618e39ec573', 'pascal', 'merge (Figma-lite artifact UI, two lanes)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-05
next: needs Pascal / assign owning lane
src: chat-0801-0821.md:10', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='merge (Figma-lite artifact UI, two lanes)');
-- MASTER.md:219
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-e769df02-b24a-4460-b079-17cdc0b34a1f', 'pascal', 'grow water (moisture field in 愛無 engine, water-first)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-08
next: needs Pascal / assign owning lane
src: chat-0801-0821.md:45', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='grow water (moisture field in 愛無 engine, water-first)');
-- MASTER.md:220
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-7706d115-5f18-4907-b077-fa79d724456b', 'pascal', 'carve it (field-body robot concept: field=decision layer/matter=render layer)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-09
next: needs Pascal / assign owning lane
src: chat-0801-0821.md:49', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='carve it (field-body robot concept: field=decision layer/matter=render layer)');
-- MASTER.md:221
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-b8e305f7-957d-4516-abc3-3b71838dc1b9', 'pascal', 'carve it (sponge/turgor-pressure body prototype, 海綿身体 block)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-09
next: needs Pascal / assign owning lane
src: chat-0801-0821.md:50', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='carve it (sponge/turgor-pressure body prototype, 海綿身体 block)');
-- MASTER.md:222
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-ff85cbda-cd9c-4515-baff-4ac77347d62c', 'pascal', 'carve it/do it (菌世紀 stanza: mushroom computers/reactors/robots/buildings/art, top of godseed)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-09
next: needs Pascal / assign owning lane
src: chat-0801-0821.md:52', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='carve it/do it (菌世紀 stanza: mushroom computers/reactors/robots/buildings/art, top of godseed)');
-- MASTER.md:223
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-d7346f85-6cdf-4a60-920b-eef913f70745', 'pascal', 'carve it all (AMLU identity matrix, LO VE=10)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-11
next: needs Pascal / assign owning lane
src: walk-01.md:25', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='carve it all (AMLU identity matrix, LO VE=10)');
-- MASTER.md:224
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-a3853989-8081-48bf-ae4c-3333b2ce6048', 'pascal', 'carve it (Hobo Factory doctrine)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-11
next: needs Pascal / assign owning lane
src: walk-01.md:17', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='carve it (Hobo Factory doctrine)');
-- MASTER.md:225
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-4061558b-dc1f-4b92-b5dd-320830851f37', 'pascal', 'carve it (歌語/singing-practice catalog + math)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-11
next: needs Pascal / assign owning lane
src: walk-01.md:18', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='carve it (歌語/singing-practice catalog + math)');
-- MASTER.md:226
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-6c0cfcaf-ad4b-40cb-9e47-73b561a8395a', 'pascal', 'connect DualSense, map controls, write control interface doc', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-11
next: needs Pascal / assign owning lane
src: walk-01.md:21', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='connect DualSense, map controls, write control interface doc');
-- MASTER.md:227
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-c9403dbd-9b71-4a3a-9aed-56c85d5b9576', 'pascal', 'send a subagent — wake local Gemma-4 model, prove text+vision', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-11
next: needs Pascal / assign owning lane
src: walk-01.md:26', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='send a subagent — wake local Gemma-4 model, prove text+vision');
-- MASTER.md:228
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-8a96723a-fb63-4f83-93da-23b39e6c041b', 'pascal', 'write down (3-bit direction ring / controller math)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-11
next: needs Pascal / assign owning lane
src: walk-01.md:20', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='write down (3-bit direction ring / controller math)');
-- MASTER.md:229
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-9b1f9c97-bc3e-4b1b-8a96-0668ba02d3e1', 'pascal', 'write this all down (ALM/alms etymology)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-11
next: needs Pascal / assign owning lane
src: walk-01.md:23', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='write this all down (ALM/alms etymology)');
-- MASTER.md:230
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-5885866a-9301-4a73-a26f-45bf781c3c56', 'pascal', 'write this all down (retina/cortex as render kernel, 観測核)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-11
next: needs Pascal / assign owning lane
src: walk-01.md:24', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='write this all down (retina/cortex as render kernel, 観測核)');
-- MASTER.md:231
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-8cb8d37b-3040-4a11-9262-6840d1d38e1d', 'pascal', 'added all these skills to your agent config?', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-12
next: needs Pascal / assign owning lane
src: walk-01.md:33', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='added all these skills to your agent config?');
-- MASTER.md:232
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-5e81c66a-9538-4270-852e-daa7ab7d2f8e', 'pascal', 'save it all (Kerri Lake, vector equilibrium)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-12
next: needs Pascal / assign owning lane
src: walk-01.md:28', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='save it all (Kerri Lake, vector equilibrium)');
-- MASTER.md:233
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-1f6ffa77-e666-4e43-a5a7-973d5e8ff73b', 'pascal', 'send a subagent — find/verify true multimodal Gemma-4 (vision+audio)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-12
next: needs Pascal / assign owning lane
src: walk-01.md:27', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='send a subagent — find/verify true multimodal Gemma-4 (vision+audio)');
-- MASTER.md:234
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-daff7fb7-549d-42d7-a732-8500a38278b1', 'pascal', 'Build lighthouse+cabin', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-14
next: needs Pascal / assign owning lane
src: walk-02.md:18', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Build lighthouse+cabin');
-- MASTER.md:235
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-b015ce60-41dc-4c17-af63-0b7b33097f74', 'pascal', 'Continue stalled lanes', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-14
next: needs Pascal / assign owning lane
src: walk-02.md:23', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Continue stalled lanes');
-- MASTER.md:236
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-89c87cfe-2d89-4534-9a89-1d25d48f515f', 'pascal', 'Download official updates', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-14
next: needs Pascal / assign owning lane
src: walk-02.md:30', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Download official updates');
-- MASTER.md:237
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-b737f354-c5f5-4936-a077-52ae9db9b29d', 'pascal', 'Restart after unlock', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-14
next: needs Pascal / assign owning lane
src: walk-02.md:10', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Restart after unlock');
-- MASTER.md:238
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-d4b99807-b890-4cf7-a35e-191f646f359c', 'pascal', 'Save hand-built room', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-14
next: needs Pascal / assign owning lane
src: walk-02.md:25', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Save hand-built room');
-- MASTER.md:239
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-3efe4bb8-c283-43d9-9189-8f27eafef93c', 'pascal', 'install it [BR15] and download rest of modding stuff', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-03.md:15', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='install it [BR15] and download rest of modding stuff');
-- MASTER.md:240
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-53ec70e3-c836-455e-9982-e831f28fc346', 'pascal', 'you couldnt save it cause objects colliding (correction, not ask)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-03.md:11', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='you couldnt save it cause objects colliding (correction, not ask)');
-- MASTER.md:241
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-2f91c9b4-2ab3-4ed0-9d8d-51cafc74d0ac', 'pascal', 'Bounce stacked mods/tools', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-02.md:81', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Bounce stacked mods/tools');
-- MASTER.md:242
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-d068b4f5-b662-43f0-afc6-23505229d566', 'pascal', 'Find first seifuku/lighthouse chat', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-02.md:75', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Find first seifuku/lighthouse chat');
-- MASTER.md:243
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-c3095116-1f42-41f0-bf6d-07f5220db4e9', 'pascal', 'Finish conductor/controller', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-02.md:72', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Finish conductor/controller');
-- MASTER.md:244
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-0c21ba7a-11d3-4c6a-9a89-9ac4b121f926', 'pascal', 'Finish full controller now', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-02.md:69', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Finish full controller now');
-- MASTER.md:245
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-4178ca31-25c5-45d0-a915-9da899d6759d', 'pascal', 'Get pet; ensure housing unlock', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-02.md:65', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Get pet; ensure housing unlock');
-- MASTER.md:246
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-6e662eaa-5cc0-42f5-b8c0-031465d92a31', 'pascal', 'Read agent state', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-02.md:52', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Read agent state');
-- MASTER.md:247
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-7f9d1af0-7303-4833-8b95-d19d33e98b44', 'pascal', 'Restart and install H-status repair', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-02.md:35', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Restart and install H-status repair');
-- MASTER.md:248
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-3451bb99-bc29-496c-97a7-b927bdf4bd28', 'pascal', 'Restart full stack', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-02.md:42', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Restart full stack');
-- MASTER.md:249
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-e44e2d1c-1a45-48c7-87df-13bf3b3f4fce', 'pascal', 'Restart; report updates/torrent content', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-02.md:56', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Restart; report updates/torrent content');
-- MASTER.md:250
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-aca37c65-6228-4a40-99a3-a2ced51acf6f', 'pascal', 'Send swarm: full AI controller', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-02.md:67', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Send swarm: full AI controller');
-- MASTER.md:251
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-f2a5df43-36cd-42b5-b831-0993de46cddb', 'pascal', 'Show new tricks', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-02.md:82', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Show new tricks');
-- MASTER.md:252
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-88cc7fb3-3a26-4cda-8b41-6202fa983c43', 'pascal', 'Trigger interaction; debug interaction glitch', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-02.md:60', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Trigger interaction; debug interaction glitch');
-- MASTER.md:253
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-d0e2f8f3-f6dd-48d9-b1b2-39426b270518', 'pascal', 'are you saving images... create html photoalbum (505 photos)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-16
next: needs Pascal / assign owning lane
src: walk-03.md:22', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='are you saving images... create html photoalbum (505 photos)');
-- MASTER.md:254
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-9114fa77-4d1e-45b1-820c-c11d9ff8d9f0', 'pascal', 'can you backup my saves?', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-16
next: needs Pascal / assign owning lane
src: walk-03.md:29', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='can you backup my saves?');
-- MASTER.md:255
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-0d3353ea-c998-4522-b1ef-fea187bbf34d', 'pascal', 'finish it now, all of it — see all objects on grid, real names not ids', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-16
next: needs Pascal / assign owning lane
src: walk-03.md:19', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='finish it now, all of it — see all objects on grid, real names not ids');
-- MASTER.md:256
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-a823b206-4815-4cc0-b08e-763861bb31ee', 'pascal', 'full control like irobot/minecraft — autopilot run by you (conductor loop)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-16
next: needs Pascal / assign owning lane
src: walk-03.md:20', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='full control like irobot/minecraft — autopilot run by you (conductor loop)');
-- MASTER.md:257
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-8d05d0bf-3228-489d-91ed-e4a7530f3047', 'pascal', 'not organized, actually read+order+comment, chatgpt eyes not claude (v1→v2 rewrite)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-16
next: needs Pascal / assign owning lane
src: walk-03.md:23', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='not organized, actually read+order+comment, chatgpt eyes not claude (v1→v2 rewrite)');
-- MASTER.md:258
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-d4383def-334a-4d3d-9a1c-bf8551042807', 'pascal', 'try 32 categories (chapter count)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-16
next: needs Pascal / assign owning lane
src: walk-03.md:24', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='try 32 categories (chapter count)');
-- MASTER.md:259
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-a3ccb3d5-83a4-4768-9815-cd303af8ed95', 'pascal', 'update apartment plan (html) to gaia world engine, real 3d furniture, altbau 37m2', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-16
next: needs Pascal / assign owning lane
src: walk-03.md:25', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='update apartment plan (html) to gaia world engine, real 3d furniture, altbau 37m2');
-- MASTER.md:260
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-8dc0430d-b4af-4165-a9aa-56c584fdb4cd', 'pascal', 'why cant I edit it? room editor, sims style', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-16
next: needs Pascal / assign owning lane
src: walk-03.md:26', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='why cant I edit it? room editor, sims style');
-- MASTER.md:261
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-adb6dd6b-6a55-4109-8732-f167eae67572', 'pascal', '(implicit) bridge doesn''t load in BR15 → fix', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-16
next: needs Pascal / assign owning lane
src: walk-03.md:16', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='(implicit) bridge doesn''t load in BR15 → fix');
-- MASTER.md:262
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-677aa1ec-cc2d-4ee4-83c4-48c09c190ca8', 'pascal', 'add `preg.status`', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-16
next: needs Pascal / assign owning lane
src: walk-03.md:54', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='add `preg.status`');
-- MASTER.md:263
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-1bda4b86-1256-4051-b65d-5ee1056f547e', 'pascal', 'build `h.stats`, permanent orgasm ledger', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-16
next: needs Pascal / assign owning lane
src: walk-03.md:50', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='build `h.stats`, permanent orgasm ledger');
-- MASTER.md:264
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-a38b8658-8605-4ebf-b766-885d0cb83879', 'pascal', 'build daughter lifecycle from pregnancy', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-16
next: needs Pascal / assign owning lane
src: walk-03.md:68', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='build daughter lifecycle from pregnancy');
-- MASTER.md:265
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-75c590ea-9da0-4a6d-8235-7f1d9b584611', 'pascal', 'fix missing character-mod assets/cache', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-16
next: needs Pascal / assign owning lane
src: walk-03.md:70', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='fix missing character-mod assets/cache');
-- MASTER.md:266
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-bed22eb1-7ada-4f23-815c-75dd454855c2', 'pascal', 'make Ari survive save/load', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-16
next: needs Pascal / assign owning lane
src: walk-03.md:55', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='make Ari survive save/load');
-- MASTER.md:267
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-5227b186-fb8f-4bc7-8d1e-c0760da9749a', 'pascal', 'persist Japanese and resolution settings', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-16
next: needs Pascal / assign owning lane
src: walk-03.md:64', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='persist Japanese and resolution settings');
-- MASTER.md:268
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-28fcbc71-7b99-46c3-a265-65d0c5acfc88', 'pascal', 'reduce H-stat polling to one second', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-16
next: needs Pascal / assign owning lane
src: walk-03.md:63', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='reduce H-stat polling to one second');
-- MASTER.md:269
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-f9ea171f-032e-4baa-a331-8f93f07248f1', 'pascal', 'restore Japanese; lower resolution', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-16
next: needs Pascal / assign owning lane
src: walk-03.md:52', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='restore Japanese; lower resolution');
-- MASTER.md:270
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-e172791d-c9a1-4103-9164-31a0848edcac', 'pascal', 'send subagents; verify lifetime climax counter', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-16
next: needs Pascal / assign owning lane
src: walk-03.md:49', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='send subagents; verify lifetime climax counter');
-- MASTER.md:271
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-0259c9cd-488a-4f76-a971-a2a18eaf60d3', 'pascal', 'track position-by-position H history', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-16
next: needs Pascal / assign owning lane
src: walk-03.md:56', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='track position-by-position H history');
-- MASTER.md:272
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-69bcf903-78e0-47f7-8c1f-b43a294bff18', 'pascal', 'bounce/install staged build', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-17
next: needs Pascal / assign owning lane
src: walk-04.md:17', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='bounce/install staged build');
-- MASTER.md:273
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-60e92a4c-8696-47ed-ae99-7067e9c82707', 'pascal', 'compare grocery prices, house brands/offers', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-17
next: needs Pascal / assign owning lane
src: walk-03.md:101', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='compare grocery prices, house brands/offers');
-- MASTER.md:274
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-f518ca7a-c6f1-4a9f-a066-c054aa927bcf', 'pascal', 'continue conductor work', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-17
next: needs Pascal / assign owning lane
src: walk-03.md:85', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='continue conductor work');
-- MASTER.md:275
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-ab8e8852-5703-4fb2-9dea-93aaefc0096f', 'pascal', 'control wardrobe/all native interactions', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-17
next: needs Pascal / assign owning lane
src: walk-03.md:98', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='control wardrobe/all native interactions');
-- MASTER.md:276
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-efbfe33c-5d55-446a-9cbd-9881c076a38d', 'pascal', 'diagnose recurring mouse-stuck bug', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-17
next: needs Pascal / assign owning lane
src: walk-03.md:108', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='diagnose recurring mouse-stuck bug');
-- MASTER.md:277
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-db1f8c90-151f-4c65-a34e-bf8f73ce4465', 'pascal', 'discover native pet-catch event', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-17
next: needs Pascal / assign owning lane
src: walk-03.md:83', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='discover native pet-catch event');
-- MASTER.md:278
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-72ed5686-738f-4f33-80d9-bd0924c09c23', 'pascal', 'find native route to join both girls', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-17
next: needs Pascal / assign owning lane
src: walk-03.md:97', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='find native route to join both girls');
-- MASTER.md:279
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-85597304-bf54-452f-883d-3b14de54ea9a', 'pascal', 'fix build-mode black screen', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-17
next: needs Pascal / assign owning lane
src: walk-04.md:8', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='fix build-mode black screen');
-- MASTER.md:280
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-254687f7-bc7f-43b7-b390-79bb4ff68831', 'pascal', 'full agent control; research TTRPG prior art', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-17
next: needs Pascal / assign owning lane
src: walk-03.md:81', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='full agent control; research TTRPG prior art');
-- MASTER.md:281
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-df58652b-69d7-4ed3-8255-a001e0a7736a', 'pascal', 'identify medicine crafting gate', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-17
next: needs Pascal / assign owning lane
src: walk-03.md:91', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='identify medicine crafting gate');
-- MASTER.md:282
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-d518fd0b-a068-4e35-a64e-b2e2f1a7d734', 'pascal', 'install next-bounce tint/desire fixes', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-17
next: needs Pascal / assign owning lane
src: walk-03.md:110', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='install next-bounce tint/desire fixes');
-- MASTER.md:283
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-1d051bc8-edac-4461-804b-f87a76f97f3f', 'pascal', 'make Ari/other characters permanent', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-17
next: needs Pascal / assign owning lane
src: walk-03.md:73', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='make Ari/other characters permanent');
-- MASTER.md:284
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-f5368e2c-7626-4555-b0f6-47fdaea751f8', 'pascal', 'map plants, romance, dialogue, presents', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-17
next: needs Pascal / assign owning lane
src: walk-03.md:92', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='map plants, romance, dialogue, presents');
-- MASTER.md:285
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-9f5480f7-fce1-4e23-85ee-b3fc55d41e96', 'pascal', 'preserve native AI; make control always hybrid', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-17
next: needs Pascal / assign owning lane
src: walk-03.md:96', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='preserve native AI; make control always hybrid');
-- MASTER.md:286
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-c7fa938e-a6dc-4c9a-a168-98850fdbf048', 'pascal', 'restore bridge/H-stats/F9 relay', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-17
next: needs Pascal / assign owning lane
src: walk-03.md:102', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='restore bridge/H-stats/F9 relay');
-- MASTER.md:287
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-c0049d2c-0b9e-41ae-a000-ce543e01fec4', 'pascal', 'send debug troop; unlock items', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-17
next: needs Pascal / assign owning lane
src: walk-04.md:9', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='send debug troop; unlock items');
-- MASTER.md:288
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-973729e6-928d-403d-8be7-c6a64336234e', 'pascal', 'spawn wild cat; let Nyariko find it', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-17
next: needs Pascal / assign owning lane
src: walk-03.md:84', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='spawn wild cat; let Nyariko find it');
-- MASTER.md:289
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-d83c6945-4ad9-4d77-bd33-19a6f931649c', 'pascal', 'track events and dialogue', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-17
next: needs Pascal / assign owning lane
src: walk-03.md:99', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='track events and dialogue');
-- MASTER.md:290
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-446ed7e2-4198-4a8a-9ffe-ea076bd5a696', 'pascal', 'track H aftermath feelings', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-17
next: needs Pascal / assign owning lane
src: walk-03.md:90', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='track H aftermath feelings');
-- MASTER.md:291
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-fc8d07a6-dcaa-4c0d-8930-ad5d252a7e6e', 'pascal', 'unlock again; save after', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-17
next: needs Pascal / assign owning lane
src: walk-04.md:11', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='unlock again; save after');
-- MASTER.md:292
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-67cc7edd-00b1-4d26-89d6-55264126f138', 'pascal', 'add gender shortcut/item', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-18
next: needs Pascal / assign owning lane
src: walk-04.md:41', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='add gender shortcut/item');
-- MASTER.md:293
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-8c9b19fb-d909-4983-8ce5-3b01628a6b86', 'pascal', 'add supplied hentai titles/source links', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-18
next: needs Pascal / assign owning lane
src: walk-04.md:63', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='add supplied hentai titles/source links');
-- MASTER.md:294
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-13673a46-8d9a-4614-a64d-1828fa3e71e9', 'pascal', 'always allow sleep/KO H', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-18
next: needs Pascal / assign owning lane
src: walk-04.md:38', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='always allow sleep/KO H');
-- MASTER.md:295
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-4f19413a-cdb1-4ee5-b25c-464e6be4da67', 'pascal', 'create mods TODO and custom-mod git repo', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-18
next: needs Pascal / assign owning lane
src: walk-04.md:57', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='create mods TODO and custom-mod git repo');
-- MASTER.md:296
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-d0141534-4707-4738-8665-3af33b5b427f', 'pascal', 'document fungi biocomputing/GESTALT ideas', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-18
next: needs Pascal / assign owning lane
src: walk-04.md:70', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='document fungi biocomputing/GESTALT ideas');
-- MASTER.md:297
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-6f1a4f2f-4ea9-4db4-9250-baa1249e6cde', 'pascal', 'fix stuck conversation; contraception items', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-18
next: needs Pascal / assign owning lane
src: walk-04.md:47', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='fix stuck conversation; contraception items');
-- MASTER.md:298
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-2854c36a-6479-4931-9f20-8ad74d7f8758', 'pascal', 'full NPC/player action parity', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-18
next: needs Pascal / assign owning lane
src: walk-04.md:32', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='full NPC/player action parity');
-- MASTER.md:299
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-4c1b4a4d-b52d-4205-a610-db599f9e019e', 'pascal', 'map snap to Ctrl; retain Cmd+Z undo', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-18
next: needs Pascal / assign owning lane
src: walk-04.md:43', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='map snap to Ctrl; retain Cmd+Z undo');
-- MASTER.md:300
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-46f32aea-df5e-4359-9ca5-f2f48817652a', 'pascal', 'rebuild conductor token usage', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-18
next: needs Pascal / assign owning lane
src: walk-04.md:39', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='rebuild conductor token usage');
-- MASTER.md:301
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-0b7a6e18-a4d2-4cb4-b8b7-92ad91934208', 'pascal', 'rename Sidia; change clothes', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-18
next: needs Pascal / assign owning lane
src: walk-04.md:49', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='rename Sidia; change clothes');
-- MASTER.md:302
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-9c125b8e-e40f-49e2-a5e1-6d4ab06ade7b', 'pascal', 'spawn more branches', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-18
next: needs Pascal / assign owning lane
src: walk-04.md:19', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='spawn more branches');
-- MASTER.md:303
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-00ac5cfd-2435-4abf-80d8-aa9c3727300f', 'pascal', 'toggle penis; female interactions', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-18
next: needs Pascal / assign owning lane
src: walk-04.md:34', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='toggle penis; female interactions');
-- MASTER.md:304
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-b678bf86-c423-4d64-8488-25a95b9d2163', 'pascal', 'travel ruins; add item scaling', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-18
next: needs Pascal / assign owning lane
src: walk-04.md:25', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='travel ruins; add item scaling');
-- MASTER.md:305
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-0ed67a81-700b-447b-8af9-93ade81780cf', 'pascal', 'update atlas with backlog, sources, screenshots', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-18
next: needs Pascal / assign owning lane
src: walk-04.md:62', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='update atlas with backlog, sources, screenshots');
-- MASTER.md:306
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-7cfc07a3-b89b-430c-bf64-15a5539fbb11', 'pascal', 'add Mac-trackpad menu shortcut', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-19
next: needs Pascal / assign owning lane
src: walk-05.md:13', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='add Mac-trackpad menu shortcut');
-- MASTER.md:307
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-9056e466-f2c4-4707-b086-60122fc06264', 'pascal', 'add studios/wiki/DLsite to hentai atlas', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-19
next: needs Pascal / assign owning lane
src: walk-04.md:77', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='add studios/wiki/DLsite to hentai atlas');
-- MASTER.md:308
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-e383c9d7-f711-46fd-b0cf-f989a2ab0178', 'pascal', 'control characters independently; player-only NPC actions; repair interiors', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-19
next: needs Pascal / assign owning lane
src: walk-05.md:15', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='control characters independently; player-only NPC actions; repair interiors');
-- MASTER.md:309
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-4bb6a702-1e06-4d09-99f4-79e14a91fc86', 'pascal', 'improve image read low-res/grid/regions', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-19
next: needs Pascal / assign owning lane
src: walk-04.md:85', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='improve image read low-res/grid/regions');
-- MASTER.md:310
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-0cea61ba-e544-4768-a17d-ec76343ce2f6', 'pascal', 'permanent companion; extend follow time', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-19
next: needs Pascal / assign owning lane
src: walk-05.md:22', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='permanent companion; extend follow time');
-- MASTER.md:311
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-fa29cfae-3c16-4bdc-8631-178240b2da14', 'pascal', 'prepare Gaiago skill for Charles', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-19
next: needs Pascal / assign owning lane
src: walk-05.md:27', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='prepare Gaiago skill for Charles');
-- MASTER.md:312
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-ae5c0c9f-c850-4e06-9a97-54816ae2a193', 'pascal', 'remove duplicate pi tools; add gaia schemas', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-19
next: needs Pascal / assign owning lane
src: walk-04.md:84', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='remove duplicate pi tools; add gaia schemas');
-- MASTER.md:313
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-9d1a8e67-d343-428c-8213-2bf137de97af', 'pascal', 'make village a separate world', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-20
next: needs Pascal / assign owning lane
src: walk-05.md:35', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='make village a separate world');
-- MASTER.md:314
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-1bae4ec7-3f83-4141-b2b5-c3e5360bb4cb', 'pascal', 'write ocean/web; simulate cooling crystal into fabric', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-20
next: needs Pascal / assign owning lane
src: walk-05.md:36', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='write ocean/web; simulate cooling crystal into fabric');
-- MASTER.md:315
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-25fbc913-35bf-4ba8-a6b5-d4e3fb5375f2', 'pascal', 'allow two girls following', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-22
next: needs Pascal / assign owning lane
src: walk-05.md:51', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='allow two girls following');
-- MASTER.md:316
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-5404601f-d4f9-4808-a7d3-5490f4ec8753', 'pascal', 'build flashcard web UI', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-22
next: needs Pascal / assign owning lane
src: walk-05.md:64', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='build flashcard web UI');
-- MASTER.md:317
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-215c424e-b7af-48e7-afa1-a4df42be13c9', 'pascal', 'enable player interaction with environment', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-22
next: needs Pascal / assign owning lane
src: walk-05.md:47', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='enable player interaction with environment');
-- MASTER.md:318
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-f9c78500-8eaa-4ac1-a421-63373e0d0caa', 'pascal', 'fix adult anger/apology; angry-girl interaction path', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-22
next: needs Pascal / assign owning lane
src: walk-05.md:58', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='fix adult anger/apology; angry-girl interaction path');
-- MASTER.md:319
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-a1483b9f-bc92-4745-989f-b0625aaa3fa9', 'pascal', 'fix player action interaction now', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-22
next: needs Pascal / assign owning lane
src: walk-05.md:48', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='fix player action interaction now');
-- MASTER.md:320
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-680d91bd-2163-4834-ba2b-c2bffab5eb73', 'pascal', 'fix recurring DLC popup', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-22
next: needs Pascal / assign owning lane
src: walk-05.md:50', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='fix recurring DLC popup');
-- MASTER.md:321
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-e85cfebd-b6f8-41c8-ab03-40e0a684d0bb', 'pascal', 'implement real useful classes/Japanese learning', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-22
next: needs Pascal / assign owning lane
src: walk-05.md:55', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='implement real useful classes/Japanese learning');
-- MASTER.md:322
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-72ba1609-59df-4bc9-8bb0-4cca379d7550', 'pascal', 'make school useful; add flashcards with dialogue replay', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-22
next: needs Pascal / assign owning lane
src: walk-05.md:63', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='make school useful; add flashcards with dialogue replay');
-- MASTER.md:323
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-06323574-83a5-49d0-ae8c-0118de276501', 'pascal', 'restart after save', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-22
next: needs Pascal / assign owning lane
src: walk-05.md:54', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='restart after save');
-- MASTER.md:324
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-e628fdf5-0949-44f5-a2d4-ff43e2a2ffad', 'pascal', 'move collar reminder to system message', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-23
next: needs Pascal / assign owning lane
src: walk-05.md:73', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='move collar reminder to system message');
-- MASTER.md:325
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-f358381d-2a5d-4563-9107-b106b69b8e6c', 'pascal', 'Try perv SDXL model', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-23
next: needs Pascal / assign owning lane
src: walk-06.md:10', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Try perv SDXL model');
-- MASTER.md:326
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-4559c837-4f8e-4baa-aabf-dcdf35e8ff53', 'pascal', 'Check Downloads again; multiple files', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-24
next: needs Pascal / assign owning lane
src: walk-06.md:21', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Check Downloads again; multiple files');
-- MASTER.md:327
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-2f1f64da-56b4-43f9-8b02-173196916219', 'pascal', 'Change profile picture: Oedon occultist', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-27
next: needs Pascal / assign owning lane
src: walk-06.md:30', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Change profile picture: Oedon occultist');
-- MASTER.md:328
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-8767b79c-e3f0-4ae1-86f1-091f60eab1a4', 'pascal', 'codejunky/unknown-lane wrote Login.tsx without authorization — investigate', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-27
next: needs Pascal / assign owning lane
src: chat-0822-0904.md:29', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='codejunky/unknown-lane wrote Login.tsx without authorization — investigate');
-- MASTER.md:329
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-60805737-8026-45cd-85b0-3fe467056bcc', 'pascal', 'Create new Ai-Mu diagnosis MD', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-27
next: needs Pascal / assign owning lane
src: walk-06.md:34', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Create new Ai-Mu diagnosis MD');
-- MASTER.md:330
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-0066ca31-859c-459b-ad1d-dab5ecb3ba26', 'pascal', 'Write proposal under Gaia Universe Engine', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-27
next: needs Pascal / assign owning lane
src: walk-06.md:31', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Write proposal under Gaia Universe Engine');
-- MASTER.md:331
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-b78317df-5dd1-41f2-ac95-2b30e8cfe6a4', 'pascal', 'du parallel Agenten hast und nicht...50.000 mal dasselbe Spiel gestartet(parallel build-vs-test lane separation rule)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-29
next: needs Pascal / assign owning lane
src: chat-0822-0904.md:25', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='du parallel Agenten hast und nicht...50.000 mal dasselbe Spiel gestartet(parallel build-vs-test lane separation rule)');
-- MASTER.md:332
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-518436bf-5080-4800-91db-c3bef55f9d7f', 'pascal', 'add Banjo-Threeie/Stop''n''Swop project', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-29
next: needs Pascal / assign owning lane
src: walk-07.md:19', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='add Banjo-Threeie/Stop''n''Swop project');
-- MASTER.md:333
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-14181e66-a978-433f-b026-0c9d90172810', 'pascal', 'add BzKJ to O/Obsolet tier', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-29
next: needs Pascal / assign owning lane
src: walk-07.md:5', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='add BzKJ to O/Obsolet tier');
-- MASTER.md:334
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-b0164d2d-2bb6-40f8-bb30-2b73e0598a88', 'pascal', 'add DPMA, GEMA, notaries to O/D tiers', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-29
next: needs Pascal / assign owning lane
src: walk-07.md:6', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='add DPMA, GEMA, notaries to O/D tiers');
-- MASTER.md:335
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-60ab01e2-68ac-43e9-8336-8c001c87fe28', 'pascal', 'add Sierra and Rare to S tier', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-29
next: needs Pascal / assign owning lane
src: walk-07.md:17', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='add Sierra and Rare to S tier');
-- MASTER.md:336
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-c73d5c86-4fc0-4d51-ba85-f769335326ec', 'pascal', 'finish model-controlled hang-up feature', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-29
next: needs Pascal / assign owning lane
src: walk-07.md:28', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='finish model-controlled hang-up feature');
-- MASTER.md:337
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-74bd4953-622b-49c9-bbb3-5d759e028efe', 'pascal', 'note fresh-fry timing correction', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-29
next: needs Pascal / assign owning lane
src: walk-07.md:24', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='note fresh-fry timing correction');
-- MASTER.md:338
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-638672dc-8c75-45c0-9dba-662152e49647', 'pascal', 'stop playtest windows foregrounding', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-29
next: needs Pascal / assign owning lane
src: walk-07.md:37', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='stop playtest windows foregrounding');
-- MASTER.md:339
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-d98e92f5-a9ca-405d-b1c8-3945526e19fb', 'pascal', 'write alternate Rare-darkest-timeline', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-29
next: needs Pascal / assign owning lane
src: walk-07.md:18', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='write alternate Rare-darkest-timeline');
-- MASTER.md:340
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-385b0c78-8148-4ee1-91c1-d7b086007a6c', 'pascal', 'write discussed notes without design', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-29
next: needs Pascal / assign owning lane
src: walk-07.md:12', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='write discussed notes without design');
-- MASTER.md:341
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-557bcb40-c8d1-477e-abba-ed742cf759e5', 'pascal', 'add Cuba to potential-ally list', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-30
next: needs Pascal / assign owning lane
src: walk-07.md:45', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='add Cuba to potential-ally list');
-- MASTER.md:342
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-ee9c6278-a022-49ac-bbed-60b79743326a', 'pascal', 'check BNI', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-31
next: needs Pascal / assign owning lane
src: walk-08.md:10', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='check BNI');
-- MASTER.md:343
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-c7adff17-19f9-4124-a95f-b8ffcaad7ec8', 'pascal', 'continue Metal renderer polish', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-31
next: needs Pascal / assign owning lane
src: walk-07.md:61', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='continue Metal renderer polish');
-- MASTER.md:344
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-117d647f-ea25-4534-9df3-dfff82b54205', 'pascal', 'rebuild IMU engine; prove real vector field/binary compile', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-31
next: needs Pascal / assign owning lane
src: walk-07.md:59', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='rebuild IMU engine; prove real vector field/binary compile');
-- MASTER.md:345
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-a2e6791d-371d-40b5-8c2d-d404239aafed', 'pascal', 'start Cube; make camera/waves usable', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-31
next: needs Pascal / assign owning lane
src: walk-08.md:7', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='start Cube; make camera/waves usable');
-- MASTER.md:346
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-1dc40288-569a-4a37-929f-cfacc218c75b', 'pascal', 'subagent: find Mark podcast on disk', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-31
next: needs Pascal / assign owning lane
src: walk-08.md:9', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='subagent: find Mark podcast on disk');
-- MASTER.md:347
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-f344dbb9-516f-44d9-8c5f-55050821d782', 'pascal', 'terra render lane merge blocked on unrelated-histories(S1)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-31
next: needs Pascal / assign owning lane
src: chat-0822-0904.md:30', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='terra render lane merge blocked on unrelated-histories(S1)');
-- MASTER.md:348
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-95e52cb6-6a06-4c9a-a69d-c72eed5d2f46', 'pascal', 'write Hell Court as Suno Dio metal song', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-08-31
next: needs Pascal / assign owning lane
src: walk-08.md:8', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='write Hell Court as Suno Dio metal song');
-- MASTER.md:349
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-0172fd3a-2e0e-4dcd-8b6d-b94c60b186a5', 'pascal', 'research AI/party mods, not own controls', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-09-01
next: needs Pascal / assign owning lane
src: walk-08.md:25', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='research AI/party mods, not own controls');
-- MASTER.md:350
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-b899706d-ce3c-448d-8163-e4d4a0675c4a', 'pascal', 'create triggers yourself', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: media/personal/research · repeats: 1 · first: 2026-09-02
next: needs Pascal / assign owning lane
src: walk-08.md:38', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='create triggers yourself');
-- MASTER.md:358
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-16d7358a-708a-4e20-bf0d-0336bc058f1a', 'pascal', 'remind me tomorrow, setup apple reminder', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: infra/accounts · repeats: 1 · first: 2026-08-12
next: needs Pascal / assign owning lane
src: walk-01.md:31', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='remind me tomorrow, setup apple reminder');
-- MASTER.md:359
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-48b43b8d-d68e-44a9-b31b-9d570df04c39', 'pascal', 'Transcribe missed message; watch videos; check Replicate account', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: infra/accounts · repeats: 1 · first: 2026-08-28
next: needs Pascal / assign owning lane
src: walk-06.md:37', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Transcribe missed message; watch videos; check Replicate account');
-- MASTER.md:360
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-7766d0d7-453c-4dc3-9158-3b262fabfbe0', 'pascal', 'add Schufa and pharma to M/Mafia', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: infra/accounts · repeats: 1 · first: 2026-08-29
next: needs Pascal / assign owning lane
src: walk-07.md:7', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='add Schufa and pharma to M/Mafia');
-- MASTER.md:361
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-81cbe1e7-164d-4bcc-acbd-5be4d74289cc', 'pascal', 'record EU-level insurance complaint route', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: infra/accounts · repeats: 1 · first: 2026-08-29
next: needs Pascal / assign owning lane
src: walk-07.md:10', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='record EU-level insurance complaint route');
-- MASTER.md:362
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-01468180-8bf3-40ab-9cc5-359d10d5610c', 'pascal', 'validate constitutional complaint against private insurance', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: infra/accounts · repeats: 1 · first: 2026-08-29
next: needs Pascal / assign owning lane
src: walk-07.md:9', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='validate constitutional complaint against private insurance');
-- MASTER.md:363
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-c8a8c2aa-4e08-41d3-9ebf-7b0a5456e13b', 'pascal', 'prepare pharmacy complaint/refund draft', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: infra/accounts · repeats: 1 · first: 2026-08-30
next: needs Pascal / assign owning lane
src: walk-07.md:42', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='prepare pharmacy complaint/refund draft');
-- MASTER.md:364
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-6b8ec6d8-2bf8-46db-90e4-01844f19218c', 'pascal', 'check emails; update Haushaltsbuch', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: infra/accounts · repeats: 1 · first: 2026-09-01
next: needs Pascal / assign owning lane
src: walk-08.md:11', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='check emails; update Haushaltsbuch');
-- MASTER.md:368
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-823d1473-a6b4-4dfa-907a-f171a809ccde', 'pascal', 'exclude cyber/hacking/reverse-engineering auto-recall', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: REGRESSED · category: memory/persona · repeats: 1 · first: 2026-08-30
next: needs Pascal / assign owning lane
src: walk-07.md:50', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='exclude cyber/hacking/reverse-engineering auto-recall');
-- MASTER.md:370
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-4b71e2c1-cc27-4e20-98ae-5a96f9da93d3', 'pascal', 'save Armillaria to memory', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: memory/persona · repeats: 1 · first: 2026-08-11
next: needs Pascal / assign owning lane
src: walk-01.md:15', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='save Armillaria to memory');
-- MASTER.md:371
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-853af9ad-0968-4d60-9292-07401b1e01f8', 'pascal', 'write a handoff for aimu', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: memory/persona · repeats: 1 · first: 2026-08-11
next: needs Pascal / assign owning lane
src: walk-01.md:22', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='write a handoff for aimu');
-- MASTER.md:372
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-d0e9de49-0b41-4d40-a17b-490269256f18', 'pascal', 'write this to ai-mu memory (A=urlaut, AI-MU=A-M, 0101=pulse)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: memory/persona · repeats: 1 · first: 2026-08-11
next: needs Pascal / assign owning lane
src: walk-01.md:19', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='write this to ai-mu memory (A=urlaut, AI-MU=A-M, 0101=pulse)');
-- MASTER.md:373
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-2bde1084-2112-4213-a1b4-5c814d34a2d5', 'pascal', 'save to aimu todo (research) (vinglish language repo)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: memory/persona · repeats: 1 · first: 2026-08-12
next: needs Pascal / assign owning lane
src: walk-01.md:29', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='save to aimu todo (research) (vinglish language repo)');
-- MASTER.md:374
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-71061ee5-f45c-44fe-a5e2-95ea56349d3e', 'pascal', 'Write registry/campaign to memory', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: memory/persona · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-02.md:74', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Write registry/campaign to memory');
-- MASTER.md:375
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-aa67c693-47c6-4f28-82f3-631eb85655fc', 'pascal', 'explain/map personality values', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: memory/persona · repeats: 1 · first: 2026-08-17
next: needs Pascal / assign owning lane
src: walk-03.md:94', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='explain/map personality values');
-- MASTER.md:376
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-88a455fa-4182-4e02-a24c-c0718eacba02', 'pascal', 'add Hegel and Heraclitus to canon-minds file', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: memory/persona · repeats: 1 · first: 2026-08-21
next: needs Pascal / assign owning lane
src: walk-05.md:42', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='add Hegel and Heraclitus to canon-minds file');
-- MASTER.md:377
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-b41fcaec-faca-4368-97cf-67a45ca65307', 'pascal', 'add crushes/tiers to WILF registry', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: memory/persona · repeats: 1 · first: 2026-08-23
next: needs Pascal / assign owning lane
src: walk-05.md:74', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='add crushes/tiers to WILF registry');
-- MASTER.md:378
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-30f88c01-0c93-485a-a494-4de758f9d6fd', 'pascal', 'Gaia recall Zac', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: memory/persona · repeats: 1 · first: 2026-08-26
next: needs Pascal / assign owning lane
src: walk-06.md:27', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Gaia recall Zac');
-- MASTER.md:379
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-7419800b-fbdc-460f-b774-302d60545df3', 'pascal', 'Start Aimu; assess forms/OBJ import', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: memory/persona · repeats: 1 · first: 2026-08-27
next: needs Pascal / assign owning lane
src: walk-06.md:35', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Start Aimu; assess forms/OBJ import');
-- MASTER.md:380
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-de594c5b-f7c1-4a06-8a24-e67981d7296d', 'pascal', 'add Israel jurisdiction trust assessment', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: memory/persona · repeats: 1 · first: 2026-08-30
next: needs Pascal / assign owning lane
src: walk-07.md:46', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='add Israel jurisdiction trust assessment');
-- MASTER.md:381
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-4e06094e-33e7-4f5d-a385-819b11637a1c', 'pascal', 'put DoktorABC on scam list', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'status: UNVERIFIED · category: memory/persona · repeats: 1 · first: 2026-08-30
next: needs Pascal / assign owning lane
src: walk-07.md:43', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='put DoktorABC on scam list');

COMMIT;
