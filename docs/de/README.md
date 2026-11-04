# folio

Eine Desktop-App zum Lesen, Bearbeiten und Drucken von Markdown mit lebenden
Diagrammen, API-Referenzen und Editoren — unter macOS, Windows und Linux, ohne
Installation.

> Status: **1.5** — das Archiv für Ihr System liegt in der [neuesten Version](https://github.com/dskripchenko/folio/releases/latest).

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
