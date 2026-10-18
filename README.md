<div align="center">

<img src="assets/logo.png" alt="RainbowlabsInc" width="96">

# 📦 Kleinanzeigen – PowerSeller

**Userscript für alle, die auf Kleinanzeigen.de viel verkaufen, privat oder mit PRO-Konto: Antwort-Bausteine in den Nachrichten und eine Warnung vor typischen Betrugsmaschen.**

[![Version](https://img.shields.io/badge/version-0.1.0-blue?style=flat-square)](https://github.com/RainbowLabsInc/Kleinanzeigen_Power_Seller_Skript/raw/claude/brave-mayer-axxs0p/powerseller.user.js)
[![Plattform](https://img.shields.io/badge/plattform-Kleinanzeigen.de-green?style=flat-square)](https://www.kleinanzeigen.de)
[![Userscript](https://img.shields.io/badge/Tampermonkey-Violentmonkey-black?style=flat-square&logo=tampermonkey)](#%EF%B8%8F-installation)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

*Chrome · Firefox · Edge · Kein eigener Server · Kein Tracking · Jedes Modul einzeln abschaltbar*

<a href="https://github.com/RainbowLabsInc/Kleinanzeigen_Power_Seller_Skript/raw/claude/brave-mayer-axxs0p/powerseller.user.js"><img src="assets/installieren.svg" alt="Installieren: PowerSeller (Tampermonkey)" width="320" height="60"></a>

</div>

---

> **Vorabversion 0.1.** Beide Module sind an einer nachgebauten Nachrichtenseite getestet, noch nicht an der echten Seite mit eingeloggtem Konto. Rückmeldungen bitte als [Issue](https://github.com/RainbowLabsInc/Kleinanzeigen_Power_Seller_Skript/issues).

Wer viel verkauft, schreibt jeden Tag dieselben Antworten: „Ja, ist noch da“, „Preis ist fest“, „Versand geht als DHL-Paket“. Dazu kommen Nachrichten, die nur so tun, als wollte jemand kaufen. **Der PowerSeller nimmt dir das Tippen ab und warnt dich vor den bekannten Maschen**, lokal in deinem Browser.

| Modul | Was es macht |
|---|---|
| 💬 **Antwort-Bausteine** | Button „Bausteine“ über dem Nachrichtenfeld: eigene Antworten mit Platzhaltern per Klick oder Taste 1 … 9 einfügen |
| ⚠️ **Betrugswarnung** | Markiert Nachrichten mit nachgemachten Bezahl- oder Versandlinks, „Geld freigeben“, Kurier-Abholung, Fragen nach Kartendaten oder SMS-Codes, Überzahlung |

**Gedacht als Hilfe, nicht als Bot:** Das Script schickt nichts von selbst ab, stellt nichts ein und schiebt nichts hoch. Jede Aktion löst du mit einem Klick aus.

---

## 💬 Antwort-Bausteine

* 🧩 **Einfügen:** Sobald du in ein Nachrichtenfeld klickst, erscheint darüber **„Bausteine“**. Ein Klick zeigt deine Antworten, ein weiterer fügt sie an der Schreibmarke ein. Schneller geht's mit den Tasten **1 … 9**, solange die Auswahl offen ist.
* 🏷️ **Platzhalter:** In geschweiften Klammern, z. B. `{Abholort}` oder `{Versand}`. Sie werden durch deine Angaben ersetzt. Fehlt eine Angabe, bleibt der Platzhalter stehen und ist markiert, sodass du direkt lostippen kannst.
* ✏️ **Bearbeiten:** In den Einstellungen anlegen, umbenennen, sortieren und löschen. Sechs Beispiele sind schon da.
* 📤 **Teilen:** Export und Import als JSON-Datei, z. B. damit im Team alle dieselben Antworten haben.
* ↩️ **Rückgängig:** Eingefügter Text lässt sich mit Strg+Z wieder entfernen.

> **PRO-Konten** bekommen von Kleinanzeigen je nach Paket automatische Antwortvorschläge. Die Bausteine sind etwas anderes: feste Texte, die du selbst formulierst und die immer gleich lauten.

## ⚠️ Betrugswarnung

* 🔴 **Rot (hohes Risiko):** Links auf Seiten, die nach Kleinanzeigen, Versand oder Bezahlen klingen, es aber nicht sind (z. B. `kleinanzeigen-sicher.de`). Außerdem Fragen nach Kartendaten, Bankzugang oder SMS-Codes, Überzahlung mit Bitte um Rücküberweisung, und jeder fremde Link zusammen mit einer weiteren Auffälligkeit.
* 🟡 **Gelb (Hinweis, abschaltbar):** „Geld erhalten oder freigeben“, Abholung durch Kurier oder Spedition, Wechsel zu WhatsApp oder Telegram, Links auf fremde Seiten.
* 🙈 **Ausblenden:** Jede Warnung lässt sich bis zum Neuladen wegklicken.
* 🔒 **Ohne Anfragen:** Das Modul liest nur, was auf der Seite steht. Es lädt nichts nach und schickt nichts weg.

Die Warnung ist eine Hilfe, keine Garantie. Sie erkennt nicht jede Masche, und auch harmlose Nachrichten, deine eigenen eingeschlossen, können markiert werden.

---

## ⚙️ Installation

**Schritt 1: Userscript-Erweiterung installieren** (kostenlos)

| Browser | Erweiterung |
|---|---|
| Chrome / Edge | [Tampermonkey](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) oder [Violentmonkey](https://chrome.google.com/webstore/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag) |
| Firefox | [Tampermonkey](https://addons.mozilla.org/de/firefox/addon/tampermonkey/) oder [Violentmonkey](https://addons.mozilla.org/de/firefox/addon/violentmonkey/) |

> **Chrome/Edge:** Bei neueren Tampermonkey-Versionen muss in den Erweiterungs-Details „Benutzerskripte zulassen“ bzw. der Entwicklermodus aktiviert sein.

**Schritt 2: PowerSeller installieren**

<a href="https://github.com/RainbowLabsInc/Kleinanzeigen_Power_Seller_Skript/raw/claude/brave-mayer-axxs0p/powerseller.user.js"><img src="assets/installieren.svg" alt="Installieren: PowerSeller (Tampermonkey)" width="320" height="60"></a>

*(Alternativ: Inhalt von `powerseller.user.js` kopieren und in Tampermonkey als neues Skript einfügen.)*

> Die Vorabversion kommt vom Test-Branch. Updates holt sich Tampermonkey aus `main`, sobald es den Branch gibt.

**Einstellungen:** Tampermonkey-Menü → **„PowerSeller: Einstellungen“**, oder in der Auswahl der Bausteine auf **„Bearbeiten …“**.

Das Script läuft auf den Seiten unter `kleinanzeigen.de/m-…`, die Betrugswarnung nur auf der Nachrichtenseite (`/m-nachrichten…`). Es verträgt sich mit dem [Superscript](https://github.com/RainbowLabsInc/Kleinanzeigen.de_Superscript), beide nutzen getrennte Speicher.

---

## 🗺️ Geplant

| Version | Inhalt |
|---|---|
| 0.2 | **Meine Anzeigen:** Aufrufe-Verlauf pro Anzeige („+14 seit gestern“), Notiz pro Anzeige (Lagerort, Artikelnummer, Einkaufspreis), Hinweis auf bald ablaufende Anzeigen (privat) |
| später | Verkaufsbuch mit CSV-Export und Jahressummen, Textvorlagen beim Einstellen, Preis-Check gegen ähnliche Anzeigen |

---

## 🔧 Entwicklung

`powerseller.user.js` wird aus `src/` gebaut. Ohne Abhängigkeiten, Node 18 oder neuer:

```sh
node build.js            # bauen
node build.js --check    # prüfen, ob powerseller.user.js zum Quellstand passt
node test/regeln.test.js # Regeln der Betrugswarnung testen
```

| Datei | Inhalt |
|---|---|
| `src/core.js` | Kern: Speicher, Module, Einstellungen. Gleiche Schnittstelle wie beim Superscript, damit die Module später auch dort laufen können |
| `src/bausteine.js` | Antwort-Bausteine. Das Nachrichtenfeld wird über den Fokus erkannt, nicht über feste Selektoren |
| `src/warnung.js` | Betrugswarnung: sucht die kleinsten Textblöcke der Seite und prüft sie |
| `src/regeln.js` | Regeln der Betrugswarnung, reine Textprüfung, in Node testbar |

Gespeichert wird im Speicher des Userscript-Managers (`GM_setValue`): `kpw-bausteine`, `kpw-felder`, `kpw-warnung`, `kpw-modules`.

## Lizenz

[MIT](LICENSE)
