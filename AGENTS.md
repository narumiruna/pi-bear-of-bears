# Repository guidance

## Boundaries

- Use manual gameplay only; do not start or restart idle mode through `/idle`, `掛機`, bot buttons, or any equivalent action.
- Do not indirectly start idle mode through character switching or other side effects.
- If idle mode is already active, stop and settle it with `/stopidle`, confirm the outcome, and do not restart it.
- Optimize EXP per elapsed wall-clock minute within the manual-only constraint; include movement, equipment changes and recovery time.
- Do not use hooks, scripts or background loops to bypass the idle-mode prohibition or gameplay action limits.
