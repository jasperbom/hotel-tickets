"""
Lijkt deze melding op een ticket dat er al ligt?

Dubbele tickets ontstaan niet uit slordigheid maar uit snelheid: de receptie
meldt "kraan lekt kamer 12" en tien minuten later doet huishouding hetzelfde,
in andere woorden. Niemand zoekt eerst — dat kost meer tijd dan melden. Dus
zoekt de app, terwijl je typt, en zegt het als er iets lijkt te liggen.

Dit is bewust géén slimme zoekmachine. Het hotel heeft hooguit een paar
honderd open tickets; we lezen ze allemaal en tellen welke woorden ze delen
met wat er getypt wordt. De kamer weegt het zwaarst: "lamp kapot" in kamer 12
en "lamp kapot" in kamer 14 zijn twee klussen, geen dubbele — die noemen we
dus nooit. Binnen dezelfde kamer is één gedeeld woord al genoeg om het te
noemen; is er aan één van beide kanten geen kamer, dan moet het grootste deel
van de melding overeenkomen.

De uitkomst is een hint, geen blokkade: de melder ziet de kandidaten, tikt er
één aan of meldt toch. Liever een keer voor niets gewaarschuwd dan een dubbele
die twee monteurs naar dezelfde kamer stuurt.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable, Protocol

# Woorden die in bijna elke melding staan en dus niets zeggen over wát er
# aan de hand is. "Kapot" en "werkt" horen daar ook bij: "lamp kapot" en
# "douche kapot" delen een woord maar geen probleem.
_STOPWOORDEN = frozenset("""
de het een en of in op aan bij van voor naar met te uit om over onder toe
is zijn was waren wordt worden ben bent heeft hebben had hadden
ik je jij u we wij ze zij hij hem haar ons nu na zo af
er hier daar dit dat deze die ook nog al wel niet geen meer even weer
kamer kmr room nr nummer graag svp aub ff snel
doet doen werkt werken gaat gaan staat staan zit zitten ligt liggen hangt
kapot stuk defect storing probleem klacht melding check checken controleren
nakijken kijken moet moeten mag kan kunnen
""".split())

# Uitgangen die we wegknippen zodat "lekt", "lekken" en "lekkage" op elkaar
# lijken. Grof, maar het gaat om herkennen, niet om taalkunde.
_UITGANGEN = ("ende", "tje", "age", "ing", "en", "je", "s", "t", "e")

_WOORD = re.compile(r"[a-z0-9]+")
_DUBBELE_KLINKER = re.compile(r"(aa|ee|oo|uu)")


def _stam(woord: str) -> str:
    """Grove stam: uitgang eraf, dubbele letters samentrekken.

    lekt / lekken / lekkage → lek, kraan / kranen → kran, raam / ramen → ram.
    """
    if len(woord) < 3:
        return woord
    for uitgang in _UITGANGEN:
        if len(woord) - len(uitgang) >= 3 and woord.endswith(uitgang):
            woord = woord[: -len(uitgang)]
            break
    # "lekk" (van lekken) → "lek"
    if len(woord) >= 3 and woord[-1] == woord[-2]:
        woord = woord[:-1]
    # "kraan" → "kran", zodat het meervoud "kranen" er ook op past.
    return _DUBBELE_KLINKER.sub(lambda m: m.group(1)[0], woord)


def sleutelwoorden(tekst: str | None) -> set[str]:
    """De woorden die ertoe doen, teruggebracht tot hun stam."""
    if not tekst:
        return set()
    # Accenten weg (café → cafe) zodat de regex de letters herkent.
    plat = (
        tekst.lower()
        .translate(str.maketrans("éèëêáàäâóòöôúùüûíìïî", "eeeeaaaaoooouuuuiiii"))
    )
    out: set[str] = set()
    for w in _WOORD.findall(plat):
        # Twee tekens mag: "tv" en "12" zeggen genoeg. Eén teken nooit.
        if len(w) < 2 or w in _STOPWOORDEN:
            continue
        out.add(_stam(w))
    return out


def _past(a: str, b: str) -> bool:
    """Twee stammen horen bij elkaar als ze gelijk zijn of de ene het begin
    van de andere is ("verwarm" ↔ "verwarmingsketel")."""
    if a == b:
        return True
    kort, lang = (a, b) if len(a) <= len(b) else (b, a)
    return len(kort) >= 4 and lang.startswith(kort)


def _overlap(vraag: set[str], aanbod: set[str]) -> int:
    return sum(1 for v in vraag if any(_past(v, a) for a in aanbod))


class _TicketAchtig(Protocol):
    id: str
    title: str
    description: str | None
    location_id: str | None
    status: object
    closed_at: datetime | None


@dataclass
class Kandidaat:
    ticket: object
    score: float


# Afgeronde tickets tellen nog even mee: "dat hebben we gisteren al gemaakt"
# is óók iets wat de melder wil weten.
AFGEROND_VENSTER = timedelta(days=7)


def vind_gelijkende(
    title: str,
    location_id: str | None,
    tickets: Iterable[_TicketAchtig],
    *,
    beschrijving: str | None = None,
    nu: datetime | None = None,
    max_aantal: int = 5,
) -> list[Kandidaat]:
    """Rangschik bestaande tickets op gelijkenis met wat er getypt wordt.

    `tickets` mag open, in behandeling en recent afgeronde tickets bevatten;
    afgeronde ouder dan `AFGEROND_VENSTER` worden overgeslagen.
    """
    vraag = sleutelwoorden(title)
    if not vraag:
        return []
    # De omschrijving helpt alleen als de titel te weinig zegt; ze mag de
    # drempel nooit verlagen door een lange lap tekst.
    vraag_extra = sleutelwoorden(beschrijving) - vraag if beschrijving else set()

    nu = nu or datetime.now(timezone.utc)
    kandidaten: list[Kandidaat] = []
    for t in tickets:
        status = getattr(t.status, "value", t.status)
        if status == "closed":
            if not t.closed_at:
                continue
            closed_at = t.closed_at if t.closed_at.tzinfo else t.closed_at.replace(tzinfo=timezone.utc)
            if nu - closed_at > AFGEROND_VENSTER:
                continue

        aanbod_titel = sleutelwoorden(t.title)
        aanbod = aanbod_titel | sleutelwoorden(t.description)
        if not aanbod:
            continue

        # Gedeelde woorden met de titel van het bestaande ticket tellen vol,
        # met alleen de omschrijving voor de helft.
        in_titel = _overlap(vraag, aanbod_titel)
        in_alles = _overlap(vraag, aanbod)
        treffers = in_titel + 0.5 * (in_alles - in_titel)
        if treffers == 0:
            continue
        aandeel = treffers / len(vraag)

        zelfde_kamer = bool(location_id) and t.location_id == location_id

        if location_id and t.location_id and not zelfde_kamer:
            # Twee kamers zijn twee klussen, hoe gelijk de woorden ook zijn.
            continue
        if zelfde_kamer:
            # Eén gedeeld woord in de titel is genoeg: "douche loopt niet
            # weg" en "douche verstopt" in dezelfde kamer zijn het waard om
            # te noemen.
            if in_titel < 1 and aandeel < 0.5:
                continue
        elif not t.location_id:
            # Het bestaande ticket hangt nergens aan (lift, lobby, tuin):
            # dan telt alleen de tekst.
            if aandeel < 0.5:
                continue
        else:
            # De melder koos geen kamer, het bestaande ticket wél. Alleen
            # noemen als de melding vrijwel hetzelfde zegt én meer dan één
            # woord heeft — anders is "lamp" gelijk aan elke lamp in het hotel.
            if aandeel < 0.75 or in_titel < 2:
                continue

        score = aandeel
        if zelfde_kamer:
            score += 1.0
        elif not t.location_id:
            score += 0.25
        if vraag_extra:
            score += 0.1 * _overlap(vraag_extra, aanbod) / len(vraag_extra)
        if status == "closed":
            score -= 0.5
        kandidaten.append(Kandidaat(ticket=t, score=score))

    kandidaten.sort(key=lambda k: k.score, reverse=True)
    return kandidaten[:max_aantal]
