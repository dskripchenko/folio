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

## Das Fenster

Die Mitte gehört der Seite; die Bedienung liegt an ihren Rändern.

- **Links — der Arbeitsbereich.** Gemeinsam und die Projekte, jedes ein Baum
  seiner Dokumente. Oben: eine Datei öffnen, eine neue schnelle Notiz,
  einklappen. Jeder Abschnitt hat sein eigenes Menü: Gemeinsam — sein Ordner;
  Projekte — **+** fügt einen Ordner hinzu oder klont ein Repository, **⋯**
  zeigt die verborgenen Projekte. Der Branch eines Repositorys ist ein Chip
  neben seinem Namen. **Eingeklappt** (`Cmd/Strg+B`) ist die Seitenleiste eine
  schmale Leiste — Gemeinsam und jedes Projekt als seine Initialen —, und ein
  Klick fährt dessen Baum über der Seite aus, bis ein Dokument geöffnet ist.
- **Oben — die Tabs**, sonst nichts.
- **Die Toolbar des Editors schwebt über der Seite** und bleibt zur Hand, wie
  weit der Text auch nach unten geht; die Seite selbst hat keinen Rahmen. Im Modus **Markdown** nimmt der Text
  den ganzen Arbeitsbereich ein, von Rand zu Rand; **neben der Seite** treffen
  sich die zwei Hälften an einer Linie und scrollen jede für sich.
- **Rechts — die Leiste.** Ein Knopf zeigt, wie das Dokument gezeigt wird,
  und schaltet per Klick reihum die Modi — **Lesen**, **Visuell bearbeiten**,
  **Markdown**, **Markdown neben der Seite** (eine Zeichnung bietet Lesen und
  Bearbeiten, draw.io nur Lesen); ein Rechtsklick listet sie zur Auswahl. Dann der Verlauf,
  Drucken und PDF; unten die Einstellungen (das Theme: wie das System, hell,
  dunkel).

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
| Code, Daten, Logs, Konfiguration — jede Textdatei einer bekannten Sprache (17 Programmiersprachen, JSON, XML, Logs, TOML, INI, `.env`, CSV, diff, Dockerfile, Makefile, …) | nummerierte Zeilen in den Farben ihrer Sprache (`@dskripchenko/syntax`; die Sprache nach Name, Endung oder `#!`-Zeile); eine Datendatei (JSON, YAML, XML, TOML, CSV, INI, `.env`) wird geprüft — Fehler an ihren Zeilen markiert, ein Zähler im Kopf springt zu ihnen; Blöcke falten über die Pfeile neben den Nummern; eine große Datei (über 2 MB oder 20 000 Zeilen, bis 200 MB) zeichnet nur die sichtbaren Zeilen und ist über 64 MB nur lesbar; ein Log filtert nach Stufe (ein Stacktrace bleibt bei seinem Eintrag) und folgt, am Ende gelesen, dem Geschriebenen | der Code-Editor |
| anderer Text | als Text | der Code-Editor |

Der **Code-Editor** (`@dskripchenko/code-editor`) bearbeitet jede Textdatei,
die Notation eines Diagramms und AsyncAPI neben ihrer Vorschau: hervorgehoben
beim Tippen, gefaltet über die Pfeile neben den Nummern, eine Datendatei beim
Schreiben geprüft. Seine Tasten sind die von VS Code — Klammern und
Anführungszeichen schließen sich selbst, `Cmd/Ctrl+/` kommentiert Zeilen,
`Alt+↑/↓` verschiebt sie, `Cmd/Ctrl+D` fügt das nächste Vorkommen zu den
Cursorn hinzu, `Ctrl+Leertaste` vervollständigt aus den Wörtern der Datei. Die
Einrückung kommt aus der `.editorconfig` des Projekts, sonst aus der Datei
selbst; die Statuszeile zeigt Zeile und Spalte, die Einrückung, die
Zeilenumbrüche (LF oder CRLF, wie sie kamen) und die Sprache. Dateien bis
64 MB werden bearbeitet; eine größere wird gelesen.

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

