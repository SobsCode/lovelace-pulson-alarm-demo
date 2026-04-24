import { LitElement, html, css } from "https://unpkg.com/lit@3/index.js?module";

const ALARM_FEATURE_ARM_HOME = 1;
const ALARM_FEATURE_ARM_AWAY = 2;

class PulsonAlarmCard extends LitElement {
  static get properties() {
    return {
      _hass: { state: false },
      _config: { state: false },
      _pin: { state: true },
      _selectedEntity: { state: true },
    };
  }

  constructor() {
    super();
    this._hass = null;
    this._config = null;
    this._pin = "";
    this._selectedEntity = null;
  }

  setConfig(config) {
    if (!config || (!config.entity && !Array.isArray(config.entities))) {
      throw new Error("Configuration error: provide 'entity' or 'entities'.");
    }

    const entities = Array.isArray(config.entities)
      ? config.entities.filter((id) => typeof id === "string" && id.startsWith("alarm_control_panel."))
      : [];

    if (Array.isArray(config.entities) && entities.length === 0) {
      throw new Error("Configuration error: 'entities' must contain alarm_control_panel entity IDs.");
    }

    this._config = {
      name: "Pulson Alarm",
      ...config,
      entities,
    };
  }

  set hass(hass) {
    this._hass = hass;
    const partitions = this._getPartitions();
    if (partitions.length > 0) {
      const hasSelected = partitions.some((p) => p.entityId === this._selectedEntity);
      if (!hasSelected) {
        this._selectedEntity = partitions[0].entityId;
      }
    } else {
      this._selectedEntity = null;
    }
    this.requestUpdate();
  }

