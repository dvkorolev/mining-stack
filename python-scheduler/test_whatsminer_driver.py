"""
Unit tests for asic/drivers/whatsminer.py and its transport.

DMI-136: the driver reads a real machine's captured responses through a fake
4028 server in-process, so the test covers the actual request/response path
(socket, framing, JSON, mapping) and not just a mapping function. The fixtures
are the same live captures the parity tests use — `.101` is SUMMARY-shaped,
`.53` is Msg-shaped, `.74` is the one machine whose `devs` pyasic can parse.

What these tests cannot do is prove the published values are unchanged on the
fleet: that needs both paths running against the same machines (the parallel
comparison) and is reported separately.

Run standalone (no pytest, no pyasic, no network):
    python python-scheduler/test_whatsminer_driver.py
"""

import asyncio
import json
import os
import unittest

from asic.drivers import whatsminer
from asic.transport import json_tcp

FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'parsers', 'fixtures')

# A response cut off mid-string, the shape `.74`'s `pools` arrives in every
# cycle (1228 bytes, the array never closes).
TRUNCATED_POOLS = (
    '{"STATUS":[{"STATUS":"S","Msg":"3 Pool(s)"}],"POOLS":[{"POOL":1,'
    '"URL":"stratum+tcp://pool.example:3333","User":"worker","Status":"Alive",'
    '"Accepted":5444,"Rejected":15,"Difficulty Stale":0.0,"Last Share Dif'
)


def fixture(name: str) -> dict:
    with open(os.path.join(FIXTURES, name)) as handle:
        return json.load(handle)


class FakeMiner:
    """A 4028 server that answers from a dict of raw responses."""

    def __init__(self, responses):
        self.responses = responses
        self.server = None
        self.port = None
        self.commands = []

    async def start(self, silent: bool = False):
        async def handle(reader, writer):
            try:
                raw = await asyncio.wait_for(reader.read(4096), timeout=5)
                if silent:
                    await asyncio.sleep(30)
                    return
                try:
                    command = json.loads(raw.decode().strip('\x00').strip())['command']
                except Exception:  # noqa: BLE001
                    command = None
                self.commands.append(command)
                body = self.responses.get(command)
                if body is None:
                    writer.write(b'{"STATUS":"E","Msg":"invalid cmd"}')
                else:
                    writer.write(body.encode())
                await writer.drain()
            except Exception:  # noqa: BLE001
                pass
            finally:
                writer.close()

        self.server = await asyncio.start_server(handle, '127.0.0.1', 0)
        self.port = self.server.sockets[0].getsockname()[1]

    async def stop(self):
        self.server.close()
        await self.server.wait_closed()


def raw_responses(fx: dict) -> dict:
    responses = {}
    for command in ('summary', 'devs', 'pools', 'status', 'get_miner_info',
                    'get_error_code', 'get_psu'):
        value = fx.get(command)
        if value is not None:
            responses[command] = json.dumps(value)
    return responses


def read_through_server(responses: dict, model: str, silent: bool = False):
    """
    Run one driver read against a fake miner, all inside one event loop.

    A server started with one `asyncio.run()` is dead by the time a second one
    dials it, so the server's lifetime has to sit inside the read's.
    """
    async def scenario():
        server = FakeMiner(responses)
        await server.start(silent=silent)
        try:
            result = await whatsminer.read_miner(
                {'ip': '127.0.0.1', 'name': 'test', 'model': model,
                 'api_port': server.port})
            return result, server.commands
        finally:
            await server.stop()

    return asyncio.run(scenario())


