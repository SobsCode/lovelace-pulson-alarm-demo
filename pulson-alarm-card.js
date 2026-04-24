import { LitElement, html, css } from "https://unpkg.com/lit@3/index.js?module";

const ALARM_FEATURE_ARM_HOME = 1;
const ALARM_FEATURE_ARM_AWAY = 2;

class PulsonAlarmCard extends LitElement {
  static get properties() {
    return {
      _hass: { state: false },
      _config: { state: false },
      _pin: { state: true },
      _selectedEntities: { state: true },
      _pendingAction: { state: true },
    };
  }

  constructor() {
    super();
    this._hass = null;
    this._config = null;
    this._pin = "";
    this._selectedEntities = [];
    this._pendingAction = null;
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
    const availableIds = partitions.map((p) => p.entityId);
    this._selectedEntities = this._selectedEntities.filter((id) => availableIds.includes(id));
    if (!this._selectedEntities.length && partitions.length) this._selectedEntities = [partitions[0].entityId];
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
    if (state === "triggered") return "alarm";
    if (state === "disarmed") return "disarmed";
    if (state.startsWith("armed")) return "armed";
    if (state === "pending" || state === "arming") return "arming";
    if (state === "disarming") return "disarming";
    if (state === "pending" || state === "arming" || state === "disarming") return "transition";
    if (state === "unavailable" || state === "unknown") return "offline";
    return "default";
  }

