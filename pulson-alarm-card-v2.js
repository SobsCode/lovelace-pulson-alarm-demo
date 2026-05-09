import { LitElement, html, css } from "https://unpkg.com/lit@3/index.js?module";

const F_ARM_HOME = 1;
const F_ARM_AWAY = 2;
const F_ARM_NIGHT = 4;

const FAULT_KEYS = [
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

class PulsonAlarmCard extends LitElement {
  static get properties() {
    return {
      _hass: { state: false },
      _config: { state: false },
      _selected: { state: true },
      _pin: { state: true },
      _pending: { state: true },
      _sending: { state: true },
      _feedback: { state: true },
    };
  }

  constructor() {
    super();
    this._hass = null;
    this._config = null;
    this._selected = [];
    this._pin = "";
    this._pending = null;
    this._sending = false;
    this._feedback = null;
  }

  setConfig(config) {
    if (!config || (!config.entity && !Array.isArray(config.entities) && !config.gateway_slug)) {
      throw new Error("Provide entity, entities, or gateway_slug.");
    }
    this._config = {
      name: "Pulson Alarm",
      gateway_slug: "pulson_security_integration_gateway",
      ...config,
    };
  }

  set hass(hass) {
    this._hass = hass;
    const ids = this._partitions().map((p) => p.entityId);
    this._selected = this._selected.filter((id) => ids.includes(id));
    if (!this._selected.length && ids.length) this._selected = [ids[0]];
    this.requestUpdate();
  }

  getCardSize() {
    return 9;
  }

  _stateLabel(state) {
    const m = {
      disarmed: "Rozbrojony",
      armed_away: "Uzbrojony (Wyjście)",
      armed_home: "Uzbrojony (Dom)",
      armed_night: "Uzbrojony (Noc)",
      triggered: "ALARM",
      pending: "Oczekiwanie",
      arming: "Uzbrajanie",
      disarming: "Rozbrajanie",
      unavailable: "Niedostępny",
      unknown: "Nieznany",
    };
    return m[state] || state;
  }

  _tone(state) {
    if (state === "triggered") return "alarm";
    if (state === "disarmed") return "safe";
    if (state.startsWith("armed")) return "armed";
    if (state === "unavailable" || state === "unknown") return "offline";
    return "neutral";
  }

  _idx(id) {
    return Number(id.match(/_partition_(\d+)$/)?.[1]) || Number(id.match(/_pulson_partition_(\d+)$/)?.[1]) || Number(id.match(/_p([1-8])$/)?.[1]) || null;
  }

  _normalize(id) {
    return id.replace(/_pulson_partition_(\d+)$/, "_partition_$1");
  }

  _candidateIds() {
    if (Array.isArray(this._config.entities) && this._config.entities.length) {
      return this._config.entities.flatMap((id) => [id, this._normalize(id)]);
    }
    if (this._config.entity) {
      const seed = [this._config.entity, this._normalize(this._config.entity)].find((id) => this._hass.states[id]);
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
    const uniq = [...new Set(this._candidateIds())];
    return uniq
      .map((entityId) => ({ entityId, entity: this._hass.states[entityId] }))
      .filter((x) => x.entity)
      .map(({ entityId, entity }) => ({
        entityId,
        entity,
        index: this._idx(entityId),
        title: entity.attributes.friendly_name || entityId,
        label: this._stateLabel(entity.state),
        tone: this._tone(entity.state),
      }))
      .sort((a, b) => (a.index ?? 999) - (b.index ?? 999));
  }

  _selectedPartitions() {
    const s = new Set(this._selected);
    return this._partitions().filter((p) => s.has(p.entityId));
  }

  _health() {
    const slug = this._config.gateway_slug;
    return {
      panel: this._hass.states[`binary_sensor.${slug}_panel_online`]?.state === "on",
      bridge: this._hass.states[`binary_sensor.${slug}_bridge_online`]?.state === "on",
      service: this._hass.states[`sensor.${slug}_service_mode_on`]?.state || "unknown",
    };
  }

  _faults() {
    const slug = this._config.gateway_slug;
    return FAULT_KEYS.map((k) => this._hass.states[`binary_sensor.${slug}_${k}`])
      .filter(Boolean)
      .filter((e) => e.state === "on")
      .map((e) => e.attributes.friendly_name || e.entity_id);
  }

  _actionsFor(partition) {
    const state = partition.entity.state;
    const f = Number(partition.entity.attributes.supported_features || 0);
    if (state === "disarmed") {
      const out = [];
      if ((f & F_ARM_AWAY) !== 0) out.push("alarm_arm_away");
      if ((f & F_ARM_HOME) !== 0) out.push("alarm_arm_home");
      if ((f & F_ARM_NIGHT) !== 0) out.push("alarm_arm_night");
      return out;
    }
    if (state.startsWith("armed") || state === "triggered") return ["alarm_disarm"];
    return [];
  }

  _visibleActions(selected) {
    const set = new Set();
    selected.forEach((p) => this._actionsFor(p).forEach((a) => set.add(a)));
    return [...set];
  }

  _targets(action, selected) {
    return selected.filter((p) => this._actionsFor(p).includes(action));
  }

  _actionMeta(action) {
    const m = {
      alarm_arm_away: { label: "Uzbrój Wyjście", short: "Wyjście", icon: "mdi:run-fast" },
      alarm_arm_home: { label: "Uzbrój Dom", short: "Dom", icon: "mdi:home-lock" },
      alarm_arm_night: { label: "Uzbrój Noc", short: "Noc", icon: "mdi:weather-night" },
      alarm_disarm: { label: "Rozbrój", short: "Rozbrój", icon: "mdi:lock-open-variant-outline" },
    };
    return m[action];
  }

  _toggle(entityId) {
    if (this._selected.includes(entityId)) {
      this._selected = this._selected.filter((id) => id !== entityId);
      return;
    }
    if (this._selected.length >= 8) return;
    this._selected = [...this._selected, entityId];
  }

  _queue(action) {
    if (!this._selected.length) return;
    this._pending = action;
    this._pin = "";
    this._feedback = null;
  }

  _cancel() {
    this._pending = null;
    this._pin = "";
    this._sending = false;
  }

  async _confirm() {
    if (!this._pending || this._sending) return;
    const selected = this._selectedPartitions();
    const targets = this._targets(this._pending, selected);
    if (!targets.length) return;
    this._sending = true;
    try {
      await Promise.all(targets.map((p) => this._hass.callService("alarm_control_panel", this._pending, { entity_id: p.entityId, code: this._pin })));
      const slug = this._config.gateway_slug;
      const st = this._hass.states[`sensor.${slug}_last_partition_command_status`]?.state || "ok";
      const cv = this._hass.states[`sensor.${slug}_last_partition_code_valid`]?.state || "unknown";
      this._feedback = { type: "ok", text: `Wysłano (${targets.length}) status=${st}, pin=${cv}` };
    } catch (_e) {
      this._feedback = { type: "err", text: "Błąd wysyłania komendy." };
    } finally {
      this._sending = false;
      this._pending = null;
      this._pin = "";
    }
  }

  _heroTone(partitions) {
    if (partitions.some((p) => p.entity.state === "triggered")) return "alarm";
    if (partitions.every((p) => p.entity.state.startsWith("armed"))) return "armed";
    if (partitions.some((p) => p.entity.state === "disarmed")) return "safe";
    return "neutral";
  }

  render() {
    if (!this._hass || !this._config) return html``;
    const partitions = this._partitions();
    if (!partitions.length) {
      return html`<ha-card><div class="empty">Brak encji partycji dla <code>${this._config.gateway_slug}</code>.</div></ha-card>`;
    }
    const selected = this._selectedPartitions();
    const actions = this._visibleActions(selected);
    const faults = this._faults();
    const h = this._health();
    const tone = this._heroTone(partitions);
    const p = this._pending ? this._actionMeta(this._pending) : null;
    const masked = this._pin.length ? "•".repeat(this._pin.length) : "—";
    return html`
      <ha-card class="card ${tone}">
        <div class="hero">
          <div>
            <div class="name">${this._config.name}</div>
            <div class="state">${this._stateLabel(partitions[0].entity.state)}</div>
            <div class="meta">Panel ${h.panel ? "online" : "offline"} • Bridge ${h.bridge ? "online" : "offline"}</div>
          </div>
          <div class="right">
            <div class="pill ${faults.length ? "fault" : "ok"}">${faults.length ? `Usterki ${faults.length}` : "Brak usterek"}</div>
            <div class="service">Serwis: ${h.service}</div>
          </div>
        </div>

        ${faults.length ? html`<div class="faults">${faults.slice(0, 3).join(" • ")}${faults.length > 3 ? ` • +${faults.length - 3}` : ""}</div>` : ""}
        ${this._feedback ? html`<div class="fb ${this._feedback.type}">${this._feedback.text}</div>` : ""}

        <div class="label">Partycje</div>
        <div class="parts">
          ${partitions.map(
            (x) => html`<button class="part ${x.tone} ${this._selected.includes(x.entityId) ? "active" : ""}" @click=${() => this._toggle(x.entityId)}>
              <div class="pn">${x.index ? `P${x.index}` : x.title}</div>
              <div class="ps">${x.label}</div>
            </button>`,
          )}
        </div>

        <div class="label">Akcje</div>
        <div class="actions">
          ${actions.length
            ? actions.map((a) => {
                const m = this._actionMeta(a);
                const c = this._targets(a, selected).length;
                return html`<button class="act" title=${`${c}/${selected.length}`} @click=${() => this._queue(a)}><ha-icon icon=${m.icon}></ha-icon><span>${m.short}</span></button>`;
              })
            : html`<div class="hint">Zaznacz partycję, aby pokazać akcje.</div>`}
        </div>

        ${this._pending
          ? html`<div class="sheet">
              <div class="st">${p.label}</div>
              <div class="sb">Dotyczy: ${this._targets(this._pending, selected).length}/${selected.length}</div>
              <div class="pin">${masked}</div>
              <div class="keys">
                ${["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => html`<button class="k" @click=${() => (this._pin = `${this._pin}${d}`)}>${d}</button>`)}
                <button class="k alt" @click=${() => (this._pin = "")}>C</button>
                <button class="k" @click=${() => (this._pin = `${this._pin}0`)}>0</button>
                <button class="k alt" @click=${() => (this._pin = "")}>Wyczyść</button>
              </div>
              <div class="row">
                <button class="btn ghost" @click=${this._cancel}>Anuluj</button>
                <button class="btn solid" ?disabled=${this._sending} @click=${this._confirm}>${this._sending ? "Wysyłanie..." : `Potwierdź (${selected.length})`}</button>
              </div>
            </div>`
          : ""}
      </ha-card>
    `;
  }

  static get styles() {
    return css`
      :host{display:block}
      ha-card.card{border-radius:22px;border:1px solid color-mix(in srgb,#fff 14%,transparent);background:radial-gradient(130% 140% at 0% 0%,#1e2430 0%,#121826 58%,#0b1018 100%);color:#eef3ff;overflow:hidden}
      .hero{display:flex;justify-content:space-between;gap:10px;padding:14px}
      .name{font-size:.72rem;letter-spacing:.09em;text-transform:uppercase;color:#99a5ba}
      .state{margin-top:4px;font-size:1.22rem;font-weight:800}
      .meta{margin-top:3px;font-size:.74rem;color:#9aa7bc}
      .safe .state{color:#55df8f}.armed .state{color:#f2bf5f}.alarm .state{color:#ff6169}.offline .state{color:#c2cada}
      .right{text-align:right}.pill{font-size:.7rem;border-radius:999px;padding:6px 10px;border:1px solid color-mix(in srgb,#fff 20%,transparent)}
      .pill.ok{color:#8ff2b8;background:color-mix(in srgb,#2ac66b 18%,transparent)}.pill.fault{color:#ffd89c;background:color-mix(in srgb,#ff9900 22%,transparent)}
      .service{margin-top:6px;font-size:.7rem;color:#a0acc2}
      .faults{margin:0 14px 8px;font-size:.75rem;color:#ffd89c}
      .fb{margin:0 14px 10px;padding:8px 10px;border-radius:12px;font-size:.74rem}
      .fb.ok{color:#9bf4c0;background:color-mix(in srgb,#2ecc71 16%,transparent)}.fb.err{color:#ffa2a8;background:color-mix(in srgb,#ef4444 20%,transparent)}
      .label{margin:3px 14px 8px;font-size:.68rem;text-transform:uppercase;letter-spacing:.09em;font-weight:700;color:#95a2b7}
      .parts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:0 14px}
      .part{min-height:72px;border-radius:14px;border:1px solid color-mix(in srgb,#fff 16%,transparent);background:color-mix(in srgb,#fff 4%,transparent);color:#edf2ff;cursor:pointer}
      .part.active{border-color:#6eaafc;box-shadow:inset 0 0 0 1px color-mix(in srgb,#6eaafc 30%,transparent)}
      .pn{font-size:.79rem;font-weight:700}.ps{margin-top:2px;font-size:.71rem;color:#aab5c8}
      .actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:0 14px 14px}
      .act{min-height:56px;border-radius:14px;border:1px solid color-mix(in srgb,#fff 16%,transparent);background:color-mix(in srgb,#fff 5%,transparent);color:#f4f8ff;cursor:pointer;display:grid;place-items:center;gap:2px;font-size:.74rem;font-weight:700}
      .act ha-icon{--mdc-icon-size:19px}
      .hint{grid-column:1/-1;border:1px dashed color-mix(in srgb,#fff 20%,transparent);border-radius:12px;padding:9px;font-size:.74rem;color:#aab5c8}
      .sheet{border-top:1px solid color-mix(in srgb,#fff 15%,transparent);background:linear-gradient(180deg,color-mix(in srgb,#09101b 64%,transparent),#090f17);padding:12px 14px 14px}
      .st{font-size:.94rem;font-weight:700}.sb{margin-top:3px;font-size:.72rem;color:#9eaac0}
      .pin{margin-top:8px;min-height:44px;border-radius:12px;border:1px solid color-mix(in srgb,#fff 20%,transparent);display:grid;place-items:center;letter-spacing:.34rem;font-size:1.15rem}
      .keys{margin-top:10px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
      .k{min-height:42px;border-radius:10px;border:1px solid color-mix(in srgb,#fff 20%,transparent);background:color-mix(in srgb,#fff 5%,transparent);color:#f5f9ff;cursor:pointer}.k.alt{color:#bbc4d5}
      .row{margin-top:10px;display:grid;grid-template-columns:1fr 2fr;gap:8px}
      .btn{min-height:42px;border-radius:10px;cursor:pointer;font-weight:700}
      .btn.ghost{border:1px solid color-mix(in srgb,#fff 20%,transparent);background:transparent;color:#c8d0df}
      .btn.solid{border:1px solid #f2f5ff;background:#f2f5ff;color:#0f1520}
      .btn:disabled{opacity:.6;cursor:not-allowed}
      .empty{color:var(--error-color,#ff5f62);font-weight:700;padding:14px}
      code{background:color-mix(in srgb,#fff 12%,transparent);padding:.1rem .35rem;border-radius:6px}
      @media (max-width:420px){.parts{grid-template-columns:1fr}}
    `;
  }
}

customElements.define("pulson-alarm-card", PulsonAlarmCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "pulson-alarm-card",
  name: "Pulson Alarm Card",
  description: "Modern Pulson alarm card with health, faults and secure PIN actions.",
});
