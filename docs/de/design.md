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

### Diagramm- und API-Dateien

Nicht nur Markdown: Ein Diagramm oder eine API-Beschreibung öffnet sich in
einem eigenen Tab, gezeichnet von seinem embed-Element; Links auf solche
Dateien in einem Dokument öffnen sie ebenfalls.

| Datei | Gezeichnet von | Bearbeitet in |
|---|---|---|
| `.bpmn`, `.dmn` | `<dsk-bpmn>`, `<dsk-dmn>` | ihren Editoren: Palette, Kontextmenü, Eigenschaften, Rückgängig |
| `.drawio`, `.dio`, `.drawio.svg` | `<dsk-drawio>`, Seiten-Tabs | — (nur angezeigt) |
| OpenAPI / Swagger (`.yaml`, `.yml`, `.json`) | `<dsk-openapi>`, die Referenz | seinem visuellen Editor mit Quelle und Vorschau |
| AsyncAPI (`.yaml`, `.yml`, `.json`) | `<dsk-asyncapi>` | Quelle neben einer Live-Vorschau |
| `.mmd`, `.puml`, `.dot`, `.gv`, `.d2`, `.dbml`, `.dsl`, `.wardley` | `<dsk-diagram>`, die Syntax nach der Endung | Quelle neben einer Live-Vorschau |
| anderer Text | als Text | die Quelle |

YAML und JSON werden an einem Schlüssel `openapi`, `swagger` oder `asyncapi`
auf oberster Ebene erkannt; der Baum listet YAML-Dateien und JSON-Dateien mit
dem Namen einer API-Beschreibung (`openapi.json`), nicht jede
`package.json`. Eine API ohne Server im Netz bekommt kein Try-it, ihre
Anfragebeispiele nennen `http://localhost`. Speichern, ungespeicherte
Änderungen, die einen Neustart überstehen, der Verlauf und seine Vergleiche
funktionieren für diese Dateien wie für Markdown.

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
auch ohne installiertes git.

### Branches und Synchronisieren

- **Branches**: Der Branch-Name im Panel öffnet die Liste — zu einem anderen
  wechseln oder vom aktuellen Stand einen neuen anlegen. Ein Wechsel wird
  abgelehnt, solange Dateien Änderungen haben, die er überschreiben würde
  (Commits, die auf ihre Pause warten, werden vorher gemacht).
- **Ein Remote**: Ein Ordner ohne Remote bekommt im Panel eine Adresse; ein in
  folio geklontes Repository (**Datei → Repository klonen…** oder ⤓ neben
  *Projekte*) bringt seines mit und wird ein Projekt mit eingeschaltetem
  **Beim Speichern committen**.
- **Synchronisieren** holt, übernimmt die Commits des Remotes — Vorspulen oder
  ein Merge-Commit, wenn sich beide Seiten bewegt haben — und sendet die
  eigenen; der Knopf zeigt, wie viele in jede Richtung gehen (↑ ↓). Alle
  Änderungen müssen vorher committet sein.
- **Ein Konflikt** bleibt im Text, wie git ihn hinterlässt: beide Fassungen
  zwischen `<<<<<<<`- und `>>>>>>>`-Zeilen, die Dateien im Panel aufgelistet.
  Bearbeiten (in folio oder anderswo), speichern, **Merge abschließen** — solange
  ein Marker übrig ist, wird abgelehnt; **Merge abbrechen** kehrt zur eigenen
  Fassung zurück. Der Merge wird wie bei git gehalten (`MERGE_HEAD`), das
  System-git sieht ihn also auch, und bis zum Abschluss entsteht beim Speichern
  kein Commit.
- **Das Netz**: über das git des Systems, wenn es installiert ist — seine
  Credential-Helper und SSH-Schlüssel wirken wie im Terminal (es fragt nie in
  einem unsichtbaren Terminal nach einem Passwort). Ohne es spricht folio selbst
  HTTPS: Verlangt das Remote eine Anmeldung, nimmt das Panel Benutzer und Token
  an, vom System verschlüsselt (Keychain, DPAPI, Secret Service) in
  `folio-data/logins.json` abgelegt — oder nur für die Sitzung, wo das System
  keine Verschlüsselung bietet. Synchronisieren ist eine eigene Aktion und
  braucht die Netzfreigabe der Dokumente nicht.

### Der Commit-Graph

Neben der Liste ein Graph wie in Fork: eine Spur je Entwicklungslinie,
Merges als Ringe, die Spuren verbinden, Branches laufen neben ihrer Basis und
biegen wieder ein. **Diese Datei** zeigt die Fassungen der Datei, ihre Linien
durch die Commits gezogen, die die Datei nicht berührten (wie `git log --
file` die Historie vereinfacht); **Alle Commits** zeigt das ganze Repository —
seine Branches, die des Remotes vom letzten Abruf und die Tags, an ihren
Commits benannt, der ausgecheckte markiert. Ein gewählter Commit öffnet die
Datei, wie sie damals war. Gezeichnet wird der Graph von
`@dskripchenko/diagrams` (`renderCommitGraph`).

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

## Drucken

**Datei → Drucken** (`Cmd/Strg+P`) druckt das aktive Dokument als Dokument:
gelesen, nicht bearbeitet; Seitenleiste, Tabs, Knöpfe und Verlauf von folio
bleiben vom Papier fern, und das Papier ist hell, wie auch immer der
Bildschirm ist. Jedes Widget druckt in seiner Druckform aus embed
(`DskEmbed.print.prepare`): ein BPMN- oder DMN-Diagramm ganz (eine DMN-Datei
mit ihren Entscheidungstabellen), jede draw.io-Seite, ein Prozess oder ein
Board ganz, eine API-Referenz als ihr statisches Dokument, ein Video als
Posterbild und Kapitel, Kanban und Kalender ohne ihre Bedienelemente. Dann
folgt der Druckdialog des Systems; ein PDF entsteht über „Als PDF exportieren“ (unten).

### PDF

**Datei → Als PDF exportieren** (`Cmd/Strg+Umschalt+P`) speichert das aktive
Dokument — wie angezeigt, mit ungespeicherten Änderungen —, und **Ordner als
PDF exportieren** (das Menü eines Projekts oder eines Ordners im Baum)
speichert einen ganzen Ordner als ein PDF. Der Dialog fragt einmal und merkt
es sich:

- Seitenformat (A4, A3, A5, Letter, Legal, Tabloid), Hoch- oder Querformat,
  Ränder (keine, schmal, normal, breit);
- der Titel oben auf jeder Seite, Seitenzahlen (`3 / 12`) unten;
- ein Inhaltsverzeichnis mit Links vor dem Text; Lesezeichen aus den
  Überschriften (die Gliederung des PDF, in einem getaggten PDF);
- Farben und Hintergründe der Zeichnungen.

Ein Ordner druckt in der Reihenfolge eines Buchs: in jedem Ordner zuerst
`index.md` oder `README.md`, dann seine Dokumente nach Namen, dann seine
Unterordner; jedes Dokument auf einer neuen Seite, Diagramm- und API-Dateien
mit ihrem Namen als Überschrift. Ein Link von einem Dokument auf ein anderes
wird ein Link innerhalb des PDF. Die Seiten werden in einem verborgenen
Fenster der Dokumentsitzung gesetzt — die Netzfreigabe gilt auch dort —, jedes
Widget in seiner Druckform; dann druckt Chromium sie als PDF.

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
