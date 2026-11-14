# folio

Eine Desktop-App zum Lesen, Bearbeiten und Drucken von Markdown mit lebenden
Diagrammen, API-Referenzen und Editoren — unter macOS, Windows und Linux, ohne
Installation. Dazu eine leichte IDE für die Arbeit neben einem KI-Agenten im
Terminal: seine Änderungen als Pull-Request geprüft, was sich seit dem letzten
Blick geändert hat, seine Worktrees, Kommentare direkt in seine Konsole.

> Status: **1.18** — das Archiv für Ihr System liegt in der [neuesten Version](https://github.com/dskripchenko/folio/releases/latest).

- [Wie es funktioniert](design.md) — die Fenster, was ein Dokument darf, wo die
  Daten liegen
- [Entwicklung](development.md) — bauen, starten und testen

## Neben dem System

- Kein Installer und keine Administratorrechte: ein Zip unter Windows und macOS,
  ein AppImage unter Linux.
- Einstellungen, Caches und Fensterzustand liegen in `folio-data/` neben dem
  Programm; den Ordner löschen entfernt folio vollständig.
- Einem Dokument wird nicht vertraut: Es sieht nur seinen eigenen Ordner und
  erreicht das Netz nur mit Ihrer Zustimmung.

## Neben dem Terminal shell

Ist auch das Terminal [shell](https://github.com/dskripchenko/shell) auf dem
Rechner, finden die beiden einander: shell öffnet Dateien, Projekte und Reviews
in folio; folio öffnet einen Tab in shell, schickt Review-Kommentare in den
Bereich des Agenten dort und übernimmt die Farben von shell für seine Konsolen;
beide führen ein gemeinsames Journal, welcher Agent was bearbeitet hat. Mehr
unter *Neben dem Terminal shell* in [Wie es funktioniert](design.md).
