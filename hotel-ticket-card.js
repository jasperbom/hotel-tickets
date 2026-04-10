/**
 * Hotel Ticket Card
 * Custom Lovelace card om tickets aan te maken via Home Assistant.
 *
 * Gebruik in dashboard YAML:
 *   type: custom:hotel-ticket-card
 *   title: Ticket aanmaken       # optioneel
 *   default_category: technical  # optioneel: technical | housekeeping | reception
 *   default_priority: medium     # optioneel: low | medium | high | urgent
 */

const CATEGORIES = [
  { value: "technical",    label: "TD" },
  { value: "housekeeping", label: "Huishouding" },
  { value: "reception",    label: "Receptie" },
];

const PRIORITIES = [
  { value: "low",    label: "Laag" },
  { value: "medium", label: "Normaal" },
  { value: "high",   label: "Hoog" },
  { value: "urgent", label: "Urgent" },
];

const STYLES = `
  :host { display: block; }

  ha-card {
    padding: 16px;
  }

  h3 {
    margin: 0 0 16px;
    font-size: 1rem;
    font-weight: 500;
    color: var(--primary-text-color);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .form { display: flex; flex-direction: column; gap: 12px; }

  .field { display: flex; flex-direction: column; gap: 4px; }

  label {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--secondary-text-color);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  input, select, textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    border: 1px solid var(--divider-color, #e0e0e0);
    border-radius: 8px;
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color);
    font-size: 0.9rem;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s;
  }

  input:focus, select:focus, textarea:focus {
    border-color: var(--primary-color);
  }

  textarea { resize: vertical; min-height: 72px; }

  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

  button {
    margin-top: 4px;
    width: 100%;
    padding: 11px;
    border: none;
    border-radius: 8px;
    background: var(--primary-color);
    color: var(--text-primary-color, #fff);
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  button:hover:not(:disabled) { opacity: 0.88; }
  button:disabled { opacity: 0.45; cursor: default; }

  .feedback {
    padding: 10px 12px;
    border-radius: 8px;
    font-size: 0.85rem;
    display: none;
  }

  .feedback.success {
    display: block;
    background: var(--success-color, #4caf50);
    color: #fff;
  }

  .feedback.error {
    display: block;
    background: var(--error-color, #f44336);
    color: #fff;
  }
`;

class HotelTicketCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
  }

  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    // Vul de locatie-dropdown met HA areas als die nog leeg is
    const select = this.shadowRoot.querySelector("#location");
    if (select && select.options.length === 1 && hass.areas) {
      Object.values(hass.areas)
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((area) => {
          const opt = document.createElement("option");
          opt.value = area.area_id;
          opt.textContent = area.name;
          select.appendChild(opt);
        });
    }
  }

  _render() {
    const { title = "Ticket aanmaken", default_category = "technical", default_priority = "medium" } = this._config;

    this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      <ha-card>
        <h3>🎫 ${title}</h3>
        <div class="form">

          <div class="field">
            <label>Uw naam *</label>
            <input id="creator_name" type="text" placeholder="Bijv. Jan de Vries" />
          </div>

          <div class="field">
            <label>Titel *</label>
            <input id="title" type="text" placeholder="Korte omschrijving van het probleem" />
          </div>

          <div class="row">
            <div class="field">
              <label>Categorie</label>
              <select id="category">
                ${CATEGORIES.map(c => `<option value="${c.value}"${c.value === default_category ? " selected" : ""}>${c.label}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label>Prioriteit</label>
              <select id="priority">
                ${PRIORITIES.map(p => `<option value="${p.value}"${p.value === default_priority ? " selected" : ""}>${p.label}</option>`).join("")}
              </select>
            </div>
          </div>

          <div class="field">
            <label>Locatie (kamer / zone)</label>
            <select id="location">
              <option value="">— Geen locatie —</option>
            </select>
          </div>

          <div class="field">
            <label>Beschrijving</label>
            <textarea id="description" placeholder="Extra details (optioneel)"></textarea>
          </div>

          <div class="feedback" id="feedback"></div>

          <button id="submit">Ticket aanmaken</button>
        </div>
      </ha-card>
    `;

    this.shadowRoot.querySelector("#submit").addEventListener("click", () => this._submit());
    this.shadowRoot.querySelector("#title").addEventListener("input", () => this._syncButton());
    this.shadowRoot.querySelector("#creator_name").addEventListener("input", () => this._syncButton());
  }

  _syncButton() {
    const btn         = this.shadowRoot.querySelector("#submit");
    const title       = this.shadowRoot.querySelector("#title").value.trim();
    const creatorName = this.shadowRoot.querySelector("#creator_name").value.trim();
    btn.disabled = !title || !creatorName;
  }

  async _submit() {
    const creatorName = this.shadowRoot.querySelector("#creator_name").value.trim();
    const title       = this.shadowRoot.querySelector("#title").value.trim();
    const category    = this.shadowRoot.querySelector("#category").value;
    const priority    = this.shadowRoot.querySelector("#priority").value;
    const location    = this.shadowRoot.querySelector("#location").value;
    const description = this.shadowRoot.querySelector("#description").value.trim();

    if (!title || !creatorName) return;

    const btn      = this.shadowRoot.querySelector("#submit");
    const feedback = this.shadowRoot.querySelector("#feedback");

    btn.disabled    = true;
    btn.textContent = "Bezig...";
    feedback.className = "feedback";

    const serviceData = { title, category, priority, creator_name: creatorName };
    if (description) serviceData.description = description;
    if (location)    serviceData.location    = location;

    try {
      await this._hass.callService("hotel_tickets", "create_ticket", serviceData);

      // Reset formulier (naam bewaren voor volgend ticket)
      this.shadowRoot.querySelector("#title").value       = "";
      this.shadowRoot.querySelector("#description").value = "";
      this.shadowRoot.querySelector("#location").value    = "";

      feedback.className   = "feedback success";
      feedback.textContent = "✓ Ticket aangemaakt!";
    } catch (err) {
      feedback.className   = "feedback error";
      feedback.textContent = `Fout: ${err.message || "Kon ticket niet aanmaken"}`;
    } finally {
      btn.textContent = "Ticket aanmaken";
      btn.disabled    = false;
      setTimeout(() => { feedback.className = "feedback"; }, 4000);
    }
  }

  static getStubConfig() {
    return { title: "Ticket aanmaken", default_category: "technical", default_priority: "medium" };
  }

  getCardSize() { return 4; }
}

customElements.define("hotel-ticket-card", HotelTicketCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type:        "hotel-ticket-card",
  name:        "Hotel Ticket Card",
  description: "Maak een ticket aan voor de technische dienst, huishouding of receptie",
  preview:     true,
  documentationURL: "https://github.com/jasperbom/hotel-tickets",
});
