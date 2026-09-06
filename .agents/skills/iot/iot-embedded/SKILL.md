# iot-embedded

Design embedded/IoT systems — firmware, sensors, edge computing, device connectivity, OTA updates — with reliability, security, and constrained resource awareness.

## Goals
- Design for constrained hardware (RAM, CPU, power)
- Plan secure device communication and firmware updates
- Define edge vs. cloud processing split
- Ensure observability of distributed devices

## Contract

### Input
An IoT system to design: device type, connectivity, processing requirements.

### Output
An IoT architecture with:
- Device hardware profile and constraints
- Communication protocol (MQTT, CoAP, HTTP)
- Edge/cloud processing split
- Security model and update strategy

## Device Constraints

| Resource | Microcontroller | Edge Device | Edge Server |
|---|---|---|---|
| RAM | 2–512 KB | 256 MB–2 GB | 4–64 GB |
| Storage | 16 KB–8 MB | 8–256 GB | 100 GB+ |
| Power | Battery/solar | Plugged | Plugged |
| Connectivity | LoRa, BLE, WiFi | WiFi/Cellular | Ethernet |

## Steps

1. **Profile the device** — understand constraints upfront
2. **Choose communication protocol** — MQTT (pub/sub), CoAP (constrained), HTTP (request/response)
3. **Split processing** — edge (real-time, low latency) vs. cloud (batch, storage)
4. **Design the protocol** — message schemas, QoS, retain, last-will
5. **Plan OTA updates** — secure boot, delta updates, rollback
6. **Add observability** — device health, connectivity, firmware version

## Security Checklist

- [ ] Secure boot with signed firmware
- [ ] TLS/DTLS for data in transit
- [ ] Device authentication (certificates or keys)
- [ ] OTA updates with rollback capability
- [ ] No hardcoded credentials

## References
- `../../networking/networking/SKILL.md` — network protocols
- `../../sec/sec-cryptography-applied/SKILL.md` — device security
- `../../platform/monitoring-alerting/SKILL.md` — device observability
