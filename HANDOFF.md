# HANDOFF

枝=feat/w10-personal·HEAD=c8599dc

完=BlogCalendarEvent·f5e1705→V65/blog_calendar_events·publish UI/API·calendar date-only/project scope。
完=feeds atom·c8599dc→issue create/update/archive→personal notifications。fan_out=explicit authorized recipients only; project owner+members SQL; scope precedence unchanged; no private leak。

gate5=cargo test 275+56+1✓·clippy -D warnings✓·tsc✓·bun test160✓·vite✓·parity_totals✓。

次=org chart/locations stub→E2E。同V65 schema追記可(同枝・V65已消費): locations{id,name,parent_id,type,archived}。platform CRUD+cycle/type guards·api·Members tree/form·desktop+HTTP dispatch/policy·tests。既member_locations=assignment text表;復用禁。HTTP既member-location routes漏=補候補。

死=全profile feed fanout: private project洩漏。死=member_locationsをorg treeと偽称: parent/entity無。
未驗=visual UI。
