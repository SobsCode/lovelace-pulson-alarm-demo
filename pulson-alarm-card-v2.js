import { LitElement, html, css } from 'https://unpkg.com/lit@3/index.js?module'

const F_ARM_HOME = 1
const F_ARM_AWAY = 2
const F_ARM_NIGHT = 4
/** Gdy integracja nie ustawia supported_features (0 / brak), zakładamy typowe możliwości panelu. */
const F_ARM_DEFAULT_ALL = F_ARM_HOME | F_ARM_AWAY | F_ARM_NIGHT

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
			_specialSliders: { state: true },
			_specialResetting: { state: true },
			_pendingTargets: { state: true },
		}
	}

	constructor() {
		super()
		this._hass = null
		this._config = null
		this._expandedPartitionId = null
		this._drawerOpen = false
		this._pendingAction = null
		this._pin = ''
		this._isSending = false
		this._feedback = null
		this._specialSliders = { panic: 0, fire: 0, medical: 0 }
		this._specialResetting = { panic: false, fire: false, medical: false }
		this._pendingTargets = null
		this._specialHoldTimer = null
	}

	disconnectedCallback() {
		super.disconnectedCallback()
		this._clearSpecialHoldTimer()
	}

	setConfig(config) {
		if (!config || (!config.entity && !Array.isArray(config.entities) && !config.gateway_slug)) {
			throw new Error('Provide entity, entities or gateway_slug.')
		}
		this._config = {
			name: 'Pulson Alarm',
			gateway_slug: 'pulson_security_integration_gateway',
			panic_service: null,
			panic_service_data: {},
			/** Encja `button` z MQTT discovery: `{base_topic}/system/panic/set` */
			panic_button_entity: null,
			fire_alarm_button_entity: null,
			medical_alarm_button_entity: null,
			/**
			 * Sensor z trybem kodu: `ui` (klawiatura na karcie) lub `backend` (kod po stronie integracji).
			 * Domyślnie: `sensor.<gateway_slug>_user_code_mode`. `false` / `""` = zawsze UI.
			 */
			user_code_mode_entity: null,
			...config,
		}
	}

	set hass(hass) {
		this._hass = hass
		this.requestUpdate()
	}

	getCardSize() {
		return 11
	}

	/**
	 * Integracje mogą zwracać polski `state` zamiast kanonu HA (`arming`, …).
	 * Ta sama normalizacja co w logice — nagłówek i lista pozostają spójne.
	 */
	_canonicalAlarmPanelState(raw) {
		const s = String(raw ?? '')
			.toLowerCase()
			.trim()
			.replace(/\s+/g, '_')
		const fold = s
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/ł/g, 'l')
		const aliases = {
			uzbrajanie: 'arming',
			rozbrajanie: 'disarming',
			oczekiwanie: 'pending',
			wylaczony: 'disarmed',
			wyłączony: 'disarmed',
			rozbrojony: 'disarmed',
			tryb_wyjscia: 'armed_away',
			tryb_wyjścia: 'armed_away',
			tryb_domowy: 'armed_home',
			tryb_nocny: 'armed_night',
			alarm: 'triggered',
		}
		if (aliases[s]) return aliases[s]
		if (aliases[fold]) return aliases[fold]
		return s
	}

	_stateLabel(state) {
		const c = this._canonicalAlarmPanelState(state)
		const map = {
			disarmed: 'Wyłączony',
			armed_away: 'Tryb wyjścia',
			armed_home: 'Tryb domowy',
			armed_night: 'Tryb nocny',
			triggered: 'ALARM',
			pending: 'Oczekiwanie',
			arming: 'Uzbrajanie',
			disarming: 'Rozbrajanie',
			unavailable: 'Niedostępny',
			unknown: 'Nieznany',
		}
		return map[c] || String(state ?? '')
	}

	/**
	 * Ikona + ton kolorystyczny kółka statusu partycji (spójnie z panelem głównym).
	 * @returns {{ tone: string, icon: string }}
	 */
	_partitionStatusVisual(state) {
		const s = this._canonicalAlarmPanelState(state)
		if (s === 'disarmed') return { tone: 'disarmed', icon: 'mdi:shield-off-outline' }
		if (s === 'armed_away') return { tone: 'away', icon: 'mdi:shield-lock' }
		if (s === 'armed_home') return { tone: 'home', icon: 'mdi:shield-home' }
		if (s === 'armed_night') return { tone: 'night', icon: 'mdi:weather-night' }
		if (s.startsWith('armed')) return { tone: 'partial', icon: 'mdi:shield-half-full' }
		if (s === 'arming') return { tone: 'transition', icon: 'mdi:shield-sync' }
		if (s === 'disarming') return { tone: 'transition', icon: 'mdi:shield-half-full' }
		if (s === 'pending') return { tone: 'transition', icon: 'mdi:clock-outline' }
		if (s === 'triggered') return { tone: 'alarm', icon: 'mdi:bell-ring' }
		if (s === 'unavailable' || s === 'unknown') return { tone: 'muted', icon: 'mdi:shield-alert-outline' }
		return { tone: 'muted', icon: 'mdi:shield-outline' }
	}

	_normalizeEntityId(id) {
		return id.replace(/_pulson_partition_(\d+)$/, '_partition_$1')
	}

	_partitionIndex(entityId) {
		const fromId =
			Number(entityId.match(/_partition_(\d+)$/)?.[1]) ||
			Number(entityId.match(/_pulson_partition_(\d+)$/)?.[1]) ||
			Number(entityId.match(/_p([1-8])$/)?.[1]) ||
			NaN
		return Number.isFinite(fromId) && fromId > 0 ? fromId : null
	}

	_partitionIndexFromAttributes(entity) {
		const raw = entity.attributes?.partition ?? entity.attributes?.partition_id ?? entity.attributes?.partition_number
		const n = raw === undefined || raw === null || raw === '' ? NaN : Number(raw)
		return Number.isFinite(n) && n >= 1 && n <= 8 ? n : null
	}

	/** Encja `text.*_partition_multi_command`; puste / false = wyłącza ścieżkę maski. */
	_partitionMultiCommandEntityId() {
		const raw = this._config?.partition_multi_command_entity
		if (raw === '' || raw === false) return null
		if (raw) return raw
		return `text.${this._config.gateway_slug}_partition_multi_command`
	}

	/** Mapowanie usługi HA → komendy mostka (tylko te obsługiwane przez multi-command). */
	_bridgeCommandFromHaAlarmService(action) {
		const map = {
			alarm_arm_away: 'ARM_AWAY',
			alarm_arm_night: 'ARM_NIGHT',
			alarm_disarm: 'DISARM',
		}
		return map[action] ?? null
	}

	/**
	 * Maska partycji: Pn → bit (n-1), suma bitów. Zwraca null, gdy brak indeksu lub poza 1–8.
	 */
	_partitionMaskFromTargets(targets) {
		let mask = 0
		for (const p of targets) {
			const n = p.index
			if (!Number.isFinite(n) || n < 1 || n > 8) return null
			mask |= 1 << (n - 1)
		}
		return mask
	}

	_partitionIds() {
		if (!this._hass || !this._config) return []
		if (Array.isArray(this._config.entities) && this._config.entities.length) {
			const configured = this._config.entities.flatMap((id) => [id, this._normalizeEntityId(id)])
			return [...new Set(configured)].filter((id) => !!this._hass.states[id])
		}

		if (this._config.entity) {
			const seed = [this._config.entity, this._normalizeEntityId(this._config.entity)].find(
				(id) => !!this._hass.states[id],
			)
			if (seed) {
				const base = seed
					.replace(/_partition_\d+$/, '')
					.replace(/_pulson_partition_\d+$/, '')
					.replace(/_p[1-8]$/, '')
				const siblings = Object.keys(this._hass.states).filter((id) => id.startsWith(`${base}_`))
				if (siblings.length) return siblings
				return [seed]
			}
		}

		const slug = this._config.gateway_slug
		return Object.keys(this._hass.states).filter((id) => id.startsWith(`alarm_control_panel.${slug}_`))
	}

	_partitions() {
		if (!this._hass || !this._config) return []
		return this._partitionIds()
			.map((entityId) => {
				const entity = this._hass.states[entityId]
				if (!entity) return null
				const index = this._partitionIndex(entityId) ?? this._partitionIndexFromAttributes(entity)
				return {
					id: index ?? entityId,
					entityId,
					index,
					entity,
					title: this._shortPartitionName(
						entity.attributes.friendly_name || (index ? `Partycja ${index}` : entityId),
						index,
					),
				}
			})
			.filter(Boolean)
			.sort((a, b) => (a.index ?? 999) - (b.index ?? 999))
	}

	_zoneStatusText(state) {
		if (state === 'on') return 'Naruszony'
		if (state === 'off') return 'Gotowy'
		if (state === 'unknown') return 'Nieznany'
		if (state === 'unavailable') return 'Niedostępny'
		return state
	}

	_zoneStatusClass(state) {
		if (state === 'on') return 'status-violated'
		if (state === 'off') return 'status-ready'
		return 'status-notReady'
	}

	_partitionReadySensorId(partition) {
		if (!this._config || !partition?.index) return null
		return `sensor.${this._config.gateway_slug}_partition_${partition.index}_ready`
	}

	_userCodeModeEntityId() {
		const raw = this._config?.user_code_mode_entity
		if (raw === false || raw === '') return null
		if (raw) return raw
		return `sensor.${this._config.gateway_slug}_user_code_mode`
	}

	/**
	 * `ui` — PIN na karcie. `backend` — bez klawiatury, wywołanie z pustym `code` (kod w integracji).
	 * Brak encji / nieznany stan → `ui`.
	 */
	_userCodeMode() {
		const id = this._userCodeModeEntityId()
		if (!id || !this._hass?.states[id]) return 'ui'
		const s = String(this._hass.states[id].state ?? '')
			.toLowerCase()
			.trim()
		if (s === 'backend') return 'backend'
		return 'ui'
	}

	async _executeAlarmActionWithoutPin(action, pendingTargets) {
		if (this._isSending) return
		this._pendingAction = action
		this._pendingTargets = pendingTargets
		this._pin = ''
		await this._confirmPendingAction()
	}

	/**
	 * Gotowość do uzbrojenia z sensor.<slug>_partition_<n>_ready — tylko gdy partycja rozbrojona.
	 * @returns {null | { variant: 'ready' | 'not_ready' | 'unknown', label: string }}
	 */
	_partitionReadinessLine(partition) {
		if (this._canonicalAlarmPanelState(partition.entity.state) !== 'disarmed' || !partition.index) return null
		const id = this._partitionReadySensorId(partition)
		const ent = this._hass?.states[id]
		if (!ent) {
			return {
				variant: 'unknown',
				label: 'Stan gotowości niedostępny',
			}
		}
		const s = String(ent.state ?? '')
			.toLowerCase()
			.trim()
			.replace(/\s+/g, '_')

		const readyStates = new Set(['on', 'true', 'yes', 'ready', '1', 'ok', 'gotowy', 'tak', 'armed_ready', 'arm_ready'])
		const notReadyStates = new Set([
			'off',
			'false',
			'no',
			'not_ready',
			'notready',
			'unready',
			'0',
			'brak',
			'brak_gotowości',
			'brak_gotowosci',
			'nie',
			'not_ok',
			'violated',
		])

		if (readyStates.has(s)) {
			return { variant: 'ready', label: 'Gotowy do uzbrojenia' }
		}
		if (notReadyStates.has(s) || s === 'nie_gotowy' || s.startsWith('niegotow')) {
			return { variant: 'not_ready', label: 'Brak gotowości' }
		}
		const n = Number(s)
		if (s !== '' && Number.isFinite(n)) {
			if (n === 1) return { variant: 'ready', label: 'Gotowy do uzbrojenia' }
			if (n === 0) return { variant: 'not_ready', label: 'Brak gotowości' }
		}
		if (s === 'unavailable' || s === 'unknown') {
			return {
				variant: 'unknown',
				label: 'Stan gotowości nieznany',
			}
		}
		return {
			variant: 'unknown',
			label: ent.state || 'Stan gotowości nieznany',
		}
	}

	_zonesForPartition(partition) {
		const slug = this._config.gateway_slug
		const zones = Object.keys(this._hass.states)
			.filter((id) => id.startsWith(`sensor.${slug}_zone_`))
			.map((id) => this._hass.states[id])
			.filter(Boolean)
			.map((entity) => {
				const zoneId = Number(entity.entity_id.match(/_zone_(\d+)$/)?.[1]) || 0
				const partitionAttr = Number(entity.attributes.partition || entity.attributes.partition_id || 0) || null
				return {
					id: zoneId,
					name: entity.attributes.friendly_name || `Linia ${zoneId}`,
					state: entity.state,
					partitionId: partitionAttr,
				}
			})

		const filtered = partition.index ? zones.filter((z) => !z.partitionId || z.partitionId === partition.index) : zones
		return filtered.sort((a, b) => a.id - b.id)
	}

	_effectiveSupportedFeatures(partition) {
		const raw = partition.entity.attributes.supported_features
		const n = raw === undefined || raw === null || raw === '' ? NaN : Number(raw)
		if (Number.isFinite(n) && n > 0) return n
		return F_ARM_DEFAULT_ALL
	}

	_allowedActions(partition) {
		const state = this._canonicalAlarmPanelState(partition.entity.state)
		const features = this._effectiveSupportedFeatures(partition)
		if (state === 'disarmed') {
			const actions = []
			if ((features & F_ARM_AWAY) !== 0) actions.push('alarm_arm_away')
			if ((features & F_ARM_HOME) !== 0) actions.push('alarm_arm_home')
			if ((features & F_ARM_NIGHT) !== 0) actions.push('alarm_arm_night')
			return actions
		}
		// W trakcie uzbrajania / rozbrajania użytkownik musi móc przerwać (rozbroić).
		if (
			state.startsWith('armed') ||
			state === 'triggered' ||
			state === 'arming' ||
			state === 'disarming' ||
			state === 'pending'
		) {
			return ['alarm_disarm']
		}
		return []
	}

	_stateForAll(partitions) {
		if (!partitions.length) return 'none'
		const unique = [...new Set(partitions.map((p) => this._canonicalAlarmPanelState(p.entity.state)))]
		if (unique.length > 1) return 'partial'
		const only = unique[0]
		if (only === 'armed_away') return 'away'
		if (only === 'armed_night') return 'night'
		if (only === 'disarmed') return 'disarm'
		if (only === 'arming' || only === 'disarming' || only === 'pending') return 'delay'
		return 'partial'
	}

	/** Gdy wszystkie partycje mają ten sam surowy `state` (np. to samo co w wierszu listy). */
	_uniformPartitionRawState(partitions) {
		if (!partitions.length) return null
		const raw = [...new Set(partitions.map((p) => p.entity.state))]
		return raw.length === 1 ? partitions[0].entity.state : null
	}

	/** Partycje w stanie `triggered` (kanonicznie), kolejność jak na liście. */
	_partitionsInAlarm(partitions) {
		return partitions.filter((p) => this._canonicalAlarmPanelState(p.entity.state) === 'triggered')
	}

	_alarmPartitionNamesForHeadline(alarmPartitions) {
		return alarmPartitions.map((p) => (p.index != null ? `${p.title} (#${p.index})` : p.title)).join(', ')
	}

	_stateHeadline(stateClass, uniformRawState = null, alarmPartitions = []) {
		const fault = this._systemFaultStatus()
		let base
		if (alarmPartitions.length > 0) {
			const names = this._alarmPartitionNamesForHeadline(alarmPartitions)
			base = {
				icon: 'mdi:bell-ring',
				title: 'ALARM',
				desc:
					alarmPartitions.length === 1
						? `Wykryto alarm na partycji: ${names}.`
						: `Wykryto alarm na partycjach: ${names}.`,
			}
		} else if (stateClass === 'away')
			base = { icon: 'mdi:home-lock', title: 'Tryb wyjścia', desc: 'Wszystkie partycje uzbrojone w trybie wyjścia' }
		else if (stateClass === 'night')
			base = { icon: 'mdi:weather-night', title: 'Tryb nocny', desc: 'System uzbrojony w trybie nocnym' }
		else if (stateClass === 'disarm')
			base = { icon: 'mdi:lock-open-variant-outline', title: 'System wyłączony', desc: 'Wszystkie partycje są rozbrojone' }
		else if (stateClass === 'delay') {
			const raw = uniformRawState ?? 'arming'
			const vis = this._partitionStatusVisual(raw)
			base = {
				icon: vis.icon,
				title: this._stateLabel(raw),
				desc: 'Wszystkie partycje są w tym samym stanie.',
			}
		} else
			base = {
				icon: 'mdi:shield-half-full',
				title: 'System uzbrojony częściowo',
				desc: 'Partycje są w różnych stanach',
			}

		return {
			...base,
			faultLevel: fault.level,
			faultLabel: fault.label,
			faultDetail: fault.desc,
		}
	}

	_setAllPartitionsAction(action) {
		this._feedback = null
		if (this._userCodeMode() === 'backend') {
			this._drawerOpen = false
			void this._executeAlarmActionWithoutPin(action, null)
			return
		}
		this._pendingAction = action
		this._pendingTargets = null
		this._pin = ''
		this._drawerOpen = true
	}

	_setSinglePartitionAction(partition, action) {
		this._feedback = null
		if (this._userCodeMode() === 'backend') {
			this._drawerOpen = false
			void this._executeAlarmActionWithoutPin(action, [partition.entityId])
			return
		}
		this._pendingAction = action
		this._pendingTargets = [partition.entityId]
		this._pin = ''
		this._drawerOpen = true
	}

	_togglePartitionExpansion(partitionId) {
		this._expandedPartitionId = this._expandedPartitionId === partitionId ? null : partitionId
	}

	_actionUi(action) {
		const map = {
			alarm_arm_away: { icon: 'mdi:home-lock', label: 'Tryb wyjścia' },
			alarm_arm_home: { icon: 'mdi:shield-home', label: 'Tryb domowy' },
			alarm_arm_night: { icon: 'mdi:weather-night', label: 'Tryb nocny' },
			alarm_disarm: { icon: 'mdi:lock-open-variant-outline', label: 'Wyłącz' },
		}
		return map[action]
	}

	_primaryActionForPartition(partition) {
		const actions = this._allowedActions(partition)
		if (!actions.length) return null
		if (actions.includes('alarm_disarm')) return 'alarm_disarm'
		if (actions.includes('alarm_arm_away')) return 'alarm_arm_away'
		if (actions.includes('alarm_arm_night')) return 'alarm_arm_night'
		if (actions.includes('alarm_arm_home')) return 'alarm_arm_home'
		return actions[0]
	}

	/** Przy rozbrojeniu i „Brak gotowości” — szybki guzik uzbrojenia widoczny, lecz nieaktywny. */
	_partitionQuickArmBlockedByReadiness(partition, primaryAction) {
		if (!primaryAction || primaryAction === 'alarm_disarm') return false
		const readiness = this._partitionReadinessLine(partition)
		return readiness?.variant === 'not_ready'
	}

	_shortPartitionName(name, index) {
		if (!name) return index ? `Partycja ${index}` : 'Partycja'
		const slugLabel = this._config.gateway_slug
			.split('_')
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(' ')

		let short = name
			.replace(/^Pulson Security Integration Gateway[\s\-_]*/i, '')
			.replace(new RegExp(`^${slugLabel}[\\s\\-_]*`, 'i'), '')
			.replace(/^Gateway[\s\-_]*/i, '')
			.trim()

		if (!short) short = index ? `Partycja ${index}` : name
		return short
	}

	async _confirmPendingAction() {
		if (!this._pendingAction || this._isSending) return
		const partitions = this._partitions()
		const scopedPartitions = this._pendingTargets?.length
			? partitions.filter((p) => this._pendingTargets.includes(p.entityId))
			: partitions
		const targets = scopedPartitions.filter((p) => this._allowedActions(p).includes(this._pendingAction))
		if (!targets.length) return
		this._isSending = true
		try {
			const multiId = this._partitionMultiCommandEntityId()
			const bridgeCmd = this._bridgeCommandFromHaAlarmService(this._pendingAction)
			const mask = this._partitionMaskFromTargets(targets)
			const canMulti = multiId && bridgeCmd && mask !== null && this._hass.states[multiId]

			if (canMulti) {
				const payload = { command: bridgeCmd, mask }
				if (this._pin) payload.code = this._pin
				await this._hass.callService('text', 'set_value', {
					entity_id: multiId,
					value: JSON.stringify(payload),
				})
			} else {
				await Promise.all(
					targets.map((partition) =>
						this._hass.callService('alarm_control_panel', this._pendingAction, {
							entity_id: partition.entityId,
							code: this._pin,
						}),
					),
				)
			}
			this._feedback = null
		} catch (_e) {
			this._feedback = { type: 'error', text: 'Nie udało się wysłać komendy.' }
		} finally {
			this._isSending = false
			this._pendingAction = null
			this._pendingTargets = null
			this._pin = ''
			this._drawerOpen = false
		}
	}

	async _triggerPanicService() {
		if (!this._config.panic_service) return
		const [domain, service] = this._config.panic_service.split('.')
		if (!domain || !service) return
		await this._hass.callService(domain, service, this._config.panic_service_data || {})
	}

	_panicDrawerRowSpec() {
		const entityId = this._config.panic_button_entity
		const hasService = !!this._config.panic_service
		if (!entityId && !hasService) return null
		const ent = entityId && this._hass?.states ? this._hass.states[entityId] : null
		if (ent)
			return {
				kind: 'panic',
				variant: 'panic',
				icon: 'mdi:alarm-light',
				label: 'Alarm napadowy',
				disabled: false,
				trigger: 'button',
			}
		if (hasService)
			return {
				kind: 'panic',
				variant: 'panic',
				icon: 'mdi:alarm-light',
				label: 'Alarm napadowy',
				disabled: false,
				trigger: 'service',
			}
		return {
			kind: 'panic',
			variant: 'panic',
			icon: 'mdi:alarm-light',
			label: 'Alarm napadowy',
			disabled: true,
			trigger: 'none',
			blockedHint: 'Encja przycisku napadu jest niedostępna. Sprawdź panic_button_entity lub ustaw panic_service.',
		}
	}

	_fireDrawerRowSpec() {
		const id = this._config.fire_alarm_button_entity
		if (!id) return null
		const ent = this._hass?.states?.[id]
		if (ent)
			return {
				kind: 'fire',
				variant: 'fire',
				icon: 'mdi:fire',
				label: 'Alarm pożarowy',
				disabled: false,
				trigger: 'button',
			}
		return {
			kind: 'fire',
			variant: 'fire',
			icon: 'mdi:fire',
			label: 'Alarm pożarowy',
			disabled: true,
			trigger: 'none',
			blockedHint: 'Encja przycisku pożaru jest niedostępna.',
		}
	}

	_medicalDrawerRowSpec() {
		const id = this._config.medical_alarm_button_entity
		if (!id) return null
		const ent = this._hass?.states?.[id]
		if (ent)
			return {
				kind: 'medical',
				variant: 'medical',
				icon: 'mdi:medical-bag',
				label: 'Alarm medyczny',
				disabled: false,
				trigger: 'button',
			}
		return {
			kind: 'medical',
			variant: 'medical',
			icon: 'mdi:medical-bag',
			label: 'Alarm medyczny',
			disabled: true,
			trigger: 'none',
			blockedHint: 'Encja przycisku alarmu medycznego jest niedostępna.',
		}
	}

	_specialAlarmDrawerSpecs() {
		return [this._panicDrawerRowSpec(), this._fireDrawerRowSpec(), this._medicalDrawerRowSpec()].filter(Boolean)
	}

	async _triggerSpecialAlarm(kind) {
		if (!this._hass) return
		try {
			if (kind === 'panic') {
				const id = this._config.panic_button_entity
				if (id && this._hass.states[id]) {
					await this._hass.callService('button', 'press', { entity_id: id })
					return
				}
				await this._triggerPanicService()
				return
			}
			if (kind === 'fire') {
				const id = this._config.fire_alarm_button_entity
				if (id && this._hass.states[id]) {
					await this._hass.callService('button', 'press', { entity_id: id })
				}
				return
			}
			if (kind === 'medical') {
				const id = this._config.medical_alarm_button_entity
				if (id && this._hass.states[id]) {
					await this._hass.callService('button', 'press', { entity_id: id })
				}
			}
		} catch (_e) {
			this._feedback = { type: 'error', text: 'Nie udało się wysłać alarmu specjalnego.' }
		}
	}

	_clearSpecialHoldTimer() {
		if (this._specialHoldTimer) {
			clearTimeout(this._specialHoldTimer)
			this._specialHoldTimer = null
		}
	}

	_updateSpecialSlider(kind, value) {
		const normalized = Number(value)
		this._specialSliders = { ...this._specialSliders, [kind]: normalized }
		if (normalized >= 100 && !this._specialHoldTimer) {
			if (navigator.vibrate) navigator.vibrate(120)
			this._specialHoldTimer = setTimeout(() => {
				this._specialHoldTimer = null
				if (this._specialSliders[kind] >= 100) {
					if (navigator.vibrate) navigator.vibrate([100, 60, 140])
					this._triggerSpecialAlarm(kind)
					this._resetSpecialSlider(kind)
				}
			}, 280)
			return
		}
		if (normalized >= 90 && navigator.vibrate) navigator.vibrate(40)
	}

	_resetSpecialSlider(kind) {
		this._clearSpecialHoldTimer()
		this._specialResetting = { ...this._specialResetting, [kind]: true }
		this._specialSliders = { ...this._specialSliders, [kind]: 0 }
		setTimeout(() => {
			this._specialResetting = { ...this._specialResetting, [kind]: false }
		}, 260)
	}

	_handleSpecialRelease(kind) {
		if (this._specialSliders[kind] < 100) this._resetSpecialSlider(kind)
	}

	_specialRowHint(spec) {
		if (spec.disabled && spec.blockedHint) return spec.blockedHint
		if (spec.disabled) return 'Ta akcja jest niedostępna.'
		const v = this._specialSliders[spec.kind]
		if (v >= 100) return 'Przytrzymaj chwilę na końcu, aby potwierdzić.'
		return 'Przeciągnij suwak do końca i przytrzymaj, aby wygenerować alarm napadowy.'
	}

	_renderSpecialAlarmDrawer() {
		const specs = this._specialAlarmDrawerSpecs()
		if (!specs.length) {
			return html`
				<div class="special-alarm-empty">
					Ustaw w konfiguracji karty encje przycisków MQTT (<code>panic_button_entity</code>,
					<code>fire_alarm_button_entity</code>, <code>medical_alarm_button_entity</code>) albo
					<code>panic_service</code> dla napadu.
				</div>
			`
		}
		return specs.map(
			(spec) => html`
				<div class="special-alarm-row variant-${spec.variant} ${spec.disabled ? 'disabled' : ''}">
					<div class="special-alarm-header">
						<ha-icon icon=${spec.icon}></ha-icon>
						<span>${spec.label}</span>
					</div>
					<div class="special-track">
						<div class="special-progress" style=${`width:${this._specialSliders[spec.kind]}%`}></div>
						<input
							class="special-slider ${this._specialResetting[spec.kind] ? 'resetting' : ''}"
							type="range"
							min="0"
							max="100"
							step="1"
							.value=${String(this._specialSliders[spec.kind])}
							?disabled=${spec.disabled}
							@input=${(e) => !spec.disabled && this._updateSpecialSlider(spec.kind, e.target.value)}
							@change=${() => this._handleSpecialRelease(spec.kind)}
							@mouseup=${() => this._handleSpecialRelease(spec.kind)}
							@touchend=${() => this._handleSpecialRelease(spec.kind)} />
					</div>
					<div class="special-hint">${this._specialRowHint(spec)}</div>
				</div>
			`,
		)
	}

	/** Stan binary_sensor.<gateway>_panel_online — poza `on` pokazujemy wyraźny baner. */
	_panelConnectivity() {
		if (!this._hass || !this._config) return { level: 'ok', title: '', message: '' }
		const id = `binary_sensor.${this._config.gateway_slug}_panel_online`
		const ent = this._hass.states[id]
		if (!ent) {
			return {
				level: 'unavailable',
				title: 'Brak statusu panelu',
				message:
					'Encja panelu online nie istnieje lub nie jest widoczna. Nie wiadomo, czy centrala jest osiągalna — komendy mogą nie zadziałać.',
			}
		}
		const s = String(ent.state || '').toLowerCase()
		if (s === 'unavailable') {
			return {
				level: 'unavailable',
				title: 'Panel niedostępny',
				message: 'Home Assistant nie odczytuje stanu połączenia z centralą. Sprawdź integrację, sieć i centralę.',
			}
		}
		if (s === 'unknown') {
			return {
				level: 'unavailable',
				title: 'Status panelu nieznany',
				message: 'Stan połączenia z panelem jest niepewny. Zanim uzbroisz system, upewnij się, że centrala działa.',
			}
		}
		if (s === 'off') {
			return {
				level: 'offline',
				title: 'Centrala offline',
				message: 'Brak komunikacja z centralą alarmową.',
			}
		}
		return { level: 'ok', title: '', message: '' }
	}

	_renderPanelConnectivityBanner() {
		const c = this._panelConnectivity()
		if (c.level === 'ok') return html``
		const icon = c.level === 'offline' ? 'mdi:router-network-off' : 'mdi:lan-disconnect'
		return html`
			<div class="panel-connectivity-banner ${c.level}" role="alert">
				<div class="panel-connectivity-icon"><ha-icon icon=${icon}></ha-icon></div>
				<div class="panel-connectivity-copy">
					<div class="panel-connectivity-title">${c.title}</div>
					<div class="panel-connectivity-desc">${c.message}</div>
				</div>
			</div>
		`
	}

	_systemFaultStatus() {
		if (!this._hass || !this._config) {
			return { level: 'unknown', label: 'Brak danych o usterkach', desc: 'Sensor niedostępny' }
		}
		const id = `sensor.${this._config.gateway_slug}_any_fault`
		const ent = this._hass.states[id]
		if (!ent) {
			return { level: 'unknown', label: 'Brak danych o usterkach', desc: 'Sensor nie istnieje w HA' }
		}
		const s = String(ent.state ?? '')
			.toLowerCase()
			.trim()
		const okStates = new Set(['off', 'false', '0', 'no', 'none', 'brak', 'ok', 'clear'])
		const faultStates = new Set(['on', 'true', '1', 'yes', 'fault', 'alarm', 'active', 'usterka', 'awaria'])
		if (okStates.has(s)) {
			return { level: 'ok', label: 'Brak usterek', desc: 'System pracuje poprawnie' }
		}
		if (faultStates.has(s)) {
			return { level: 'fault', label: 'Wykryto usterkę', desc: 'Sprawdź szczegóły usterek w systemie' }
		}
		if (s === 'unknown' || s === 'unavailable' || s === '') {
			return { level: 'unknown', label: 'Brak danych o usterkach', desc: 'Sensor raportuje stan nieznany' }
		}
		return { level: 'unknown', label: 'Status usterek niejednoznaczny', desc: `Odczyt: ${ent.state}` }
	}

	_renderControlPanel(partitions) {
		const stateClass = this._stateForAll(partitions)
		const uniformRaw = stateClass === 'delay' ? this._uniformPartitionRawState(partitions) : null
		const alarmPartitions = this._partitionsInAlarm(partitions)
		const headline = this._stateHeadline(stateClass, uniformRaw, alarmPartitions)
		const statusModifierClass = alarmPartitions.length > 0 ? 'alarm' : stateClass
		const canAway = partitions.some((p) => this._allowedActions(p).includes('alarm_arm_away'))
		const canNight = partitions.some((p) => this._allowedActions(p).includes('alarm_arm_night'))
		const canDisarm = partitions.some((p) => this._allowedActions(p).includes('alarm_disarm'))
		const pa = this._pendingAction

		return html`
			<div class="control-panel">
				<div
					class="status-indicator ${statusModifierClass} fault-${headline.faultLevel}"
					role=${alarmPartitions.length > 0 ? 'alert' : 'status'}
					aria-live=${alarmPartitions.length > 0 ? 'assertive' : 'polite'}>
					<div class="status-icon"><ha-icon icon=${headline.icon}></ha-icon></div>
					<div class="status-info">
						<div class="status-label">${headline.title}</div>
						<div class="status-description">${headline.desc}</div>
						<div class="status-fault-line ${headline.faultLevel}">
							<span class="status-fault-dot" aria-hidden="true"></span>
							<span class="status-fault-text">
								<span class="status-fault-label">${headline.faultLabel}</span>
								<span class="status-fault-sep" aria-hidden="true">·</span>
								<span class="status-fault-detail">${headline.faultDetail}</span>
							</span>
						</div>
					</div>
				</div>

				<div class="state-controls">
					<button
						class="state-button-wrapper away ${canAway ? '' : 'disabled'} ${pa === 'alarm_arm_away' ? 'selected' : ''}"
						?disabled=${!canAway}
						@click=${() => this._setAllPartitionsAction('alarm_arm_away')}>
						<div class="state-button"><ha-icon icon="mdi:home-lock"></ha-icon></div>
						<div class="button-label">Tryb wyjścia</div>
						<div class="button-description">Pełna ochrona</div>
					</button>

					<button
						class="state-button-wrapper night ${canNight ? '' : 'disabled'} ${pa === 'alarm_arm_night'
							? 'selected'
							: ''}"
						?disabled=${!canNight}
						@click=${() => this._setAllPartitionsAction('alarm_arm_night')}>
						<div class="state-button"><ha-icon icon="mdi:weather-night"></ha-icon></div>
						<div class="button-label">Tryb nocny</div>
						<div class="button-description">Ochrona nocna</div>
					</button>

					<button
						class="state-button-wrapper disarm ${canDisarm ? '' : 'disabled'} ${pa === 'alarm_disarm'
							? 'selected'
							: ''}"
						?disabled=${!canDisarm}
						@click=${() => this._setAllPartitionsAction('alarm_disarm')}>
						<div class="state-button"><ha-icon icon="mdi:lock-open-variant-outline"></ha-icon></div>
						<div class="button-label">Wyłącz</div>
						<div class="button-description">Wyłącz system</div>
					</button>
				</div>
			</div>
		`
	}

	_renderPinMode(partitions) {
		return html`
			<ha-card class="dashboard pin-mode">
				${this._feedback ? html`<div class="feedback ${this._feedback.type}">${this._feedback.text}</div>` : ''}
				${this._renderControlPanel(partitions)}

				<div class="pin-mode-panel">
					<div class="pin-display">${this._pin.length ? '•'.repeat(this._pin.length) : '—'}</div>
					<div class="keys">
						${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(
							(d) => html`<button class="key" @click=${() => (this._pin = `${this._pin}${d}`)}>${d}</button>`,
						)}
						<button class="key alt" @click=${() => (this._pin = this._pin.slice(0, -1))}>⌫</button>
						<button class="key" @click=${() => (this._pin = `${this._pin}0`)}>0</button>
						<button class="key alt" @click=${() => (this._pin = '')}>Wyczyść</button>
					</div>
				</div>

				<div class="pin-mode-actions">
					<button
						class="btn ghost"
						@click=${() => {
							this._pendingAction = null
							this._pendingTargets = null
							this._pin = ''
							this._drawerOpen = false
						}}>
						Anuluj
					</button>
					<button
						class="btn solid"
						?disabled=${this._isSending || this._pin.length === 0}
						@click=${this._confirmPendingAction}>
						${this._isSending ? 'Wysyłanie...' : 'Potwierdź'}
					</button>
				</div>
			</ha-card>
		`
	}

	render() {
		if (!this._hass || !this._config) return html``
		if (this._panelConnectivity().level !== 'ok') {
			return html`<ha-card class="dashboard dashboard-connectivity-only"
				>${this._renderPanelConnectivityBanner()}</ha-card
			>`
		}

		const partitions = this._partitions()
		if (!partitions.length) {
			return html`<ha-card class="dashboard"
				><div class="empty">Brak partycji dla <code>${this._config.gateway_slug}</code>.</div></ha-card
			>`
		}

		if (this._pendingAction && this._userCodeMode() !== 'backend') {
			return this._renderPinMode(partitions)
		}

		return html`
			<ha-card class="dashboard">
				${this._renderControlPanel(partitions)}
				${this._feedback ? html`<div class="feedback ${this._feedback.type}">${this._feedback.text}</div>` : ''}

				<div class="partitions-list">
					${partitions.map((partition) => {
						const expanded = this._expandedPartitionId === partition.id
						const zoneList = this._zonesForPartition(partition)
						const readiness = this._partitionReadinessLine(partition)
						const primary = this._primaryActionForPartition(partition)
						const quickArmBlocked = primary && this._partitionQuickArmBlockedByReadiness(partition, primary)
						const quickTitle = primary
							? quickArmBlocked
								? `${this._actionUi(primary).label} — partycja nie jest gotowa do uzbrojenia`
								: this._actionUi(primary).label
							: ''
						const pVis = this._partitionStatusVisual(partition.entity.state)
						return html`
							<div class="partition-card partition-tone-${pVis.tone}">
								<div class="partition-content">
									<div class="partition-icon tone-${pVis.tone}" aria-hidden="true">
										<ha-icon icon=${pVis.icon}></ha-icon>
									</div>
									<div class="partition-info">
										<div class="partition-title">
											<span class="name">${partition.title}</span>
											${partition.index ? html`<span class="id-label">Partycja #${partition.index}</span>` : ''}
										</div>
										<div class="partition-meta" role="status">
											<span class="partition-status">${this._stateLabel(partition.entity.state)}</span>
											${readiness
												? html`
														<span class="partition-meta-sep" aria-hidden="true">|</span>
														<span class="partition-readiness-inline ${readiness.variant}">${readiness.label}</span>
													`
												: ''}
										</div>
									</div>
									${primary
										? html`
												<button
													class="quick-action"
													title=${quickTitle}
													?disabled=${quickArmBlocked}
													@click=${() => {
														if (quickArmBlocked) return
														this._setSinglePartitionAction(partition, primary)
													}}>
													<ha-icon icon=${this._actionUi(primary).icon}></ha-icon>
												</button>
											`
										: ''}
									<button
										class="expand-btn ${expanded ? 'rotated' : ''}"
										@click=${() => this._togglePartitionExpansion(partition.id)}>
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
																	<div class="zone-status ${this._zoneStatusClass(zone.state)}">
																		${this._zoneStatusText(zone.state)}
																	</div>
																</div>
															`,
														)
													: html`<div class="zone-empty">Brak linii do wyświetlenia - wszystkie linie są gotowe do uzbrojenia.</div>`}
											</div>
										`
									: ''}
							</div>
						`
					})}
				</div>

				<div class="action-drawer ${this._drawerOpen ? 'expanded' : ''}">
					<button class="drawer-handle" @click=${() => (this._drawerOpen = !this._drawerOpen)}>
						<ha-icon icon=${this._drawerOpen ? 'mdi:chevron-down' : 'mdi:chevron-up'}></ha-icon>
						<span>Alarmy specjalne</span>
					</button>

					<div class="drawer-content special-alarm-drawer">${this._renderSpecialAlarmDrawer()}</div>
				</div>
			</ha-card>
		`
	}

	static get styles() {
		return css`
			:host {
				display: block;
				-webkit-font-smoothing: antialiased;
				-moz-osx-font-smoothing: grayscale;
				font-family: var(
					--ha-font-family-body,
					'Roboto',
					'Google Sans',
					system-ui,
					-apple-system,
					'Segoe UI',
					sans-serif
				);
				--pac-bg: var(--ha-card-background, var(--card-background-color, #ffffff));
				--pac-bg-soft: color-mix(in srgb, var(--pac-bg) 94%, var(--primary-text-color) 6%);
				--pac-surface: color-mix(in srgb, var(--pac-bg) 91%, var(--primary-text-color) 9%);
				--pac-surface-2: color-mix(in srgb, var(--pac-bg) 86%, var(--primary-text-color) 14%);
				--pac-border: color-mix(in srgb, var(--divider-color, #e0e0e0) 55%, var(--pac-bg) 45%);
				--pac-text: var(--primary-text-color, #1f1f1f);
				--pac-text-soft: var(--secondary-text-color, #5f6368);
				--pac-ok: var(--success-color, #1e8e3e);
				--pac-warn: var(--warning-color, #f9ab00);
				--pac-danger: var(--error-color, #d93025);
				--pac-accent: var(--primary-color, #1a73e8);
				--pac-elev-1: 0 1px 2px rgba(60, 64, 67, 0.12), 0 1px 3px 1px rgba(60, 64, 67, 0.08);
				--pac-elev-2: 0 1px 3px rgba(60, 64, 67, 0.14), 0 4px 8px 3px rgba(60, 64, 67, 0.08);
				--pac-radius-xl: 16px;
				--pac-radius-lg: 12px;
				--pac-radius-md: 8px;
			}
			.dashboard {
				border-radius: var(--pac-radius-xl);
				background: var(--pac-bg);
				color: var(--pac-text);
				border: 1px solid var(--pac-border);
				box-shadow: var(--pac-elev-1);
				overflow: hidden;
			}
			.dashboard-connectivity-only {
				min-height: auto;
			}
			.dashboard-connectivity-only .panel-connectivity-banner {
				border-bottom: none;
				margin: 0;
			}

			.panel-connectivity-banner {
				display: flex;
				align-items: flex-start;
				gap: 14px;
				padding: 16px;
				border-bottom: 1px solid var(--pac-border);
				font-size: 0.875rem;
				line-height: 1.43;
			}
			.panel-connectivity-banner.unavailable {
				background: color-mix(in srgb, var(--pac-danger) 22%, var(--pac-bg));
				border-bottom-color: var(--pac-danger);
				color: var(--pac-text);
				animation: pac-panel-pulse 2.2s ease-in-out infinite;
			}
			.panel-connectivity-banner.offline {
				background: color-mix(in srgb, var(--pac-warn) 26%, var(--pac-bg));
				border-bottom-color: var(--pac-warn);
				color: var(--pac-text);
			}
			.panel-connectivity-icon {
				flex-shrink: 0;
				width: 44px;
				height: 44px;
				border-radius: var(--pac-radius-md);
				display: grid;
				place-items: center;
				background: color-mix(in srgb, var(--pac-bg) 88%, var(--primary-text-color) 12%);
				box-shadow: var(--pac-elev-1);
			}
			.panel-connectivity-banner.unavailable .panel-connectivity-icon {
				color: var(--pac-danger);
			}
			.panel-connectivity-banner.offline .panel-connectivity-icon {
				color: color-mix(in srgb, var(--pac-warn) 85%, #000000);
			}
			.panel-connectivity-icon ha-icon {
				--mdc-icon-size: 26px;
			}
			.panel-connectivity-title {
				font-weight: 500;
				font-size: 0.9375rem;
				letter-spacing: 0.00625em;
				margin-bottom: 4px;
			}
			.panel-connectivity-desc {
				color: var(--pac-text);
				opacity: 0.92;
			}
			@keyframes pac-panel-pulse {
				0%,
				100% {
					filter: brightness(1);
				}
				50% {
					filter: brightness(1.06);
				}
			}

			.control-panel {
				padding: 16px;
			}
			.status-indicator {
				display: flex;
				gap: 14px;
				align-items: center;
				border-radius: var(--pac-radius-xl);
				padding: 16px;
				margin-bottom: 16px;
				background: var(--pac-surface);
				border: 1px solid color-mix(in srgb, var(--pac-border) 70%, transparent);
				box-shadow: var(--pac-elev-1);
			}
			.status-icon {
				width: 48px;
				height: 48px;
				border-radius: 50%;
				display: grid;
				place-items: center;
				flex-shrink: 0;
				color: #fff;
				background: var(--pac-accent);
				box-shadow: var(--pac-elev-1);
			}
			.status-icon ha-icon {
				--mdc-icon-size: 24px;
				color: #fff;
			}
			.status-label {
				font-size: 1.125rem;
				font-weight: 400;
				letter-spacing: 0;
				line-height: 1.35;
			}
			.status-description {
				font-size: 0.8125rem;
				font-weight: 400;
				color: var(--pac-text-soft);
				line-height: 1.43;
				margin-top: 4px;
				max-width: 56ch;
			}
			.status-indicator.away .status-icon {
				background: color-mix(in srgb, var(--pac-danger) 94%, #000 6%);
			}
			.status-indicator.night .status-icon {
				background: #6750a4;
			}
			.status-indicator.disarm .status-icon {
				background: color-mix(in srgb, var(--pac-ok) 92%, #000 8%);
			}
			.status-indicator.partial .status-icon {
				background: color-mix(in srgb, var(--pac-warn) 90%, #000 10%);
			}
			.status-indicator.delay .status-icon {
				background: #039be5;
			}
			.status-indicator.alarm .status-icon {
				background: color-mix(in srgb, var(--pac-danger) 96%, #000 4%);
				animation: pac-header-alarm-pulse 2.2s ease-in-out infinite;
			}
			@keyframes pac-header-alarm-pulse {
				0%,
				100% {
					filter: brightness(1);
					box-shadow: 0 0 0 0 color-mix(in srgb, var(--pac-danger) 35%, transparent);
				}
				50% {
					filter: brightness(1.08);
					box-shadow: 0 0 0 6px color-mix(in srgb, var(--pac-danger) 12%, transparent);
				}
			}
			.status-indicator.fault-fault {
				box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--pac-danger) 45%, transparent);
			}
			.status-indicator.fault-unknown {
				box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--pac-text-soft) 35%, transparent);
			}
			.status-fault-line {
				display: flex;
				align-items: flex-start;
				gap: 8px;
				margin-top: 12px;
				padding-top: 12px;
				border-top: 1px solid color-mix(in srgb, var(--pac-border) 75%, transparent);
				font-size: 0.8125rem;
				line-height: 1.43;
			}
			.status-fault-dot {
				width: 8px;
				height: 8px;
				border-radius: 999px;
				margin-top: 4px;
				flex-shrink: 0;
			}
			.status-fault-text {
				min-width: 0;
				display: block;
			}
			.status-fault-label {
				font-weight: 500;
			}
			.status-fault-sep {
				margin: 0 0.28em;
				opacity: 0.45;
				font-weight: 400;
			}
			.status-fault-detail {
				font-weight: 400;
				color: var(--pac-text-soft);
			}
			.status-fault-line.ok .status-fault-dot {
				background: var(--pac-ok);
				box-shadow: 0 0 0 3px color-mix(in srgb, var(--pac-ok) 18%, transparent);
			}
			.status-fault-line.ok .status-fault-label {
				color: color-mix(in srgb, var(--pac-ok) 82%, var(--pac-text));
			}
			.status-fault-line.fault .status-fault-dot {
				background: var(--pac-danger);
				box-shadow: 0 0 0 3px color-mix(in srgb, var(--pac-danger) 22%, transparent);
			}
			.status-fault-line.fault .status-fault-label {
				color: color-mix(in srgb, var(--pac-danger) 88%, var(--pac-text));
			}
			.status-fault-line.fault .status-fault-detail {
				color: color-mix(in srgb, var(--pac-danger) 55%, var(--pac-text-soft));
			}
			.status-fault-line.unknown .status-fault-dot {
				background: var(--pac-text-soft);
				box-shadow: 0 0 0 3px color-mix(in srgb, var(--pac-text-soft) 16%, transparent);
			}
			.status-fault-line.unknown .status-fault-label {
				color: var(--pac-text-soft);
			}

			.state-controls {
				display: grid;
				grid-template-columns: repeat(3, minmax(0, 1fr));
				gap: 8px;
			}
			.state-button-wrapper {
				border-radius: var(--pac-radius-lg);
				border: 1px solid var(--pac-border);
				background: var(--pac-bg-soft);
				color: var(--pac-text);
				padding: 12px 8px;
				text-align: center;
				cursor: pointer;
				transition: background 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
			}
			.state-button-wrapper:hover:not(.disabled) {
				background: var(--pac-surface);
				box-shadow: var(--pac-elev-1);
			}
			.state-button-wrapper.disabled {
				opacity: 0.38;
				cursor: not-allowed;
			}
			.state-button-wrapper.selected {
				background: color-mix(in srgb, var(--pac-accent) 10%, var(--pac-bg));
				border-color: color-mix(in srgb, var(--pac-accent) 45%, var(--pac-border));
				box-shadow: 0 0 0 1px color-mix(in srgb, var(--pac-accent) 35%, transparent);
			}
			.state-button {
				width: 48px;
				height: 48px;
				margin: 0 auto 10px;
				border-radius: 50%;
				display: grid;
				place-items: center;
				color: #fff;
				box-shadow: var(--pac-elev-1);
			}
			.state-button ha-icon {
				color: #fff;
			}
			.state-button-wrapper.away .state-button {
				background: color-mix(in srgb, var(--pac-danger) 94%, #000 6%);
			}
			.state-button-wrapper.night .state-button {
				background: #6750a4;
			}
			.state-button-wrapper.disarm .state-button {
				background: color-mix(in srgb, var(--pac-ok) 92%, #000 8%);
			}
			.button-label {
				font-size: 0.8125rem;
				font-weight: 500;
				letter-spacing: 0.00625em;
			}
			.button-description {
				font-size: 0.75rem;
				font-weight: 400;
				color: var(--pac-text-soft);
				line-height: 1.33;
				margin-top: 4px;
			}

			.feedback {
				margin: 0 16px 12px;
				border-radius: var(--pac-radius-md);
				padding: 10px 12px;
				font-size: 0.8125rem;
				line-height: 1.43;
			}
			.feedback.success {
				color: var(--pac-ok);
				background: color-mix(in srgb, var(--pac-ok) 14%, transparent);
			}
			.feedback.error {
				color: var(--pac-danger);
				background: color-mix(in srgb, var(--pac-danger) 16%, transparent);
			}

			.partitions-list {
				padding: 0 16px 78px;
				display: grid;
				gap: 8px;
			}
			.partition-card {
				border-radius: var(--pac-radius-lg);
				border: 1px solid var(--pac-border);
				background: var(--pac-bg-soft);
				box-shadow: var(--pac-elev-1);
				border-left-width: 3px;
				border-left-color: var(--pac-border);
			}
			.partition-tone-disarmed {
				border-left-color: color-mix(in srgb, var(--pac-ok) 55%, var(--pac-border));
			}
			.partition-tone-away {
				border-left-color: color-mix(in srgb, var(--pac-danger) 62%, var(--pac-border));
			}
			.partition-tone-home {
				border-left-color: color-mix(in srgb, var(--pac-accent) 58%, var(--pac-border));
			}
			.partition-tone-night {
				border-left-color: color-mix(in srgb, #8b5cf6 55%, var(--pac-border));
			}
			.partition-tone-partial {
				border-left-color: color-mix(in srgb, var(--pac-warn) 52%, var(--pac-border));
			}
			.partition-tone-transition {
				border-left-color: color-mix(in srgb, var(--pac-warn) 48%, var(--pac-border));
			}
			.partition-tone-alarm {
				border-left-color: var(--pac-danger);
			}
			.partition-tone-muted {
				border-left-color: color-mix(in srgb, var(--pac-text-soft) 45%, var(--pac-border));
			}
			.partition-content {
				display: flex;
				align-items: center;
				gap: 10px;
				padding: 10px;
			}
			.partition-icon {
				width: 38px;
				height: 38px;
				border-radius: 50%;
				flex-shrink: 0;
				display: grid;
				place-items: center;
				border: 1px solid var(--pac-border);
				box-sizing: border-box;
			}
			.partition-icon ha-icon {
				--mdc-icon-size: 22px;
			}
			.partition-icon.tone-disarmed {
				background: color-mix(in srgb, var(--pac-ok) 16%, var(--pac-bg));
				color: color-mix(in srgb, var(--pac-ok) 88%, var(--pac-text));
				border-color: color-mix(in srgb, var(--pac-ok) 28%, var(--pac-border));
			}
			.partition-icon.tone-away {
				background: color-mix(in srgb, var(--pac-danger) 18%, var(--pac-bg));
				color: var(--pac-danger);
				border-color: color-mix(in srgb, var(--pac-danger) 32%, var(--pac-border));
			}
			.partition-icon.tone-home {
				background: color-mix(in srgb, var(--pac-accent) 16%, var(--pac-bg));
				color: var(--pac-accent);
				border-color: color-mix(in srgb, var(--pac-accent) 30%, var(--pac-border));
			}
			.partition-icon.tone-night {
				background: color-mix(in srgb, #8b5cf6 17%, var(--pac-bg));
				color: #7c3aed;
				border-color: color-mix(in srgb, #8b5cf6 32%, var(--pac-border));
			}
			.partition-icon.tone-partial {
				background: color-mix(in srgb, var(--pac-warn) 16%, var(--pac-bg));
				color: color-mix(in srgb, var(--pac-warn) 82%, var(--pac-text));
				border-color: color-mix(in srgb, var(--pac-warn) 30%, var(--pac-border));
			}
			.partition-icon.tone-transition {
				background: color-mix(in srgb, var(--pac-warn) 14%, var(--pac-bg));
				color: color-mix(in srgb, var(--pac-warn) 78%, var(--pac-text));
				border-color: color-mix(in srgb, var(--pac-warn) 26%, var(--pac-border));
			}
			.partition-icon.tone-alarm {
				background: color-mix(in srgb, var(--pac-danger) 22%, var(--pac-bg));
				color: var(--pac-danger);
				border-color: color-mix(in srgb, var(--pac-danger) 42%, var(--pac-border));
				animation: pac-partition-alarm-pulse 2.1s ease-in-out infinite;
			}
			.partition-icon.tone-muted {
				background: color-mix(in srgb, var(--pac-surface-2) 88%, var(--pac-bg));
				color: var(--pac-text-soft);
				border-color: color-mix(in srgb, var(--pac-text-soft) 22%, var(--pac-border));
			}
			@keyframes pac-partition-alarm-pulse {
				0%,
				100% {
					box-shadow: 0 0 0 0 color-mix(in srgb, var(--pac-danger) 28%, transparent);
				}
				50% {
					box-shadow: 0 0 0 5px color-mix(in srgb, var(--pac-danger) 8%, transparent);
				}
			}
			.partition-info {
				flex: 1;
				min-width: 0;
			}
			.partition-title {
				display: flex;
				align-items: center;
				gap: 6px;
			}
			.partition-title .name {
				font-size: 0.875rem;
				font-weight: 500;
				letter-spacing: 0.00625em;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}
			.id-label {
				font-size: 0.6875rem;
				font-weight: 500;
				border-radius: 6px;
				padding: 3px 8px;
				background: var(--pac-surface-2);
				color: var(--pac-text-soft);
			}
			.partition-meta {
				margin-top: 4px;
				display: flex;
				align-items: baseline;
				flex-wrap: wrap;
				gap: 0 6px;
				font-size: 0.8125rem;
				line-height: 1.43;
				color: var(--pac-text-soft);
			}
			.partition-status {
				color: inherit;
				font-weight: 400;
			}
			.partition-meta-sep {
				color: var(--pac-text-soft);
				opacity: 0.4;
				font-weight: 400;
				user-select: none;
			}
			.partition-readiness-inline {
				min-width: 0;
				font-weight: 500;
			}
			.partition-readiness-inline.ready {
				color: color-mix(in srgb, var(--pac-ok) 88%, var(--pac-text-soft));
			}
			.partition-readiness-inline.not_ready {
				color: color-mix(in srgb, var(--pac-warn) 85%, var(--pac-text-soft));
			}
			.partition-readiness-inline.unknown {
				color: var(--pac-text-soft);
				font-weight: 400;
			}
			.quick-action {
				border: none;
				background: var(--pac-surface-2);
				color: var(--pac-text);
				border-radius: var(--pac-radius-md);
				min-width: 40px;
				min-height: 40px;
				display: grid;
				place-items: center;
				cursor: pointer;
				box-shadow: var(--pac-elev-1);
				transition: box-shadow 0.2s ease, background 0.2s ease;
			}
			.quick-action:hover:not(:disabled) {
				box-shadow: var(--pac-elev-2);
				background: var(--pac-surface);
			}
			.quick-action ha-icon {
				--mdc-icon-size: 18px;
			}
			.quick-action:disabled {
				opacity: 0.45;
				cursor: not-allowed;
			}
			.expand-btn {
				border: none;
				background: transparent;
				color: var(--pac-text-soft);
				cursor: pointer;
				border-radius: 999px;
				padding: 4px;
				transition: transform 0.2s ease, background 0.2s ease;
			}
			.expand-btn:hover {
				background: color-mix(in srgb, var(--pac-text-soft) 10%, transparent);
			}
			.expand-btn.rotated {
				transform: rotate(180deg);
			}

			.zones-grid {
				padding: 0 12px 12px;
				display: grid;
				gap: 8px;
			}
			.zone-item {
				display: flex;
				justify-content: space-between;
				align-items: center;
				border-radius: var(--pac-radius-md);
				padding: 10px 12px;
				background: var(--pac-surface);
				border: 1px solid color-mix(in srgb, var(--pac-border) 65%, transparent);
				box-shadow: 0 1px 1px rgba(60, 64, 67, 0.06);
			}
			.zone-name {
				display: flex;
				gap: 6px;
				align-items: center;
				font-size: 0.8125rem;
				font-weight: 400;
			}
			.zone-status {
				font-size: 0.75rem;
				font-weight: 500;
			}
			.zone-status.status-ready {
				color: var(--pac-ok);
			}
			.zone-status.status-violated {
				color: var(--pac-danger);
			}
			.zone-status.status-notReady {
				color: var(--pac-warn);
			}
			.zone-empty {
				color: var(--pac-text-soft);
				font-size: 0.73rem;
				padding: 8px 0;
			}

			.action-drawer {
				position: sticky;
				bottom: 0;
				left: 0;
				right: 0;
				z-index: 3;
				border-top: 1px solid var(--pac-border);
				background: color-mix(in srgb, var(--pac-bg) 97%, var(--primary-text-color) 3%);
				box-shadow: 0 -2px 8px rgba(60, 64, 67, 0.06);
			}
			.drawer-handle {
				width: 100%;
				min-height: 48px;
				border: none;
				background: transparent;
				color: var(--pac-text-soft);
				position: relative;
				z-index: 4;
				display: inline-flex;
				align-items: center;
				justify-content: center;
				gap: 8px;
				cursor: pointer;
				font-family: inherit;
				font-size: 0.875rem;
				font-weight: 500;
				letter-spacing: 0.00625em;
			}
			.drawer-handle:hover {
				background: color-mix(in srgb, var(--primary-text-color) 4%, transparent);
			}
			.drawer-content {
				display: none;
				padding: 0 14px 14px;
			}
			.action-drawer.expanded .drawer-content {
				display: block;
			}

			.pin-panel {
				margin-bottom: 12px;
			}
			.pin-title {
				font-size: 0.875rem;
				font-weight: 500;
				letter-spacing: 0.00625em;
				margin-bottom: 8px;
			}
			.pin-subtitle {
				font-size: 0.8125rem;
				font-weight: 400;
				line-height: 1.43;
				color: var(--pac-text-soft);
				margin-bottom: 8px;
			}
			.pin-display {
				min-height: 48px;
				border-radius: var(--pac-radius-lg);
				border: 1px solid var(--pac-border);
				background: var(--pac-bg-soft);
				display: grid;
				place-items: center;
				letter-spacing: 0.35rem;
				margin-bottom: 8px;
				box-shadow: inset 0 1px 2px rgba(60, 64, 67, 0.06);
			}
			.keys {
				display: grid;
				grid-template-columns: repeat(3, 1fr);
				gap: 7px;
			}
			.key {
				min-height: 44px;
				border-radius: var(--pac-radius-md);
				border: none;
				background: var(--pac-surface);
				color: var(--pac-text);
				cursor: pointer;
				font-family: inherit;
				font-size: 1.125rem;
				font-weight: 500;
				box-shadow: var(--pac-elev-1);
				transition: box-shadow 0.15s ease, background 0.15s ease;
			}
			.key:hover {
				box-shadow: var(--pac-elev-2);
				background: var(--pac-bg-soft);
			}
			.key.alt {
				color: var(--pac-text-soft);
			}
			.confirm-row {
				margin-top: 8px;
				display: grid;
				grid-template-columns: 1fr 2fr;
				gap: 7px;
			}
			.btn {
				min-height: 44px;
				border-radius: var(--pac-radius-md);
				cursor: pointer;
				font-family: inherit;
				font-weight: 500;
				font-size: 0.875rem;
				letter-spacing: 0.00625em;
			}
			.btn.ghost {
				border: 1px solid var(--pac-border);
				background: transparent;
				color: var(--pac-accent);
			}
			.btn.solid {
				border: none;
				background: var(--pac-accent);
				color: #fff;
				box-shadow: var(--pac-elev-1);
			}
			.btn.solid:hover:not(:disabled) {
				box-shadow: var(--pac-elev-2);
				filter: brightness(1.03);
			}
			.btn:disabled {
				opacity: 0.6;
				cursor: not-allowed;
			}

			.drawer-content.special-alarm-drawer {
				display: none;
			}
			.action-drawer.expanded .drawer-content.special-alarm-drawer {
				display: flex;
				flex-direction: column;
				gap: 10px;
			}
			.special-alarm-empty {
				font-size: 0.72rem;
				color: var(--pac-text-soft);
				line-height: 1.4;
			}
			.special-alarm-empty code {
				font-size: 0.65rem;
			}
			.special-alarm-row {
				border-radius: var(--pac-radius-lg);
				border: 1px solid var(--pac-border);
				background: var(--pac-bg-soft);
				padding: 12px;
				box-shadow: var(--pac-elev-1);
			}
			.special-alarm-row.disabled {
				opacity: 0.72;
			}
			.special-alarm-header {
				display: flex;
				align-items: center;
				gap: 8px;
				font-weight: 500;
				font-size: 0.875rem;
				letter-spacing: 0.00625em;
				margin-bottom: 10px;
			}
			.special-alarm-row.variant-panic .special-alarm-header ha-icon {
				color: var(--pac-danger);
			}
			.special-alarm-row.variant-fire .special-alarm-header ha-icon {
				color: var(--pac-warn);
			}
			.special-alarm-row.variant-medical .special-alarm-header ha-icon {
				color: color-mix(in srgb, var(--pac-accent) 70%, var(--pac-ok) 30%);
			}
			.special-track {
				position: relative;
				height: 50px;
				border-radius: 999px;
				background: var(--pac-surface);
				border: 1px solid color-mix(in srgb, var(--pac-border) 70%, transparent);
				overflow: hidden;
				box-shadow: inset 0 1px 2px rgba(60, 64, 67, 0.06);
			}
			.special-alarm-row.variant-panic .special-progress {
				background: linear-gradient(
					90deg,
					color-mix(in srgb, var(--pac-danger) 25%, transparent),
					color-mix(in srgb, var(--pac-danger) 50%, transparent)
				);
			}
			.special-alarm-row.variant-fire .special-progress {
				background: linear-gradient(
					90deg,
					color-mix(in srgb, var(--pac-warn) 22%, transparent),
					color-mix(in srgb, var(--pac-warn) 48%, transparent)
				);
			}
			.special-alarm-row.variant-medical .special-progress {
				background: linear-gradient(
					90deg,
					color-mix(in srgb, var(--pac-accent) 22%, transparent),
					color-mix(in srgb, var(--pac-ok) 35%, transparent)
				);
			}
			.special-progress {
				position: absolute;
				inset: 0 auto 0 0;
				pointer-events: none;
			}
			.special-slider {
				position: absolute;
				inset: 0;
				width: 100%;
				margin: 0;
				background: transparent;
				-webkit-appearance: none;
				appearance: none;
			}
			.special-slider:disabled {
				cursor: not-allowed;
				opacity: 0.55;
			}
			.special-slider::-webkit-slider-runnable-track {
				height: 50px;
				background: transparent;
			}
			.special-alarm-row.variant-panic .special-slider::-webkit-slider-thumb {
				-webkit-appearance: none;
				appearance: none;
				width: 42px;
				height: 42px;
				margin-top: 4px;
				border-radius: 999px;
				border: 2px solid color-mix(in srgb, var(--pac-bg) 92%, var(--primary-text-color) 8%);
				background: var(--pac-danger);
				box-shadow: var(--pac-elev-2);
			}
			.special-alarm-row.variant-fire .special-slider::-webkit-slider-thumb {
				-webkit-appearance: none;
				appearance: none;
				width: 42px;
				height: 42px;
				margin-top: 4px;
				border-radius: 999px;
				border: 2px solid color-mix(in srgb, var(--pac-bg) 92%, var(--primary-text-color) 8%);
				background: var(--pac-warn);
				box-shadow: var(--pac-elev-2);
			}
			.special-alarm-row.variant-medical .special-slider::-webkit-slider-thumb {
				-webkit-appearance: none;
				appearance: none;
				width: 42px;
				height: 42px;
				margin-top: 4px;
				border-radius: 999px;
				border: 2px solid color-mix(in srgb, var(--pac-bg) 92%, var(--primary-text-color) 8%);
				background: color-mix(in srgb, var(--pac-accent) 55%, var(--pac-ok) 45%);
				box-shadow: var(--pac-elev-2);
			}
			.special-slider::-moz-range-track {
				height: 50px;
				background: transparent;
				border: none;
			}
			.special-alarm-row.variant-panic .special-slider::-moz-range-thumb {
				width: 42px;
				height: 42px;
				border: 2px solid color-mix(in srgb, var(--pac-bg) 92%, var(--primary-text-color) 8%);
				border-radius: 999px;
				background: var(--pac-danger);
				box-shadow: var(--pac-elev-2);
			}
			.special-alarm-row.variant-fire .special-slider::-moz-range-thumb {
				width: 42px;
				height: 42px;
				border: 2px solid color-mix(in srgb, var(--pac-bg) 92%, var(--primary-text-color) 8%);
				border-radius: 999px;
				background: var(--pac-warn);
				box-shadow: var(--pac-elev-2);
			}
			.special-alarm-row.variant-medical .special-slider::-moz-range-thumb {
				width: 42px;
				height: 42px;
				border: 2px solid color-mix(in srgb, var(--pac-bg) 92%, var(--primary-text-color) 8%);
				border-radius: 999px;
				background: color-mix(in srgb, var(--pac-accent) 55%, var(--pac-ok) 45%);
				box-shadow: var(--pac-elev-2);
			}
			.special-slider.resetting {
				transition: all 0.25s ease;
			}
			.special-hint {
				margin-top: 8px;
				font-size: 0.75rem;
				line-height: 1.43;
				color: var(--pac-text-soft);
				font-weight: 400;
			}

			.pin-mode {
				min-height: 420px;
				display: grid;
				grid-template-rows: auto auto 1fr auto;
			}
			.pin-mode .feedback {
				margin: 10px 14px 0;
			}
			.pin-mode-panel {
				padding: 14px;
			}
			.pin-mode-actions {
				display: grid;
				grid-template-columns: 1fr 2fr;
				gap: 8px;
				padding: 0 14px 14px;
			}

			.empty {
				color: var(--pac-text-soft);
				font-weight: 400;
				font-size: 0.875rem;
				line-height: 1.43;
				padding: 16px;
			}
			code {
				background: var(--pac-surface-2);
				padding: 0.15rem 0.4rem;
				border-radius: 4px;
				font-size: 0.8125em;
			}
		`
	}
}

customElements.define('pulson-alarm-card', PulsonAlarmCard)

window.customCards = window.customCards || []
window.customCards.push({
	type: 'pulson-alarm-card',
	name: 'Pulson Alarm Card',
	description: 'Partition dashboard style card inspired by the Angular mobile app.',
})
