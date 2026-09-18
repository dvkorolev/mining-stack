"""
JSON-over-TCP transport for the CGMiner / btminer 4028 API.

Moved here from `collectors/pyasic_collector.py` (DMI-136) for one reason: the
primary path must be able to talk to a miner without importing pyasic. A module
that imports pyasic at the top cannot be imported by a test that runs without
pyasic installed, which is every test this repository runs in CI.

Two deliberate differences from the function that lived in the collector, both
behavioural only in the failure path, and both required to keep
`miner_scrape_status` unchanged when the primary path switches over:

1. A failed command carries a **classified reason** (`refused` / `timeout` /
   `other`) instead of being swallowed into `None`. The pyasic path lets
   `ConnectionRefusedError`, `TimeoutError` and everything else propagate and
   maps them to -1 / 0 / -2; a transport that returns `None` for all three
   would silently collapse those three states into -2 for every machine that
   goes down, changing a published value and the DMI-54/55 cull timing with it.
2. The socket is always closed, including on the failure paths.

Timeouts, buffer size, the trailing-NUL and `%` handling and the raw-decode
fallback are unchanged from the original.
"""

import asyncio
import json
import logging
from typing import Dict, Optional, Tuple

logger = logging.getLogger(__name__)

DEFAULT_API_PORT = 4028

# Failure reasons. These are the buckets the pyasic path already maps to
# scrape_status: refused -> -1, timeout -> 0, anything else -> -2.
REFUSED = 'refused'
TIMEOUT = 'timeout'
OTHER = 'other'

CONNECT_TIMEOUT = 10.0
READ_TIMEOUT = 10.0
READ_BUFFER = 65536


class CgminerError(Exception):
    """A command that produced no usable response, with a classified reason."""

    def __init__(self, reason: str, detail: str = ''):
        super().__init__(f'{reason}: {detail}' if detail else reason)
        self.reason = reason
        self.detail = detail


async def fetch_raw(ip: str, command: str, port: int = DEFAULT_API_PORT) -> str:
    """
    Send one command and return the raw response text.

    Raises CgminerError with a classified reason on any failure.
    """
    # `api_port` arrives as JSON null from every DB row (the column exists,
    # unset), and dict.get(key, default) does NOT substitute for a present
    # None -- it returns the None. open_connection(ip, None) then dials port
    # 0 and the connect refuses, which silently cost DMI-94 its whole first
    # live run (found during the DMI-108 deploy acceptance, 2026-09-18).
    # Normalized here because this is the one boundary every caller shares.
    port = port or DEFAULT_API_PORT

    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, port), timeout=CONNECT_TIMEOUT)
    except asyncio.TimeoutError as exc:
        raise CgminerError(TIMEOUT, f'connect {ip}:{port}') from exc
    except ConnectionRefusedError as exc:
        raise CgminerError(REFUSED, f'{ip}:{port}') from exc
    except OSError as exc:
        raise CgminerError(_reason_for(exc), f'{ip}:{port}: {exc}') from exc

    try:
        cmd = json.dumps({"command": command})
        # Send command without newline - some miners reject commands with \n
        writer.write(cmd.encode())
        await writer.drain()
        data = await _read_whole_response(reader)
    except asyncio.TimeoutError as exc:
        raise CgminerError(TIMEOUT, f'read {command} from {ip}') from exc
    except OSError as exc:
        raise CgminerError(_reason_for(exc), f'{command} from {ip}: {exc}') from exc
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:  # noqa: BLE001 - closing must not mask the real error
            pass

    response_str = data.decode().strip('\x00').strip()
    # Remove trailing % if present
    if response_str.endswith('%'):
        response_str = response_str[:-1]
    return response_str


async def _read_whole_response(reader) -> bytes:
    """
    Read one response until it is complete, not until the first packet arrives.

    The single `read(65536)` this replaced returned as soon as *any* bytes were
    available, which on this link truncates: the site is ~2 s away over
    Tailscale, so a response arrives in several TCP segments and the read caught
    only the first. Measured in the DMI-136 parallel run — `.101`, `.52`, `.65`
    and `.87` lost their `devs` response (and with it every per-board series)
    while pyasic, which reads to EOF, kept it. That is our path *losing* data the
    pyasic path publishes, so it is not a difference this phase can carry.

    The budget is the same 10 s the old single read had, spent across chunks
    rather than once: a body that is already complete does not wait for the
    socket to close.
    """
    loop = asyncio.get_event_loop()
    deadline = loop.time() + READ_TIMEOUT
    chunks = []
    while True:
        remaining = deadline - loop.time()
        if remaining <= 0:
            raise asyncio.TimeoutError('read budget exhausted')
        chunk = await asyncio.wait_for(reader.read(READ_BUFFER), timeout=remaining)
        if not chunk:
            break
        chunks.append(chunk)
        body = b''.join(chunks)
        if _is_complete(body):
            break
    return b''.join(chunks)


