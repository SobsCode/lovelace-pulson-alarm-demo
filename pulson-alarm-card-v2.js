import { LitElement, html, css } from "https://unpkg.com/lit@3/index.js?module";

const F_ARM_HOME = 1;
const F_ARM_AWAY = 2;
const F_ARM_NIGHT = 4;

class PulsonAlarmCard extends LitElement {
  static get properties() {
    return {
      _hass: { state: false },
      _config: { state: false },
      _expandedPartitionId: { state: true },
      _drawerOpen: { state: true },
      _pendingAction: { state: true },
      _pin: { state: true },
      _isSending: { state: true },
      _feedback: { state: true },
      _panicSlider: { state: true },
      _panicResetting: { state: true },
    };
  }

  constructor() {
    super();
    this._hass = null;
    this._config = null;
    this._expandedPartitionId = null;
    this._drawerOpen = false;
    this._pendingAction = null;
    this._pin = "";
    this._isSending = false;
    this._feedback = null;
    this._panicSlider = 0;
    this._panicResetting = false;
  }

  setConfig(config) {
    if (!config || (!config.entity && !Array.isArray(config.entities) && !config.gateway_slug)) {
      throw new Error("Provide entity, entities or gateway_slug.");
    }
    this._config = {
      name: "Pulson Alarm",
      gateway_slug: "pulson_security_integration_gateway",
      panic_service: null,
      panic_service_data: {},
      ...config,
    };
  }

  set hass(hass) {
    this._hass = hass;
    this.requestUpdate();
  }

  getCardSize() {
    return 11;
  }

  _stateLabel(state) {
    const map = {
      disarmed: "Wyłączony",
      armed_away: "Tryb wyjścia",
      armed_home: "Tryb domowy",
      armed_night: "Tryb nocny",
      triggered: "ALARM",
      pending: "Oczekiwanie",
      arming: "Uzbrajanie",
      disarming: "Rozbrajanie",
      unavailable: "Niedostępny",
      unknown: "Nieznany",
    };
    return map[state] || state;
  }

  _normalizeEntityId(id) {
    return id.replace(/_pulson_partition_(\d+)$/, "_partition_$1");
  }

  _partitionIndex(entityId) {
    return (
      Number(entityId.match(/_partition_(\d+)$/)?.[1]) ||
      Number(entityId.match(/_pulson_partition_(\d+)$/)?.[1]) ||
      Number(entityId.match(/_p([1-8])$/)?.[1]) ||
      null
    );
  }

  _partitionIds() {
    if (!this._hass || !this._config) return [];
    if (Array.isArray(this._config.entities) && this._config.entities.length) {
      const configured = this._config.entities.flatMap((id) => [id, this._normalizeEntityId(id)]);
      return [...new Set(configured)].filter((id) => !!this._hass.states[id]);
    }

    if (this._config.entity) {
      const seed = [this._config.entity, this._normalizeEntityId(this._config.entity)].find((id) => !!this._hass.states[id]);
      if (seed) {
        const base = seed.replace(/_partition_\d+$/, "").replace(/_pulson_partition_\d+$/, "").replace(/_p[1-8]$/, "");
        const siblings = Object.keys(this._hass.states).filter((id) => id.startsWith(`${base}_`));
        if (siblings.length) return siblings;
        return [seed];
      }
    }

    const slug = this._config.gateway_slug;
    return Object.keys(this._hass.states).filter((id) => id.startsWith(`alarm_control_panel.${slug}_`));
  }

