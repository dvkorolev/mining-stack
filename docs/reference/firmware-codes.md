# Справочник прошивки: коды ошибок и причины рестарта

> Collected from the `fw-reverse` offline session on 2026-10-20. The catalogue applies to the
> `.58`/`.117` firmware line; do not transfer it to `.122`/`.126` without their own binaries.
> Machine-readable companion: `firmware-codes.yaml`.

Источник: `bins/system-monitor117-live-20250811.18.bin` (DWARF enum кодов), `bins/libwhatsminer58.so` (`get_power_code_string` 0x2dcb0, таблица 0x4b8dc), `bins/btminer58.bin` (сайты причин рестарта). Линия `.58`/`.117`; на `.122`/`.126` без их бинарей не переносить.

## 1. Правило кодов БП

`код = 233 + номер бита`, где 233 = `ERROR_POWER_COMMON_STATUS`, бит = позиция в статусном слове БП.

Диапазон печатаемых кодов — **233…296** (биты 0…63). Внутри: биты **48–55** → `Power vender status1 bit%d error.`, биты **56–63** → `Power vender status2 bit%d error.`; дыры 9/19/29/32/33/43–47 → `Power Unknow error.` Индекс > 63 (код ≥ 297) → `Power Unknow error.`

⚠️ `233` = бит 0 (`OVER_TOUT0`), а не «голый статус»: различает только поле `code:` в строке. `ERROR_POWER_STATUS = 210` — другой член каталога.

## 2. Биты статусного слова

| бит | код | имя |
|---|---|---|
| 0 | 233 | OVER_TOUT0 |
| 1 | 234 | OVER_TOUT1 |
| 2 | 235 | OVER_TOUT2 |
| 3 | 236 | OVER_IOUT0 |
| 4 | 237 | OVER_IOUT1 |
| 5 | 238 | OVER_IOUT2 |
| 6 | 239 | OVER_VOUT |
| 7 | 240 | UNDER_VOUT |
| 8 | 241 | UNBALANCE_IOUT |
| 9 | 242 | — |
| 10 | 243 | OVER_TIN0 |
| 11 | 244 | OVER_TIN1 |
| 12 | 245 | OVER_TIN2 |
| 13 | 246 | OVER_IIN0 |
| 14 | 247 | OVER_IIN1 |
| 15 | 248 | OVER_VIN0 |
| 16 | 249 | OVER_VIN1 |
| 17 | 250 | UNDER_VIN0 |
| 18 | 251 | UNDER_VIN1 |
| 19 | 252 | — |
| 20 | 253 | FAN0 |
| 21 | 254 | FAN1 |
| 22 | 255 | OVER_POUT |
| 23 | 256 | OVER_PIN |
| 24 | 257 | LLC |
| 25 | 258 | WARN_3PHASE_VIN_UNBALANCE |
| 26 | 259 | ERR_3PHASE_VIN_UNBALANCE |
| 27 | 260 | WARN_3PHASE_IIN_UNBALANCE |
| 28 | 261 | ERR_3PHASE_IIN_UNBALANCE |
| 29 | 262 | — |
| 30 | 263 | WARN_XFER |
| 31 | 264 | ERROR_XFER |
| 32 | 265 | — |
| 33 | 266 | RESERVED |
| 34 | 267 | WATCHDOG_PROTECTED |
| 35 | 268 | WARN_OVER_IOUT |
| 36 | 269 | WARN_OVER_IIN |
| 37 | 270 | WARN_OVER_VIN |
| 38 | 271 | WARN_UNDER_VIN |
| 39 | 272 | WARN_OVER_POUT |
| 40 | 273 | WARN_OVER_PIN |
| 41 | 274 | WARN_FAN |
| 42 | 275 | WARN_OVER_TEMP |
| 43 | 276 | — |
| 44 | 277 | — |
| 45 | 278 | — |
| 46 | 279 | — |
| 47 | 280 | — |
| 48 | 281 | VENDER_1 |
| 49 | 282 | VENDER_1 |
| 50 | 283 | VENDER_1 |
| 51 | 284 | VENDER_1 |
| 52 | 285 | VENDER_1 |
| 53 | 286 | VENDER_1 |
| 54 | 287 | VENDER_1 |
| 55 | 288 | VENDER_1 |
| 56 | 289 | VENDER_2 |
| 57 | 290 | VENDER_2 |
| 58 | 291 | VENDER_2 |
| 59 | 292 | VENDER_2 |
| 60 | 293 | VENDER_2 |
| 61 | 294 | VENDER_2 |
| 62 | 295 | VENDER_2 |
| 63 | 296 | VENDER_2 |

