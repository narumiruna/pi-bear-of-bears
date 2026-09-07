# Verified manual-play notes

These are historical observations, not current state or authorization. Recheck live HP, MP, enemies, exits and equipment before acting. Message IDs refer to @BearOfBearsBot history. Do not infer spawn times, drop rates or a route to Lv170 from these samples.

## Combat: early 法熊

- `/consider` explicitly estimates ordinary attacks, not spell damage (617391, 617399). Do not spend a normal attack merely to start combat when a known spell can safely finish a visible enemy.
- `/skill 蜂蜜火球` successfully initiated combat outside an existing fight (617365, 617387, 617393). Target-selection rules for mixed enemy rooms remain unverified; use only when all possible targets have been assessed as safe.
- At Lv17, INT82, DEF36, a 20MP 蜂蜜火球 killed each of these without a reported counterattack:

| Enemy | HP | Observed damage | EXP | Evidence |
| --- | --- | --- | --- | --- |
| 鎧甲烏龜 Lv11 | 120 | 198 | 72 | 617387 |
| 荊棘藤妖 Lv15 | 160 | 194, 199 | 108 each | 617393, 617395 |
| 活甲冑 Lv16 | 170 | 194 | 110 | 617401 |

- At INT79, 疾風隼 Lv12 (110HP) took 193–194 spell damage and awarded 88 EXP (617359, 617365). These are samples, not guaranteed minimum damage.
- Cleared 螢石廊 and 晶簇洞 were still empty on the immediate return trip (617403, 617405). Movement does not guarantee respawns; inspect before casting again.

## Research timing

617861–617877: boar plus sealed-room armor/two hunters, 490 EXP, six fireballs (120MP), HP loss9 at DEF49. End state 617879; no recovery yet, so not a completed recovery-inclusive benchmark. Each hunter two fireballs, lost5/4 HP (617871/617875); no need for an automatic retreat after only one hunter when live reserves remain sufficient.

617815–617835: east forest loop via 菌絲迷道→幽光菇徑→孢子林→霉紋深林→station: 163 EXP in 70s (139.71 EXP/min), includes gear change, four kills, 84MP. Low-reward detour; do not prefer for leveling over cave samples. 秘法連射 (617821) stopped after first 77-damage hit killed one 50HP mushroom, did not chain onto second visible mushroom (subsequently killed 617823). Do not interpret help's 群怪 wording as verified room AOE. Dropped/equipped 精良青銅護手 (617823/617825), ATK+3 DEF+3 with no INT loss.

617773–617789: 蜜香驛站 east→霉紋深林 (浣熊武士 65 EXP), south→腐木林 (two 疾風隼, 88 each), west→晶簇洞 (turtle 72), north→station. 313 EXP in 53 seconds including four fireballs, free recovery and equipping dropped 傳世青銅戰靴. Boots improved DEF44→46 and AGI13→18 without INT loss (617777/617791). Alternate route, not proven superior; equipment change and different level confound comparison.

617750–617769: cave out-and-back, 398 EXP in 62 seconds including movement/recovery (385.16 EXP/min). Including preceding and final status timestamps 617749–617771: 121 seconds (197.36 EXP/min). Different timing scopes cannot be compared directly. This sample crossed Lv18→19. Research playbook: `.auto/prompt.md`; native experiment tools unavailable, no automated gameplay started.

## Equipment

- Correction (617729, 617731, 617749): equipped 青銅戰靴 and 青銅頭盔 improve DEF37→43 and AGI10→13 without losing INT85. No reason to defer these direct slot upgrades just because they lack INT.
- Two fireballs per hunter tested at DEF43 (617735–617741): 40MP and two actions per kill, 160 EXP each, only 8 and 5 HP lost respectively. Faster action count than fireball plus two ordinary attacks; compare full recovery-inclusive routes before declaring optimal.

- 青銅星環 and 青銅護符 compete for the same accessory slot, despite different icons (617379).
- The inspected ordinary 青銅星環 would change ATK +3, DEF -1, INT -3 versus the equipped 青銅護符. Retained the amulet for spell damage and defense. Reinspect other rolled items rather than generalizing from the name.
- Equipment changes can reorder inventory (617375, 617377). Refresh indices before another numbered command; inspected names can avoid stale indices.

## Verified routes and healing

