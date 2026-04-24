# Pulson Alarm Card

`pulson-alarm-card` is a custom Lovelace card for Home Assistant that provides a modern alarm interface for an `alarm_control_panel` entity.

## Features

- Clear alarm state header (`Rozbrojony`, `Uzbrojony`, `Alarm uruchomiony`, etc.)
- Secure PIN entry via numeric keypad (`0-9`, clear)
- Action buttons:
  - `Uzbroj` (arm away)
  - `Uzbroj w domu` (arm home)
  - `Rozbroj` (disarm)
- Calls Home Assistant alarm services with PIN code
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

```yaml
type: custom:pulson-alarm-card
entity: alarm_control_panel.your_alarm_entity
name: Alarm
```

## Notes

- The `entity` option is required.
- The PIN input is cleared automatically after every action call.
