from homeassistant import config_entries
from homeassistant.core import callback

DOMAIN = "hotel_tickets"


class HotelTicketsConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Minimale config flow — er is geen gebruikersinvoer nodig."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        # Slechts één instantie toegestaan
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        if user_input is not None:
            return self.async_create_entry(title="Hotel Ticket System", data={})

        return self.async_show_form(step_id="user")