## 3. Каталог кодов (161 уникальное значение; 162 члена, дубль значения 315)

| код | имя |
|---|---|
| 0 | `FT_PRETEST_PASS` |
| 20 | `ERROR_POWER_AGING_WITH_HASHBOARD` |
| 21 | `ERROR_POWER_AGING_POWERFAN` |
| 22 | `ERROR_POWER_AGING_OVER_POWER` |
| 23 | `ERROR_POWER_AGING_TEMP_OUT_RAGE` |
| 24 | `ERROR_POWER_AGING_IOUT` |
| 100 | `ERROR_FAN_UNKNOW` |
| 110 | `ERROR_FAN_DETECT_BAD` |
| 120 | `ERROR_FAN_DETECT_SPEED` |
| 130 | `ERROR_FAN_SPEED` |
| 140 | `ERROR_FAN_HIGH_PERCENT` |
| 200 | `ERROR_POWER_UNKNOW` |
| 201 | `ERROR_POWER_DETECT` |
| 202 | `ERROR_POWER_VOUT` |
| 203 | `ERROR_POWER_PROTECT` |
| 204 | `ERROR_IOUT_PROTECT` |
| 205 | `ERROR_POWER_IOUT_MUTATE` |
| 206 | `ERROR_POWER_VIN` |
| 207 | `ERROR_IIN_PROTECT` |
| 208 | `ERROR_POWER_PIN` |
| 209 | `ERROR_POWER_VOLTAGE_OFFSET` |
| 210 | `ERROR_POWER_STATUS` |
| 211 | `ERROR_POWER_IOUT` |
| 212 | `ERROR_POWER_VOUT_BORDER` |
| 213 | `ERROR_POWER_PIN_VIN_IIN` |
| 214 | `ERROR_POWER_PIN_NO_CHANGE` |
| 215 | `ERROR_POWER_VOUT_SET` |
| 216 | `ERROR_POWER_PIN_NO_CHANGE_LV2` |
| 217 | `ERROR_POWER_SET_ENABLE` |
| 218 | `ERROR_POWER_VIN_FOR_HIGH_POWER` |
| 219 | `ERROR_POWER_IIN` |
| 220 | `ERROR_POWER_TEMP` |
| 221 | `ERROR_POWER_FAN` |
| 233 | `ERROR_POWER_COMMON_STATUS` |
| 300 | `ERROR_TEMP_UNKNOW` |
| 310 | `ERROR_MASTER_ENV_TEMP_UNKNOW` |
| 311 | `ERROR_SLAVE_ENV_TEMP_UNKNOW` |
| 315 | `ERROR_INLET_TEMP_UNKNOW` |
| 320 | `ERROR_TEMP_READING` |
| 330 | `ERROR_MASTER_ENV_TEMP_READING` |
| 331 | `ERROR_SLAVE_ENV_TEMP_READING` |
| 340 | `ERROR_TEMP_LIMIT` |
| 350 | `ERROR_TEMP_PROTECT` |
| 360 | `ERROR_TEMP_OVERHEAT` |
| 370 | `ERROR_TEMP_FLUCTUATE_TOO_MUCH` |
| 380 | `ERROR_TEMP_VALUE_ABNORMAL` |
| 400 | `ERROR_EEPROM_UNKONW` |
| 410 | `ERROR_EEPROM_DETECT` |
| 420 | `ERROR_EEPROM_PARSER` |
| 430 | `ERROR_EEPROM_BIN_TYPE` |
| 440 | `ERROR_EEPROM_CHIP_NUM` |
| 450 | `ERROR_EEPROM_XFER` |
| 460 | `ERROR_EEPROM_TYPE_ERROR` |
| 500 | `ERROR_BOARD_UNKOWN` |
| 510 | `ERROR_BOARD_MINER_TYPE` |
| 520 | `ERROR_BOARD_DIFF_BIN` |
| 530 | `ERROR_BOARD_DETECT` |
| 540 | `ERROR_BOARD_CHIP_NUM` |
| 560 | `ERROR_BOARD_LOSS_BALANCE` |
| 580 | `ERROR_BOARD_RESET` |
| 590 | `ERROR_BOARD_FREQ_LOW` |
| 600 | `ERROR_ENV_TEMP_HIGH` |
| 610 | `ERROR_ENV_TEMP_HIGH_FOR_HIGH_POWER` |
| 620 | `ERROR_LIQUID_TEMP_PROTECT` |
| 650 | `ERROR_LIQUID_TEMP_LOW` |
| 651 | `ERROR_LIQUID_TEMP_HIGH` |
| 652 | `ERROR_LIQUID_TEMP_UNSTABLE` |
| 700 | `ERROR_CONTROL_BOARD_MAC` |
| 701 | `ERROR_CONTROL_BOARD_NO_SUPPORT` |
| 702 | `ERROR_CONTROL_BOARD_VERSION_UNKNOWN` |
| 703 | `ERROR_CONTROL_BOARD_CPU_NUM_ERROR` |
| 704 | `ERROR_CONTROL_BOARD_CPU_FREQ_ERROR` |
| 710 | `ERROR_CONTROL_BOARD_EXCEPTION` |
| 711 | `ERROR_EXCEPTION_AND_CPUFREQ_REDUCED` |
| 712 | `ERROR_CPUFREQ_REDUCED` |
| 714 | `ERROR_NET_UNSTABLE` |
| 715 | `ERROR_LOAD_KEYBOX` |
| 720 | `ERROR_UART_FRAME_ERROR` |
| 800 | `ERROR_BTMINER_BAD_CHECKSUM` |
| 801 | `ERROR_SYSTEM_MONITOR_BAD_CHECKSUM` |
| 802 | `ERROR_REMOTE_DAEMON_BAD_CHECKSUM` |
| 810 | `ERROR_OVERPOWER_PCBSN_CHECK` |
| 820 | `ERROR_OVERPOWER_POWERSN_CHECK` |
| 901 | `ERROR_POWER_RATE_ERROR` |
| 902 | `ERROR_UT_PIN_TOO_LOW` |
| 903 | `ERROR_DISABLE_FACTORY_MODE` |
| 910 | `ERROR_UT_COREBIST_ERROR` |
| 2000 | `ERROR_POOL_NO_CONFIG` |
| 2010 | `ERROR_POOLS_ACTIVE` |
| 2020 | `ERROR_POOL_CONNECT` |
| 2030 | `ERROR_POOL_REJECTION_RATE` |
| 2040 | `ERROR_POOL_ASICBOOST` |
| 2050 | `ERROR_POOL_CONFIG_FAILED` |
| 2060 | `ERROR_POOL_JOB` |
| 2070 | `ERROR_POOL_JOB_TOO_FREQUENT` |
| 2110 | `ERROR_FACTORY_TEST` |
| 2310 | `ERROR_HASHRATE_LOW_LV1` |
| 2320 | `ERROR_HASHRATE_LOW_LV2` |
| 2340 | `ERROR_HASHRATE_LOSS_LV1` |
| 2350 | `ERROR_HASHRATE_LOSS_LV2` |
| 3000 | `ERROR_PSU_NEED_12V` |
| 3001 | `ERROR_PSU_NEED_14V` |
| 3002 | `ERROR_PSU_NEED_24V` |
| 3003 | `ERROR_PSU_NEED_27V` |
| 3004 | `ERROR_PSU_NEED_36V` |
| 3005 | `ERROR_PSU_NEED_42V` |
| 3010 | `ERROR_VOUT_UPPER_MARGIN` |
| 3011 | `ERROR_VOUT_FLOOR_MARGIN` |
| 5010 | `ERROR_BOARD_CHIP_VOL_LOW` |
| 5020 | `ERROR_BOARD_CHIP_VOL_CHANGE` |
| 5030 | `ERROR_BOARD_CHIP_TEMP_DIFF` |
| 5040 | `ERROR_BOARD_CHIP_TEMP_HOT` |
| 5050 | `ERROR_BOARD_CHIP_TEMP_PROTECT` |
| 5060 | `ERROR_BOARD_CHIP_TEMP_HIGH` |
| 5070 | `ERROR_BOARD_ABNORMAL_WATER_VELOCITY` |
| 5080 | `ERROR_CHIP_TEMP_CALIBRATION_FAILED` |
| 5090 | `ERROR_CHIP_TEMP_CALIBRATION_CHECK` |
| 5110 | `ERROR_BOARD_UPFREQ_TIMEOUT` |
| 5130 | `ERROR_BOARD_UT_UNSTABLE` |
| 5140 | `ERROR_BOARD_RUN_UNSTABLE` |
| 5150 | `ERROR_BOARD_CHIP_TEMP_LIMIT` |
| 5400 | `ERROR_BOARD_INIT_ERROR` |
| 5410 | `ERROR_BOARD_DETECT_EXTEND` |
| 5420 | `ERROR_BOARD_BOOT_FAIL_FIRST_LINE` |
| 5430 | `ERROR_BOARD_BOOT_FAIL_NO_DATA` |
| 5440 | `ERROR_BOARD_BOOT_ALL_FAIL_NO_DATA` |
| 5450 | `ERROR_BOARD_BOOT_DETECT_BAUDRATE` |
| 5490 | `ERROR_BOARD_BOOT_FAIL` |
| 5710 | `ERROR_BOARD_CRC_ERROR_AT_TURIING` |
| 5720 | `ERROR_BOARD_CRC_ERROR` |
| 520000 | `ERROR_BOARD_CHIP_ERROR_NONCE` |
| 530000 | `ERROR_BOARD_CHIP_FEW_NONCE` |
| 540000 | `ERROR_BOARD_CHIP_TEMP_PROTECTED` |
| 550000 | `ERROR_BOARD_CHIP_RESET` |
| 560000 | `ERROR_BOARD_CHIP_ZERO_NONCE` |
| 570000 | `ERROR_BOARD_CHIP_XFER_ERROR` |
| 580000 | `ERROR_BOARD_BAD_CHIP` |
| 6000 | `ERROR_TEMP` |
| 6010 | `ERROR_TEMP_DISABLE_TOO_MANY` |
| 7000 | `ERROR_BTROM_PCB_SN` |
| 7010 | `ERROR_BTROM_PCB_SN_CRC` |
| 7020 | `ERROR_BTROM_PCB_SN_LEN` |
| 7030 | `ERROR_BTROM_DEV_TYPE` |
| 7040 | `ERROR_BTROM_DEV_TYPE_WRITE` |
| 7050 | `ERROR_BTROM_PCB_SN_WRITE` |
| 7060 | `ERROR_BTROM_PERM_AUTH` |
| 7100 | `ERROR_BTROM_AUTH_CONNECT` |
| 7110 | `ERROR_BTROM_AUTH_DATA` |
| 7120 | `ERROR_BTROM_AUTH_HASHRATE` |
| 7130 | `ERROR_BTROM_AUTH_TIMEOUT` |
| 7140 | `ERROR_BTROM_AUTH_FORCE_STOP` |
| 7200 | `ERROR_BTROM_NOT_FOUND` |
| 8410 | `ERROR_FIRMWARE_CHIP_ERROR` |
| 9000 | `ERROR_SYSTEM_MONITOR_EXIT` |
| 9010 | `ERROR_REMOTE_DAEMON_EXIT` |
| 9020 | `ERROR_API_EXIT` |
| 9030 | `ERROR_BTMINER_EXIT` |
| 9100 | `ERROR_SYSTEM_MONITOR_WATCHDOG_TIMEOUT` |
| 9110 | `ERROR_PSU_WATCHDOG_TIMEOUT` |
| 9120 | `ERROR_SLAVE_WATCHDOG_TIMEOUT` |
| 9999 | `ERROR_UNKNOW` |