- Entering 蜜香驛站 restored HP/MP fully without a purchase or `/rest` (617373, 617407). Final status confirmed 202/202 HP and 228/228 MP with no healing expense (617409).
- Confirmed route: 蜜香驛站 → south 晶簇洞 → south 螢石廊 → west 回聲地穴. Return: east, north, north. Confirm each exit again during travel.
- Other observed return route: 巨傘蕈叢 → west 幽光菇徑 → south 菌絲迷道 → west 霉紋深林 → west 蜜香驛站 (617367–617373).
- 巨傘蕈叢 had Lv12 enemies, but its eastern neighbor 雷紋台地 had 雷羽鷹群 Lv185 (617361). Adjacent rooms need not have similar difficulty. Retreated without fighting; do not use this eastern exit as an assumed low-level progression route.

## Latest checkpoint

At message 617879: 法熊 Lv19, EXP 1877/5500, HP207/216, MP124/244, ATK31, DEF49, INT88, AGI18, coins10729, location 封印石室. Manual-only session since 617409 earned 6746 EXP and 2422 coins, reached Lv18 at 617435, and repeatedly used the safe-room loop around 蜜香驛站 for free full recovery; no idle mode, purchases, sales or advancement.

## 2026-09-07 manual leveling observations

- With Lv17–18 法熊, equipped INT-focused gear stayed best among observed inventory: 精良粗木法杖 (INT+7), 青銅護符 (INT+7/DEF+3/AGI+2), basic armor pieces. Inventory 617411 had no higher-INT usable replacement; 青銅星環 would be lower INT than 青銅護符 based on previous inspection.
- 蜂蜜火球 remained the fastest verified kill method: 20 MP, one-shot on Lv2 小蜜蜂 (15 EXP) and Lv5 黑熊盜賊 (38 EXP), no counterattack when one-shot from neutral state (617417, 617425, 617427, 617443, 617454, 617456, 617462). Starting a black-bear fight with normal attack caused only 1 HP damage taken, then spell finished it (617446–617448); prefer direct spell when MP is available.
- Very low-level grassland loop near 蜜香驛站 is safe but low EXP/min versus verified Lv15–16 cave targets. Use it mainly to finish a near-complete level or while waiting for safer higher-EXP rooms to repopulate. 草原野豬 Lv8 one-shots for 60 EXP (617490), still below cave EXP but adjacent to free healing.
- Promising one-shot route (not proven globally optimal EXP/min) at Lv18 is the cave route from 蜜香驛站 → south 晶簇洞 → south 螢石廊 → west 回聲地穴, casting 蜂蜜火球 on 鎧甲烏龜 (72 EXP, 617474/617543/617635/617673/617705), two 荊棘藤妖 (108+108 EXP, 617478/617480, 617549/617551, 617639/617641, 617677/617679, 617709/617711), and 活甲冑 (110 EXP, 617484/617555/617645/617683/617715), then returning through 暖陽坡→蜂鳴花海→蜜香驛站 or backtracking for free MP recovery. All cave kills took one spell each and no damage in these samples.
- Confirmed recovery from 金穗丘 south to 蜜香驛站 (617466, status 617468) and from 蜂鳴花海 east to 蜜香驛站 (617492, status 617494; 617535, status 617539): entering restores HP/MP fully for free. Current route options from 蜜香驛站: north 金穗丘, west 蜂鳴花海, south 晶簇洞, east 霉紋深林; inspect before pushing deeper because neighboring room difficulty can vary sharply.
- 封印石室 at Lv18 had two 人類獵人 Lv20 and one 活甲冑 Lv16 (617508). `/consider` rated hunters 有把握 (617510). 人類獵人 awards 160 EXP but has 240 HP: one 蜂蜜火球 plus physical cleanup caused 20–42 HP damage taken depending on opening sequence (617511–617515, 617523–617527, 617619–617623, 617657–617661, 617689–617693). This is higher EXP per monster than cave one-shots but requires a short trip back to 蜜香驛站 after one or two hunters; use when full HP/MP and escape route east→north→east is open.
- Inventory 617537 after drops still had no better INT equipment than equipped 精良粗木法杖 + 青銅護符. Newly dropped 青銅巨劍 and 精良青銅戰斧 are physical/DEF options, not preferred for current fireball farming. 青銅戰靴 drop from 鎧甲烏龜 (617573) gives AGI/DEF but no INT; consider inspecting/equipping only if survivability becomes limiting.
- Respawn timing matters: on the 617571–617577 pass, 晶簇洞 turtle had respawned but 螢石廊 and 回聲地穴 were still empty; later at 617597–617607, 螢石廊 and 回聲地穴 had respawned while 晶簇洞 was empty. If high-EXP cave rooms are empty, route onward to 封印石室 for hunters/活甲冑 or return via 蜂鳴花海 to reset/heal rather than waiting in place.
