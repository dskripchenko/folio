# Wie es funktioniert

## Zwei Arten von Prozessen

folio ist eine Electron-App, und Electron teilt sie in zwei Teile:

- **Der Hauptprozess** besitzt die Fenster, die Menüs, die Festplatte und die
  Netzregeln. Nur er liest und schreibt Dateien.
- **Das Fenster eines Dokuments** zeichnet das Dokument. Es läuft mit
  Kontextisolierung und der Sandbox von Chromium, ohne Node.js, unter einer
  Content Security Policy, die nur folios eigene Skripte erlaubt. Was es beim
  Hauptprozess anfragen darf, geht über eine kleine Brücke (das Preload-Skript)
  — öffnen, speichern, eine Datei des Projekts lesen — und sonst nichts.

## Was ein Dokument darf

> Die Isolierung des Fensters steht; das Ordner-Schema und die Zustimmung zum
> Netz kommen mit dem Lesen von Markdown (Stufe 1), Tabs mit Ordnern (Stufe 2).

Eine Markdown-Datei kann von überall kommen, deshalb vertraut das Fenster ihr
nicht:

- es sieht die Dateien des Ordners, aus dem es geöffnet wurde — über ein eigenes
  Schema von folio ausgeliefert — und nichts außerhalb dieses Ordners;
- ins Netz — „Ausprobieren“ in einer API-Referenz, ein Bild oder Video per URL —
  geht es erst, nachdem Sie es für diese Datei oder diesen Ordner erlaubt haben;
- es kann das Fenster nicht auf eine andere Seite führen und keine neuen Fenster
  öffnen; ein Link geht an den Systembrowser.

## Wo die Daten liegen

Electron legt seine Daten standardmäßig im Benutzerprofil ab. folio verlegt sie
alle — Einstellungen, Caches, Sitzungsdaten, Logs — nach `folio-data/` neben
dem Programm:

| Wie es läuft | `folio-data/` liegt |
|---|---|
| Windows | neben `folio.exe` |
| macOS | neben `folio.app` |
| Linux | neben der `.AppImage`-Datei |
| `FOLIO_DATA` ist gesetzt | in diesem Verzeichnis |
| aus den Quellen | `.folio-data/` im Arbeitsverzeichnis |

Den Ordner des Programms zu löschen entfernt daher alles, was es je geschrieben
hat. Die Kehrseite: Der Ordner muss beschreibbar sein — entpacken Sie folio
nicht dorthin, wo nur ein Administrator schreiben darf.

## Ein Fenster

Ein zweiter Start holt das laufende folio nach vorn, statt eine zweite Kopie zu
starten; Dokumente öffnen sich als Tabs dieses Fensters.
