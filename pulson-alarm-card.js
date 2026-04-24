import { LitElement, html, css } from "https://unpkg.com/lit@3/index.js?module";

class PulsonAlarmCard extends LitElement {
  static get properties() {
    return {
      _hass: { state: false },
      _config: { state: false },
      _pin: { state: true },
    };
  }

  constructor() {
    super();
    this._hass = null;
    this._config = null;
    this._pin = "";
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("Configuration error: 'entity' is required.");
    }

    this._config = {
      name: "Pulson Alarm",
      ...config,
    };
  }

  set hass(hass) {
    this._hass = hass;
    this.requestUpdate();
  }

  getCardSize() {
    return 5;
  }

  _stateLabel(state) {
    const labels = {
      disarmed: "Rozbrojony",
      armed_away: "Uzbrojony (poza domem)",
      armed_home: "Uzbrojony (w domu)",
      armed_night: "Uzbrojony (noc)",
      armed_vacation: "Uzbrojony (wakacje)",
      armed_custom_bypass: "Uzbrojony (niestandardowy)",
      pending: "Oczekiwanie",
      arming: "Uzbrajanie",
      disarming: "Rozbrajanie",
      triggered: "Alarm uruchomiony",
      unavailable: "Niedostepny",
      unknown: "Nieznany",
    };

    return labels[state] || state;
  }

  _appendDigit(digit) {
    this._pin = `${this._pin}${digit}`;
  }

  _clearPin() {
    this._pin = "";
  }

  async _callAlarmService(service) {
    if (!this._hass || !this._config?.entity) return;

    try {
      await this._hass.callService("alarm_control_panel", service, {
        entity_id: this._config.entity,
        code: this._pin,
      });
    } finally {
      this._clearPin();
    }
  }

  _renderKeyButton(label, value = label) {
    return html`
      <button class="key" @click=${() => this._appendDigit(value)}>
        ${label}
      </button>
    `;
  }

  render() {
    if (!this._config || !this._hass) {
      return html``;
    }

    const entity = this._hass.states[this._config.entity];
    if (!entity) {
      return html`
        <ha-card>
          <div class="container">
            <div class="error">
              Nie znaleziono encji: <code>${this._config.entity}</code>
            </div>
          </div>
        </ha-card>
      `;
    }

    const stateLabel = this._stateLabel(entity.state);
    const maskedPin = this._pin.length ? "*".repeat(this._pin.length) : "-";

    return html`
      <ha-card>
        <div class="container">
          <div class="header">
            <div class="title">${this._config.name}</div>
            <div class="state">${stateLabel}</div>
          </div>

          <div class="pin-display" aria-label="Wprowadzony PIN">${maskedPin}</div>

          <div class="keypad">
            ${this._renderKeyButton("1")}
            ${this._renderKeyButton("2")}
            ${this._renderKeyButton("3")}
            ${this._renderKeyButton("4")}
            ${this._renderKeyButton("5")}
            ${this._renderKeyButton("6")}
            ${this._renderKeyButton("7")}
            ${this._renderKeyButton("8")}
            ${this._renderKeyButton("9")}
            <button class="key clear" @click=${this._clearPin}>C</button>
            ${this._renderKeyButton("0")}
            <button class="key clear" @click=${this._clearPin}>Wyczysc</button>
          </div>

          <div class="actions">
            <button class="action primary" @click=${() => this._callAlarmService("alarm_arm_away")}>
              Uzbroj
            </button>
            <button class="action secondary" @click=${() => this._callAlarmService("alarm_arm_home")}>
              Uzbroj w domu
            </button>
            <button class="action danger" @click=${() => this._callAlarmService("alarm_disarm")}>
              Rozbroj
            </button>
          </div>
        </div>
      </ha-card>
    `;
  }

  static get styles() {
    return css`
      :host {
        display: block;
      }

      ha-card {
        background: var(--ha-card-background, var(--card-background-color));
        color: var(--primary-text-color);
        border-radius: var(--ha-card-border-radius, 16px);
      }

      .container {
        padding: 16px;
        display: grid;
        gap: 14px;
      }

      .header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 12px;
      }

      .title {
        font-size: 1.1rem;
        font-weight: 600;
        color: var(--primary-text-color);
      }

      .state {
        font-size: 0.95rem;
        font-weight: 600;
        color: var(--primary-color);
        text-align: right;
      }

      .pin-display {
        min-height: 44px;
        border-radius: 12px;
        border: 1px solid var(--divider-color);
        background: var(--secondary-background-color);
        color: var(--primary-text-color);
        display: flex;
        align-items: center;
        justify-content: center;
        letter-spacing: 0.35rem;
        font-size: 1.2rem;
        font-weight: 700;
        user-select: none;
      }

      .keypad {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }

      .key,
      .action {
        height: 42px;
        border: none;
        border-radius: 10px;
        cursor: pointer;
        font-size: 0.95rem;
        font-weight: 600;
        transition: transform 0.05s ease, filter 0.2s ease;
      }

      .key {
        background: var(--secondary-background-color);
        color: var(--primary-text-color);
        border: 1px solid var(--divider-color);
      }

      .key.clear {
        color: var(--secondary-text-color);
      }

      .actions {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }

      .action.primary {
        background: var(--primary-color);
        color: var(--text-primary-color, #fff);
      }

      .action.secondary {
        background: var(--accent-color);
        color: var(--text-primary-color, #fff);
      }

      .action.danger {
        background: var(--error-color);
        color: var(--text-primary-color, #fff);
      }

      .key:active,
      .action:active {
        transform: translateY(1px);
      }

      .key:hover,
      .action:hover {
        filter: brightness(1.05);
      }

      .error {
        color: var(--error-color);
        font-weight: 600;
      }

      code {
        font-family: var(--code-font-family, monospace);
        background: var(--secondary-background-color);
        padding: 0.1rem 0.3rem;
        border-radius: 6px;
      }
    `;
  }
}

customElements.define("pulson-alarm-card", PulsonAlarmCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "pulson-alarm-card",
  name: "Pulson Alarm Card",
  description: "Alarm control panel card with keypad and actions.",
});
