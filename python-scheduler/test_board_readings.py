"""
Unit tests for parsers/board_readings.py.

DMI-64: per-board readings come from the CGMiner `devs` response, which is the
only source that answers for most of this fleet. The shapes below are real
responses captured from the farm on 2026-08-14, not invented ones.

Run standalone (no pytest, no pyasic needed):
    python python-scheduler/test_board_readings.py
"""

import unittest

from parsers.board_readings import boards_from_devs, optional_float

# 192.168.2.65, firmware 20241108.22.Rel. Note the third board: the chip
# temperature is 21 C above the board temperature, and it is the board figure
# that miner_temp_max_c reports.
DEVS_WITH_CHIP_TEMP = {
    'STATUS': [{'STATUS': 'S'}],
    'DEVS': [
        {'ASC': 0, 'Temperature': 67.06, 'Chip Temp Min': 67.73,
         'Chip Temp Max': 83.54, 'Chip Temp Avg': 76.62, 'Effective Chips': 78},
        {'ASC': 1, 'Temperature': 70.06, 'Chip Temp Min': 70.4,
         'Chip Temp Max': 87.96, 'Chip Temp Avg': 79.27, 'Effective Chips': 78},
        {'ASC': 2, 'Temperature': 76.0, 'Chip Temp Min': 77.9,
         'Chip Temp Max': 97.15, 'Chip Temp Avg': 87.63, 'Effective Chips': 78},
    ],
}

# 192.168.2.53, firmware 20250321.14.Rel — reports board temperature but no
# chip temperature at all. Five machines on the farm behave this way.
DEVS_WITHOUT_CHIP_TEMP = {
    'DEVS': [
        {'ASC': 0, 'Temperature': 69.12, 'Chip Temp Max': None, 'Effective Chips': 70},
        {'ASC': 1, 'Temperature': 60.44, 'Effective Chips': 70},
    ],
}


class BoardsFromDevsTest(unittest.TestCase):
    def test_reads_both_temperatures_and_keeps_them_apart(self):
        boards = boards_from_devs(DEVS_WITH_CHIP_TEMP)

        self.assertEqual(sorted(boards), ['0', '1', '2'])
        # `chips` joined the record on 2026-08-29: these fixtures are real
        # devs responses and always carried Effective Chips; the parser simply
        # did not read it, which left MinerMissingChips able to evaluate one
        # machine out of 21.
        self.assertEqual(boards['2'], {'temp': 76.0, 'chip_temp': 97.15, 'chips': 78.0})
        # The distinction the metric split exists for: on this board the chip
        # runs 21 C hotter than the PCB, and the alerts watch the cooler one.
        self.assertGreater(boards['2']['chip_temp'], boards['2']['temp'] + 20)

    def test_slot_is_the_position_in_devs(self):
        boards = boards_from_devs(DEVS_WITH_CHIP_TEMP)

        self.assertEqual(boards['0']['temp'], 67.06)
        self.assertEqual(boards['1']['temp'], 70.06)

    def test_a_firmware_without_chip_temp_still_contributes_its_board_temp(self):
        boards = boards_from_devs(DEVS_WITHOUT_CHIP_TEMP)

        self.assertEqual(boards['0'], {'temp': 69.12, 'chips': 70.0})
        self.assertEqual(boards['1'], {'temp': 60.44, 'chips': 70.0})
        # Absent is not zero: no chip_temp key at all, rather than a cold 0.
        self.assertNotIn('chip_temp', boards['0'])

    def test_a_board_that_reports_nothing_usable_produces_no_record(self):
        self.assertEqual(boards_from_devs({'DEVS': [{'ASC': 0}]}), {})
        self.assertEqual(boards_from_devs({'DEVS': [{'Temperature': None}]}), {})

    def test_missing_and_malformed_responses_are_safe(self):
        for payload in (None, {}, {'DEVS': None}, {'DEVS': []}, {'STATUS': []}):
            self.assertEqual(boards_from_devs(payload), {})

    def test_junk_entries_are_skipped_not_raised(self):
        # A miner that answers with something unexpected must not abort the
        # collection cycle -- that failure mode cost months in DMI-54.
        boards = boards_from_devs({'DEVS': [None, 'nonsense', 42,
                                            {'Temperature': 70.0}]})

        self.assertEqual(boards, {'3': {'temp': 70.0}})


class OptionalFloatTest(unittest.TestCase):
    def test_numbers_parse(self):
        self.assertEqual(optional_float(97.15), 97.15)
        self.assertEqual(optional_float(78), 78.0)
        self.assertEqual(optional_float('83.54'), 83.54)

    def test_a_real_zero_survives(self):
        # 0 C is implausible for a hashboard but the parser must not decide
        # that; only "not reported" becomes None.
        self.assertEqual(optional_float(0), 0.0)

    def test_unreported_and_unparseable_become_none(self):
        for value in (None, '', 'n/a', '--', [], {}, True, False):
            self.assertIsNone(optional_float(value))


