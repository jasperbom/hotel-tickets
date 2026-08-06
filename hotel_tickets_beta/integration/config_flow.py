from homeassistant import config_entries

DOMAIN = "hotel_tickets"


class HotelTicketsConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        self._async_abort_entries_match()  # Voorkom dubbele installatie
        return self.async_create_entry(title="Hotel Ticket System", data={})
