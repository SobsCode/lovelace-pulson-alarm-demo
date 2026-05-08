import { LitElement, html, css } from "https://unpkg.com/lit@3/index.js?module";

const ALARM_FEATURE_ARM_HOME = 1;
const ALARM_FEATURE_ARM_AWAY = 2;
const ALARM_FEATURE_ARM_NIGHT = 4;

class PulsonAlarmCard extends LitElement {
  static get properties() {
    return {
      _hass: { state: false },
      _config: { state: false },
      _pin: { state: true },
      _selectedEntities: { state: true },
      _pendingAction: { state: true },
      _isSubmitting: { state: true },
      _feedback: { state: true },
    };
  }

  constructor() {
    super();
    this._hass = null;
    this._config = null;
    this._pin = "";
    this._selectedEntities = [];
    this._pendingAction = null;
    this._isSubmitting = false;
    this._feedback = null;
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

  _parsePartitionEntityId(entityId) {
    const newFormatMatch = entityId.match(/^(alarm_control_panel\..+)_partition_(\d+)$/);
    if (newFormatMatch) {
      return {
        base: newFormatMatch[1],
        index: Number(newFormatMatch[2]),
        format: "partition",
      };
    }

    const legacyFormatMatch = entityId.match(/^(alarm_control_panel\..+)_p([1-8])$/);
    if (legacyFormatMatch) {
      return {
        base: legacyFormatMatch[1],
        index: Number(legacyFormatMatch[2]),
        format: "legacy",
      };
    }

    return null;
  }

  _discoverEntityGroup(seedEntityId) {
    const seedInfo = this._parsePartitionEntityId(seedEntityId);
    if (!seedInfo) return [seedEntityId];

    const { base } = seedInfo;
    const discovered = Object.keys(this._hass.states)
      .map((id) => ({ id, parsed: this._parsePartitionEntityId(id) }))
      .filter((entry) => entry.parsed && entry.parsed.base === base)
      .sort((a, b) => a.parsed.index - b.parsed.index)
      .map((entry) => entry.id)
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

        const parsedEntityId = this._parsePartitionEntityId(entityId);
        const index = parsedEntityId ? parsedEntityId.index : null;

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

  _heroStateClass(partitions) {
    if (!partitions.length) return "neutral";
    const hasAlarm = partitions.some((partition) => partition.entity.state === "triggered");
    if (hasAlarm) return "alarm";

    const hasDisarmed = partitions.some((partition) => partition.entity.state === "disarmed");
    if (hasDisarmed) return "safe";

    const allArmed = partitions.every((partition) => partition.entity.state.startsWith("armed"));
    if (allArmed) return "armed";

    return "neutral";
  }

  _getGlobalFaultText(partitions) {
    const tags = [];
    partitions.forEach((partition) => {
      const attrs = partition.entity.attributes || {};
      if (attrs.tamper === true) tags.push("sabotaż");
      if (attrs.communication_lost === true) tags.push("łączność");
      if (attrs.system_fault === true || attrs.fault === true || attrs.trouble === true) tags.push("usterka");
    });
    const unique = [...new Set(tags)];
    if (!unique.length) return "Usterka systemu";
    return `Usterka: ${unique.join(", ")}`;
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
    this._feedback = null;
  }

  _cancelPendingAction() {
    this._pendingAction = null;
    this._pin = "";
    this._isSubmitting = false;
  }

  async _executePendingAction() {
    if (!this._hass || !this._pendingAction || !this._selectedEntities.length || this._isSubmitting) return;

    const selectedPartitions = this._getPartitions().filter((p) => this._selectedEntities.includes(p.entityId));
    const targets = this._getActionTargets(this._pendingAction, selectedPartitions);
    if (!targets.length) return;

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
      this._feedback = { type: "success", text: `Wykonano akcje dla ${targets.length} partycji.` };
    } catch (_error) {
      this._feedback = { type: "error", text: "Wystapil blad podczas wysylania komendy." };
    } finally {
      this._isSubmitting = false;
      this._cancelPendingAction();
    }
  }

  _actionSupportIssue(action, selectedPartitions) {
    if (!selectedPartitions.length) return "Wybierz co najmniej jedna partycje.";
    if (action === "alarm_arm_away") {
      const unsupported = selectedPartitions.some(
        (p) => (Number(p.entity.attributes.supported_features || 0) & ALARM_FEATURE_ARM_AWAY) === 0,
      );
      if (unsupported) return "Niektore zaznaczone partycje nie wspieraja opcji Uzbroj.";
    }
    if (action === "alarm_arm_home") {
      const unsupported = selectedPartitions.some(
        (p) => (Number(p.entity.attributes.supported_features || 0) & ALARM_FEATURE_ARM_HOME) === 0,
      );
      if (unsupported) return "Niektore zaznaczone partycje nie wspieraja opcji Uzbroj w domu.";
    }
    return "";
  }

  _getAllowedActionsForPartition(partition) {
    const state = partition.entity.state;
    const features = Number(partition.entity.attributes.supported_features || 0);

    if (state === "disarmed") {
      const actions = [];
      if ((features & ALARM_FEATURE_ARM_NIGHT) !== 0) actions.push("alarm_arm_night");
      if ((features & ALARM_FEATURE_ARM_AWAY) !== 0) actions.push("alarm_arm_away");
      return actions;
    }

    if (state.startsWith("armed") || state === "triggered") {
      return ["alarm_disarm"];
    }

    return [];
  }

  _getCommonActions(selectedPartitions) {
    if (!selectedPartitions.length) return [];

    const all = selectedPartitions.map((partition) => this._getAllowedActionsForPartition(partition));
    return all[0].filter((action) => all.every((list) => list.includes(action)));
  }

  _getVisibleActions(selectedPartitions) {
    if (!selectedPartitions.length) return [];
    const set = new Set();
    selectedPartitions.forEach((partition) => {
      this._getAllowedActionsForPartition(partition).forEach((action) => set.add(action));
    });
    return [...set];
  }

  _getActionTargets(action, selectedPartitions) {
    return selectedPartitions.filter((partition) => this._getAllowedActionsForPartition(partition).includes(action));
  }

  _actionUi(action) {
    const map = {
      alarm_arm_away: {
        label: "Uzbrój (Wyjście)",
        shortLabel: "Wyjście",
        icon: "mdi:shield-lock-outline",
        className: "arm-away",
      },
      alarm_arm_night: {
        label: "Uzbrój (Noc)",
        shortLabel: "Noc",
        icon: "mdi:weather-night",
        className: "arm-night",
      },
      alarm_disarm: {
        label: "Rozbrój",
        shortLabel: "Rozbrój",
        icon: "mdi:lock-open-variant-outline",
        className: "disarm",
      },
    };
    return map[action];
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
    const visibleActions = this._getVisibleActions(selectedPartitions);
    const maskedPin = this._pin.length ? "*".repeat(this._pin.length) : "-";
    const selectedCount = selectedPartitions.length;
    const hasGlobalFault = this._hasGlobalFault(partitions);
    const globalFaultText = this._getGlobalFaultText(partitions);
    const heroStateClass = this._heroStateClass(partitions);
    const selectedSummary = selectedPartitions
      .map((p) => (p.index ? `P${p.index}` : p.title))
      .slice(0, 4)
      .join(", ");
    const selectedOverflow = selectedPartitions.length > 4 ? ` +${selectedPartitions.length - 4}` : "";
    const hasCompatibleAction = visibleActions.length > 0;

    const pendingActionLabel = {
      alarm_arm_away: "Uzbroj",
      alarm_arm_night: "Uzbroj noc",
      alarm_disarm: "Rozbroj",
    }[this._pendingAction];

    return html`
      <ha-card>
        <div class="container">
          <div class="hero ${heroStateClass}">
            ${hasGlobalFault
              ? html`<div class="global-fault" title=${globalFaultText}>
                  <ha-icon icon="mdi:alert-outline"></ha-icon> ${globalFaultText}
                </div>`
              : ""}
            <div>
              <div class="title">${this._config.name}</div>
              <div class="subtitle">Zaznaczone partycje: ${selectedCount}</div>
            </div>
            <div class="hero-actions">
              ${this._pendingAction
                ? html`<div class="status-pill">Akcja: ${pendingActionLabel}</div>`
                : visibleActions.map((action) => {
                    const actionUi = this._actionUi(action);
                    const supportedTargets = this._getActionTargets(action, selectedPartitions).length;
                    return html`
                      <button
                        class="hero-action ${actionUi.className}"
                        aria-label=${actionUi.label}
                        title=${`${actionUi.label} (${supportedTargets}/${selectedCount})`}
                        @click=${() => this._queueAction(action)}
                      >
                        <ha-icon icon=${actionUi.icon}></ha-icon>
                      </button>
                    `;
                  })}
            </div>
          </div>
          ${this._feedback ? html`<div class="feedback ${this._feedback.type}" role="status">${this._feedback.text}</div>` : ""}

          <div class="section-label">Partycje</div>
          <div class="partition-grid">
            ${partitions.map(
              (partition) => html`
                <button
                  class="partition ${partition.stateClass} ${this._selectedEntities.includes(partition.entityId) ? "active" : ""}"
                  @click=${() => this._togglePartition(partition.entityId)}
                  aria-label=${`${partition.title}, stan: ${partition.stateLabel}`}
                  title=${`${partition.title}: ${partition.stateLabel}`}
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

          ${selectedCount === 0
            ? html`<div class="helper">Wybierz partycje, aby pokazac dostepne akcje.</div>`
            : ""}
          ${selectedCount > 0 && !hasCompatibleAction
            ? html`<div class="helper">Dla wybranego zestawu partycji brak wspolnej akcji.</div>`
            : ""}

          ${this._pendingAction
            ? html`
                <div class="pin-panel">
                  <div class="section-label">PIN</div>
                  <div class="selection-preview">Wybrane: ${selectedSummary}${selectedOverflow}</div>
                  <div class="selection-preview">
                    Dotyczy akcji: ${this._getActionTargets(this._pendingAction, selectedPartitions).length}/${selectedCount}
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

                  <div class="confirm-row">
                    <button class="confirm neutral" ?disabled=${this._isSubmitting} @click=${this._cancelPendingAction}>
                      Anuluj
                    </button>
                    <button class="confirm accent" ?disabled=${this._isSubmitting} @click=${this._executePendingAction}>
                      ${this._isSubmitting ? "Wysylanie..." : `Potwierdz: ${pendingActionLabel} (${selectedCount})`}
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
        background:
          linear-gradient(
            160deg,
            color-mix(in srgb, var(--primary-color, #3b82f6) 8%, var(--secondary-background-color, #f8fafc)),
            color-mix(in srgb, var(--accent-color, #8b5cf6) 6%, var(--secondary-background-color, #f8fafc))
          );
        border: 1px solid var(--divider-color, #e2e8f0);
        border-radius: 14px;
        padding: 12px;
        overflow: hidden;
      }

      .hero::before {
        content: "";
        position: absolute;
        left: 10px;
        right: 10px;
        top: 0;
        height: 46%;
        border-radius: 0 0 14px 14px;
        background: linear-gradient(
          180deg,
          color-mix(in srgb, var(--ha-card-background, #ffffff) 70%, transparent),
          transparent
        );
        pointer-events: none;
      }

      .hero.safe {
        background:
          linear-gradient(
            160deg,
            color-mix(in srgb, var(--success-color, #16a34a) 16%, var(--secondary-background-color, #f8fafc)),
            color-mix(in srgb, var(--primary-color, #3b82f6) 6%, var(--secondary-background-color, #f8fafc))
          );
        border-color: color-mix(in srgb, var(--success-color, #16a34a) 24%, var(--divider-color, #e2e8f0));
      }

      .hero.armed {
        background:
          linear-gradient(
            160deg,
            color-mix(in srgb, var(--error-color, #dc2626) 18%, var(--secondary-background-color, #f8fafc)),
            color-mix(in srgb, var(--warning-color, #f59e0b) 6%, var(--secondary-background-color, #f8fafc))
          );
        border-color: color-mix(in srgb, var(--error-color, #dc2626) 26%, var(--divider-color, #e2e8f0));
      }

      .hero.alarm {
        background:
          linear-gradient(
            160deg,
            color-mix(in srgb, var(--error-color, #dc2626) 24%, var(--secondary-background-color, #f8fafc)),
            color-mix(in srgb, #b91c1c 18%, var(--secondary-background-color, #f8fafc))
          );
        border-color: color-mix(in srgb, var(--error-color, #dc2626) 40%, var(--divider-color, #e2e8f0));
        box-shadow: 0 0 0 1px color-mix(in srgb, var(--error-color, #dc2626) 22%, transparent);
      }

      .hero-actions {
        display: inline-flex;
        align-items: center;
        gap: 6px;
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
        max-width: 66%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
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

      .hero.alarm .status-pill {
        color: var(--error-color, #dc2626);
        border-color: color-mix(in srgb, var(--error-color, #dc2626) 25%, var(--divider-color, #e2e8f0));
        background: color-mix(in srgb, var(--error-color, #dc2626) 8%, var(--ha-card-background, #ffffff));
      }

      .hero-action {
        width: 42px;
        height: 42px;
        border-radius: 999px;
        border: 1px solid var(--divider-color, #e2e8f0);
        background: var(--ha-card-background, #ffffff);
        color: var(--secondary-text-color, #475569);
        cursor: pointer;
        display: grid;
        place-items: center;
      }

      .hero-action ha-icon {
        --mdc-icon-size: 20px;
      }

      .hero-action.arm-away {
        color: color-mix(in srgb, var(--primary-color, #3b82f6) 80%, #000);
        background: color-mix(in srgb, var(--primary-color, #3b82f6) 10%, transparent);
      }

      .hero-action.arm-night {
        color: color-mix(in srgb, var(--warning-color, #f59e0b) 80%, #000);
        background: color-mix(in srgb, var(--warning-color, #f59e0b) 12%, transparent);
      }

      .hero-action.disarm {
        color: color-mix(in srgb, var(--error-color, #dc2626) 80%, #000);
        background: color-mix(in srgb, var(--error-color, #dc2626) 10%, transparent);
      }

      .section-label {
        margin-top: 2px;
        font-size: 0.68rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        font-weight: 700;
        color: var(--secondary-text-color, #64748b);
      }

      .feedback {
        border-radius: 10px;
        border: 1px solid var(--divider-color, #e2e8f0);
        padding: 8px 10px;
        font-size: 0.75rem;
      }

      .feedback.success {
        color: var(--success-color, #16a34a);
        background: color-mix(in srgb, var(--success-color, #16a34a) 9%, transparent);
      }

      .feedback.error {
        color: var(--error-color, #dc2626);
        background: color-mix(in srgb, var(--error-color, #dc2626) 10%, transparent);
      }

      .helper {
        font-size: 0.74rem;
        color: var(--secondary-text-color, #64748b);
        border: 1px dashed var(--divider-color, #e2e8f0);
        border-radius: 10px;
        padding: 7px 9px;
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
        position: relative;
        overflow: hidden;
      }

      .partition::after {
        content: "";
        position: absolute;
        left: 8px;
        right: 8px;
        bottom: 6px;
        height: 3px;
        border-radius: 999px;
        opacity: 0.5;
        background: color-mix(in srgb, var(--disabled-text-color, #9ca3af) 35%, transparent);
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
        color: var(--warning-color, #f59e0b);
        background: color-mix(in srgb, var(--warning-color, #f59e0b) 12%, transparent);
      }

      .partition-icon.disarmed {
        color: var(--success-color, #16a34a);
        background: color-mix(in srgb, var(--success-color, #16a34a) 10%, transparent);
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

      .partition.armed::after {
        background: color-mix(in srgb, var(--warning-color, #f59e0b) 45%, transparent);
      }

      .partition.disarmed::after {
        background: color-mix(in srgb, var(--success-color, #16a34a) 45%, transparent);
      }

      .partition.alarm::after {
        background: color-mix(in srgb, var(--error-color, #dc2626) 45%, transparent);
      }

      .partition.arming::after,
      .partition.disarming::after {
        background: color-mix(in srgb, var(--primary-color, #3b82f6) 45%, transparent);
      }

      .partition.offline::after {
        background: color-mix(in srgb, var(--disabled-text-color, #9ca3af) 50%, transparent);
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

      .selection-preview {
        font-size: 0.72rem;
        color: var(--secondary-text-color, #64748b);
      }

      .keypad {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }

      .key {
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

      .key:active,
      .partition:active,
      .hero-action:active {
        transform: translateY(1px);
      }

      .key:hover,
      .partition:hover,
      .hero-action:hover {
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

      .confirm:disabled {
        opacity: 0.6;
        cursor: not-allowed;
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
        .section-label,
        .partition-grid,
        .feedback,
        .helper {
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
