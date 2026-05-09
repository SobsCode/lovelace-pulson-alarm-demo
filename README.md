# Pulson Alarm Card

`pulson-alarm-card` is a modern Lovelace card for Home Assistant designed for the Pulson integration (`pulson_security_integration_gateway`).

The current version ports core layout and behavior from an Angular mobile `partition-dashboard`: global state panel, quick mode buttons, expandable partition cards with zones, and bottom action drawer.

## What this card provides

- System state header with mode summary (`away`, `night`, `disarm`, `partial`)
- Global quick actions:
  - `Tryb wyjścia` (arm away)
  - `Tryb nocny` (arm night)
  - `Wyłącz` (disarm)
- Partition list with expandable zone view (`sensor.<slug>_zone_<n>`)
- Bottom drawer for:
  - action confirmation and PIN entry
  - optional panic slider action (configurable service call)
- Uses `supported_features` to show only valid actions

## Installation (HACS)

1. Open HACS in Home Assistant.
2. Add this repository as a **Custom repository** with type **Dashboard**.
3. Install **Pulson Alarm Card**.
4. Ensure Lovelace resource exists:
   - `/hacsfiles/lovelace-pulson-alarm-demo/pulson-alarm-card-v2.js`
   - type: `JavaScript Module`
5. Hard refresh the browser (`Ctrl+F5`).

## Installation (manual)

1. Copy `pulson-alarm-card-v2.js` into Home Assistant `www` directory.
2. Add Lovelace resource:
   - URL: `/local/pulson-alarm-card-v2.js`
   - Type: `JavaScript Module`
3. Hard refresh the browser (`Ctrl+F5`).

## Card configuration

### Recommended (gateway auto-discovery)

```yaml
type: custom:pulson-alarm-card
name: Pulson Alarm
gateway_slug: pulson_security_integration_gateway
panic_service: script.pulson_panic
panic_service_data: {}
```

### With explicit seed entity

```yaml
type: custom:pulson-alarm-card
name: Pulson Alarm
gateway_slug: pulson_security_integration_gateway
entity: alarm_control_panel.pulson_security_integration_gateway_partition_1
```

### With explicit entity list

```yaml
type: custom:pulson-alarm-card
name: Pulson Alarm
entities:
  - alarm_control_panel.pulson_security_integration_gateway_partition_1
  - alarm_control_panel.pulson_security_integration_gateway_partition_2
  - alarm_control_panel.pulson_security_integration_gateway_partition_3
```

## Notes

- The card supports modern partition naming (`_partition_<n>`) and legacy variants.
- If partitions are not found, verify `gateway_slug` and entity IDs in Home Assistant.
- After each update of card JS, use hard refresh to bypass browser cache.
- `panic_service` is optional. Format: `<domain>.<service>`, e.g. `script.pulson_panic`.