## 4. Причины `btminer_restart` (12 сайтов, `btminer58`)

| сайт | причина | гейт |
|---|---|---|
| `0x41a0fc` | `no pool active` | — |
| `0x41f810` | `Failed to create bitmicro detect_env_thr` | ошибка pthread_create |
| `0x42357c` | `psu error.` | фаза загрузки > 19 |
| `0x425c94` | `Slot%d chip loss, num: %d/%.1f` | потери > 15%% чипов слота за раунд |
| `0x4262cc` | `check chip reset error, reset cnt: %d` | — |
| `0x426814` | `Failed to create bitmicro detect_env_thr` | ошибка pthread_create |
| `0x426904` | `Failed to create bitmicro detect_env_thr` | ошибка pthread_create |
| `0x427a44` | `Failed to create bitmicro detect_env_thr` | ошибка pthread_create |
| `0x44d4b8` | `Upfreq failed due to power error` | en == 0 ∨ vout <= 0 |
| `0x45707c` | `(пустая/форматная строка)` | — |
| `0x45af04` | `Upfreq failed` | upfreq_finish(arg): arg != 0 ∧ [ctx+0] != 0 |
| `0x45f900` | `failed to create upfreq thread` | ошибка pthread_create |

## 5. Снятие кодов (`remove_code`)

Группа `205/206/212/217/218` снимается вместе при подъёме БП (`remove_code(4/3, код)` в `0x41cb04…0x41cb44`). Это признак «машина поднялась», но **API-путь не установлен**: в наших артефактах наблюдался только syslog.

## 6. Ловушки строк логов

- `[212] Power vout error, reach vout border, vout: %d, border: [%d, %d]` — под именем `vout` печатается **`vout_set` (наша заявка)**, а не измеренное состояние БП. Границы — per-machine `voltage_target/limit`, не константа прошивки.

- `[205] Power output current error, iout now: %.2fA, last: %.2fA` — печатает `last`, порога в строке нет.

- `Attempting to restart %s` — общий лог, не имя ветки.

