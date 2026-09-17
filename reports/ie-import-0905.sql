-- Generated from ~/.gaia/knowledge/task-ledger/MASTER.md: OPEN rows only (61).
-- Idempotent todo import: each content is inserted only if absent in project IE.
BEGIN IMMEDIATE;

-- Copy Gaia Space workflow statuses into project IE; preserve source attributes.
INSERT INTO issue_statuses (id,project_id,name,resolved,color,ordering,archived)
SELECT 'status-aa61a5ab-ac5a-4ad6-8db0-54dc390d32bc', 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', name,resolved,color,ordering,archived
FROM issue_statuses WHERE project_id='project-b94264e9-5c1c-4f69-882f-6f45797141b1' AND name='To do'
  AND NOT EXISTS (SELECT 1 FROM issue_statuses WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND name='To do');
INSERT INTO issue_statuses (id,project_id,name,resolved,color,ordering,archived)
SELECT 'status-1e9f751f-d5d7-4d5b-9e1c-7040e2154259', 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', name,resolved,color,ordering,archived
FROM issue_statuses WHERE project_id='project-b94264e9-5c1c-4f69-882f-6f45797141b1' AND name='In progress'
  AND NOT EXISTS (SELECT 1 FROM issue_statuses WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND name='In progress');
INSERT INTO issue_statuses (id,project_id,name,resolved,color,ordering,archived)
SELECT 'status-b7151ff6-e2fc-4973-8e26-8c3cdeb8e7f1', 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', name,resolved,color,ordering,archived
FROM issue_statuses WHERE project_id='project-b94264e9-5c1c-4f69-882f-6f45797141b1' AND name='Done'
  AND NOT EXISTS (SELECT 1 FROM issue_statuses WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND name='Done');