Im Code-Editor werden die **Symbole** einer Datei — Funktionen, Klassen,
Methoden, Typen, Konstanten; Schlüssel und Abschnitte einer Konfiguration —
beim Tippen gelesen: die **Gliederung** (rechte Leiste) listet sie, das Symbol
mit der Einfügemarke markiert, ein Klick springt hin; Brotkrumen über dem Text
zeigen Projekt und Ordner der Datei, dann die Symbole um die Einfügemarke;
`Cmd/Strg+Umschalt+O` springt zu einem Symbol der Datei nach Namen,
`Cmd/Strg+Alt+O` zu einem jedes sichtbaren Projekts (seine Datei im Editor dort
geöffnet). Die Vervollständigung bietet die Namen der Projekte neben den
Wörtern der Datei.

**Aufgaben** (`Cmd/Strg+Umschalt+B` oder *Eine Aufgabe ausführen* unter den
Befehlen) sind die des Projekts: die Skripte von `package.json` (mit dem
Paketmanager, den die Lock-Datei nennt) und `composer.json`, die Ziele eines
`Makefile`, die Rezepte einer `justfile` und die Aufgaben aus
`.folio/settings.json`; die zuletzt ausgeführten zuerst. Eine Aufgabe läuft in
einem eigenen Konsolen-Tab mit ihrem Namen, der mit ihr endet. Ihre Ausgabe wird
nach **Problemen** gelesen — `Pfad:Zeile:Spalte: Meldung` (gcc, clang, go, ruff,
mypy, pytest, eslints Unix-Form), tsc, eslints Stylish-Blöcke, rustc, psalm —,
gezeigt in der Leiste **Probleme** (rechte Leiste, öffnet sich, wenn eine
Aufgabe welche findet), jedes ein Weg zu seiner Stelle und im Code-Editor
unterstrichen.

Ein Code-Projekt kann **beim Speichern formatieren** mit seinem eigenen
Formatierer — prettier (das des Projekts), pint, gofmt, ruff, rustfmt, black
oder einem eigenen Befehl, der den Text von stdin liest —, wenn
`.folio/settings.json` es verlangt; nur was der Formatierer änderte, wird
geändert, in einem Schritt rückgängig zu machen.

`.folio/settings.json` oben in einem Projekt enthält seine eigenen
Einstellungen, von Hand geschrieben (und mit ihm committet, wenn seine Leute
wollen):

```json
{
  "kind": "code",
  "indentUnit": "  ",
  "tabSize": 2,
  "formatOnSave": true,
  "formatter": "prettier",
  "tasks": [{ "name": "serve", "command": "php artisan serve" }]
}
```

Die Art gilt vor der erratenen, die Einrückung vor der von `.editorconfig`.
Eigene Tasten stehen in `folio-data/keybindings.json`, ohne Fenster dafür:
`[{ "key": "Mod-Shift-d", "command": "copyLineDown" }, { "key": "Mod-Alt-p",
"command": "folio.problems" }]` — die Befehle des Code-Editors mit ihren Namen,
die von folio mit `folio.` und der ID ihres Befehls; im Editor gelten seine
vor folios Kürzeln.

Ein Projekt ist eines aus **Notizen** oder aus **Code** — beim Hinzufügen
erraten (ein `package.json`, `composer.json`, `go.mod`, `Cargo.toml` … oben,
oder ein Git-Repository ohne Notizen neben seiner README macht es zu Code) und in
seinem Menü umgestellt. Ein Code-Projekt listet jede Datei, auch die mit Punkt
(`.github`, `.editorconfig`), und eine Datei, die kein Text ist, öffnet sich im
Programm des Systems; ein Speichern wird dort nie von selbst committet —
Commits entstehen von Hand. In einem Ordner unter Git bleibt, was `.gitignore`
(mit `.git/info/exclude` und der globalen Ausschlussdatei des Benutzers)
ausschließt, aus dem Baum, dem Gehe-zu-Datei und der Suche heraus, und der Baum
folgt einer `.gitignore`, während sie geschrieben wird; ein Ordner ohne Git
behält folios eigene Liste von Werkzeugordnern (`node_modules`, `vendor`,
`dist` …).