  _stateIcon(state) {
    if (state === "triggered") return "mdi:alarm-light";
    if (state === "disarmed") return "mdi:lock-open-variant-outline";
    if (state.startsWith("armed")) return "mdi:shield-lock-outline";
    if (state === "pending" || state === "arming") return "mdi:progress-clock";
    if (state === "disarming") return "mdi:lock-open-alert-outline";
    if (state === "unavailable" || state === "unknown") return "mdi:lan-disconnect";
    return "mdi:shield-outline";
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

  _hasGlobalFault(partitions) {
    return partitions.some((partition) => {
      const attrs = partition.entity.attributes || {};
      return (
        attrs.trouble === true ||
        attrs.fault === true ||
        attrs.system_fault === true ||
        attrs.tamper === true ||
        attrs.communication_lost === true
      );
    });
  }

  _togglePartition(entityId) {
    if (this._selectedEntities.includes(entityId)) {
      this._selectedEntities = this._selectedEntities.filter((id) => id !== entityId);
      return;
    }
    if (this._selectedEntities.length >= 8) return;
    this._selectedEntities = [...this._selectedEntities, entityId];
  }

  _appendDigit(digit) {
    this._pin = `${this._pin}${digit}`;
  }

  _clearPin() {
    this._pin = "";
  }

  _queueAction(service) {
    if (!this._selectedEntities.length) return;
    this._pendingAction = service;
    this._pin = "";
  }

  _cancelPendingAction() {
    this._pendingAction = null;
    this._pin = "";
  }

  async _executePendingAction() {
    if (!this._hass || !this._pendingAction || !this._selectedEntities.length) return;

    try {
      await Promise.all(
        this._selectedEntities.map((entityId) =>
          this._hass.callService("alarm_control_panel", this._pendingAction, {
            entity_id: entityId,
            code: this._pin,
          }),
        ),
      );
    } finally {
      this._cancelPendingAction();
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

    const selectedPartitions = partitions.filter((p) => this._selectedEntities.includes(p.entityId));
    const canArmAway =
      selectedPartitions.length > 0 &&
      selectedPartitions.every((p) => (Number(p.entity.attributes.supported_features || 0) & ALARM_FEATURE_ARM_AWAY) !== 0);
    const canArmHome =
      selectedPartitions.length > 0 &&
      selectedPartitions.every((p) => (Number(p.entity.attributes.supported_features || 0) & ALARM_FEATURE_ARM_HOME) !== 0);
    const maskedPin = this._pin.length ? "*".repeat(this._pin.length) : "-";
    const selectedCount = selectedPartitions.length;
    const hasGlobalFault = this._hasGlobalFault(partitions);

    const pendingActionLabel = {
      alarm_arm_away: "Uzbroj",
      alarm_arm_home: "Uzbroj w domu",
      alarm_disarm: "Rozbroj",
    }[this._pendingAction];

    return html`
      <ha-card>
        <div class="container">
          <div class="hero">
            ${hasGlobalFault ? html`<div class="global-fault"><ha-icon icon="mdi:alert-outline"></ha-icon> Usterka systemu</div>` : ""}
            <div>
              <div class="title">${this._config.name}</div>
              <div class="subtitle">Zaznaczone partycje: ${selectedCount}</div>
            </div>
            <div class="status-pill">${this._pendingAction ? `Akcja: ${pendingActionLabel}` : "Gotowy"}</div>
          </div>

          <div class="section-label">Partycje</div>
          <div class="partition-grid">
            ${partitions.map(
              (partition) => html`
                <button
                  class="partition ${partition.stateClass} ${this._selectedEntities.includes(partition.entityId) ? "active" : ""}"
                  @click=${() => this._togglePartition(partition.entityId)}
                >
                  <div class="partition-icon ${partition.stateClass}">
                    <ha-icon icon=${this._stateIcon(partition.entity.state)}></ha-icon>
                  </div>
                  <div class="partition-name">${partition.index ? `P${partition.index}` : partition.title}</div>
                  <div class="partition-state">${partition.stateLabel}</div>
                </button>
              `,
            )}
          </div>

          <div class="section-label">Akcje</div>
          <div class="actions">
            <button
              class="action primary"
              ?disabled=${!canArmAway || selectedCount === 0}
              @click=${() => this._queueAction("alarm_arm_away")}
            >
              Uzbroj
            </button>
            <button
              class="action secondary"
              ?disabled=${!canArmHome || selectedCount === 0}
              @click=${() => this._queueAction("alarm_arm_home")}
            >
              Uzbroj w domu
            </button>
            <button
              class="action danger"
              ?disabled=${selectedCount === 0}
              @click=${() => this._queueAction("alarm_disarm")}
            >
              Rozbroj
            </button>
          </div>

          ${this._pendingAction
            ? html`
                <div class="pin-panel">
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

                  <div class="confirm-row">
                    <button class="confirm neutral" @click=${this._cancelPendingAction}>Anuluj</button>
                    <button class="confirm accent" @click=${this._executePendingAction}>
                      Potwierdz: ${pendingActionLabel} (${selectedCount})
                    </button>
                  </div>
                </div>
              `
            : ""}
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
        background: var(--ha-card-background, var(--card-background-color, #ffffff));
        color: var(--primary-text-color, #111827);
        border-radius: var(--ha-card-border-radius, 20px);
        border: 1px solid var(--divider-color, #e2e8f0);
        box-shadow: 0 10px 26px color-mix(in srgb, var(--primary-text-color, #111827) 8%, transparent);
      }

      .container {
        padding: 14px;
        display: grid;
        gap: 10px;
      }

      .hero {
        position: relative;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        background: var(--secondary-background-color, #f8fafc);
        border: 1px solid var(--divider-color, #e2e8f0);
        border-radius: 14px;
        padding: 12px;
      }

      .global-fault {
        position: absolute;
        top: -8px;
        right: -8px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        padding: 6px 10px;
        border: 1px solid #fcd34d;
        background: #fef3c7;
        color: #92400e;
        font-size: 0.7rem;
        font-weight: 700;
      }

      .global-fault ha-icon {
        --mdc-icon-size: 14px;
      }

      .title {
        font-size: 1.03rem;
        font-weight: 700;
        color: var(--primary-text-color, #111827);
      }

      .subtitle {
        margin-top: 2px;
        font-size: 0.78rem;
        color: var(--secondary-text-color, #64748b);
      }

      .status-pill {
        border-radius: 999px;
        font-size: 0.74rem;
        font-weight: 600;
        padding: 7px 10px;
        border: 1px solid var(--divider-color, #e2e8f0);
        color: var(--secondary-text-color, #475569);
        background: var(--ha-card-background, #ffffff);
      }

      .section-label {
        margin-top: 2px;
        font-size: 0.68rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        font-weight: 700;
        color: var(--secondary-text-color, #64748b);
      }

      .partition-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
      }

      .partition {
        border: 1px solid var(--divider-color, #e2e8f0);
        border-radius: 14px;
        background: var(--ha-card-background, #ffffff);
        color: var(--primary-text-color, #111827);
        min-height: 84px;
        text-align: center;
        padding: 10px 8px;
        display: grid;
        place-items: center;
        gap: 6px;
        cursor: pointer;
        transition: border-color 0.2s ease, transform 0.06s ease, box-shadow 0.2s ease;
      }

      .partition.active {
        border-color: color-mix(in srgb, var(--primary-color, #3b82f6) 30%, var(--divider-color, #e2e8f0));
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary-color, #3b82f6) 22%, transparent);
      }

      .partition-icon {
        width: 26px;
        height: 26px;
        border-radius: 999px;
        border: 1px solid var(--divider-color, #e2e8f0);
        display: grid;
        place-items: center;
      }

      .partition-icon ha-icon {
        --mdc-icon-size: 16px;
      }

      .partition-icon.armed {
        color: var(--success-color, #16a34a);
        background: color-mix(in srgb, var(--success-color, #16a34a) 10%, transparent);
      }

      .partition-icon.disarmed {
        color: var(--warning-color, #f59e0b);
        background: color-mix(in srgb, var(--warning-color, #f59e0b) 12%, transparent);
      }

      .partition-icon.alarm {
        color: var(--error-color, #dc2626);
        background: color-mix(in srgb, var(--error-color, #dc2626) 12%, transparent);
      }

      .partition-icon.arming,
      .partition-icon.disarming {
        color: var(--primary-color, #3b82f6);
        background: color-mix(in srgb, var(--primary-color, #3b82f6) 10%, transparent);
      }

      .partition-icon.offline {
        color: var(--disabled-text-color, #9ca3af);
        background: color-mix(in srgb, var(--disabled-text-color, #9ca3af) 10%, transparent);
      }

      .partition-name {
        font-size: 0.74rem;
        font-weight: 650;
      }

      .partition-state {
        font-size: 0.66rem;
        color: var(--secondary-text-color, #64748b);
        line-height: 1.2;
      }

      .pin-panel {
        display: grid;
        gap: 10px;
        padding: 12px;
        border: 1px solid var(--divider-color, #e2e8f0);
        border-radius: 14px;
        background: var(--secondary-background-color, #f8fafc);
      }

      .pin-display {
        min-height: 46px;
        border-radius: 12px;
        border: 1px solid var(--divider-color, #e2e8f0);
        background: var(--ha-card-background, #ffffff);
        color: var(--primary-text-color, #111827);
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
        background: var(--ha-card-background, #ffffff);
        color: var(--primary-text-color, #111827);
        border: 1px solid var(--divider-color, #e2e8f0);
      }

      .key.clear {
        color: var(--secondary-text-color, #64748b);
      }

      .actions {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }

      .action.primary {
        background: var(--primary-text-color, #111827);
        color: var(--text-primary-color, #fff);
        border-color: var(--primary-text-color, #111827);
      }

      .action.secondary {
        background: var(--ha-card-background, #ffffff);
        color: var(--primary-text-color, #111827);
        border-color: var(--divider-color, #e2e8f0);
      }

      .action.danger {
        background: color-mix(in srgb, var(--error-color, #dc2626) 10%, transparent);
        color: var(--error-color, #dc2626);
        border-color: color-mix(in srgb, var(--error-color, #dc2626) 25%, var(--divider-color, #e2e8f0));
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

      .confirm-row {
        display: grid;
        grid-template-columns: 1fr 2fr;
        gap: 8px;
      }

      .confirm {
        min-height: 44px;
        border-radius: 12px;
        border: 1px solid var(--divider-color, #e2e8f0);
        cursor: pointer;
        font-size: 0.9rem;
        font-weight: 700;
      }

      .confirm.neutral {
        background: var(--ha-card-background, #ffffff);
        color: var(--secondary-text-color, #64748b);
      }

      .confirm.accent {
        background: var(--primary-text-color, #111827);
        color: var(--text-primary-color, #fff);
        border-color: var(--primary-text-color, #111827);
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
        .actions {
          grid-column: 1 / -1;
        }

        .partition-grid {
          grid-template-columns: repeat(3, 1fr);
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
