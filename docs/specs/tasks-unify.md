# Tasks unify — 2026-09-05

§ goal → one work entity=task (`todos`) · tickets/issues≠separate entity · legacy issue→task/same project · external/GitHub ticket→task+dev link

§ V143 → `todo_links` exact contract · issue→todo id-preserving · archived/resolved→done · external tracker→category `dev` · assignees/links/comments preserved · issue tables→`*_legacy` · no drops

§ API → `TodoLink{id,todo_id,kind,url?,target_id?,title?}` · todo/input `links` default [] · list/add/delete links · write=owner|assignee|GlobalAdmin · `dev` category · conversion deleted

§ commands → todo link commands registered · issue/board/sprint/swimlane/planning-tag/checklist/time-tracking dispatch removed · legacy ticket command JSON error `tickets merged into tasks (09-05)`

§ bridge → `!space ticket <title>` alias task · project task category `dev`

§ dashboard → `open_issues` retained field · open project todos count

§ gates → cargo db/full/check · bun check/test · production-shaped migration copy · deploy CI → prod verification