class DriverReading(unittest.TestCase):
    def read(self, fx: dict, responses: dict) -> dict:
        result, _ = read_through_server(responses, fx['model'])
        return result

    def test_summary_shaped_machine(self):
        fx = fixture('whatsminer_summary_shape.json')
        result = self.read(fx, raw_responses(fx))

        data = result['data']
        native = fx['summary']['SUMMARY'][0]
        self.assertEqual(result['method'], 'cgminer_4028')
        self.assertAlmostEqual(data['hashrate'], native['MHS 1m'] / 1e6, places=6)
        self.assertEqual(data['power'], native['Power'])
        self.assertEqual(data['uptime'], int(native['Elapsed']))
        self.assertAlmostEqual(data['temperature'],
                               max(d['Temperature'] for d in fx['devs']['DEVS']))
        self.assertEqual([fan['speed'] for fan in data['fans']],
                         [native['Fan Speed In'], native['Fan Speed Out']])
        self.assertEqual(result['provenance']['hashrate_ths'], 'summary.mhs_1m')
        self.assertEqual(result['provenance']['shape'], 'summary')

    def test_msg_shaped_machine(self):
        fx = fixture('whatsminer_msg_shape.json')
        result = self.read(fx, raw_responses(fx))

        data = result['data']
        msg = fx['summary']['Msg']
        self.assertAlmostEqual(data['hashrate'], msg['MHS av'] / 1e6, places=6)
        self.assertEqual(data['power'], msg['Power'])
        # No Msg branch in pyasic's uptime and no fan series at all, both
        # reproduced deliberately (see asic/parity.py).
        self.assertEqual(data['uptime'], 0)
        self.assertEqual(data['fans'], [])
        self.assertEqual(result['provenance']['hashrate_ths'], 'msg.mhs_av')
        self.assertEqual(result['provenance']['shape'], 'msg')

    def test_errors_are_counted_not_carried(self):
        fx = fixture('whatsminer_summary_shape.json')
        result = self.read(fx, raw_responses(fx))
        codes = fx['get_error_code']['Msg']['error_code']
        self.assertEqual(len(result['data']['errors']), len(codes))

    def test_pools_are_parsed_for_this_model(self):
        fx = fixture('whatsminer_summary_shape.json')
        result = self.read(fx, raw_responses(fx))
        pools = result['data']['pools']
        self.assertEqual(len(pools), len(fx['pools']['POOLS']))
        self.assertEqual(pools[0]['url'], fx['pools']['POOLS'][0]['URL'])
        self.assertEqual(pools[0]['status'], fx['pools']['POOLS'][0]['Status'])

    def test_the_m60_still_publishes_no_pools(self):
        fx = dict(fixture('whatsminer_msg_shape.json'), model='M60 VK6A (Stock)')
        result, commands = read_through_server(raw_responses(fx), fx['model'])
        self.assertEqual(result['data']['pools'], [])
        # ... and the pools command is not even asked for.
        self.assertNotIn('pools', commands)

    def test_registry_tainted_machine_is_flagged(self):
        fx = fixture('whatsminer_hashboards_parseable.json')
        result = self.read(fx, raw_responses(fx))
        self.assertTrue(result['pyasic_registry_tainted'])

    def test_ordinary_machine_is_not_flagged(self):
        fx = fixture('whatsminer_summary_shape.json')
        result = self.read(fx, raw_responses(fx))
        self.assertFalse(result['pyasic_registry_tainted'])

    def test_psu_readings_come_from_get_psu(self):
        fx = fixture('whatsminer_summary_shape.json')
        result = self.read(fx, raw_responses(fx))
        self.assertTrue(result['data']['psu'])
        self.assertEqual(result['provenance']['psu'], 'get_psu')


class DriverFailures(unittest.TestCase):
    def test_refused_connection_is_bucketed_as_refused(self):
        # Nothing listening: the same bucket pyasic's ConnectionRefusedError
        # produces, i.e. miner_scrape_status = -1.
        result = asyncio.run(whatsminer.read_miner(
            {'ip': '127.0.0.1', 'name': 'test', 'model': 'M30S++ VH90 (Stock)',
             'api_port': 1}))
        self.assertEqual(result['error_type'], 'refused')

    def test_timeout_is_bucketed_as_timeout(self):
        original = json_tcp.READ_TIMEOUT
        json_tcp.READ_TIMEOUT = 0.3
        try:
            result, _ = read_through_server({}, 'M30S++ VH90 (Stock)', silent=True)
        finally:
            json_tcp.READ_TIMEOUT = original
        self.assertEqual(result['error_type'], 'timeout')

    def test_a_response_that_is_not_a_summary_is_unsupported(self):
        result, _ = read_through_server({'summary': '{"unexpected": true}'},
                                        'M30S++ VH90 (Stock)')
        self.assertEqual(result['error_type'], 'unsupported')

    def test_one_failed_command_loses_only_that_field(self):
        fx = fixture('whatsminer_summary_shape.json')
        responses = raw_responses(fx)
        responses.pop('get_psu')
        result, _ = read_through_server(responses, fx['model'])
        self.assertIn('data', result)
        # None, not {}: the collector treats both as "no PSU series", and this
        # is the value psu_from_get_psu() gives for an unanswered call.
        self.assertFalse(result['data']['psu'])
        self.assertAlmostEqual(result['data']['hashrate'],
                               fx['summary']['SUMMARY'][0]['MHS 1m'] / 1e6, places=6)

    def test_truncated_pools_lose_pools_and_nothing_else(self):
        fx = fixture('whatsminer_summary_shape.json')
        responses = raw_responses(fx)
        responses['pools'] = TRUNCATED_POOLS
        result, _ = read_through_server(responses, fx['model'])
        self.assertIn('data', result)
        self.assertEqual(result['data']['pools'], [])
        self.assertTrue(result['data']['cgminer_boards'])


class TruncationRepair(unittest.TestCase):
    def test_a_response_cut_at_a_complete_field_is_repaired(self):
        # Truncated after a whole top-level field: pyasic drops the incomplete
        # tail and closes the object, and the same bytes must not fail here.
        text = '{"Code":131,"When":1789750890,"Last Share Dif'
        self.assertEqual(json_tcp.parse_json(text)['Code'], 131)

    def test_a_response_cut_before_its_braces_close_still_fails(self):
        # `.74`'s pools: the repair cannot invent the missing `]}` or an inner
        # `}`, and neither can pyasic's -- so both paths publish no pools for
        # that machine. Pinned so "fixed the truncation" is a deliberate change.
        with self.assertRaises(json_tcp.CgminerError):
            json_tcp.parse_json(TRUNCATED_POOLS)

    def test_a_complete_response_is_untouched(self):
        text = '{"Msg":{"User":"a,}b","Power":1}}'
        self.assertEqual(json_tcp.parse_json(text)['Msg']['User'], 'a,}b')


if __name__ == '__main__':
    unittest.main(verbosity=2)
