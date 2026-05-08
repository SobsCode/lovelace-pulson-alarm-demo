import { LitElement, html, css } from "https://unpkg.com/lit@3/index.js?module";

const ALARM_FEATURE_ARM_HOME = 1;
const ALARM_FEATURE_ARM_AWAY = 2;
const ALARM_FEATURE_ARM_NIGHT = 4;

const FAULT_SUFFIXES = [
  "ac_loss_230v",
  "low_battery",
  "battery_missing",
  "bell_trouble",
  "service_required",
  "false_code",
  "aux1_problem",
  "aux2_problem",
  "bus_voltage_trouble",
  "bus_communication_problem",
  "ats_communication_problem",
  "zone_fault",
  "time_trouble",
  "gsm_coverage_trouble",
  "gprs_coverage_trouble",
  "tamper_trouble",
  "lan_trouble",
  "no_activity_trouble",
];

class PulsonGuardCard extends LitElement {
  static get properties() {
    return {
      _hass: { state: false },
      _config: { state: false },
      _selectedEntities: { state: true },
      _pendingAction: { state: true },
      _pin: { state: true },
      _feedback: { state: true },
      _isSubmitting: { state: true },
    };
  }

  constructor() {
    super();
    this._hass = null;
    this._config = null;
    this._selectedEntities = [];
    this._pendingAction = null;
    this._pin = "";
    this._feedback = null;
    this._isSubmitting = false;
  }

  setConfig(config) {
    if (!config) throw new Error("Configuration error: provide card config.");
    this._config = {
      name: "Pulson Guard",
      gateway_slug: "pulson_security_integration_gateway",
      ...config,
    };
  }

  set hass(hass) {
    this._hass = hass;
    const ids = this._getPartitions().map((p) => p.entityId);
    this._selectedEntities = this._selectedEntities.filter((id) => ids.includes(id));
    if (!this._selectedEntities.length && ids.length) this._selectedEntities = [ids[0]];
    this.requestUpdate();
  }

  getCardSize() {
    return 9;
  }

  _stateLabel(state) {
    const labels = {
      disarmed: "Rozbrojony",
      armed_away: "Uzbrojony (Wyjście)",
      armed_home: "Uzbrojony (Dom)",
      armed_night: "Uzbrojony (Noc)",
      pending: "Oczekiwanie",
      arming: "Uzbrajanie",
      disarming: "Rozbrajanie",
      triggered: "ALARM",
      unavailable: "Niedostępny",
      unknown: "Nieznany",
    };
    return labels[state] || state;
  }

  _stateTone(state) {
    if (state === "triggered") return "alarm";
    if (state === "disarmed") return "safe";
    if (state.startsWith("armed")) return "armed";
    if (state === "unavailable" || state === "unknown") return "offline";
    return "neutral";
  }

  _partitionIndex(entityId) {
    return (
      Number(entityId.match(/_partition_(\d+)$/)?.[1]) ||
      Number(entityId.match(/_p([1-8])$/)?.[1]) ||
      null
    );
  }

  _gatewaySlug() {
    return this._config?.gateway_slug || "pulson_security_integration_gateway";
  }

  _getPartitions() {
    if (!this._hass || !this._config) return [];
    const fromConfig = Array.isArray(this._config.entities)
      ? this._config.entities
      : typeof this._config.entity === "string"
        ? [this._config.entity]
        : [];

    const ids =
      fromConfig.length > 0
        ? fromConfig
        : Object.keys(this._hass.states).filter((id) =>
            id.startsWith(`alarm_control_panel.${this._gatewaySlug()}_`),
          );

    return ids
      .map((entityId) => ({ entityId, entity: this._hass.states[entityId] }))
      .filter((x) => x.entity)
      .map(({ entityId, entity }) => {
        const index = this._partitionIndex(entityId);
        return {
          entityId,
          entity,
          index,
          title: entity.attributes.friendly_name || (index ? `Partycja ${index}` : entityId),
          tone: this._stateTone(entity.state),
          stateLabel: this._stateLabel(entity.state),
        };
      })
      .sort((a, b) => (a.index || 999) - (b.index || 999));
  }

  _selectedPartitions() {
    return this._getPartitions().filter((p) => this._selectedEntities.includes(p.entityId));
  }

