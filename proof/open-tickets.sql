.mode list
.separator ' | '
SELECT p.name, i.number, coalesce(s.name,'(null)'), substr(i.title,1,90), i.created_at FROM issues i LEFT JOIN projects p ON p.id=i.project_id LEFT JOIN issue_statuses s ON s.id=i.status_id WHERE coalesce(i.archived,0)=0 AND (s.name IS NULL OR s.name NOT IN ('Done','Closed')) ORDER BY p.name, i.number;
