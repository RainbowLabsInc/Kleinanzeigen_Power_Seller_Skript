<div align="center">

<img src="assets/logo.png" alt="RainbowlabsInc" width="96">

# 📦 Kleinanzeigen – PowerSeller

**Userscript für alle, die auf Kleinanzeigen.de viel verkaufen, privat oder mit PRO-Konto: Bausteine für Nachrichten und Anzeigentexte, eine Warnung vor typischen Betrugsmaschen, unter „Meine Anzeigen“ ein Verlauf der Besucher mit eigenen Notizen, eine Warteliste für Interessenten und ein Verkaufsbuch.**

[![Version](https://img.shields.io/badge/version-0.5.0-blue?style=flat-square)](https://github.com/RainbowLabsInc/Kleinanzeigen_Power_Seller_Skript/raw/main/powerseller.user.js)
[![Plattform](https://img.shields.io/badge/plattform-Kleinanzeigen.de-green?style=flat-square)](https://www.kleinanzeigen.de)
[![Userscript](https://img.shields.io/badge/Tampermonkey-Violentmonkey-black?style=flat-square&logo=tampermonkey)](#%EF%B8%8F-installation)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

*Chrome · Firefox · Edge · Kein eigener Server · Kein Tracking · Jedes Modul einzeln abschaltbar*

<a href="https://github.com/RainbowLabsInc/Kleinanzeigen_Power_Seller_Skript/raw/main/powerseller.user.js"><img src="assets/installieren.svg" alt="Installieren: PowerSeller (Tampermonkey)" width="320" height="60"></a>

</div>

---

> **Vorabversion.** Bausteine, Betrugswarnung, „Meine Anzeigen“, Verkaufsbuch und Darstellung sind an den echten Seiten getestet (privates Konto). Die Warteliste in den Nachrichten bisher nur an einer gespeicherten Seite. Rückmeldungen bitte als [Issue](https://github.com/RainbowLabsInc/Kleinanzeigen_Power_Seller_Skript/issues).

Wer viel verkauft, schreibt jeden Tag dieselben Antworten: „Ja, ist noch da“, „Preis ist fest“, „Versand geht als DHL-Paket“. Dazu kommen Nachrichten, die nur so tun, als wollte jemand kaufen, und die Frage, welche Anzeige überhaupt noch jemand ansieht. **Der PowerSeller nimmt dir das Tippen ab, warnt dich vor den bekannten Maschen und merkt sich, wie sich deine Anzeigen entwickeln**, lokal in deinem Browser.

| Modul | Was es macht |
|---|---|
| 💬 **Bausteine** | Button „Bausteine“ über dem Nachrichtenfeld und über der Beschreibung beim Einstellen: eigene Texte mit Platzhaltern per Klick oder Taste 1 … 9 einfügen |
| ⚠️ **Betrugswarnung** | Markiert Nachrichten mit nachgemachten Bezahl- oder Versandlinks, „Geld freigeben“, Kurier-Abholung, Fragen nach Kartendaten oder SMS-Codes, Überzahlung |
| 📈 **Meine Anzeigen** | Verlauf von Besuchern und Merkern („+28 Besucher seit 17.10.“), Hinweis auf Ladenhüter, eigene Notiz pro Anzeige, Summen über der Liste, CSV-Export |
| 👥 **Interessenten** | Warteliste pro Anzeige mit Status und Notiz, „Als Nächstes“, Hinweis bei Namen, die schon einmal nicht erschienen sind. In den Nachrichten: Notiz der Anzeige, Warteliste und das Gegenüber mit einem Klick auf die Liste setzen |
| 📒 **Verkaufsbuch** | „Verkauft …“ an jeder Anzeige: Endpreis, Zahlungsart, Einkaufspreis. Summen pro Monat und Jahr, Gewinn, Stand zur Meldegrenze, CSV-Export |

**Gedacht als Hilfe, nicht als Bot:** Das Script schickt nichts von selbst ab, stellt nichts ein und schiebt nichts hoch. Jede Aktion löst du mit einem Klick aus.

---

## 💬 Bausteine

* 🧩 **Einfügen:** Sobald du in ein Nachrichtenfeld klickst, erscheint darüber **„Bausteine“**. Ein Klick zeigt deine Antworten, ein weiterer fügt sie an der Schreibmarke ein. Schneller geht's mit den Tasten **1 … 9**, solange die Auswahl offen ist.
* 🏷️ **Platzhalter:** In geschweiften Klammern, z. B. `{Abholort}` oder `{Versand}`. Sie werden durch deine Angaben ersetzt. Fehlt eine Angabe, bleibt der Platzhalter stehen und ist markiert, sodass du direkt lostippen kannst.
* 🪄 **Automatisch gefüllt:** `{Name}` (dein Gegenüber in der Unterhaltung), `{Titel}` (die Anzeige) und `{Preis}` (beim Einstellen aus dem Formular; in den Nachrichten, sobald die Anzeige einmal unter „Meine Anzeigen“ zu sehen war). Aus „Hallo {Name}, {Titel} ist noch da“ wird „Hallo Kai, Bosch Turbinenhäcksler ist noch da“.
* 📝 **Auch beim Einstellen:** Beim Aufgeben und Bearbeiten einer Anzeige sitzt der Button über der Beschreibung, in jeder Kategorie. Dort erscheinen nur Bausteine für Anzeigentexte (z. B. „Privatverkauf, daher keine Garantie …“), jeweils als eigener Absatz.
* ✏️ **Bearbeiten:** In den Einstellungen anlegen, umbenennen, sortieren, löschen und festlegen, ob ein Baustein bei Nachrichten, Anzeigentexten oder beidem erscheint. Acht Beispiele sind schon da.
* 📤 **Teilen:** Export und Import als JSON-Datei, z. B. damit im Team alle dieselben Antworten haben.
* ↩️ **Rückgängig:** Eingefügter Text lässt sich mit Strg+Z wieder entfernen.

> **PRO-Konten** bekommen von Kleinanzeigen je nach Paket automatische Antwortvorschläge. Die Bausteine sind etwas anderes: feste Texte, die du selbst formulierst und die immer gleich lauten.

## ⚠️ Betrugswarnung

* 🔴 **Rot (hohes Risiko):** Links auf Seiten, die nach Kleinanzeigen, Versand oder Bezahlen klingen, es aber nicht sind (z. B. `kleinanzeigen-sicher.de`). Außerdem Fragen nach Kartendaten, Bankzugang oder SMS-Codes, Überzahlung mit Bitte um Rücküberweisung, und jeder fremde Link zusammen mit einer weiteren Auffälligkeit.
* 🟡 **Gelb (Hinweis, abschaltbar):** „Geld erhalten oder freigeben“, Abholung durch Kurier oder Spedition, Wechsel zu WhatsApp oder Telegram, Links auf fremde Seiten.
* 🙈 **Ausblenden:** Jede Warnung lässt sich bis zum Neuladen wegklicken.
* 🎯 **Nur fremde Nachrichten:** Geprüft wird, was dein Gegenüber schreibt, nicht deine eigenen Nachrichten und nicht die Sicherheitshinweise von Kleinanzeigen.
* 🔒 **Ohne Anfragen:** Das Modul liest nur, was auf der Seite steht. Es lädt nichts nach und schickt nichts weg.

Die Warnung ist eine Hilfe, keine Garantie. Sie erkennt nicht jede Masche, und auch harmlose Nachrichten können markiert werden.

## 📈 Meine Anzeigen

* 📊 **Verlauf:** Kleinanzeigen zeigt bei jeder Anzeige „N Besucher“ und „N mal gemerkt“, aber nur den aktuellen Stand. Das Script merkt sich bei jedem Aufruf von „Meine Anzeigen“ einen Stand pro Tag und schreibt darunter, was seit dem letzten Stand dazugekommen ist, z. B. **„+28 Besucher, +1 gemerkt seit 17.10.“**. Ein Klick zeigt die letzten 14 Stände.
* 🐌 **Ladenhüter:** Kam seit mindestens 7 Tagen kein neuer Besucher dazu, steht ein Hinweis da (abschaltbar).
* 📝 **Notiz pro Anzeige:** Lagerort, Artikelnummer, Einkaufspreis … nur für dich, nur in deinem Browser.
* ➕ **Summen:** Über der Liste stehen Zahl der Anzeigen, Besucher (mit neuen seit dem letzten Stand), Merker und die Summe der Preise, jeweils für die aufgerufene Seite.
* 📤 **Export:** Alle gemerkten Anzeigen mit letztem Stand und Notiz als CSV (in den Einstellungen), z. B. für Excel.

Der Verlauf beginnt mit deinem ersten Aufruf. Was davor war, weiß das Script nicht. Anzeigen, die noch „Bald Online“ sind, bekommen keinen Ladenhüter-Hinweis. Ein Ablaufdatum zeigt „Meine Anzeigen“ nicht an, darum gibt es (noch) keinen Hinweis auf ablaufende Anzeigen.

## 👥 Interessenten

* 📋 **Warteliste an jeder Anzeige** unter „Meine Anzeigen“: Name, Status (wartet, reserviert, gekauft, abgesagt, nicht erschienen) und Notiz („bietet 40 €, kommt Sa“). Die Reihenfolge ist die Warteliste, mit ↑ ↓ änderbar. Darüber steht **„Als Nächstes: …“** oder **„Reserviert für …“**.
* 💬 **In den Nachrichten:** Unter dem Kopf der geöffneten Unterhaltung erscheint eine Leiste mit der Notiz der Anzeige und der Warteliste. **„+ Kai auf die Warteliste“** setzt dein Gegenüber mit einem Klick auf die Liste; Status und Notiz änderst du direkt dort.
* ⚠️ **Nicht erschienen:** Taucht ein Name auf, der schon einmal nicht erschienen ist (auch bei einer anderen Anzeige), steht ein Hinweis dabei.
* 🏷️ **In der Liste der Unterhaltungen:** Neben dem Titel steht der Status des Gegenübers, z. B. „Reserviert“, „Wartet, Platz 2“ oder „⚠ Nicht erschienen“. So siehst du die Lage, ohne jede Unterhaltung zu öffnen.
* 📒 **Gekauft → Verkaufsbuch:** Steht jemand auf „Gekauft“, trägst du den Verkauf mit einem Klick ein. Artikel, Preis, Käufer und (aus „EK …“ in der Notiz) der Einkaufspreis sind schon ausgefüllt.

Namen und Notizen bleiben in deinem Browser.

## 📒 Verkaufsbuch

* ✅ **Verkauft …:** An jeder Anzeige unter „Meine Anzeigen“. Endpreis (vorgeschlagen: der Anzeigenpreis), Datum, Zahlungsart (bar, über Kleinanzeigen, PayPal, Überweisung), Abholung oder Versand, optional Einkaufspreis und Notiz. Steht in der Notiz der Anzeige z. B. „EK 20 €“, wird der Einkaufspreis vorgeschlagen. Mehrere Stück aus einer Anzeige? Einfach „Noch eins verkauft …“.
* 📊 **Übersicht:** Button **„📒 Verkaufsbuch“** über der Liste oder Tampermonkey-Menü → **„PowerSeller: Verkaufsbuch“**. Verkäufe, Umsatz und Gewinn pro Jahr, Tabelle nach Monaten, alle Verkäufe des Jahres. Verkäufe ohne Anzeige (z. B. schon gelöscht) lassen sich dort nachtragen.
* 🧾 **Meldegrenze:** Plattformen melden Verkäufer ans Bundeszentralamt für Steuern, wenn sie in einem Jahr 30 Verkäufe oder mehr als 2.000 € erreichen (DAC7). Das Verkaufsbuch zeigt, wie weit deine eingetragenen Verkäufe „über Kleinanzeigen bezahlt“ davon entfernt sind. Kleinanzeigen zählt nach eigener Aussage nur Verkäufe über das eigene Bezahlsystem; maßgeblich ist die „Verkaufsübersicht“ in deinem Profil. Das ist ein Hinweis, **keine Steuerberatung**.
* 📤 **Export:** Alle Verkäufe als CSV, z. B. für Excel oder die Buchhaltung.

Das Verkaufsbuch kennt nur, was du einträgst. Es liegt nur in deinem Browser, darum ab und zu sichern (siehe unten).

## 💾 Datensicherung

Alle Daten des PowerSellers liegen nur in deinem Browser. Ein neuer Rechner oder geleerte Browserdaten, und sie wären weg. Darum:

* 📥 **Sicherung herunterladen:** In den Einstellungen unter **Datensicherung**. Eine einzige Datei mit Bausteinen, Verlauf, Notizen, Interessenten, Verkaufsbuch und Einstellungen.
* 📤 **Sicherung einspielen:** Datei wählen, dann zeigt eine Vorschau, was drinsteht und was du jetzt hast. Erst **„Übernehmen“** ersetzt deine Daten.
* ⏰ **Erinnerung:** Ist die letzte Sicherung mehr als 30 Tage her (und gibt es etwas zu sichern), erscheint unten links ein Hinweis mit **„Jetzt sichern“** oder **„Später“** (eine Woche Ruhe). Beim Einstellen einer Anzeige stört er nicht.

---

## ⚙️ Installation

**Schritt 1: Userscript-Erweiterung installieren** (kostenlos)

| Browser | Erweiterung |
|---|---|
| Chrome / Edge | [Tampermonkey](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) oder [Violentmonkey](https://chrome.google.com/webstore/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag) |
| Firefox | [Tampermonkey](https://addons.mozilla.org/de/firefox/addon/tampermonkey/) oder [Violentmonkey](https://addons.mozilla.org/de/firefox/addon/violentmonkey/) |

> **Chrome/Edge:** Bei neueren Tampermonkey-Versionen muss in den Erweiterungs-Details „Benutzerskripte zulassen“ bzw. der Entwicklermodus aktiviert sein.

**Schritt 2: PowerSeller installieren**

<a href="https://github.com/RainbowLabsInc/Kleinanzeigen_Power_Seller_Skript/raw/main/powerseller.user.js"><img src="assets/installieren.svg" alt="Installieren: PowerSeller (Tampermonkey)" width="320" height="60"></a>

*(Alternativ: Inhalt von `powerseller.user.js` kopieren und in Tampermonkey als neues Skript einfügen.)*

Updates holt sich Tampermonkey automatisch aus diesem Repo.

**Einstellungen:** Tampermonkey-Menü → **„PowerSeller: Einstellungen“**, oder in der Auswahl der Bausteine auf **„Bearbeiten …“**. Das Verkaufsbuch öffnet **„PowerSeller: Verkaufsbuch“**. Unter **Darstellung** wählst du zwischen **Regenbogen** (Buttons, Boxen und Dialoge des PowerSellers mit farbigem Rand, voreingestellt) und **Standard** (schlicht grau). Warnungen bleiben in beiden rot und gelb.

Das Script läuft auf den Seiten unter `kleinanzeigen.de/m-…` (Nachrichten, Meine Anzeigen) und beim Aufgeben und Bearbeiten von Anzeigen (`/p-anzeige-aufgeben…`, `/p-anzeige-bearbeiten…`). Es verträgt sich mit dem [Superscript](https://github.com/RainbowLabsInc/Kleinanzeigen.de_Superscript), beide nutzen getrennte Speicher.

---

## 🗺️ Geplant

| Version | Inhalt |
|---|---|
| 1.0 | **Verlässlich:** Selbstprüfung mit Hinweis, wenn Kleinanzeigen den Aufbau einer Seite ändert; PRO-Konten prüfen; echte Screenshots; Veröffentlichung (z. B. Greasy Fork) |
| später | Preis-Check gegen ähnliche Anzeigen, Erinnerung an Abholtermine, Hinweis auf ablaufende Anzeigen (sobald klar ist, wo Kleinanzeigen das Datum zeigt) |

---

## 🔧 Entwicklung

`powerseller.user.js` wird aus `src/` gebaut. Ohne Abhängigkeiten, Node 18 oder neuer:

```sh
node build.js            # bauen
node build.js --check    # prüfen, ob powerseller.user.js zum Quellstand passt
node test/regeln.test.js # Regeln der Betrugswarnung testen
node test/browser.test.js  # alle Module an nachgebauten Seiten (test/fixtures/), braucht Playwright
```

| Datei | Inhalt |
|---|---|
| `src/core.js` | Kern: Speicher, Module, Einstellungen. Gleiche Schnittstelle wie beim Superscript, damit die Module später auch dort laufen können |
| `src/bausteine.js` | Bausteine. Das Textfeld wird über den Fokus erkannt, nicht über feste Selektoren |
| `src/warnung.js` | Betrugswarnung: sucht die kleinsten Textblöcke der Seite und prüft sie |
| `src/regeln.js` | Regeln der Betrugswarnung, reine Textprüfung, in Node testbar |
| `src/anzeigen.js` | Meine Anzeigen: liest die Karten (`li[data-testid="ad-card"][data-adid]`), Selektoren im `CONFIG`-Block |
| `src/verkaufsbuch.js` | Verkaufsbuch: Formular an den Karten, Übersicht als eigener Dialog |
| `src/interessenten.js` | Interessenten: Warteliste an den Karten, Leiste in der Unterhaltung (`[data-testid="conversation-wrapper"]`) |
| `test/fixtures/` | Nachbauten echter Seiten mit Beispieldaten, ohne persönliche Daten |

Gespeichert wird im Speicher des Userscript-Managers (`GM_setValue`): `kpw-bausteine`, `kpw-felder`, `kpw-warnung`, `kpw-anzeigen`, `kpw-anzeigen-settings`, `kpw-verkaeufe`, `kpw-verkaufsbuch`, `kpw-interessenten`, `kpw-interessenten-titel`, `kpw-theme`, `kpw-backup`, `kpw-modules`. Alle außer `kpw-backup` stecken in der Datensicherung (Liste in `src/core.js`, `BACKUP.keys`). Höchstens 3.000 Anzeigen mit je 120 Tagesständen; die am längsten nicht mehr gesehenen ohne Notiz fallen zuerst heraus.

## Lizenz

[MIT](LICENSE)
