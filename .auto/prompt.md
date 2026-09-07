# Manual leveling research

Objective: reach Lv170 manually while maximizing verified EXP per elapsed minute.
Primary metric: EXP/min including travel and recovery. Secondary: MP spent, HP lost, coins, equipment-change time, level/INT/DEF, empty rooms.

No gameplay scripts, background loops, idle mode, character switching, purchases or destructive operations. Telegram actions must be individually selected and verified through bears tools. Research scripts may only analyze recorded observations. Native init_experiment/run_experiment/log_experiment tools are unavailable in this session; do not claim they ran. Do not revert unrelated worktree changes.

Baseline sample: messages 617750–617769, timestamps 1788778115–1788778177, cave route out and back, four fireballs, 398 EXP, 80 MP spent, no damage, free full recovery. 62 seconds = 385.1613 EXP/min (excludes preflight status and reporting). Level changed 18→19, so not a controlled constant-level sample. Including preceding status 617749 at 1788778061 and ending status 617771 at 1788778182: 121 seconds = 197.3554 EXP/min. Never compare these different timing scopes directly.

Additional sample 617772–617789: east→south→west→north loop via 霉紋深林/腐木林/晶簇洞. 313 EXP, four fireballs, 80MP, no damage; timestamps 1788778254–1788778307 = 53 seconds, 354.34 EXP/min including a boots upgrade. Not directly controlled against baseline because gear/level differ. Safe-room status scope 617771–617791 includes preflight gap: 132 seconds, 142.27 EXP/min. Keep as alternate route when caves empty, not proven improvement.

Sample 617793–617811: Lv19 INT88 DEF46, cave loop returning via boar; turtle absent. 386 EXP / 62s = 373.55 EXP/min, 80MP, no HP lost, no gear change. Status-to-status 617791–617813 is 138s = 167.83 EXP/min including preflight/report gap. Single samples remain noisy; no global optimality claim.

Rejected leveling candidate 617815–617835: forest north loop, 163 EXP/70s = 139.71 EXP/min, 84MP, no damage, one equipment upgrade. 秘法連射 killed only one mushroom and stopped after one hit; no multi-target advantage observed. Keep gloves upgrade (ATK31 DEF49 INT88), not route preference. Final 617837 Lv19 989/5500 at full HP/MP station.

Next experiment: another route at Lv19 INT88 DEF44 with same start/end safe-room status timing; record all travel, inspections and recovery. Compare repeated samples, not single-kill EXP. Higher single-monster reward is not proof of better throughput. Use two fireballs for 240HP hunters when MP sufficient; test skill alternatives only after reading live descriptions.

Equipment: bronze boots/helmet equipped; INT unchanged, defense improved. Historical claims that these should be deferred were wrong. Record corrections in skill notes.