  getCardSize() {
    return 8;
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

  _stateClass(state) {
    if (state === "triggered") return "triggered";
    if (state === "disarmed") return "disarmed";
    if (state.startsWith("armed")) return "armed";
    if (state === "pending" || state === "arming" || state === "disarming") return "transition";
    if (state === "unavailable" || state === "unknown") return "offline";
    return "default";
  }

  _discoverEntityGroup(seedEntityId) {
    const seedMatch = seedEntityId.match(/^(alarm_control_panel\..+)_p([1-8])$/);
    if (!seedMatch) return [seedEntityId];

    const base = seedMatch[1];
    const discovered = Object.keys(this._hass.states)
      .filter((id) => id.startsWith(`${base}_p`) && /^alarm_control_panel\..+_p[1-8]$/.test(id))
      .sort((a, b) => {
        const pa = Number(a.match(/_p([1-8])$/)?.[1] || 99);
        const pb = Number(b.match(/_p([1-8])$/)?.[1] || 99);
        return pa - pb;
      })
      .slice(0, 8);

    return discovered.length ? discovered : [seedEntityId];
  }

  _getPartitions() {
    if (!this._hass || !this._config) return [];

    let entityIds = [];
    if (this._config.entities?.length) {
      entityIds = this._config.entities;
    } else if (this._config.entity) {
      entityIds = this._discoverEntityGroup(this._config.entity);
    }

    return entityIds
      .map((entityId) => {
        const entity = this._hass.states[entityId];
        if (!entity) return null;

        const indexMatch = entityId.match(/_p([1-8])$/);
        const index = indexMatch ? Number(indexMatch[1]) : null;

        return {
          entityId,
          entity,
          index,
          title: entity.attributes.friendly_name || (index ? `Partycja ${index}` : entityId),
          stateLabel: this._stateLabel(entity.state),
          stateClass: this._stateClass(entity.state),
        };
      })
      .filter(Boolean);
  }

  _getSummary(partitions) {
    return partitions.reduce(
      (acc, partition) => {
        const state = partition.entity.state;
        if (state === "triggered") acc.triggered += 1;
        else if (state.startsWith("armed")) acc.armed += 1;
        else if (state === "disarmed") acc.disarmed += 1;
        else acc.other += 1;
        return acc;
      },
      { armed: 0, disarmed: 0, triggered: 0, other: 0 },
    );
  }

  _selectPartition(entityId) {
    this._selectedEntity = entityId;
  }

  _appendDigit(digit) {
    this._pin = `${this._pin}${digit}`;
  }

  _clearPin() {
    this._pin = "";
  }

  async _callAlarmService(service) {
    if (!this._hass || !this._selectedEntity) return;

    try {
      await this._hass.callService("alarm_control_panel", service, {
        entity_id: this._selectedEntity,
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

    const partitions = this._getPartitions();
    if (!partitions.length) {
      return html`
        <ha-card>
          <div class="container">
            <div class="error">
              Nie znaleziono zadnej encji alarm_control_panel w konfiguracji.
            </div>
          </div>
        </ha-card>
      `;
    }

    const selected = partitions.find((p) => p.entityId === this._selectedEntity) || partitions[0];
    const selectedFeatures = Number(selected.entity.attributes.supported_features || 0);
    const canArmAway = (selectedFeatures & ALARM_FEATURE_ARM_AWAY) !== 0;
    const canArmHome = (selectedFeatures & ALARM_FEATURE_ARM_HOME) !== 0;
    const summary = this._getSummary(partitions);
    const maskedPin = this._pin.length ? "*".repeat(this._pin.length) : "-";

    return html`
      <ha-card>
        <div class="container">
          <div class="hero">
            <div>
              <div class="title">${this._config.name}</div>
              <div class="subtitle">Aktywna: ${selected.title}</div>
            </div>
            <div class="status-pill ${selected.stateClass}">${selected.stateLabel}</div>
          </div>

          <div class="summary-grid">
            <div class="summary-tile">
              <span>Uzbrojone</span>
              <strong>${summary.armed}</strong>
            </div>
            <div class="summary-tile">
              <span>Rozbrojone</span>
              <strong>${summary.disarmed}</strong>
            </div>
            <div class="summary-tile alert">
              <span>Alarm</span>
              <strong>${summary.triggered}</strong>
            </div>
          </div>

          <div class="section-label">Partycje</div>
          <div class="partition-grid">
            ${partitions.map(
              (partition) => html`
                <button
                  class="partition ${partition.stateClass} ${partition.entityId === selected.entityId ? "active" : ""}"
                  @click=${() => this._selectPartition(partition.entityId)}
                >
                  <div class="partition-name">${partition.title}</div>
                  <div class="partition-state">${partition.stateLabel}</div>
                </button>
              `,
            )}
          </div>

          <div class="section-label">PIN</div>
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
            <button
              class="action primary"
              ?disabled=${!canArmAway}
              @click=${() => this._callAlarmService("alarm_arm_away")}
            >
              Uzbroj
            </button>
            <button
              class="action secondary"
              ?disabled=${!canArmHome}
              @click=${() => this._callAlarmService("alarm_arm_home")}
            >
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
        border-radius: var(--ha-card-border-radius, 18px);
        border: 1px solid color-mix(in srgb, var(--divider-color) 70%, transparent);
        box-shadow:
          0 10px 30px color-mix(in srgb, var(--primary-color) 10%, transparent),
          0 1px 1px color-mix(in srgb, var(--primary-text-color) 8%, transparent);
      }

      .container {
        padding: 16px;
        display: grid;
        gap: 10px;
      }

      .hero {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        background: linear-gradient(
          135deg,
          color-mix(in srgb, var(--primary-color) 18%, transparent),
          color-mix(in srgb, var(--accent-color) 14%, transparent)
        );
        border: 1px solid color-mix(in srgb, var(--divider-color) 70%, var(--primary-color));
        border-radius: 14px;
        padding: 12px;
      }

      .title {
        font-size: 1.05rem;
        font-weight: 700;
        color: var(--primary-text-color);
      }

      .subtitle {
        margin-top: 2px;
        font-size: 0.85rem;
        color: var(--secondary-text-color);
      }

      .status-pill {
        border-radius: 999px;
        font-size: 0.78rem;
        font-weight: 700;
        padding: 7px 10px;
        border: 1px solid var(--divider-color);
        backdrop-filter: blur(4px);
      }

      .status-pill.armed {
        color: var(--primary-color);
        background: color-mix(in srgb, var(--primary-color) 15%, transparent);
      }

      .status-pill.disarmed {
        color: var(--success-color, var(--state-icon-active-color, var(--primary-color)));
        background: color-mix(in srgb, var(--success-color, var(--primary-color)) 15%, transparent);
      }

      .status-pill.triggered {
        color: var(--error-color);
        background: color-mix(in srgb, var(--error-color) 14%, transparent);
      }

      .status-pill.transition {
        color: var(--warning-color, var(--accent-color));
        background: color-mix(in srgb, var(--warning-color, var(--accent-color)) 12%, transparent);
      }

      .status-pill.offline {
        color: var(--disabled-text-color);
        background: color-mix(in srgb, var(--disabled-text-color) 10%, transparent);
      }

      .summary-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }

      .summary-tile {
        border: 1px solid var(--divider-color);
        border-radius: 12px;
        padding: 10px;
        background: var(--secondary-background-color);
        display: grid;
        gap: 2px;
      }

      .summary-tile span {
        font-size: 0.74rem;
        color: var(--secondary-text-color);
        text-transform: uppercase;
        letter-spacing: 0.03rem;
      }

      .summary-tile strong {
        font-size: 1.1rem;
      }

      .summary-tile.alert strong {
        color: var(--error-color);
      }

      .section-label {
        margin-top: 2px;
        font-size: 0.72rem;
        letter-spacing: 0.07em;
        text-transform: uppercase;
        font-weight: 700;
        color: var(--secondary-text-color);
      }

      .partition-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
      }

      .partition {
        border: 1px solid var(--divider-color);
        border-radius: 12px;
        background: var(--ha-card-background, var(--card-background-color));
        color: var(--primary-text-color);
        text-align: left;
        padding: 10px;
        display: grid;
        gap: 3px;
        cursor: pointer;
        transition: border-color 0.2s ease, transform 0.06s ease, background 0.2s ease;
      }

      .partition.active {
        border-color: var(--primary-color);
        background: color-mix(in srgb, var(--primary-color) 10%, var(--ha-card-background, var(--card-background-color)));
        box-shadow: 0 4px 14px color-mix(in srgb, var(--primary-color) 16%, transparent);
      }

      .partition-name {
        font-size: 0.86rem;
        font-weight: 700;
      }

      .partition-state {
        font-size: 0.78rem;
        color: var(--secondary-text-color);
      }

      .partition.triggered .partition-state {
        color: var(--error-color);
      }

      .partition.disarmed .partition-state {
        color: var(--success-color, var(--state-icon-active-color, var(--primary-color)));
      }

      .pin-display {
        min-height: 46px;
        border-radius: 12px;
        border: 1px solid var(--divider-color);
        background: color-mix(in srgb, var(--secondary-background-color) 86%, var(--ha-card-background, var(--card-background-color)));
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
        min-height: 44px;
        border: 1px solid transparent;
        border-radius: 12px;
        cursor: pointer;
        font-size: 0.95rem;
        font-weight: 600;
        transition: transform 0.05s ease, filter 0.2s ease, opacity 0.2s ease;
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

      .action:disabled {
        opacity: 0.45;
        cursor: not-allowed;
        filter: grayscale(0.3);
      }

      .key:active,
      .partition:active,
      .action:active {
        transform: translateY(1px);
      }

      .key:hover,
      .partition:hover,
      .action:hover {
        filter: brightness(1.05);
      }

      @media (max-width: 420px) {
        .hero {
          padding: 10px;
        }

        .title {
          font-size: 0.98rem;
        }

        .subtitle {
          font-size: 0.8rem;
        }

        .summary-tile {
          padding: 8px;
        }

        .summary-tile strong {
          font-size: 1rem;
        }

        .partition-grid {
          grid-template-columns: 1fr;
        }
      }

      @media (min-width: 760px) {
        .container {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .hero,
        .summary-grid,
        .section-label,
        .partition-grid,
        .pin-display,
        .keypad,
        .actions {
          grid-column: 1 / -1;
        }

        .partition-grid {
          grid-template-columns: repeat(4, 1fr);
        }
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
