# xr-development

Design and build extended reality (AR/VR/MR) experiences — 3D interaction, spatial computing, headset development, immersive UX — with performance, comfort, and accessibility as first-class concerns.

## Goals
- Design immersive 3D interfaces that are comfortable and safe
- Choose the right XR paradigm (pass-through AR, VR, MR)
- Plan for performance (frame rate, latency, power)
- Design for accessibility and inclusive XR

## Contract

### Input
An XR experience to design: use case, target device, interaction needs.

### Output
An XR design document with:
- Paradigm selection (AR/VR/MR)
- 3D interaction model (gaze, hand, controller)
- Technical constraints (frame rate, latency, power)
- Accessibility considerations

## Paradigms

| Paradigm | Environment | Key challenges | Devices |
|---|---|---|---|
| VR | Fully synthetic | Presence, comfort, locomotion | Quest, Vive, PSVR |
| AR | Real + overlay | Occlusion, registration, FOV | HoloLens, ARKit, ARCore |
| MR | Anchored to world | Spatial anchors, persistence | Magic Leap |

## 3D Interaction Model

| Input | Best for | Trade-offs |
|---|---|---|
| Gaze + dwell | Hands-free, accessibility | Slow, imprecise |
| Controller | Precise, haptic feedback | Learn curve, physical fatigue |
| Hand tracking | Natural, no controller | Occlusion, tracking loss |
| Eye tracking | Foveated rendering, input | Calibration, privacy |

## Performance Targets

| Metric | Target | Why |
|---|---|---|
| Frame rate | 72–120 FPS (VR), 30+ FPS (AR) | Comfort, presence |
| Motion-to-photon latency | <20 ms | Avoid motion sickness |
| Power budget | 5–15 W | Thermal, battery |

## Steps

1. **Choose paradigm** — VR, AR, or MR based on use case
2. **Select target device(s)** — SDK (Unity, Unreal, WebXR, native)
3. **Design 3D interaction** — how users see, move, and act
4. **Plan spatial UX** — comfort, safe areas, locomotion
5. **Optimize performance** — foveated rendering, level of detail
6. **Test for comfort** — locomotion sickness, FOV, ergonomics
7. **Add accessibility** — subtitle, audio cues, seated mode

## References
- `../../ux/ux-research/SKILL.md` — user research for XR
- `../../ux/interaction-design/SKILL.md` — interaction patterns
- `../../accessibility/accessibility/SKILL.md` — inclusive XR
