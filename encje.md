# Gotowiec: encje tak jak zwykle widać je w HA

Zakładając domyślną nazwę urządzenia: **Pulson Security Integration Gateway**  
(slug w `entity_id`: `pulson_security_integration_gateway`)

## Encje stałe

### Binary sensor

- `binary_sensor.pulson_security_integration_gateway_panel_online`
- `binary_sensor.pulson_security_integration_gateway_bridge_online`

### Sensor

- `sensor.pulson_security_integration_gateway_panel_version`
- `sensor.pulson_security_integration_gateway_panel_language`
- `sensor.pulson_security_integration_gateway_panel_time`
- `sensor.pulson_security_integration_gateway_panel_uptime_s`
- `sensor.pulson_security_integration_gateway_panel_build_timestamp`
- `sensor.pulson_security_integration_gateway_panel_serial_number`
- `sensor.pulson_security_integration_gateway_panel_programming_now`
- `sensor.pulson_security_integration_gateway_service_mode_on`
- `sensor.pulson_security_integration_gateway_service_mode_up_to`
- `sensor.pulson_security_integration_gateway_last_partition_command_status`
- `sensor.pulson_security_integration_gateway_last_partition_code_valid`
- `sensor.pulson_security_integration_gateway_any_fault`
- `sensor.pulson_security_integration_gateway_user_code_mode` — stan `ui` (PIN na karcie) lub `backend` (kod po stronie integracji, bez klawiatury na karcie)

### Text

- `text.pulson_security_integration_gateway_partition_multi_command`

### Button

- `button.pulson_security_integration_gateway_system_restart` _(jeśli restart jest włączony)_

## Usterki (18)

- `binary_sensor.pulson_security_integration_gateway_ac_loss_230v`
- `binary_sensor.pulson_security_integration_gateway_low_battery`
- `binary_sensor.pulson_security_integration_gateway_battery_missing`
- `binary_sensor.pulson_security_integration_gateway_bell_trouble`
- `binary_sensor.pulson_security_integration_gateway_service_required`
- `binary_sensor.pulson_security_integration_gateway_false_code`
- `binary_sensor.pulson_security_integration_gateway_aux1_problem`
- `binary_sensor.pulson_security_integration_gateway_aux2_problem`
- `binary_sensor.pulson_security_integration_gateway_bus_voltage_trouble`
- `binary_sensor.pulson_security_integration_gateway_bus_communication_problem`
- `binary_sensor.pulson_security_integration_gateway_ats_communication_problem`
- `binary_sensor.pulson_security_integration_gateway_zone_fault`
- `binary_sensor.pulson_security_integration_gateway_time_trouble`
- `binary_sensor.pulson_security_integration_gateway_gsm_coverage_trouble`
- `binary_sensor.pulson_security_integration_gateway_gprs_coverage_trouble`
- `binary_sensor.pulson_security_integration_gateway_tamper_trouble`
- `binary_sensor.pulson_security_integration_gateway_lan_trouble`
- `binary_sensor.pulson_security_integration_gateway_no_activity_trouble`

## Dynamiczne (pojawiają się w trakcie pracy)

### Partycje

- `alarm_control_panel.pulson_security_integration_gateway_<nazwa_partycji_lub_partition_n>`
- `sensor.pulson_security_integration_gateway_partition_<n>_ready`

### Wyjścia

- `switch.pulson_security_integration_gateway_<nazwa_wyjscia_lub_output_n>`

### Linie

- `sensor.pulson_security_integration_gateway_zone_<n>`
