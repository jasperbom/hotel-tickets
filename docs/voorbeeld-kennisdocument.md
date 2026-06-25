# Voorbeeld-kennisdocument voor de Kennisbot

Hieronder staat **één compleet voorbeelddocument** ("Koffiemachine") zoals je het
ideaal aanlevert, gevolgd door een **leeg sjabloon** en een korte uitleg waarom
het zo werkt.

> Tip: kopieer alleen het deel ónder de streep (vanaf "Koffiemachine — bediening
> en storingen") en plak dat in **Kennis → Beheer → Documenten → tekst plakken**,
> of bewaar het als `.md`-bestand en upload het. Maak per onderwerp een apart
> document.

---

# Koffiemachine — bediening en storingen

De koffiemachine staat in de ontbijtzaal. Dit document beschrijft het dagelijks
gebruik, schoonmaken, ontkalken en de meest voorkomende storingen en foutcodes.

## Aanzetten en uitzetten

De machine staat normaal altijd aan. Wil je hem toch uit- en weer aanzetten:

1. Houd de aan/uit-knop rechtsboven 3 seconden ingedrukt tot het scherm uitgaat.
2. Wacht 10 seconden.
3. Druk kort op dezelfde knop om hem weer aan te zetten. Het opwarmen duurt
   ongeveer 2 minuten.

## De machine resetten (herstarten)

Reageert de machine niet meer, geeft hij een vastgelopen scherm, of doet een knop
het niet? Voer dan een reset (herstart) uit:

1. Houd de aan/uit-knop 5 seconden ingedrukt tot het lampje knippert.
2. Laat los; de machine herstart automatisch.
3. Werkt het daarna nog niet, trek dan de stekker eruit, wacht 30 seconden en
   steek hem terug.

## Ontkalken (kalk verwijderen)

Ontkalk de machine één keer per maand, of zodra het bericht "ontkalken nodig"
verschijnt. Je hebt een ontkalkingstablet nodig (voorraadkast keuken).

1. Open menu 3 ("Onderhoud") op het scherm.
2. Kies "Ontkalken" en plaats één ontkalkingstablet in het bakje.
3. Start het programma en wacht tot het klaar is (circa 20 minuten). Gebruik de
   machine in die tijd niet.

## Veelvoorkomende foutcodes

- **Foutcode E5 — waterreservoir:** het reservoir zit niet goed. Verwijder het
  reservoir, vul het bij en plaats het stevig terug tot je een klik hoort.
- **Foutcode E8 — lekbak vol:** leeg de lekbak onderin en plaats hem terug.
- **Geen warme koffie / lauw:** de machine is waarschijnlijk nog aan het opwarmen,
  of moet ontkalkt worden (zie "Ontkalken").

## Wanneer een ticket aanmaken

Lukt het niet met bovenstaande stappen, of komt dezelfde storing steeds terug,
maak dan een ticket aan voor de technische dienst met de foutcode erbij.

---

# Leeg sjabloon (kopieer en vul in)

```
# [Onderwerp] — [korte omschrijving]

Eén of twee zinnen die vertellen waar dit over gaat en waar het apparaat/de
situatie zich bevindt.

## [Deelonderwerp, bijv. "Aanzetten" of "Reset"]

Korte inleiding indien nodig.

1. Eerste stap.
2. Tweede stap.
3. Derde stap.

## [Volgend deelonderwerp]

...

## Wanneer een ticket aanmaken

Wanneer moet de medewerker dit doorgeven in plaats van zelf oplossen?
```

---

# Waarom deze opzet werkt

- **Eén onderwerp per document.** Liever 10 korte documenten dan één enorme
  handleiding — de bot vindt zo gerichter de juiste passage.
- **Korte alinea's met een lege regel ertussen.** Het systeem knipt het document
  in stukjes op die lege regels, zodat samenhangende stappen bij elkaar blijven.
- **Duidelijke kopjes (`##`) per deelonderwerp.** Maakt de stukjes vindbaar en
  overzichtelijk.
- **Genummerde stappen** voor procedures — die neemt de bot bijna één-op-één over
  in zijn antwoord.
- **Gebruik de woorden die je personeel écht gebruikt, plus synoniemen.** Het
  zoeken naar de juiste passage gaat op trefwoord. Daarom staat er bijvoorbeeld
  zowel "resetten" als "herstarten", en "ontkalken" als "kalk verwijderen".
- **Benoem foutcodes en symptomen letterlijk** ("foutcode E5", "geen warme
  koffie") — precies zoals iemand ze zou intypen.
- **Sluit af met "wanneer een ticket aanmaken"** zodat de bot weet wanneer hij
  moet doorverwijzen in plaats van zelf antwoorden.
</content>
