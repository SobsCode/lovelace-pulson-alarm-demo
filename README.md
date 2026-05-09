# Pulson Alarm Card

`pulson-alarm-card` is a modern Lovelace card for Home Assistant designed for the Pulson integration (`pulson_security_integration_gateway`).

The interface is rebuilt from scratch with a mobile-first, premium dark design inspired by streaming apps, while keeping alarm-system safety and clarity as the top priority.

## What this card provides

- Hero security state (safe / armed / alarm)
- Gateway health status (panel online, bridge online, service mode)
- Active fault summary (from Pulson trouble sensors)
- Multi-partition selection (up to 8 partitions)
- Dynamic actions based on partition state and features:
  - Arm Away
  - Arm Home
  - Arm Night
  - Disarm
- Secure two-step flow:
  1. choose action
  2. enter PIN and confirm
- Action feedback with:
  - `last_partition_command_status`
  - `last_partition_code_valid`

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
