# Niet handmatig bewerken

Deze map is gegenereerd door `scripts/sync-beta.sh` uit `hotel_tickets/` plus
de overlay in `scripts/beta-overlay/`. Wijzigingen hier worden bij de volgende
sync overschreven.

* Functionaliteit aanpassen → `hotel_tickets/`
* Beta-specifieke instellingen (slug, poorten, database, BETA_MODE) →
  `scripts/beta-overlay/`

`frontend/dist/` staat hier bewust niet in: de Dockerfile bouwt de frontend
tijdens het bouwen van de addon.