  _health() {
    const slug = this._gatewaySlug();
    const panelOnline = this._hass?.states[`binary_sensor.${slug}_panel_online`]?.state === "on";
    const bridgeOnline = this._hass?.states[`binary_sensor.${slug}_bridge_online`]?.state === "on";
    const anyFault = this._hass?.states[`sensor.${slug}_any_fault`]?.state;
    return { panelOnline, bridgeOnline, anyFault };
  }

  _activeFaults() {
    const slug = this._gatewaySlug();
    return FAULT_SUFFIXES.map((suffix) => {
      const id = `binary_sensor.${slug}_${suffix}`;
      return this._hass.states[id];
    })
      .filter(Boolean)
      .filter((entity) => entity.state === "on")
      .map((entity) => entity.attributes.friendly_name || entity.entity_id);
  }

  _toggle(entityId) {
    if (this._selectedEntities.includes(entityId)) {
      this._selectedEntities = this._selectedEntities.filter((id) => id !== entityId);
      return;
    }
    if (this._selectedEntities.length >= 8) return;
    this._selectedEntities = [...this._selectedEntities, entityId];
  }

  _actionsFor(partition) {
    const features = Number(partition.entity.attributes.supported_features || 0);
    const state = partition.entity.state;
    if (state === "disarmed") {
      const out = [];
      if ((features & ALARM_FEATURE_ARM_AWAY) !== 0) out.push("alarm_arm_away");
      if ((features & ALARM_FEATURE_ARM_HOME) !== 0) out.push("alarm_arm_home");
      if ((features & ALARM_FEATURE_ARM_NIGHT) !== 0) out.push("alarm_arm_night");
      return out;
    }
    if (state.startsWith("armed") || state === "triggered") return ["alarm_disarm"];
    return [];
  }

  _visibleActions(selected) {
    const set = new Set();
    selected.forEach((partition) => this._actionsFor(partition).forEach((x) => set.add(x)));
    return [...set];
  }

  _targetsFor(action, selected) {
    return selected.filter((partition) => this._actionsFor(partition).includes(action));
  }

  _actionUi(action) {
    const map = {
      alarm_arm_away: { label: "Uzbrój Wyjście", short: "Wyjście", icon: "mdi:run-fast" },
      alarm_arm_home: { label: "Uzbrój Dom", short: "Dom", icon: "mdi:home-lock" },
      alarm_arm_night: { label: "Uzbrój Noc", short: "Noc", icon: "mdi:weather-night" },
      alarm_disarm: { label: "Rozbrój", short: "Rozbrój", icon: "mdi:lock-open-variant" },
    };
    return map[action];
  }

  _queueAction(action) {
    if (!this._selectedEntities.length) return;
    this._pendingAction = action;
    this._pin = "";
    this._feedback = null;
  }

  _appendDigit(x) {
    this._pin = `${this._pin}${x}`;
  }

  _clearPin() {
    this._pin = "";
  }

  _cancel() {
    this._pendingAction = null;
    this._pin = "";
    this._isSubmitting = false;
  }

  async _confirm() {
    const selected = this._selectedPartitions();
    const targets = this._targetsFor(this._pendingAction, selected);
    if (!targets.length || this._isSubmitting || !this._pendingAction) return;

    this._isSubmitting = true;
    try {
      await Promise.all(
        targets.map((partition) =>
          this._hass.callService("alarm_control_panel", this._pendingAction, {
            entity_id: partition.entityId,
            code: this._pin,
          }),
        ),
      );

      const status =
        this._hass.states[`sensor.${this._gatewaySlug()}_last_partition_command_status`]?.state || "ok";
      const codeValid =
        this._hass.states[`sensor.${this._gatewaySlug()}_last_partition_code_valid`]?.state || "unknown";
      this._feedback = {
        type: "success",
        text: `Wysłano do ${targets.length} partycji (status: ${status}, PIN: ${codeValid}).`,
      };
    } catch (_error) {
      this._feedback = {
        type: "error",
        text: "Nie udało się wysłać komendy alarmu.",
      };
    } finally {
      this._isSubmitting = false;
      this._pendingAction = null;
      this._pin = "";
    }
  }

