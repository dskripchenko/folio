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


Eine Markdown-Datei kann von überall kommen, deshalb vertraut das Fenster ihr
nicht:

- es sieht die Dateien des Ordners, aus dem es geöffnet wurde — über ein eigenes
  Schema von folio ausgeliefert — und nichts außerhalb dieses Ordners;
- ins Netz — „Ausprobieren“ in einer API-Referenz, ein Bild oder Video per URL —
  geht es erst, nachdem Sie es für diese Datei oder diesen Ordner erlaubt haben;
- es kann das Fenster nicht auf eine andere Seite führen und keine neuen Fenster
  öffnen; ein Link geht an den Systembrowser.

## Dokumente öffnen

Eine Markdown-Datei öffnet sich über **Datei → Öffnen**, durch Ablegen auf dem
Fenster, von der Kommandozeile (`folio notes.md`) oder — läuft folio schon —
durch einen erneuten Start mit einer Datei: das laufende folio öffnet sie. Ein
Link auf ein anderes Dokument desselben Ordners öffnet es in einem Tab. Die
offenen Dokumente und das aktive kommen nach einem Neustart zurück.

## Gemeinsam und Projekte

Der Arbeitsbereich hat zwei Teile: **Gemeinsam**, ein Ordner für Dokumente, die
für alles gelten (standardmäßig `folio-data/library` oder ein Ordner Ihrer
Wahl), und **Projekte** — beliebige Ordner auf der Festplatte, die zu folio
hinzugefügt wurden. Die Liste liegt in `folio-data/workspace.json`; die Ordner
bleiben, wo sie sind. Ein Dokument eines Projekts oder von „Gemeinsam“ darf die
Dateien dieses ganzen Ordners lesen; eine einzeln geöffnete Datei ihren eigenen
Ordner.

Die Seitenleiste zeigt „Gemeinsam“ und die Projekte: angeheftete zuerst, dann
nach Gruppe, dann die übrigen; das Menü eines Projekts (Rechtsklick) heftet es
an, benennt es um, ordnet es einer Gruppe zu, blendet es aus oder entfernt es
aus folio (der Ordner bleibt auf der Festplatte). Die Bäume zeigen Ordner und die
Dateien, die folio öffnet, Ordner zuerst, und folgen der Festplatte: eine
anderswo hinzugefügte, geänderte oder gelöschte Datei erscheint sofort, ein
offenes Dokument wird neu gezeichnet. `Cmd/Strg+B` blendet die Leiste aus.

## Verlauf mit git

Pro Ordner — „Gemeinsam“ und jedes Projekt — und nur, wenn Sie es wollen. Ein
Ordner, der ein git-Repository ist (oder darin liegt), zeigt seinen Verlauf
sofort; ein anderer beginnt einen mit **Verlauf führen** im Bereich **Verlauf**
(`Cmd/Strg+Umschalt+H`): ein Repository auf dem Branch `main` und ein erster
Commit dessen, was da ist.

- **Beim Speichern committen** — an für einen Verlauf, den folio begonnen hat,
  aus für ein schon vorhandenes Repository (folio committet nicht von selbst in
  ein Projekt). Eine gespeicherte Datei wird 3 Minuten nach ihrem letzten
  Speichern committet, eine Reihe von Speichervorgängen ergibt also einen
  Commit; beim Verlassen von folio wird Wartendes sofort committet. Nur die
  gespeicherte Datei wird committet, als *Update <Pfad>*; **Committen** mit einer
  eigenen Nachricht tut es sofort.
- **Versionen** der offenen Datei, neueste zuerst. Eine öffnet sich nur zum
  Lesen, wie sie war; **Änderungen** zeigt den Unterschied zu jetzt Zeile für
  Zeile, **Nebeneinander** die beiden gezeichneten Dokumente samt Diagrammen.
  **Diese Version wiederherstellen** legt ihren Text als ungespeicherte Änderung
  in den Editor — ob gespeichert wird, entscheiden Sie.
- **Im Baum**: geänderte Dateien sind markiert, ein Ordner mit Änderungen darin
  trägt einen Punkt, ein Projekt zeigt seinen Branch.
- Der Autor ist `user.name` / `user.email` aus der Konfiguration des
  Repositorys, dann aus `~/.gitconfig`, sonst der Systembenutzer.

git steckt in folio (isomorphic-git, reines JavaScript), das funktioniert also
auch ohne installiertes git. Als Nächstes: Branches, Pull und Push, ein
Repository als Projekt klonen (Stufe 4b) und ein Graph der Commits (4c).

## Ungespeichertes und schnelle Notizen

Wie in Sublime Text: ein unbenannter Tab ist eine schnelle Notiz, und eine nicht
gespeicherte Änderung erreicht die Datei nicht. Beides wird beim Tippen nach
`folio-data/session/` geschrieben, übersteht also das Schließen von folio, einen
Absturz und einen Neustart des Rechners und kommt genau so zurück. Ein Tab mit ungespeicherten Änderungen
trägt einen Punkt. Das Schließen eines solchen Tabs fragt, ob gespeichert werden
soll; das Schließen von folio fragt nichts — es liegt schon alles auf der
Festplatte. Ändert sich die Datei auf der Festplatte, während Sie sie
bearbeiten, sagt folio es und behält beides: die Datei von der Festplatte
nehmen oder die eigene Version behalten und darüber speichern. Eine schnelle
Notiz speichert **Speichern** in „Gemeinsam“ (oder anderswo), benannt nach
ihrer ersten Zeile.

## Bearbeiten

`Cmd/Strg+E` (oder **Bearbeiten** in der Leiste) macht aus einem Dokument den
Editor und zurück. Der Editor hat drei Modi: visuell (Bearbeiten wie in einer
Textverarbeitung mit Werkzeugleiste, `/`-Menü und allen lebenden Blöcken), das
Markdown selbst und beides nebeneinander. Die Datei bleibt Markdown: was der
visuelle Modus nicht halten kann (Überschriften unter h3, Aufgabenlisten,
Hinweisboxen, HTML), bleibt wie geschrieben, und Bilder behalten ihre relativen
Pfade.

| Tasten | |
|---|---|
| `Cmd/Strg+N` | schnelle Notiz |
| `Cmd/Strg+O` | Datei öffnen |
| `Cmd/Strg+S`, `Cmd/Strg+Umschalt+S` | speichern, speichern unter |
| `Cmd/Strg+E` | bearbeiten / lesen |
| `Cmd/Strg+W` | Tab schließen |
| `Cmd/Strg+B` | Seitenleiste |

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