if __name__ == '__main__':
    unittest.main(verbosity=2)


# ---------------------------------------------------------------------------
# Effective Chips, per-board hashrate and the unit problem (2026-08-29).
# ---------------------------------------------------------------------------

class TestChipsAndHashrate(unittest.TestCase):
    """
    `MHS av` does not carry a consistent unit across this fleet's firmware.
    Real readings, all taken on 2026-08-29:

        .101 (2024 fw)   MHS av = 34333778.28,  Factory GHS = 33231
        .70  (2025 fw)   MHS av =       37.26,  Factory GHS = 36346
        .121 (M60)       MHS av =       57.85,  Factory GHS = 58402

    Reading it as MH/s everywhere made five machines sum to 0.00 per board
    while reporting 110-176 TH/s at the machine level.
    """

    def dev(self, **kw):
        base = {'Temperature': 70.0, 'Chip Temp Max': 92.0}
        base.update(kw)
        return {'DEVS': [base]}

    def test_mhs_when_the_field_really_is_mhs(self):
        b = boards_from_devs(self.dev(**{'MHS av': 34333778.28, 'Factory GHS': 33231}))
        self.assertAlmostEqual(b['0']['hashrate'], 34.33377828, places=5)

    def test_ths_when_the_field_is_already_ths(self):
        b = boards_from_devs(self.dev(**{'MHS av': 37.26, 'Factory GHS': 36346}))
        self.assertAlmostEqual(b['0']['hashrate'], 37.26, places=5)

    def test_m60_shape(self):
        b = boards_from_devs(self.dev(**{'MHS av': 57.85, 'Factory GHS': 58402}))
        self.assertAlmostEqual(b['0']['hashrate'], 57.85, places=5)

    def test_a_reported_zero_hashrate_is_published(self):
        # A board producing nothing is a fact worth publishing, unlike a
        # fabricated zero (DMI-62).
        b = boards_from_devs(self.dev(**{'MHS av': 0, 'Factory GHS': 33231}))
        self.assertEqual(b['0']['hashrate'], 0.0)

    def test_absent_hashrate_stays_absent(self):
        b = boards_from_devs(self.dev(**{'Factory GHS': 33231}))
        self.assertNotIn('hashrate', b['0'])

    def test_implausible_against_the_rating_publishes_nothing(self):
        # Neither TH/s nor MH/s lands near the board's own rating, so rather
        # than feed a degradation alert a figure off by orders of magnitude,
        # publish none.
        b = boards_from_devs(self.dev(**{'MHS av': 5_000_000_000_000, 'Factory GHS': 33231}))
        self.assertNotIn('hashrate', b['0'])

    def test_magnitude_fallback_without_a_rating(self):
        big = boards_from_devs(self.dev(**{'MHS av': 34333778.28}))
        self.assertAlmostEqual(big['0']['hashrate'], 34.33377828, places=5)
        small = boards_from_devs(self.dev(**{'MHS av': 37.26}))
        self.assertAlmostEqual(small['0']['hashrate'], 37.26, places=5)

    def test_mhs_5s_is_never_used(self):
        # DMI-75: published from a 5-second window, over-reported by 3-4x.
        b = boards_from_devs(self.dev(**{'MHS 5s': 99.0, 'Factory GHS': 33231}))
        self.assertNotIn('hashrate', b['0'])

    def test_effective_chips_is_read(self):
        b = boards_from_devs(self.dev(**{'Effective Chips': 78}))
        self.assertEqual(b['0']['chips'], 78.0)

    def test_reported_zero_chips_is_published(self):
        # .58 answers 0 on every board. That is the fault the metric exists for.
        b = boards_from_devs(self.dev(**{'Effective Chips': 0}))
        self.assertEqual(b['0']['chips'], 0.0)

    def test_factory_ghs_becomes_the_board_rating(self):
        b = boards_from_devs(self.dev(**{'Factory GHS': 33231}))
        self.assertAlmostEqual(b['0']['rated'], 33.231, places=3)

    def test_undetermined_rating_is_absent_not_zero(self):
        # .98 answers 0 here, matching the -1:-1:-1 it gives over API v3.
        for value in (0, -1, None):
            b = boards_from_devs(self.dev(**{'Factory GHS': value, 'Temperature': 70.0}))
            self.assertNotIn('rated', b['0'], value)

    def test_board_sums_match_the_machine(self):
        # .101 as measured: three boards summing to the machine's own 103.11.
        devs = {'DEVS': [
            {'MHS av': 34333778.28, 'Factory GHS': 33231},
            {'MHS av': 33542882.90, 'Factory GHS': 34095},
            {'MHS av': 35230121.22, 'Factory GHS': 34306},
        ]}
        b = boards_from_devs(devs)
        total = sum(v['hashrate'] for v in b.values())
        self.assertAlmostEqual(total, 103.10678240, places=4)
        rated = sum(v['rated'] for v in b.values())
        self.assertAlmostEqual(rated, 101.632, places=3)  # == its v3 detect-hash-rate
