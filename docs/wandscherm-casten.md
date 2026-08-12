# Het wandscherm op een tv of Chromecast

Het bord (`#/wandscherm`) is gemaakt om ergens te blijven hangen. Deze notitie
gaat over het ophangen: hoe een scherm zonder medewerker erbij het bord mag
lezen, en hoe je het op een Chromecast krijgt.

## Eerst: een kioskcode

Een tv, een tablet aan de muur of een Chromecast kan niet inloggen. Zo'n scherm
krijgt daarom een eigen code.

1. Instellingen → Systeem → **Wandschermen — kioskcodes**
2. Geef het scherm een naam ("Werkplaats") → **Code aanmaken**
3. Kopieer de kiosk-URL. **Dit is het enige moment dat de code zichtbaar is** —
   er wordt alleen een hash bewaard, dus kwijt is een nieuwe aanmaken.

De code geeft uitsluitend leestoegang tot `GET /api/board`. Tickets wijzigen,
andere pagina's, medewerkersgegevens: niets daarvan. Intrekken kan op dezelfde
plek; het scherm is dan binnen een halve minuut leeg.

De URL ziet er zo uit:

```
http://192.168.1.10:8080/#/wandscherm?sleutel=hbk.xxxxx&afdeling=technical&schaal=1.3
```

Let op drie dingen:

- **Het IP-adres van Home Assistant**, niet het ingress-pad. Een ingress-URL
  hoort bij de sessie van wie hem opende en werkt nergens anders.
- **Poort 8080 moet openstaan** in de addonconfiguratie (Instellingen →
  Add-ons → Hotel Ticket System → Netwerk). Staat `allowed_networks` ingevuld,
  dan moet het netwerk van het scherm daarin passen.
- **http, geen https.** Draai je met een eigen certificaat op 8443, dan weigert
  de ingebouwde browser van een Chromecast dat zonder zichtbare melding.

## Route A — tv-stick met een kioskbrowser

De saaie en daarom betrouwbare route. Een Android TV- of Fire TV-stick met
Fully Kiosk Browser (of de ingebouwde browser): URL invullen, "start bij
opstarten" aanzetten, klaar. Geen receiver-app, geen hercast, en het scherm
komt na een stroomstoring vanzelf terug.

## Route B — Chromecast via DashCast

Een Chromecast kan geen webpagina openen: de standaard-ontvanger speelt alleen
media af. **DashCast** is een openbare receiver-app die precies één ding doet —
een URL laden. De addon-integratie heeft daar een service voor.

Vereist: de **Google Cast**-integratie in Home Assistant (die levert de
`pychromecast`-bibliotheek waar de service op leunt) en versie 1.4.19 of hoger
van de custom component (Instellingen → Systeem → HA Integratie → bijwerken).

```yaml
action: hotel_tickets.cast_wandscherm
data:
  url: "http://192.168.1.10:8080/#/wandscherm?sleutel=hbk.xxxxx&afdeling=technical&schaal=1.3"
  device_name: "Werkplaats"
```

`device_name` is de naam van de Chromecast **zoals die in de Google Home-app
staat** — dat is waarop het apparaat op het netwerk te vinden is. Je mag ook
`entity_id: media_player.werkplaats` gebruiken; dat werkt zolang de naam in
Home Assistant niet is aangepast.

### Het scherm terugzetten na een onderbreking

Een Chromecast valt terug op zijn eigen achtergrondplaatjes zodra iets anders
de cast overneemt, en na een stroomstoring staat hij weer op start. Een
automatisering die elk uur opnieuw cast lost dat op; `force: false` betekent
"niets doen als het al goed staat", zodat het bord niet elk uur knippert.

```yaml
alias: Wandscherm werkplaats terugzetten
triggers:
  - trigger: time_pattern
    hours: "/1"
  - trigger: homeassistant
    event: start
actions:
  - action: hotel_tickets.cast_wandscherm
    data:
      url: "http://192.168.1.10:8080/#/wandscherm?sleutel=hbk.xxxxx&afdeling=technical"
      device_name: "Werkplaats"
      force: false
mode: single
```

Wil je het bord alleen overdag, zet er dan een conditie op de tijd bij en cast
's avonds niets — de Chromecast valt dan vanzelf terug op zijn eigen scherm.

### Als het niet werkt

| Wat je ziet | Wat er meestal aan de hand is |
|---|---|
| "Chromecast '…' niet gevonden op het netwerk" | De naam klopt niet (kijk in de Google Home-app), of HA en de Chromecast zitten in verschillende VLAN's — mDNS komt daar niet doorheen |
| Wit of leeg scherm op de tv | De URL is niet bereikbaar vanaf de Chromecast: poort 8080 dicht, verkeerd IP, of https met een eigen certificaat |
| "Dit scherm mag het bord niet lezen" | De kioskcode is ingetrokken of verkeerd overgenomen |
| Bord staat er, maar ververst niet meer | De cast is onderbroken; laat de automatisering hierboven het terugzetten |

## Route C — Lovelace casten

`cast.show_lovelace_view` gebruikt de eigen receiver van Home Assistant. Dat
zou betekenen dat het bord opnieuw gebouwd wordt als Lovelace-kaarten, met de
beperkte set die de cast-receiver ondersteunt. Niet gedaan, en niet aan te
raden: dan staat er een tweede bord dat anders leest dan het eerste.
