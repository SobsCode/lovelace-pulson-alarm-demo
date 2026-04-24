# Pulson Alarm Card

`pulson-alarm-card` is a custom Lovelace card for Home Assistant that provides a modern alarm interface for one or multiple `alarm_control_panel` entities (up to 8 partitions).

## Features

- Modern hero header with active partition and state
- Live status overview for available partitions (up to 8)
- Automatic partition discovery for entities named like `..._p1` to `..._p8`
- Secure PIN entry via numeric keypad (`0-9`, clear)
- Action buttons:
  - `Uzbroj` (arm away)
  - `Uzbroj w domu` (arm home)
  - `Rozbroj` (disarm)
- Calls Home Assistant alarm services with PIN code for selected partition
- Fully theme-friendly styling using standard HA CSS variables

## HACS Installation

1. Open HACS in Home Assistant.
2. Add this repository as a **Custom repository** of type **Dashboard**.
3. Install **Pulson Alarm Card**.
4. Restart Home Assistant (or reload frontend resources if needed).

After installation, add the resource if HACS does not add it automatically:

`/hacsfiles/lovelace-pulson-alarm-demo/pulson-alarm-card.js`

Resource type: `JavaScript Module`

## Manual Installation

1. Copy `pulson-alarm-card.js` to your Home Assistant `www` folder.
2. Add a Lovelace resource:
   - URL: `/local/pulson-alarm-card.js`
   - Type: `JavaScript Module`

## Card Configuration

Single seed entity (auto-discover sibling partitions `p1...p8`):

```yaml
type: custom:pulson-alarm-card
entity: alarm_control_panel.pulson_central_pulson_alarm_p1
name: Alarm
```

Manual list of entities (only configured and available ones are shown):

```yaml
type: custom:pulson-alarm-card
name: Alarm
entities:
  - alarm_control_panel.pulson_central_pulson_alarm_p1
  - alarm_control_panel.pulson_central_pulson_alarm_p2
  - alarm_control_panel.pulson_central_pulson_alarm_p3
```

## Notes

- Provide either `entity` or `entities`.
- Only domain `alarm_control_panel` is supported.
- The PIN input is cleared automatically after every action call.