  _heroTone(partitions) {
    if (!partitions.length) return "neutral";
    if (partitions.some((p) => p.entity.state === "triggered")) return "alarm";
    if (partitions.every((p) => p.entity.state.startsWith("armed"))) return "armed";
    if (partitions.some((p) => p.entity.state === "disarmed")) return "safe";
    return "neutral";
  }

  render() {
    if (!this._hass || !this._config) return html``;
    const partitions = this._getPartitions();
    if (!partitions.length) {
      return html`<ha-card><div class="empty">Nie znaleziono partycji dla ${this._gatewaySlug()}.</div></ha-card>`;
    }

    const selected = this._selectedPartitions();
    const visibleActions = this._visibleActions(selected);
    const health = this._health();
    const faults = this._activeFaults();
    const tone = this._heroTone(partitions);
    const maskedPin = this._pin.length ? "•".repeat(this._pin.length) : "—";
    const pendingUi = this._pendingAction ? this._actionUi(this._pendingAction) : null;

    return html`
      <ha-card class="card ${tone}">
        <div class="hero">
          <div>
            <div class="eyebrow">Pulson Guard</div>
            <div class="status">${this._stateLabel(partitions[0].entity.state)}</div>
            <div class="meta">
              Panel: ${health.panelOnline ? "online" : "offline"} • Bridge: ${health.bridgeOnline ? "online" : "offline"}
            </div>
          </div>
          <div class="badge ${faults.length ? "fault" : "ok"}">${faults.length ? `Usterki: ${faults.length}` : "Brak usterek"}</div>
        </div>

        ${faults.length
          ? html`<div class="faults">${faults.slice(0, 3).join(" • ")}${faults.length > 3 ? ` • +${faults.length - 3}` : ""}</div>`
          : ""}

        ${this._feedback ? html`<div class="feedback ${this._feedback.type}">${this._feedback.text}</div>` : ""}

        <div class="section-title">Partycje</div>
        <div class="partitions">
          ${partitions.map(
            (partition) => html`
              <button
                class="partition ${partition.tone} ${this._selectedEntities.includes(partition.entityId) ? "active" : ""}"
                @click=${() => this._toggle(partition.entityId)}
              >
                <div class="name">${partition.index ? `P${partition.index}` : partition.title}</div>
                <div class="state">${partition.stateLabel}</div>
              </button>
            `,
          )}
        </div>

        <div class="section-title">Akcje</div>
        <div class="actions">
          ${visibleActions.length
            ? visibleActions.map((action) => {
                const ui = this._actionUi(action);
                const supportedCount = this._targetsFor(action, selected).length;
                return html`
                  <button class="action" @click=${() => this._queueAction(action)} title=${`${supportedCount}/${selected.length}`}>
                    <ha-icon icon=${ui.icon}></ha-icon>
                    <span>${ui.short}</span>
                  </button>
                `;
              })
            : html`<div class="hint">Wybierz partycje, aby zobaczyć dostępne akcje.</div>`}
        </div>

        ${this._pendingAction
          ? html`
              <div class="sheet">
                <div class="sheet-title">${pendingUi.label}</div>
                <div class="pin">${maskedPin}</div>
                <div class="keys">
                  ${["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(
                    (x) => html`<button class="key" @click=${() => this._appendDigit(x)}>${x}</button>`,
                  )}
                  <button class="key alt" @click=${this._clearPin}>C</button>
                  <button class="key" @click=${() => this._appendDigit("0")}>0</button>
                  <button class="key alt" @click=${this._clearPin}>Wyczyść</button>
                </div>
                <div class="confirm">
                  <button class="btn ghost" @click=${this._cancel}>Anuluj</button>
                  <button class="btn solid" ?disabled=${this._isSubmitting} @click=${this._confirm}>
                    ${this._isSubmitting ? "Wysyłanie..." : `Potwierdź (${selected.length})`}
                  </button>
                </div>
              </div>
            `
          : ""}
      </ha-card>
    `;
  }