  _partitions() {
    if (!this._hass || !this._config) return [];
    return this._partitionIds()
      .map((entityId) => {
        const entity = this._hass.states[entityId];
        if (!entity) return null;
        const index = this._partitionIndex(entityId);
        return {
          id: index ?? entityId,
          entityId,
          index,
          entity,
          title: entity.attributes.friendly_name || (index ? `Partycja ${index}` : entityId),
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a.index ?? 999) - (b.index ?? 999));
  }

  _zoneStatusText(state) {
    if (state === "on") return "Naruszony";
    if (state === "off") return "Gotowy";
    if (state === "unknown") return "Nieznany";
    if (state === "unavailable") return "Niedostępny";
    return state;
  }

  _zoneStatusClass(state) {
    if (state === "on") return "status-violated";
    if (state === "off") return "status-ready";
    return "status-notReady";
  }

  _zonesForPartition(partition) {
    const slug = this._config.gateway_slug;
    const zones = Object.keys(this._hass.states)
      .filter((id) => id.startsWith(`sensor.${slug}_zone_`))
      .map((id) => this._hass.states[id])
      .filter(Boolean)
      .map((entity) => {
        const zoneId = Number(entity.entity_id.match(/_zone_(\d+)$/)?.[1]) || 0;
        const partitionAttr = Number(entity.attributes.partition || entity.attributes.partition_id || 0) || null;
        return {
          id: zoneId,
          name: entity.attributes.friendly_name || `Linia ${zoneId}`,
          state: entity.state,
          partitionId: partitionAttr,
        };
      });

    const filtered = partition.index ? zones.filter((z) => !z.partitionId || z.partitionId === partition.index) : zones;
    return filtered.sort((a, b) => a.id - b.id);
  }

  _allowedActions(partition) {
    const state = partition.entity.state;
    const features = Number(partition.entity.attributes.supported_features || 0);
    if (state === "disarmed") {
      const actions = [];
      if ((features & F_ARM_AWAY) !== 0) actions.push("alarm_arm_away");
      if ((features & F_ARM_HOME) !== 0) actions.push("alarm_arm_home");
      if ((features & F_ARM_NIGHT) !== 0) actions.push("alarm_arm_night");
      return actions;
    }
    if (state.startsWith("armed") || state === "triggered") return ["alarm_disarm"];
    return [];
  }

  _stateForAll(partitions) {
    if (!partitions.length) return "none";
    const unique = [...new Set(partitions.map((p) => p.entity.state))];
    if (unique.length > 1) return "partial";
    const only = unique[0];
    if (only === "armed_away") return "away";
    if (only === "armed_night") return "night";
    if (only === "disarmed") return "disarm";
    return "partial";
  }

  _stateHeadline(stateClass) {
    if (stateClass === "away") return { icon: "mdi:home-lock", title: "Tryb wyjścia", desc: "System uzbrojony w pełnym trybie ochrony" };
    if (stateClass === "night") return { icon: "mdi:weather-night", title: "Tryb nocny", desc: "System uzbrojony w trybie nocnym" };
    if (stateClass === "disarm") return { icon: "mdi:lock-open-variant-outline", title: "System wyłączony", desc: "Alarm rozbrojony" };
    return { icon: "mdi:shield-half-full", title: "System częściowy", desc: "Partycje są w różnych stanach" };
  }

  _setAllPartitionsAction(action) {
    this._pendingAction = action;
    this._pin = "";
    this._feedback = null;
    this._drawerOpen = true;
  }

  _togglePartitionExpansion(partitionId) {
    this._expandedPartitionId = this._expandedPartitionId === partitionId ? null : partitionId;
  }

  _actionUi(action) {
    const map = {
      alarm_arm_away: { icon: "mdi:home-lock", label: "Tryb wyjścia" },
      alarm_arm_home: { icon: "mdi:shield-home", label: "Tryb domowy" },
      alarm_arm_night: { icon: "mdi:weather-night", label: "Tryb nocny" },
      alarm_disarm: { icon: "mdi:lock-open-variant-outline", label: "Wyłącz" },
    };
    return map[action];
  }

  async _confirmPendingAction() {
    if (!this._pendingAction || this._isSending) return;
    const partitions = this._partitions();
    const targets = partitions.filter((p) => this._allowedActions(p).includes(this._pendingAction));
    if (!targets.length) return;
    this._isSending = true;
    try {
      await Promise.all(
        targets.map((partition) =>
          this._hass.callService("alarm_control_panel", this._pendingAction, {
            entity_id: partition.entityId,
            code: this._pin,
          }),
        ),
      );
      this._feedback = { type: "success", text: `Wysłano komendę do ${targets.length} partycji.` };
    } catch (_e) {
      this._feedback = { type: "error", text: "Nie udało się wysłać komendy." };
    } finally {
      this._isSending = false;
      this._pendingAction = null;
      this._pin = "";
    }
  }

  async _triggerPanic() {
    if (!this._config.panic_service) return;
    const [domain, service] = this._config.panic_service.split(".");
    if (!domain || !service) return;
    await this._hass.callService(domain, service, this._config.panic_service_data || {});
  }

  _updatePanicSlider(value) {
    const normalized = Number(value);
    this._panicSlider = normalized;
    if (normalized >= 100) {
      if (navigator.vibrate) navigator.vibrate(200);
      this._triggerPanic();
      setTimeout(() => {
        this._panicResetting = true;
        this._panicSlider = 0;
        setTimeout(() => {
          this._panicResetting = false;
        }, 450);
      }, 180);
      return;
    }
    if (normalized >= 90 && navigator.vibrate) navigator.vibrate(40);
  }

  render() {
    if (!this._hass || !this._config) return html``;
    const partitions = this._partitions();
    if (!partitions.length) {
      return html`<ha-card><div class="empty">Brak partycji dla <code>${this._config.gateway_slug}</code>.</div></ha-card>`;
    }

    const stateClass = this._stateForAll(partitions);
    const headline = this._stateHeadline(stateClass);
    const canAway = partitions.some((p) => this._allowedActions(p).includes("alarm_arm_away"));
    const canNight = partitions.some((p) => this._allowedActions(p).includes("alarm_arm_night"));
    const canDisarm = partitions.some((p) => this._allowedActions(p).includes("alarm_disarm"));
    const pendingUi = this._pendingAction ? this._actionUi(this._pendingAction) : null;

    return html`
      <ha-card class="dashboard">
        <div class="control-panel">
          <div class="status-indicator ${stateClass}">
            <div class="status-icon"><ha-icon icon=${headline.icon}></ha-icon></div>
            <div class="status-info">
              <div class="status-label">${headline.title}</div>
              <div class="status-description">${headline.desc}</div>
            </div>
          </div>

          <div class="state-controls">
            <button class="state-button-wrapper away ${canAway ? "" : "disabled"}" ?disabled=${!canAway} @click=${() => this._setAllPartitionsAction("alarm_arm_away")}>
              <div class="state-button"><ha-icon icon="mdi:home-lock"></ha-icon></div>
              <div class="button-label">Tryb wyjścia</div>
              <div class="button-description">Pełna ochrona</div>
            </button>

            <button class="state-button-wrapper night ${canNight ? "" : "disabled"}" ?disabled=${!canNight} @click=${() => this._setAllPartitionsAction("alarm_arm_night")}>
              <div class="state-button"><ha-icon icon="mdi:weather-night"></ha-icon></div>
              <div class="button-label">Tryb nocny</div>
              <div class="button-description">Ochrona nocna</div>
            </button>

            <button class="state-button-wrapper disarm ${canDisarm ? "" : "disabled"}" ?disabled=${!canDisarm} @click=${() => this._setAllPartitionsAction("alarm_disarm")}>
              <div class="state-button"><ha-icon icon="mdi:lock-open-variant-outline"></ha-icon></div>
              <div class="button-label">Wyłącz</div>
              <div class="button-description">Wyłącz system</div>
            </button>
          </div>
        </div>

        ${this._feedback ? html`<div class="feedback ${this._feedback.type}">${this._feedback.text}</div>` : ""}

        <div class="partitions-list">
          ${partitions.map((partition) => {
            const expanded = this._expandedPartitionId === partition.id;
            const zoneList = this._zonesForPartition(partition);
            return html`
              <div class="partition-card">
                <div class="partition-content">
                  <div class="partition-icon"><ha-icon icon="mdi:shield-outline"></ha-icon></div>
                  <div class="partition-info">
                    <div class="partition-title">
                      <span class="name">${partition.title}</span>
                      ${partition.index ? html`<span class="id-label">Partycja #${partition.index}</span>` : ""}
                    </div>
                    <div class="partition-status">${this._stateLabel(partition.entity.state)}</div>
                  </div>
                  <button class="expand-btn ${expanded ? "rotated" : ""}" @click=${() => this._togglePartitionExpansion(partition.id)}>
                    <ha-icon icon="mdi:chevron-down"></ha-icon>
                  </button>
                </div>

                ${expanded
                  ? html`
                      <div class="zones-grid">
                        ${zoneList.length
                          ? zoneList.map(
                              (zone) => html`
                                <div class="zone-item">
                                  <div class="zone-name">
                                    <span class="id-label">Linia #${zone.id}</span>
                                    <span>${zone.name}</span>
                                  </div>
                                  <div class="zone-status ${this._zoneStatusClass(zone.state)}">${this._zoneStatusText(zone.state)}</div>
                                </div>
                              `,
                            )
                          : html`<div class="zone-empty">Brak stref do wyświetlenia.</div>`}
                      </div>
                    `
                  : ""}
              </div>
            `;
          })}
        </div>

        <div class="action-drawer ${this._drawerOpen ? "expanded" : ""}">
          <button class="drawer-handle" @click=${() => (this._drawerOpen = !this._drawerOpen)}>
            <ha-icon icon=${this._drawerOpen ? "mdi:chevron-down" : "mdi:chevron-up"}></ha-icon>
            <span>Akcje systemowe</span>
          </button>

          <div class="drawer-content">
            ${this._pendingAction
              ? html`
                  <div class="pin-panel">
                    <div class="pin-title">${pendingUi?.label}</div>
                    <div class="pin-display">${this._pin.length ? "•".repeat(this._pin.length) : "—"}</div>
                    <div class="keys">
                      ${["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => html`<button class="key" @click=${() => (this._pin = `${this._pin}${d}`)}>${d}</button>`)}
                      <button class="key alt" @click=${() => (this._pin = "")}>C</button>
                      <button class="key" @click=${() => (this._pin = `${this._pin}0`)}>0</button>
                      <button class="key alt" @click=${() => (this._pin = "")}>Wyczyść</button>
                    </div>
                    <div class="confirm-row">
                      <button class="btn ghost" @click=${() => (this._pendingAction = null)}>Anuluj</button>
                      <button class="btn solid" ?disabled=${this._isSending} @click=${this._confirmPendingAction}>
                        ${this._isSending ? "Wysyłanie..." : "Potwierdź"}
                      </button>
                    </div>
                  </div>
                `
              : ""}

            <div class="panic-slider-container">
              <div class="panic-header">
                <ha-icon icon="mdi:alarm-light"></ha-icon>
                <span>Alarm napadowy</span>
              </div>
              <input
                class="panic-slider ${this._panicResetting ? "resetting" : ""}"
                type="range"
                min="0"
                max="100"
                .value=${String(this._panicSlider)}
                @input=${(e) => this._updatePanicSlider(e.target.value)}
                @change=${() => {
                  if (this._panicSlider < 100) this._updatePanicSlider(0);
                }}
              />
              <div class="panic-hint">${this._config.panic_service ? "Przesuń do końca, aby aktywować PANIC." : "Ustaw panic_service w config, aby aktywować."}</div>
            </div>
          </div>
        </div>
      </ha-card>
    `;
  }

  static get styles() {
    return css`
      :host { display: block; }
      .dashboard {
        border-radius: 18px;
        background: radial-gradient(130% 140% at 0% 0%, #1e2430 0%, #131927 58%, #0a1018 100%);
        color: #eef2ff;
        border: 1px solid color-mix(in srgb, #ffffff 14%, transparent);
        overflow: hidden;
      }

      .control-panel { padding: 14px; }
      .status-indicator {
        display: flex;
        gap: 12px;
        align-items: center;
        border-radius: 14px;
        padding: 14px;
        margin-bottom: 14px;
        background: color-mix(in srgb, #ffffff 6%, transparent);
      }
      .status-icon {
        width: 44px; height: 44px; border-radius: 50%;
        display: grid; place-items: center;
        background: linear-gradient(135deg, #5b7bff, #4056d6);
      }
      .status-icon ha-icon { --mdc-icon-size: 24px; }
      .status-label { font-size: 1rem; font-weight: 700; }
      .status-description { font-size: 0.75rem; color: #a4afc2; margin-top: 2px; }
      .status-indicator.away .status-icon { background: linear-gradient(135deg, #f44336, #e53935); }
      .status-indicator.night .status-icon { background: linear-gradient(135deg, #9c27b0, #8e24aa); }
      .status-indicator.disarm .status-icon { background: linear-gradient(135deg, #4caf50, #43a047); }
      .status-indicator.partial .status-icon { background: linear-gradient(135deg, #ff9800, #fb8c00); }

      .state-controls { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
      .state-button-wrapper {
        border-radius: 14px;
        border: 1px solid color-mix(in srgb, #ffffff 16%, transparent);
        background: color-mix(in srgb, #ffffff 4%, transparent);
        color: #eef2ff;
        padding: 10px;
        text-align: center;
        cursor: pointer;
      }
      .state-button-wrapper.disabled { opacity: 0.5; cursor: not-allowed; }
      .state-button {
        width: 50px; height: 50px; margin: 0 auto 8px;
        border-radius: 50%; display: grid; place-items: center;
      }
      .state-button-wrapper.away .state-button { background: linear-gradient(135deg, #f44336, #e53935); }
      .state-button-wrapper.night .state-button { background: linear-gradient(135deg, #9c27b0, #8e24aa); }
      .state-button-wrapper.disarm .state-button { background: linear-gradient(135deg, #4caf50, #43a047); }
      .button-label { font-size: 0.78rem; font-weight: 700; }
      .button-description { font-size: 0.68rem; color: #a9b4c9; margin-top: 2px; }

      .feedback { margin: 0 14px 10px; border-radius: 10px; padding: 8px 10px; font-size: 0.74rem; }
      .feedback.success { color: #8ff0ba; background: color-mix(in srgb, #2ecc71 16%, transparent); }
      .feedback.error { color: #ff9ea6; background: color-mix(in srgb, #ef4444 20%, transparent); }

      .partitions-list { padding: 0 14px 78px; display: grid; gap: 10px; }
      .partition-card {
        border-radius: 12px;
        border: 1px solid color-mix(in srgb, #ffffff 14%, transparent);
        background: color-mix(in srgb, #ffffff 4%, transparent);
      }
      .partition-content { display: flex; align-items: center; gap: 10px; padding: 10px; }
      .partition-icon {
        width: 34px; height: 34px; border-radius: 50%;
        display: grid; place-items: center;
        background: color-mix(in srgb, #50dc8a 16%, transparent);
      }
      .partition-info { flex: 1; min-width: 0; }
      .partition-title { display: flex; align-items: center; gap: 6px; }
      .partition-title .name { font-size: 0.82rem; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .id-label { font-size: 0.65rem; border-radius: 5px; padding: 2px 5px; background: color-mix(in srgb, #ffffff 10%, transparent); color: #abb6ca; }
      .partition-status { font-size: 0.73rem; color: #9eabc0; margin-top: 2px; }
      .expand-btn {
        border: none; background: transparent; color: #b7c1d3; cursor: pointer;
        transition: transform 0.2s ease;
      }
      .expand-btn.rotated { transform: rotate(180deg); }

      .zones-grid { padding: 0 10px 10px; display: grid; gap: 7px; }
      .zone-item {
        display: flex; justify-content: space-between; align-items: center;
        border-radius: 10px; padding: 8px 10px;
        background: color-mix(in srgb, #ffffff 4%, transparent);
      }
      .zone-name { display: flex; gap: 6px; align-items: center; font-size: 0.74rem; }
      .zone-status { font-size: 0.72rem; font-weight: 700; }
      .zone-status.status-ready { color: #60df95; }
      .zone-status.status-violated { color: #ff747a; }
      .zone-status.status-notReady { color: #f4be5d; }
      .zone-empty { color: #a6b1c5; font-size: 0.73rem; padding: 8px 0; }

      .action-drawer {
        position: sticky; bottom: 0; left: 0; right: 0;
        border-top: 1px solid color-mix(in srgb, #ffffff 15%, transparent);
        background: linear-gradient(180deg, rgba(10, 12, 18, 0.88), rgba(9, 11, 16, 0.98));
      }
      .drawer-handle {
        width: 100%; min-height: 48px; border: none; background: transparent; color: #d2dbec;
        display: inline-flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer;
      }
      .drawer-content { display: none; padding: 0 14px 14px; }
      .action-drawer.expanded .drawer-content { display: block; }

      .pin-panel { margin-bottom: 12px; }
      .pin-title { font-size: 0.8rem; font-weight: 700; margin-bottom: 8px; }
      .pin-display {
        min-height: 42px; border-radius: 10px; border: 1px solid color-mix(in srgb, #ffffff 18%, transparent);
        display: grid; place-items: center; letter-spacing: 0.3rem; margin-bottom: 8px;
      }
      .keys { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
      .key {
        min-height: 38px; border-radius: 9px; border: 1px solid color-mix(in srgb, #ffffff 18%, transparent);
        background: color-mix(in srgb, #ffffff 5%, transparent); color: #f2f5ff; cursor: pointer;
      }
      .key.alt { color: #aeb8cb; }
      .confirm-row { margin-top: 8px; display: grid; grid-template-columns: 1fr 2fr; gap: 7px; }
      .btn { min-height: 40px; border-radius: 9px; cursor: pointer; font-weight: 700; }
      .btn.ghost { border: 1px solid color-mix(in srgb, #ffffff 18%, transparent); background: transparent; color: #cad3e2; }
      .btn.solid { border: 1px solid #f2f5ff; background: #f2f5ff; color: #0f1520; }
      .btn:disabled { opacity: 0.6; cursor: not-allowed; }

      .panic-slider-container {
        border-radius: 12px;
        border: 1px solid color-mix(in srgb, #ffffff 15%, transparent);
        background: color-mix(in srgb, #ffffff 3%, transparent);
        padding: 10px;
      }
      .panic-header { display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 0.8rem; margin-bottom: 8px; }
      .panic-header ha-icon { color: #ff7277; }
      .panic-slider { width: 100%; accent-color: #ef4444; }
      .panic-slider.resetting { transition: all 0.4s ease; }
      .panic-hint { margin-top: 6px; font-size: 0.69rem; color: #a8b3c7; }

      .empty { color: var(--error-color, #ff5b62); font-weight: 700; padding: 12px; }
      code { background: color-mix(in srgb, #ffffff 12%, transparent); padding: 0.1rem 0.35rem; border-radius: 6px; }
    `;
  }
}

customElements.define("pulson-alarm-card", PulsonAlarmCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "pulson-alarm-card",
  name: "Pulson Alarm Card",
  description: "Partition dashboard style card inspired by the Angular mobile app.",
});
