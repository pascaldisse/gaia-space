| endpoint | code |
|---|---|
| /api/capabilities | 200 |
| /api/auth/me | 200 |
| /api/users | 200 |
| /api/directory | 200 |
| /api/app/projects | 401 |
| /api/app/rooms | 401 |
| /api/domains | 200 |

Note: /api/app/* are application-token endpoints; 401 with session cookie = scope gate working as designed. DB copy migrated user_version 52→123 on real-disk copy.