  static get styles() {
    return css`
      :host {
        display: block;
      }

      .card {
        border-radius: 22px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: radial-gradient(120% 120% at 0% 0%, #20222b 0%, #0f1118 55%, #090b10 100%);
        color: #f5f7fb;
        overflow: hidden;
      }

      .hero {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: center;
        padding: 14px;
      }

      .eyebrow {
        font-size: 0.72rem;
        letter-spacing: 0.09em;
        text-transform: uppercase;
        color: #9aa3b2;
      }

      .status {
        margin-top: 3px;
        font-weight: 800;
        font-size: 1.22rem;
      }

      .meta {
        margin-top: 2px;
        color: #9aa3b2;
        font-size: 0.74rem;
      }

      .safe .status {
        color: #47d37e;
      }
      .armed .status {
        color: #f8ba4b;
      }
      .alarm .status {
        color: #ff5f62;
      }

      .badge {
        font-size: 0.72rem;
        border-radius: 999px;
        padding: 6px 10px;
        border: 1px solid rgba(255, 255, 255, 0.18);
      }
      .badge.ok {
        color: #71e6a2;
        background: rgba(57, 211, 116, 0.14);
      }
      .badge.fault {
        color: #ffd08a;
        background: rgba(255, 166, 0, 0.14);
      }

      .faults {
        margin: 0 14px 8px;
        font-size: 0.75rem;
        color: #ffd08a;
      }

      .feedback {
        margin: 0 14px 10px;
        border-radius: 12px;
        padding: 8px 10px;
        font-size: 0.74rem;
      }
      .feedback.success {
        color: #8cf0b5;
        background: rgba(38, 190, 89, 0.14);
      }
      .feedback.error {
        color: #ff9597;
        background: rgba(228, 72, 75, 0.16);
      }

      .section-title {
        margin: 4px 14px 8px;
        color: #8e98ab;
        font-size: 0.68rem;
        text-transform: uppercase;
        letter-spacing: 0.09em;
        font-weight: 700;
      }

      .partitions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        padding: 0 14px;
      }

      .partition {
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.03);
        color: #f5f7fb;
        border-radius: 14px;
        min-height: 72px;
        cursor: pointer;
      }
      .partition.active {
        border-color: #6ca6ff;
        box-shadow: inset 0 0 0 1px rgba(108, 166, 255, 0.35);
      }
      .partition .name {
        font-weight: 700;
        font-size: 0.8rem;
      }
      .partition .state {
        margin-top: 2px;
        color: #a7b0c1;
        font-size: 0.72rem;
      }

      .actions {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        padding: 0 14px 14px;
      }
      .action {
        min-height: 56px;
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.05);
        color: #f4f7ff;
        cursor: pointer;
        display: grid;
        place-items: center;
        gap: 2px;
        font-size: 0.74rem;
        font-weight: 700;
      }
      .hint {
        grid-column: 1 / -1;
        border: 1px dashed rgba(255, 255, 255, 0.18);
        border-radius: 12px;
        padding: 9px;
        font-size: 0.74rem;
        color: #a7b0c1;
      }

      .sheet {
        border-top: 1px solid rgba(255, 255, 255, 0.15);
        padding: 12px 14px 14px;
        background: linear-gradient(180deg, rgba(10, 12, 18, 0.7), rgba(9, 11, 16, 0.95));
      }
      .sheet-title {
        font-weight: 700;
      }
      .pin {
        margin-top: 8px;
        min-height: 44px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        display: grid;
        place-items: center;
        letter-spacing: 0.35rem;
        font-size: 1.15rem;
      }
      .keys {
        margin-top: 10px;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }
      .key {
        min-height: 42px;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(255, 255, 255, 0.05);
        color: #f7f9ff;
        cursor: pointer;
      }
      .key.alt {
        color: #aeb8cb;
      }
      .confirm {
        margin-top: 10px;
        display: grid;
        grid-template-columns: 1fr 2fr;
        gap: 8px;
      }
      .btn {
        min-height: 42px;
        border-radius: 10px;
        cursor: pointer;
        font-weight: 700;
      }
      .btn.ghost {
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: #c3cbdb;
        background: transparent;
      }
      .btn.solid {
        border: 1px solid #ffffff;
        background: #f6f7fb;
        color: #10131a;
      }
      .btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .empty {
        color: var(--error-color, #ff4b4b);
        padding: 14px;
        font-weight: 700;
      }
    `;
  }
}

customElements.define("pulson-guard-card", PulsonGuardCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "pulson-guard-card",
  name: "Pulson Guard Card",
  description: "Modern alarm card with health, faults, and PIN flow.",
});
