# Übergabe — GAIA Space Redesign

Stand: 2026-08-28 · Branch `space-redesign-communication-first` · Arbeitsverzeichnis sauber
**Lokal committet, NICHTS gepusht.** Sicherheitsbranch: `pre-merge-backup`.

## Was das ist
Umbau von GAIA Space auf ein kommunikationsorientiertes Layout nach Bjarnes Entwurf.
Quelle der Wahrheit für das Design: `~/Downloads/GAIA_SPACE_FINAL_FOR_JANNES/FINAL_GAIA_SPACE_PROTOTYP.html`
Erst lokal fertig machen, **dann** Branch/PR für Pascal.

## Starten
`bun run tauri dev` — Desktop, kein Login.
`bun run dev` (Web) verlangt ein Passwort → nicht benutzen.

## Gates (alle vier, vor jedem Commit)
- `bunx tsc --noEmit -p tsconfig.json` → exit 0
- `bun test` → **338 pass / 0 fail**
- `bunx vite build`
- `cd src-tauri && cargo test`

## Live-Prüfung gegen die laufende App
Debug-Server `127.0.0.1:9433` → `POST /eval` (plain JS), `/screenshot`, `/console`

Sechs bewiesene Messartefakte — bitte nicht neu entdecken:
1. `/screenshot` erfasst keine animierten Ebenen
2. Hintergrund-WebView friert Übergänge ein → vorher `*{transition:none!important;animation:none!important}` einspritzen
3. Natives `<select>`-Popup erscheint **nie** im Screenshot
4. `location.hash` haftet oft nicht beim ersten Versuch → Wiederholschleife in EINEM `eval`, Hash vor und nach jeder Aufnahme prüfen
5. Vite-HMR-Reload sieht aus wie Selbstnavigation
6. `requestAnimationFrame` feuert nie im unfokussierten Fenster → `setTimeout`

## Geltende Entscheidungen
- **Nichts löschen** — alte Ansichten bleiben über „More" erreichbar
- Helle Palette **nur** unter `.theme-space-light`. **Struktur (Größen, Positionierung) NIE scopen** — hat dreimal das dunkle Layout gebrochen
- UI komplett Englisch. Development · Tickets · Bugs · Pull Requests · Releases. Intern bleibt `issue`
- **Ein Projekt hat eine „Responsible person", keinen „Lead"** — das Wort gehört dem Leads-Bereich (Landing-Page-Kontakte). Intern weiter `lead_id`
- Farben: teal = Aktion/offen · amber = bald fällig · rot = kritisch. **Wert 0 trägt keine Farbe**
- **Eine Aktion, ein Ort**: Kopf-Primary tritt zurück, solange ein EmptyState dieselbe Aktion trägt
- **Eine leere Aussage bekommt keinen Platz** (kein „No lead yet", kein Rail über Nichts)
- **Eine Seite, ein Maß** — Kacheln und Karten enden an derselben Kante
- Kontext wird geerbt, nie erfragt. Formulare in Drawern — außer auf Betreiberwerkzeugen
- Keine abgeschwächten Tests. Commits mit **expliziten Pfaden**, nie `git add -A`

## Offen
1. **`ProfilePicker`/`ProjectPicker` auf `PillMenu` umstellen?** — 22 Einsatzstellen, 7 Testdateien greifen auf `select[aria-label=…]` zu. Eigener Arbeitsgang. **Jannes' Antwort steht aus**
2. **Defekt: `actor::resolve` scheitert bei 2 Profilen**, wenn `GAIA_SPACE_ACTOR_PROFILE` fehlt → `get_calendar_options`, `get_dashboard_preferences` schlagen fehl. Vorschlag lag vor: Desktop-Hülle merkt sich die Identität nativ. **Jannes' Entscheidung steht aus**
3. **Türkis auf „2 open tickets"** in den Projektkarten — Home färbt Kennzahlen gar nicht. Entfärben? **Gefragt, Antwort steht aus**
4. Danach: sauberen Branch/PR für Pascal (~138 Commits, teils vermischte Urheberschaft)

## Kleinigkeiten, notiert und nicht behoben
- Chat-Metazeile im Chats-Tab benennt den Kanal doppelt
- Development-Sidebar hat keinen „Bugs"-Eintrag
- Gelöschte Nachrichten hinterlassen Mention-Notifications

## Testdaten in Jannes' DB
Kanäle `T17 Berlin office chat` / `T17 Lisbon studio chat` (nur archivierbar, kein Delete-Command).
Locations: `Berlin office`, `Lisbon studio`, `Room 4.12`. Zwei Demo-Notifications im Organisationsstrom.

## Kern-Dateien
`src/components/{PageHeader,controls,blocks,EmptyState,paper.css,TaskRowEdit,TaskDrawer,SpaceShell,WorkItemDrawer,NotesLog}`
`src/{attention.ts,statusTone.ts,nav.ts,router.ts,session.ts,spaceTheme.css,spaceLightType.css,spaceLightOverrides.css}`
→ `spaceLightOverrides.css` ist **generiert**: `bun tools/lightOverrides.mjs`

## § Known
`bun test --randomize --seed 1` fails calendar test “a task is drawn on its project's calendar…
organisation calendar carries meetings” — second module-state leak, pre-existing, not in CI order.