def _is_complete(body: bytes) -> bool:
    """Whether the bytes so far look like a whole response."""
    text = body.decode('utf-8', 'replace').strip('\x00').strip()
    if not text:
        return False
    if text.endswith('%'):
        text = text[:-1]
    try:
        json.loads(text)
        return True
    except json.JSONDecodeError:
        # A response cut before its closing brace is still "all there is": the
        # repair path deals with it, and waiting for a socket that will not
        # close only burns the budget.
        return text.endswith('}')


def _reason_for(exc: OSError) -> str:
    """Same classification the pyasic path applies to a bare OSError."""
    return REFUSED if 'refused' in str(exc).lower() else OTHER


def repair_like_pyasic(response_str: str) -> str:
    """
    Apply the repairs pyasic applies to a raw response before parsing it.

    `pyasic/rpc/base.py::_load_api_data`, reproduced because today's path uses
    it and this one has to cope with the same bytes. The one that matters is the
    last: a response that does not end in `}` is **truncated**, and pyasic keeps
    the complete fields and closes the object rather than failing. Measured
    2026-09-18: `.74`'s `pools` response arrives truncated every time (1228
    bytes, cut mid-string), so without this our path would publish no pool
    series on that machine where the pyasic path publishes them from the fields
    that did arrive.

    Two deliberate divergences from pyasic, both in the failure direction that
    keeps this module honest:

    - pyasic runs these repairs *unconditionally*, before parsing. This applies
      them only after a plain parse and a raw-decode have both failed, so a
      well-formed response is never rewritten. For the truncation above the two
      land on the same text and the same outcome.
    - pyasic's `"error_code":["..."]` bracket swap for one buggy v2.0.4
      firmware is not reproduced. It rewrites every bracket in the response,
      which corrupts whatever else it touches, and `asic.parity.error_count()`
      counts both shapes identically — the published value is the same without
      the damage.

    Note the repair cannot synthesise a missing `]}`: `.74`'s response is cut
    before its array closes, so it fails here *and* in pyasic, and that machine
    publishes no pool series on either path.
    """
    text = response_str.replace(',}', '}').replace('\n', '')
    text = text.replace('}{', '},{').replace('[,{', '[{')
    if text and not text.endswith('}'):
        text = ','.join(text.split(',')[:-1]) + '}'
    return text


def parse_json(response_str: str) -> Dict:
    """Parse a response body. Raises CgminerError(OTHER) when it is not JSON."""
    try:
        return json.loads(response_str)
    except json.JSONDecodeError as exc:
        logger.warning(
            f'CGMiner JSON decode error: {exc}, response: {response_str[:100]}')
        try:
            decoder = json.JSONDecoder()
            obj, _ = decoder.raw_decode(response_str)
            return obj
        except Exception:  # noqa: BLE001
            pass
        try:
            return json.loads(repair_like_pyasic(response_str))
        except Exception:  # noqa: BLE001
            raise CgminerError(OTHER, f'unparseable response: {response_str[:100]}') from exc


async def command(ip: str, command_name: str, port: int = DEFAULT_API_PORT) -> Dict:
    """Send one command and return the parsed response. Raises CgminerError."""
    return parse_json(await fetch_raw(ip, command_name, port))


async def command_result(ip: str, command_name: str,
                         port: int = DEFAULT_API_PORT) -> Tuple[Optional[Dict], Optional[str]]:
    """
    Send one command, returning `(response, None)` or `(None, reason)`.

    The reason is what the caller needs to publish the same scrape_status the
    pyasic path would have published for the same failure.
    """
    try:
        return await command(ip, command_name, port), None
    except CgminerError as exc:
        logger.warning(
            f'CGMiner command failed for {ip}:{port or DEFAULT_API_PORT} '
            f'cmd={command_name}: {exc}')
        return None, exc.reason
    except Exception as exc:  # noqa: BLE001 - never let one miner abort a cycle
        logger.warning(
            f'CGMiner command failed for {ip}:{port or DEFAULT_API_PORT} '
            f'cmd={command_name}: {type(exc).__name__}: {exc}')
        return None, OTHER


async def cgminer_command(ip: str, command_name: str,
                          port: int = DEFAULT_API_PORT) -> Optional[Dict]:
    """
    Send one command, returning the parsed response or None.

    Kept for the call sites that genuinely have nothing to do with the failure
    reason (the per-board and PSU reads, whose absence is not a scrape failure).
    New failure-classifying code should use `command_result`.
    """
    response, _ = await command_result(ip, command_name, port)
    return response