### Dateien und Ordner

Der Baum legt Dateien auch an und ändert sie: **Neue Notiz** und **Neuer
Ordner** im Rechtsklick-Menü eines Ordners oder Projekts (und im **…**-Menü von
„Gemeinsam“) — der Name wird an Ort und Stelle getippt, eine Notiz öffnet sich
sofort mit ihrem Titel als Überschrift; **Umbenennen…** (oder `F2`) bearbeitet
den Namen in seiner Zeile, die Endung bleibt; eine auf einen Ordner (oder ein
Projekt) gezogene Datei oder ein Ordner wird dorthin verschoben;
**Duplizieren** legt daneben eine Kopie an; **In den Papierkorb** (oder
`Entf`, `Cmd+Rücktaste`) fragt nach und legt sie in den Papierkorb des Systems,
aus dem sie sich zurückholen lässt. Geöffnete Dokumente folgen einer
Umbenennung oder Verschiebung; ein in den Papierkorb gelegtes schließt sich,
außer es hat ungespeicherte Änderungen. Ein Name mit `/ \ : * ? " < > |` oder
einer, den es schon gibt, wird an Ort und Stelle abgelehnt, mit dem Grund.

### Zwei Dokumente nebeneinander

**Daneben öffnen** im Menü eines Tabs (oder `Cmd/Strg+\`, oder der Befehl)
zeigt das Dokument in einer zweiten Ansicht rechts; die Hauptansicht behält
einen anderen Tab. Jede Ansicht hat ihr eigenes Dokument und ihren Bildlauf;
ein Klick in eine Ansicht macht ihr Dokument zum aktuellen, Panels, Suche und
Verlauf folgen ihm. Der Teiler zwischen den Ansichten lässt sich ziehen, der
Anteil bleibt erhalten. **Zurück in die Hauptansicht** (oder erneut
`Cmd/Strg+\`) schließt die Seitenansicht, das Dokument bleibt in einem Tab
offen; das Schließen seines Tabs schließt die Ansicht ebenfalls. Gedruckt wird
nur das aktuelle Dokument.

### Links zwischen Notizen

`[[Notiz]]` verlinkt eine Notiz über ihren Namen, wo immer sie im selben Projekt
(oder in Gemeinsam) liegt: zuerst der Ordner der Notiz selbst, dann der kürzeste
Pfad. `[[Notiz#Überschrift]]` öffnet sie an dieser Überschrift, `[[Notiz|Text]]`
zeigt einen anderen Text, `![[bild.png]]` ein Bild. Ein Link auf keine Notiz
erscheint blasser; ein Klick legt die Notiz neben der verlinkenden an und öffnet
sie. Im Editor öffnet sich ein Link mit `Cmd/Ctrl`+Klick, und die Eingabe von `[[`
schlägt die Notizen des Projekts vor. Eine im Baum umbenannte oder verschobene
Notiz oder ein Ordner nimmt die Links mit: `[[…]]`-Links und relative Links
(`[Text](notes/plan.md)`, Bilder) in den Notizen des Projekts werden neu
geschrieben, ebenso die relativen Links der verschobenen Notiz selbst; Notizen,
die mit ungespeicherten Änderungen offen sind, bleiben unverändert.

**Das Link-Panel** (das Link-Symbol auf der rechten Leiste) zeigt für die
sichtbare Notiz die Notizen, die auf sie verlinken, ihre eigenen Links — ein
fehlender blasser, ein Klick legt ihn an — und die Notizen, die sie ohne Link
nennen; **Verlinken** macht aus einer solchen Erwähnung `[[Notiz]]` (die
Schreibweise bleibt als Text). Ein Klick auf eine Zeile öffnet die Notiz dort.
Das Panel folgt der sichtbaren Notiz und dem Getippten.

### Tagesnotizen und Vorlagen

`Cmd/Strg+Umschalt+D` (oder **Notiz des Tages** unter den Befehlen) öffnet die
Notiz des Tages — `JJJJ-MM-TT.md` im Ordner der Tagesnotizen (`Daily` in
„Gemeinsam“, sofern kein anderer gewählt ist) —, bei Bedarf angelegt, aus der
Vorlage `Daily`, wenn es sie gibt. **Die Tagesnotiz davor / danach** führt zur
nächsten vorhandenen. Eine Vorlage ist eine Notiz im Vorlagenordner
(`Templates` in „Gemeinsam“): **Vorlage einfügen…** setzt sie an die
Einfügemarke, **Neue Notiz aus Vorlage…** macht eine Schnellnotiz daraus;
`{{title}}`, `{{date}}`, `{{time}}` und `{{date:DD.MM.YYYY}}` werden ausgefüllt.
Beide Ordner werden im Einstellungsmenü gewählt.

`![[Notiz]]` bettet eine andere Notiz in diese ein — gezeichnet wie beim Lesen,
in einem Rahmen mit ihrem Link; `![[Notiz#Überschrift]]` bettet den Abschnitt
ein. Eine Einbettung in einer Einbettung wird ebenfalls gezeichnet (drei Ebenen
tief), eine Notiz, die sich selbst einbettet, bleibt ein Link, und im Editor ist
eine Einbettung ihr Link, wie geschrieben erhalten.

Andere Namen einer Notiz — `aliases:` in ihren Eigenschaften (`aliases: [Fahrplan]`)
— gelten in Links als ihr Name: `[[Fahrplan]]` erreicht sie, wenn keine Datei so
heißt, und `[[` bietet sie an und schreibt `[[Roadmap|Fahrplan]]`.

### Die Gliederung

Das Gliederungs-Panel (auf der rechten Leiste oder unter den Befehlen) zeigt
die Überschriften der sichtbaren Notiz, nach Ebene eingerückt, während sie
geschrieben wird; ein Klick führt zur Überschrift — in der Quelle setzt er die
Einfügemarke auf ihre Zeile —, und der sichtbare Abschnitt wird beim Scrollen
markiert.

### Rechtschreibung und Statuszeile

Die Rechtschreibung wird beim Schreiben geprüft — auf macOS und Windows vom
System, offline; unter Linux lädt Chromium die Wörterbücher, daher ist sie dort
aus, bis sie im Einstellungsmenü eingeschaltet wird. Das Menü eines Felds bietet
Korrekturen, **Zum Wörterbuch hinzufügen** sowie Ausschneiden, Kopieren und
Einfügen. Unter der Seite zeigt die Statuszeile Wörter, Zeichen und Lesezeit
des Dokuments, in der Markdown-Quelle Zeile und Spalte der Einfügemarke.

### Der Graph

Das Graph-Panel (auf der rechten Leiste oder unter den Befehlen) zeichnet die
Notizen des sichtbaren Projekts als Punkte und ihre Links als Linien —
**Diese Notiz**: die Notizen bis zu zwei Links von der sichtbaren entfernt,
**Alle**: das ganze Projekt. Die Größe eines Punkts ist die Zahl seiner Links,
die sichtbare Notiz ist farbig; der Zeiger auf einem Punkt hebt ihn und seine
Nachbarn hervor, ein Klick öffnet ihn; das Mausrad zoomt, Ziehen verschiebt
das Bild.

### Lesezeichen

Eine Datei griffbereit: **Zu Lesezeichen** im Menü eines Tabs, im Menü einer
Datei im Baum oder unter den Befehlen. Die Lesezeichen stehen über
„Gemeinsam“; ein Klick öffnet eines, sein Menü entfernt es. Ein Lesezeichen
folgt seiner Datei, wenn sie in folio umbenannt oder verschoben wird; eines,
dessen Datei anderswo verschwunden ist, bleibt blass stehen.

### Boards und Kalender

Eine `*.kanban.md`-Datei öffnet sich als Kanban-Board, eine `*.calendar.md`-Datei
als Kalender — beide als Markup geschrieben, das jeder Editor lesen kann
(Spalten `## …` und Karten `- …`; Termine `2026-11-03 10:00 …`, Wiederholungen
`every mon …`). **Bearbeiten** macht sie auf sich selbst bearbeitbar: Karten
gezogen und hinzugefügt, Termine verschoben, die Quelle in einem eigenen Tab;
die Datei behält das Markup und ändert sich nur, wo bearbeitet wurde. **Neues
Kanban-Board** und **Neuer Kalender** unter den Befehlen legen eines neben der
sichtbaren Notiz an.

### Whiteboards

Eine `*.board`-Datei öffnet sich als Whiteboard (`@dskripchenko/board`):
Haftnotizen, Formen, Text, Rahmen, Verbinder, Emoji, Stift und Marker auf
einer endlosen Fläche. **Bearbeiten** zeichnet darauf; die Datei behält das
JSON des Boards, eingerückt, sodass ein Diff zeigt, was sich bewegt hat.
**Neues Whiteboard** unter den Befehlen legt eines neben der geöffneten
Notiz an.

### Aufgaben

Das Aufgaben-Panel (auf der rechten Leiste oder unter den Befehlen) listet die
`- [ ]`-Aufgaben des sichtbaren Projekts nach Fälligkeit — **Überfällig**,
**Heute**, **Später**, **Ohne Datum** — und mit **Alle** auch die erledigten; ein
Tag wird `📅 2026-11-10`, `@2026-11-10` oder `due:2026-11-10` geschrieben. Eine
Aufgabe wird im Panel abgehakt oder wieder geöffnet, in ihrer Notiz (nicht in
einer mit ungespeicherten Änderungen); ihr Text öffnet die Notiz dort.

### Folien

**Als Folien zeigen** (`F5` oder unter den Befehlen) zeigt die Notiz bildschirmfüllend,
Folie für Folie: Folien sind ihre Teile zwischen `---`-Zeilen mit einer
Leerzeile davor (außerhalb von Code und Eigenschaften, wie in Marp und
reveal.js). Pfeiltasten, Leertaste, Bild auf/ab, Pos1 und Ende oder ein Klick
auf die linke oder rechte Hälfte blättern; Escape beendet die Vorführung.
**Folien als PDF exportieren** (unter den Befehlen oder in der Leiste der
Vorführung) schreibt eine 16:9-Seite pro Folie.

### Vorschau

Ruht der Zeiger auf einem `[[Link]]` oder einem Link zu einer Notiz, erscheint
die Notiz in einem Fenster am Link — gezeichnet wie beim Lesen, an der
Überschrift, die der Link nennt. Das Fenster scrollt; ein Klick darin öffnet
die Notiz; Wegbewegen oder Escape schließt es. Im Editor wartet die Vorschau
auf `Cmd/Strg`.

### Tags und Eigenschaften

`#todo`, `#work/urgent` in einer Notiz sind Tags (ein Buchstabe ist nötig:
`#123` ist keiner, `C#` auch nicht); die `tags:` ihrer Eigenschaften ebenso.
Die Eigenschaften einer Notiz — ein YAML-Front-Matter an ihrem Anfang,
`---`-Zeilen um `Schlüssel: Wert` — erscheinen als Tabelle über ihr und bleiben
im Editor genau wie geschrieben. Das Tag-Panel (das Tag-Symbol auf der rechten
Leiste oder der Befehl) zeigt die Tags des sichtbaren Projekts mit der Zahl
ihrer Notizen, verschachtelte unter ihren Eltern; ein geöffneter Tag zeigt
seine Notizen, ein Klick öffnet eine; der Filter findet einen Tag nach Namen.
Ein Klick auf einen Tag in einer Notiz öffnet das Panel auf ihm (im Editor mit
`Cmd/Strg`).

### Formeln und Hervorhebungen

TeX-Formeln werden gezeichnet, wie sie gelesen werden: `$E = mc^2$` in einer
Zeile, `$$ … $$` (oder ein ` ```math `-Block) in eigenen Zeilen — von folios
eigenem `@dskripchenko/math`, als MathML. Ein Preis (`$5 oder $10`) bleibt
Text. Im visuellen Editor ist eine Formel ein Stück: ein Doppelklick bearbeitet
ihr TeX, **Formel** im `/`-Menü fügt eine hinzu, und die Datei behält sie genau
wie geschrieben; die Markdown-Quelle hebt ihr TeX hervor. Klammern und Wurzeln
strecken sich in einer Mathematikschrift: der des Systems (macOS, Windows)
oder STIX Two Math, die folio mitbringt (SIL Open Font License). `==Text==`
wird hervorgehoben.

### Bilder

Ein in eine Notiz eingefügtes Bild (ein Bildschirmfoto, ein kopiertes Bild) oder
ein auf den Editor gezogenes — im visuellen Modus oder in der Quelle — wird in
`attachments/` neben der Notiz gespeichert und an der Einfügemarke verlinkt:
unter seinem eigenen Namen, ein namenloses Bildschirmfoto als `Pasted image` mit
der Uhrzeit; ein vergebener Name bekommt eine Nummer. Die Bild-Schaltfläche des
Editors nimmt Bilder von der Festplatte ebenso. Eine noch nicht gespeicherte
Schnellnotiz bittet, sie zuerst zu speichern — ihre Bilder brauchen einen Ordner.

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

### Änderungen

`Strg+Umschalt+G` auf jedem System (oder der Commit-Knopf in der rechten
Leiste) öffnet **Änderungen**, wie die Quellcodeverwaltung eines Code-Editors:
die im Arbeitsordner geänderten Dateien und die für den nächsten Commit
vorgemerkten, jede mit ihrem Buchstaben (**A** hinzugefügt, **M** geändert,
**D** gelöscht, **U** nicht verfolgt). Eine Datei kommt mit ihrem `+` und `−`
in den Index und wieder heraus (oder alle auf einmal aus der Überschrift der
Gruppe), ihre Änderungen werden mit dem Pfeil verworfen — nach einer Frage, es
lässt sich nicht rückgängig machen —, und ihr Name öffnet sie. Eine Nachricht
und **Commit** (oder `Cmd/Strg+Enter`) committen das Vorgemerkte. Die Leiste
folgt dem sichtbaren Dokument und sieht neu nach, wenn sich die Platte ändert.
In einem Code-Projekt entstehen Commits so: ein Speichern committet dort nie
von selbst.

### Änderungen im Rand, wer eine Zeile geändert hat

Eine Datei unter Git, im Code-Editor bearbeitet, markiert beim Tippen ihre
Änderungen gegenüber dem letzten Commit neben den Zeilennummern: ein grüner
Balken für hinzugefügte Zeilen, ein blauer für geänderte, eine rote Kerbe, wo
Zeilen gelöscht wurden. Ein Klick auf eine Marke zeigt, wie die Zeilen waren,
mit **Zurücksetzen**, um diese Änderung zurückzunehmen. **Wer hat jede Zeile
geändert (blame)** unter den Befehlen fügt eine Spalte neben den Nummern hinzu
— der Autor und wie lange her, beim Darüberfahren die Nachricht des Commits,
Autor und Datum; derselbe Befehl nimmt sie wieder weg. Es nutzt das Git des
Systems, wenn es eines gibt, sonst liest folio die Geschichte der Datei selbst.

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
| `Cmd/Strg+T` | zu einer Datei nach Namen gehen |
| `Cmd/Strg+K`, `F1` | die Befehle: jede Aktion nach ihrem Namen |
| `Cmd/Strg+Umschalt+D` | die Notiz des Tages |
| `Cmd/Strg+\` | das Dokument neben der Hauptansicht, oder die Seitenansicht schließen |
| `Cmd/Strg+Umschalt+F` | in den Dateien suchen |
| `Cmd/Strg+F` | im Dokument suchen |
| `Cmd+G`, `Cmd+Umschalt+G` (macOS); `F3`, `Umschalt+F3` | der nächste Treffer, der vorige |
| `Strg+G` | zu einer Zeile gehen, im Code-Editor (auf jedem System) |
| `Strg+Umschalt+G` | die Änderungen: vormerken, committen (auf jedem System) |
| `Cmd/Strg+Umschalt+O`, `Cmd/Strg+Alt+O` | ein Symbol der Datei, der Projekte |
| `Cmd/Strg+Umschalt+B` | eine Aufgabe des Projekts ausführen |

## Suchen

`Cmd/Strg+Umschalt+F` (**Bearbeiten → In Dateien suchen** oder die Lupe auf der
rechten Leiste) öffnet neben der Seite ein Feld, das den Text der Dateien
durchsucht — alle, „Gemeinsam“ oder ein Projekt — mit denselben drei Optionen.
Die Treffer kommen, sobald sie gefunden sind, nach Datei, jede Zeile mit ihrem
Treffer; ein Klick öffnet die Datei und setzt die Suchleiste auf diesen
Treffer. Binärdateien, Dateien über 8 MB und die vom Gehe-zu-Datei
ausgelassenen Ordner werden nicht durchsucht; höchstens 200 Treffer je Datei
und 5 000 insgesamt werden gelistet.

Filter grenzen die durchsuchten Dateien ein: `tag:arbeit` (auch verschachtelte
Tags), `path:notes/`, `file:plan` (ein Wert in Anführungszeichen darf Leerzeichen
enthalten); ohne Text listet ein Filter allein seine Dateien.

Der Pfeil vor der Suchanfrage öffnet **Ersetzen**: jeder Treffer zeigt, was aus
ihm wird, Häkchen bestimmen die beteiligten Dateien, und **Alle ersetzen**
fragt mit der Anzahl noch einmal nach, bevor es schreibt. Mit einem regulären
Ausdruck bezeichnen `$1`, `$&` und ähnliche seine Gruppen; ohne ihn wird der
Text genommen, wie er ist. Eine mit ungespeicherten Änderungen geöffnete Datei
wird ausgelassen (das wird gesagt), damit keine Seite verloren geht; eine
geöffnete ohne Änderungen zeigt den neuen Text. Ein Ordner mit Verlauf erhält
einen Commit für die Ersetzung — `Replace "a" with "b"` —, nicht einen je Datei.

`Cmd/Strg+K` oder `F1` (**Ansicht → Befehle**) öffnet eine Palette der Aktionen
von folio — die der Menüs und Leisten —, ebenso nach ihrem Namen gefunden, jede
mit ihren Tasten; die zuletzt benutzten kommen zuerst, und was gerade nicht
laufen kann (Speichern ohne offenes Dokument, ein schon aktiver Modus), wird
nicht angeboten.

`Cmd/Strg+T` (**Datei → Gehe zu Datei**) öffnet eine Palette aller Dateien,
die folio öffnet, in „Gemeinsam“ und den sichtbaren Projekten, geordnet, während
der Name getippt wird: die Zeichen in Reihenfolge, nicht unbedingt beieinander —
`rn` findet `release-notes.md`, die Anfangsbuchstaben der Wörter zählen am
meisten, ein Treffer im Namen mehr als einer in den Ordnern. Pfeile wählen,
Enter öffnet, Escape verlässt. Die Liste wird je Ordner einmal erstellt und
gehalten, bis dort eine Datei hinzukommt oder verschwindet; Ordner mit
Abhängigkeiten und Build-Ausgaben (`vendor`, `dist`, `build`, `target`,
`coverage` …) fehlen darin, obwohl der Baum sie zeigt.

`Cmd/Strg+F` (**Bearbeiten → Suchen**) öffnet eine Leiste über der Seite: jeder
Treffer ist markiert, der aktuelle wird in den Blick gebracht; Enter und
Umschalt+Enter gehen sie durch, der Zähler zeigt, wo man ist. **Aa** beachtet
die Groß-/Kleinschreibung, **ab** sucht ganze Wörter (jeder Schrift), **.\***
nimmt einen regulären Ausdruck. Lesen und der visuelle Editor durchsuchen die
Seite, wie sie gezeichnet ist — ein Treffer läuft nie von einem Absatz in den
nächsten, und die Seite selbst bleibt unberührt; die Markdown-Quelle durchsucht
ihr Feld und eine Datei im Code-Editor ihren ganzen Text, die Treffer darin
markiert, und Escape lässt den aktuellen
Treffer dort ausgewählt; eine große Datei wird ganz durchsucht, nicht nur die
sichtbaren Zeilen. Ändert sich die Seite unter der Leiste — eine Bearbeitung,
die Datei auf der Festplatte —, wird erneut gesucht.

## Konsolen

`` Strg+` `` (**Ansicht → Konsole** oder der Konsolen-Knopf auf der rechten
Leiste) öffnet unter der Seite ein Feld mit Ihrer Shell — zsh oder bash, wie Ihr
Terminal sie startet, PowerShell unter Windows — in „Gemeinsam“; **Hier eine
Konsole öffnen** im Menü eines Projekts oder Ordners öffnet eine in diesem
Ordner. Tabs halten mehrere; **+** öffnet eine weitere im selben Ordner, das ×
eines Tabs beendet seine Shell. Vollbildprogramme — `vim`, `htop`, `less`, `mc`
— funktionieren wie in einer Terminal-App, mit der Maus, wo sie danach fragen;
die Höhe des Felds zieht man an seiner Oberkante, es folgt dem hellen oder
dunklen Thema des Fensters. Außerhalb des Mac gehört Strg mit einem Buchstaben
in einer Konsole der Shell (^W, ^E, ^P …), nicht den Kürzeln von folio — außer Strg+F, das in der Ausgabe sucht. Die
Konsolen enden mit dem Fenster.

Bei zsh, bash und PowerShell ergänzt folio den Start der Shell ein wenig (nach
Ihren eigenen Startdateien, die wie immer laufen): Jeder Befehl bekommt neben
seiner Eingabeaufforderung eine Marke — grün bei Erfolg, rot bei Fehler,
pulsierend, solange er läuft; beim Darüberfahren Befehl, Exit-Code und Dauer;
ein Klick wählt seine Ausgabe aus. Der Tab zeigt, was läuft, und den Ordner
(folgt `cd`), einen Punkt, wenn ein Befehl fehlschlug oder ein Tab im
Hintergrund etwas ausgab. `Cmd+↑`/`Cmd+↓` (`Strg+Umschalt+↑`/`↓` außerhalb des
Mac) gehen von Befehl zu Befehl, `Cmd+K` (`Strg+Umschalt+K`) leert, `Cmd+D`
(`Strg+Umschalt+D`) öffnet eine zweite Konsole daneben; `Cmd+F` in einer Konsole
sucht in ihrer Ausgabe. Ein Pfad in der Ausgabe — `src/app.ts:12:3` — öffnet
sich mit Cmd (Strg) und Klick in folio an seiner Zeile; eine aus dem Baum (oder
dem System) gezogene Datei wird als ihr Pfad getippt. Der Rechtsklick bietet
Kopieren, Einfügen, Alles auswählen, Suchen, Leeren, Teilen, das Feld neben der
Seite oder im ganzen Fenster. `FOLIO_SHELL_INTEGRATION=0` startet Shells, wie
sie sind. Gezeichnet von `@dskripchenko/terminal`, die
Shell läuft in `node-pty`.

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

## Aktualisierungen

Einmal am Tag beim Start schaut folio nach der neuesten Version auf GitHub.
Eine neuere wird nach `folio-data/update/` geladen, gegen die daneben
veröffentlichte `.sha256` geprüft und dort entpackt; sie ersetzt das Programm,
wenn folio geschlossen wird — `.app` oder AppImage werden an ihren Platz
umbenannt, unter Windows werden die Dateien des Ordners überschrieben, sobald
folio beendet ist (`folio-data/` bleibt unberührt) — oder sofort mit
**Neu starten und aktualisieren** in den Einstellungen. Im Hintergrund läuft
nichts. **Nach Updates suchen** prüft jetzt; **Täglich nach Updates suchen**
schaltet die tägliche Prüfung ab.

Die Prüfsumme belegt, dass das Archiv das in der Version genannte und
vollständig ist; sie kommt über TLS aus derselben Version und belegt daher
nicht, wer die Version erstellt hat. Dafür gibt es die Herkunftsbestätigung
des Builds: `gh attestation verify folio-….zip --repo dskripchenko/folio`.

## Ein Fenster

Ein zweiter Start holt das laufende folio nach vorn, statt eine zweite Kopie zu
starten; Dokumente öffnen sich als Tabs dieses Fensters.
