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
        self.assertEqual(boards['2'], {'temp': 76.0, 'chip_temp': 97.15})
        # The distinction the metric split exists for: on this board the chip
        # runs 21 C hotter than the PCB, and the alerts watch the cooler one.
        self.assertGreater(boards['2']['chip_temp'], boards['2']['temp'] + 20)

    def test_slot_is_the_position_in_devs(self):
        boards = boards_from_devs(DEVS_WITH_CHIP_TEMP)

        self.assertEqual(boards['0']['temp'], 67.06)
        self.assertEqual(boards['1']['temp'], 70.06)

    def test_a_firmware_without_chip_temp_still_contributes_its_board_temp(self):
        boards = boards_from_devs(DEVS_WITHOUT_CHIP_TEMP)

        self.assertEqual(boards['0'], {'temp': 69.12})
        self.assertEqual(boards['1'], {'temp': 60.44})
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