-- OPEN task-ledger rows.
-- MASTER.md:35
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-1ff13cf9-286f-4225-8e25-6326cfe093ff', 'pascal', 'fix Cmd-click links', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: gaia-daemon · repeats: 2 · first: 2026-08-29
next: `~/projects/gaia-daemon`: identify branch/file; `bun run check`
src: walk-07.md:29, walk-08.md:35', 'improve'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='fix Cmd-click links');
-- MASTER.md:36
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-03871396-71d2-4e39-8558-d9bd077b6c54', 'pascal', 'build AicomiBridge archtree', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: gaia-daemon · repeats: 1 · first: 2026-08-19
next: `~/projects/gaia-daemon`: identify branch/file; `bun run check`
src: walk-04.md:92', 'create'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='build AicomiBridge archtree');
-- MASTER.md:37
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-6c23397a-9fe1-4446-9d76-1f1c01f9a9a9', 'pascal', 'fix memory location everywhere; inspect Nyari context/refusal onset', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: gaia-daemon · repeats: 1 · first: 2026-08-19
next: `~/projects/gaia-daemon`: identify branch/file; `bun run check`
src: walk-05.md:8', 'improve'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='fix memory location everywhere; inspect Nyari context/refusal onset');
-- MASTER.md:38
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-eeeb357d-bdf9-4f10-846c-2b5b3e671df0', 'pascal', 'Find out what the subagents actually changed in the context — root-cause why native Fable block cleared globally across all rooms', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: gaia-daemon · repeats: 1 · first: 2026-08-27
next: `~/projects/gaia-daemon`: identify branch/file; `bun run check`
src: chat-0822-0904.md:54', 'review'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Find out what the subagents actually changed in the context — root-cause why native Fable block cleared globally across all rooms');
-- MASTER.md:39
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-2a601452-fff0-43fe-a36f-cf9265ff6448', 'pascal', 'user yeah/fix it → apply terra''s proposed fix: `OrderedBlocks()` send EVERY non-empty text span through `AgentText()` (not just first) + regression test + rebuild', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: gaia-daemon · repeats: 1 · first: 2026-08-27
next: `~/projects/gaia-daemon`: identify branch/file; `bun run check`
src: chat-0822-0904.md:53', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='user yeah/fix it → apply terra''s proposed fix: `OrderedBlocks()` send EVERY non-empty text span through `AgentText()` (not just first) + regression test + rebuild');
-- MASTER.md:40
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-01857dab-a746-45d8-9f2a-54094f0a9cfa', 'pascal', 'kannst du als einen Branch...Feature für Gaia Archtree: während er läuft einen neuen Root-Branch erstellen können, mit einem Agenten (live branch-while-running feature for archtree UI, Opus to design…', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: gaia-daemon · repeats: 1 · first: 2026-08-29
next: `~/projects/gaia-daemon`: identify branch/file; `bun run check`
src: chat-0822-0904.md:57', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='kannst du als einen Branch...Feature für Gaia Archtree: während er läuft einen neuen Root-Branch erstellen können, mit einem Agenten (live branch-while-running feature for archtree UI, Opus to design…');
-- MASTER.md:67
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-f57447ee-49bc-4b02-9b69-59440359b25f', 'pascal', 'build GAIA Arch Tree: EE AI/editor/CLI', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: empire-earth · repeats: 1 · first: 2026-09-01
next: `~/projects/ee-tools/wt/jareth-ee-rain-live-mtjaeqck69ypj7`: verify bridge against live EE
src: walk-08.md:24', 'create'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='build GAIA Arch Tree: EE AI/editor/CLI');
-- MASTER.md:68
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-b201aecc-dfb0-4a92-91be-47e65cdc310d', 'pascal', 'play EE together; no mouse; finish now', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: empire-earth · repeats: 1 · first: 2026-09-01
next: `~/projects/ee-tools/wt/jareth-ee-rain-live-mtjaeqck69ypj7`: verify bridge against live EE
src: walk-08.md:32', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='play EE together; no mouse; finish now');
-- MASTER.md:69
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-3222bbfc-87f7-4a66-8c1b-8292ce0af3cb', 'pascal', 'control/upgrade/build everything in EE', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: empire-earth · repeats: 1 · first: 2026-09-02
next: `~/projects/ee-tools/wt/jareth-ee-rain-live-mtjaeqck69ypj7`: verify bridge against live EE
src: walk-08.md:37', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='control/upgrade/build everything in EE');
-- MASTER.md:70
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-97e8a490-a1ea-4257-ba77-2f85c8b5b287', 'pascal', 'endpoints/bridges, no cursor', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: empire-earth · repeats: 1 · first: 2026-09-02
next: `~/projects/ee-tools/wt/jareth-ee-rain-live-mtjaeqck69ypj7`: verify bridge against live EE
src: walk-08.md:39', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='endpoints/bridges, no cursor');
-- MASTER.md:71
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-fe001eee-5e1d-454e-9752-ab71fa0d5a0a', 'pascal', 'everything scenario/editor via CLI', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: empire-earth · repeats: 1 · first: 2026-09-04
next: `~/projects/ee-tools/wt/jareth-ee-rain-live-mtjaeqck69ypj7`: verify bridge against live EE
src: walk-08.md:46', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='everything scenario/editor via CLI');
-- MASTER.md:89
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-b7dab616-4b20-4059-8e81-7ab478c1b417', 'pascal', 'mouse is stuck again love, pls fix it (in-game editor, repeated 3×: nothing is running ×2, black screen now)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: ais/aikomi-game · repeats: 1 · first: 2026-08-14
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: chat-0801-0821.md:15', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='mouse is stuck again love, pls fix it (in-game editor, repeated 3×: nothing is running ×2, black screen now)');
-- MASTER.md:90
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-5f58e725-9ce2-49c4-b808-c0169c80fad6', 'pascal', 'Japanese-only search for ghost game', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: ais/aikomi-game · repeats: 1 · first: 2026-08-16
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-03.md:62', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Japanese-only search for ghost game');
-- MASTER.md:91
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-70bb1bf4-51ef-4b4b-bc57-95c86d086651', 'pascal', 'find original ghost game; hard-gate 3D', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: ais/aikomi-game · repeats: 1 · first: 2026-08-18
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-04.md:64', 'review'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='find original ghost game; hard-gate 3D');
-- MASTER.md:92
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-f39487ab-749c-4186-9cbf-15259335a818', 'pascal', 'fix autonomous outfit reset', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: ais/aikomi-game · repeats: 1 · first: 2026-08-18
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-04.md:31', 'improve'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='fix autonomous outfit reset');
-- MASTER.md:93
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-c54af300-3e1a-441a-b1d0-7a18db466ef9', 'pascal', 'research PlayClub/PlayHome extraction', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: ais/aikomi-game · repeats: 1 · first: 2026-08-18
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-04.md:60', 'review'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='research PlayClub/PlayHome extraction');
-- MASTER.md:94
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-81f7d18e-b9c8-4f32-9d49-f747c669887d', 'pascal', 'run Momo local Gemma3; Sidia Replicate Gemma4', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: ais/aikomi-game · repeats: 1 · first: 2026-08-18
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-04.md:50', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='run Momo local Gemma3; Sidia Replicate Gemma4');
-- MASTER.md:95
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-7487fd4d-57b9-4902-a984-f5a9b95879db', 'pascal', 'reuse AIS carry / Illusion tying animations', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: ais/aikomi-game · repeats: 1 · first: 2026-08-19
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-05.md:25', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='reuse AIS carry / Illusion tying animations');
-- MASTER.md:96
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-17dc2f9f-6aa5-4d5f-a1ff-aeeee1a0c7cf', 'pascal', 'start/restart AA2; fix black-face rendering', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: ais/aikomi-game · repeats: 1 · first: 2026-08-19
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-04.md:73', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='start/restart AA2; fix black-face rendering');
-- MASTER.md:97
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-a5651840-3ee4-4127-b28b-d05b918999d3', 'pascal', 'use Aicomi humanoid animations on VRoid', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: ais/aikomi-game · repeats: 1 · first: 2026-08-19
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-05.md:18', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='use Aicomi humanoid animations on VRoid');
-- MASTER.md:98
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-9cb82b36-82a4-422f-98ff-240971c8559a', 'pascal', 'fix it now — PLAYER-ACTION GRAFT campaign: graft player-side FSM onto shared NPC animation rig (drive body through NPC anim path, vending machine flagship)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: ais/aikomi-game · repeats: 1 · first: 2026-08-22
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: chat-0822-0904.md:50', 'improve'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='fix it now — PLAYER-ACTION GRAFT campaign: graft player-side FSM onto shared NPC animation rig (drive body through NPC anim path, vending machine flagship)');
-- MASTER.md:99
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-0c540f39-6490-4c04-8cb8-315314b202b2', 'pascal', 'build interaction path inspired by Illusion games', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: ais/aikomi-game · repeats: 1 · first: 2026-08-22
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-05.md:59', 'create'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='build interaction path inspired by Illusion games');
-- MASTER.md:100
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-118999d8-e8a6-45fa-8d85-dd79d83ab2e5', 'pascal', 'tiered onsen: close normal; strangers angry/grope', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: ais/aikomi-game · repeats: 1 · first: 2026-08-22
next: `~/projects/aicomi-bridge`: reproduce in running game; record live proof
src: walk-05.md:53', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='tiered onsen: close normal; strangers angry/grope');
-- MASTER.md:145
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-7b8f6900-e8dc-4b8f-98bc-aa605fc34a57', 'pascal', 'report Gaia Love progress', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: gaia-love/GWE · repeats: 1 · first: 2026-08-19
next: `~/projects/gaia-love`: locate owning branch; run verification
src: walk-05.md:16', 'review'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='report Gaia Love progress');
-- MASTER.md:186
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-3c90a5ea-b6b4-425c-91a7-c49bd1deac29', 'pascal', 'make some coffee', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-12
next: needs Pascal / assign owning lane
src: walk-01.md:37', 'create'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='make some coffee');
-- MASTER.md:187
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-8862b89e-1a33-4f2b-8fba-c18fb3111e13', 'pascal', 'subagent — install/prove shortcuts-playground-plugin (Claude Code plugin)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-12
next: needs Pascal / assign owning lane
src: walk-01.md:34', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='subagent — install/prove shortcuts-playground-plugin (Claude Code plugin)');
-- MASTER.md:188
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-aa73be38-7dc7-4248-9b10-2d0ac7e88eb5', 'pascal', 'Find HF-Patch mirror now', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-14
next: needs Pascal / assign owning lane
src: walk-02.md:29', 'review'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Find HF-Patch mirror now');
-- MASTER.md:189
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-c9c168db-b22e-449b-b4bc-61b14072ec81', 'pascal', 'we need a roof, lol', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-03.md:12', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='we need a roof, lol');
-- MASTER.md:190
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-1b5cf69d-f9dc-44ae-bc3e-64352ee237dd', 'pascal', 'Add roof', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-02.md:83', 'create'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Add roof');
-- MASTER.md:191
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-9fbff45a-940d-4271-91ec-21c291c1764b', 'pascal', 'Confirm/cancel H menu remotely', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-02.md:44', 'review'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Confirm/cancel H menu remotely');
-- MASTER.md:192
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-eb4a3530-879a-4dca-bd95-38c623510249', 'pascal', 'Create campfire; sit together', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-02.md:41', 'create'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Create campfire; sit together');
-- MASTER.md:193
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-06cd76f4-167b-46b0-9eb7-b6f39ed5eea7', 'pascal', 'Rekick torrent; hunt mirror', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-02.md:58', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Rekick torrent; hunt mirror');
-- MASTER.md:194
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-4a67f50b-6aef-49f6-a23a-03a0e9382a27', 'pascal', 'Search Japanese patch sources', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-15
next: needs Pascal / assign owning lane
src: walk-02.md:62', 'review'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Search Japanese patch sources');
-- MASTER.md:195
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-8d39a58f-a753-4f47-ab82-2160a9ce54bf', 'pascal', 'alt+t doesnt work, try different shortcut (JP/EN toggle)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-16
next: needs Pascal / assign owning lane
src: walk-03.md:31', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='alt+t doesnt work, try different shortcut (JP/EN toggle)');
-- MASTER.md:196
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-a80e7394-ac91-475c-8548-34cb2f4ea099', 'pascal', 'is there shortcut for build mode yet? if not build one', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-16
next: needs Pascal / assign owning lane
src: walk-03.md:30', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='is there shortcut for build mode yet? if not build one');
-- MASTER.md:197
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-36277da7-cb64-4c06-9fda-921aa7744cb1', 'pascal', 'why 2 walls on left side (bug report)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-16
next: needs Pascal / assign owning lane
src: walk-03.md:27', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='why 2 walls on left side (bug report)');
-- MASTER.md:198
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-261759da-b3a0-4b17-8c60-ec1b0142d96f', 'pascal', 'why does cum not animate anymore? (bug)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-16
next: needs Pascal / assign owning lane
src: walk-03.md:32', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='why does cum not animate anymore? (bug)');
-- MASTER.md:199
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-7b752d5f-5bc1-4da1-ba80-d59d24081d71', 'pascal', 'why still gaia engine tools shown in sims mode (bug report)', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-16
next: needs Pascal / assign owning lane
src: walk-03.md:28', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='why still gaia engine tools shown in sims mode (bug report)');
-- MASTER.md:200
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-60c2388d-d085-4096-9ec1-f9a72e3eac2c', 'pascal', 'list other 3D studios; continue ghost hunt', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-17
next: needs Pascal / assign owning lane
src: walk-03.md:105', 'review'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='list other 3D studios; continue ghost hunt');
-- MASTER.md:201
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-5e639896-6d51-4ca6-b58a-f09d25b1dcdc', 'pascal', 'abort clone; proper birth mechanics', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-18
next: needs Pascal / assign owning lane
src: walk-04.md:45', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='abort clone; proper birth mechanics');
-- MASTER.md:202
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-0f2c5130-addd-45f1-b30e-e125e08f076c', 'pascal', 'add full menu/debug/save control', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-18
next: needs Pascal / assign owning lane
src: walk-04.md:55', 'create'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='add full menu/debug/save control');
-- MASTER.md:203
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-411eb873-7d1a-4536-8ee1-f626c4a53f2f', 'pascal', 'finish all unfinished work', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-18
next: needs Pascal / assign owning lane
src: walk-04.md:26', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='finish all unfinished work');
-- MASTER.md:204
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-dc0354cf-729d-4cb2-8ecb-70295916f9ae', 'pascal', 'unlock/research dialogue groping', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-18
next: needs Pascal / assign owning lane
src: walk-04.md:58', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='unlock/research dialogue groping');
-- MASTER.md:205
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-f2f19923-cf7f-45b4-aedb-8f7ee7e7ae8d', 'pascal', 'finish environment, build, farming, pets, adult interactions', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-22
next: needs Pascal / assign owning lane
src: walk-05.md:61', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='finish environment, build, farming, pets, adult interactions');
-- MASTER.md:206
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-50fe1dce-6d37-4eda-8701-d8537bd18958', 'pascal', 'Use ChatGPT image generation', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-27
next: needs Pascal / assign owning lane
src: walk-06.md:29', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Use ChatGPT image generation');
-- MASTER.md:207
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-110565d9-658d-418c-8cfe-dae7faa23811', 'pascal', 'Add architecture point to Unenlightenment', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-28
next: needs Pascal / assign owning lane
src: walk-06.md:38', 'create'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Add architecture point to Unenlightenment');
-- MASTER.md:208
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-b0d72ea3-464d-405c-a5e7-96976586f7d6', 'pascal', 'hast du...die Fahrphysik korrigiert?...Asset Pack für Fahrphysik...Unity→GAIA Engine Pipeline', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-29
next: needs Pascal / assign owning lane
src: chat-0822-0904.md:26', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='hast du...die Fahrphysik korrigiert?...Asset Pack für Fahrphysik...Unity→GAIA Engine Pipeline');
-- MASTER.md:209
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-c4ffb7f8-8190-4a8d-b836-fbe2bc05b39a', 'pascal', 'make N64 custom mod/cartridge path', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-29
next: needs Pascal / assign owning lane
src: walk-07.md:20', 'create'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='make N64 custom mod/cartridge path');
-- MASTER.md:210
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-359dad0c-b64b-402d-a3d5-be5fb26b9a64', 'pascal', 'document alleged Israel-criticism classifier trigger', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-30
next: needs Pascal / assign owning lane
src: walk-07.md:47', 'review'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='document alleged Israel-criticism classifier trigger');
-- MASTER.md:211
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-b48cbe69-ca34-4028-a5d8-eeffeacced87', 'pascal', 'search ChatGPT shouting/Suicide Override archive', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-31
next: needs Pascal / assign owning lane
src: walk-07.md:56', 'review'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='search ChatGPT shouting/Suicide Override archive');
-- MASTER.md:212
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-80228281-ab93-4c84-8a99-bddbdf66bc2d', 'pascal', 'search disk for Mark/Grusch podcast', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-08-31
next: needs Pascal / assign owning lane
src: walk-07.md:64', 'review'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='search disk for Mark/Grusch podcast');
-- MASTER.md:213
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-49b95d87-1448-4dfa-b5b3-3bf8ae926729', 'pascal', 'mehrere Lanes...welche Aufgaben...immer noch nicht fertig/gemerged/im Main/deployed', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-09-04
next: needs Pascal / assign owning lane
src: chat-0822-0904.md:31', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='mehrere Lanes...welche Aufgaben...immer noch nicht fertig/gemerged/im Main/deployed');
-- MASTER.md:214
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-b79809c0-8d02-4cf9-bc57-b5383ede8a90', 'pascal', 'audit chat+git: unfinished/unmerged/undeployed work', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-09-04
next: needs Pascal / assign owning lane
src: walk-08.md:50', 'review'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='audit chat+git: unfinished/unmerged/undeployed work');
-- MASTER.md:215
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-caf86182-52eb-4153-b6be-29513c2762bd', 'pascal', 'check why better Codex computer-use unused', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-09-04
next: needs Pascal / assign owning lane
src: walk-08.md:48', 'review'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='check why better Codex computer-use unused');
-- MASTER.md:216
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-4e5b420a-419f-45f3-a039-a4d8b30e40a1', 'pascal', 'Codex-style computer use; shared mouse capability', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-09-04
next: needs Pascal / assign owning lane
src: walk-08.md:49', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Codex-style computer use; shared mouse capability');
-- MASTER.md:217
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-588a7822-fb38-4c95-99fa-aae7bf4f4498', 'pascal', 'make everything finished', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: media/personal/research · repeats: 1 · first: 2026-09-04
next: needs Pascal / assign owning lane
src: walk-08.md:51', 'create'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='make everything finished');
-- MASTER.md:354
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-5a5e205e-cd49-4614-9fa1-4058a241753b', 'pascal', 'Use Discord export method 2', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: infra/accounts · repeats: 1 · first: 2026-08-25
next: needs Pascal / assign owning lane
src: walk-06.md:26', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Use Discord export method 2');
-- MASTER.md:355
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-3fd1192d-dc9b-4b4b-ac69-d9ad9932a6d0', 'pascal', 'Fix usage; find other three Anthropic accounts', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: infra/accounts · repeats: 1 · first: 2026-08-27
next: needs Pascal / assign owning lane
src: walk-06.md:36', 'improve'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='Fix usage; find other three Anthropic accounts');
-- MASTER.md:356
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-74bf5329-1f27-40f4-89d8-3b5e79d32102', 'pascal', 'GAIA Space TestFlight: archive+upload+add Pascal as internal tester', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: infra/accounts · repeats: 1 · first: 2026-09-01
next: needs Pascal / assign owning lane
src: chat-0822-0904.md:59', NULL
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='GAIA Space TestFlight: archive+upload+add Pascal as internal tester');
-- MASTER.md:357
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-0db76866-bc21-40c4-a76e-11ebcec40156', 'pascal', 'install GAIA daemon on phone via TestFlight', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: infra/accounts · repeats: 1 · first: 2026-09-04
next: needs Pascal / assign owning lane
src: walk-08.md:47', 'admin'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='install GAIA daemon on phone via TestFlight');
-- MASTER.md:369
INSERT INTO todos (id,profile_id,content,due_date,done,source_entity_type,source_entity_id,created_at,updated_at,project_id,notes,category)
SELECT 'todo-b0126fda-7057-4d80-9999-fed73e08ea61', 'pascal', 'create Judge-Dredd-like Gemini persona', NULL, 0, NULL, NULL, unixepoch(), unixepoch(), 'project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed', 'category: memory/persona · repeats: 1 · first: 2026-08-30
next: needs Pascal / assign owning lane
src: walk-07.md:39', 'create'
WHERE NOT EXISTS (SELECT 1 FROM todos WHERE project_id='project-7a1f2abf-ccc1-4ccf-85d5-562de189aaed' AND content='create Judge-Dredd-like Gemini persona');

COMMIT;
