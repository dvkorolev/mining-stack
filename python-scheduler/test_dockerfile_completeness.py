#!/usr/bin/env python3
"""
Every local module and package the scheduler imports must be COPYed into the image.

Written after DMI-81 shipped a `rated_hashrate.py` that was never added to the
Dockerfile's COPY list. Everything passed -- unit tests, py_compile, the full
suite -- because they all run against the source tree, where the file is
obviously present. The image is the only place it was missing, so the failure
appeared for the first time in production, as a crash loop:

    File "/app/main.py", line 30, in <module>
        import rated_hashrate
    ModuleNotFoundError: No module named 'rated_hashrate'

The scheduler restarted every few seconds and the fleet went unpolled. Nothing
in CI could have caught it, because nothing in CI looked at the Dockerfile.

DMI-207 is the same failure a second time, in the half this check could not
see. DMI-136 phase 1 made `asic/` a package the collector imports at startup,
and the Dockerfile never gained a `COPY asic/` line. All three tests below
stayed green, because the comparison ran through `COPIED_DIRS` -- the very list
that was missing the entry -- and then filtered candidates to files ending in
`.py`, which no package has. The list is now discovered from the source tree
rather than maintained by hand, and packages are compared like modules.
"""

import ast
import re
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).parent
DOCKERFILE = HERE / 'Dockerfile'

def local_modules():
    """Top-level .py files that could be imported as local modules."""
    return {p.stem for p in HERE.glob('*.py') if not p.name.startswith('test_')}


def local_packages():
    """Directories that are importable local packages.

    Discovered rather than listed. A hand-maintained tuple was the first half
    of DMI-207: it was both the thing the Dockerfile parse validated against
    and the thing that was wrong, so the check could only ever confirm what the
    list already claimed.
    """
    return {p.name for p in HERE.iterdir()
            if p.is_dir() and (p / '__init__.py').exists()}


def imports_of(path: Path):
    """Every module name imported by a file, at any level."""
    names = set()
    tree = ast.parse(path.read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                names.add(a.name.split('.')[0])
        elif isinstance(node, ast.ImportFrom):
            if node.module and node.level == 0:
                names.add(node.module.split('.')[0])
    return names


def copied_modules():
    """Module and package names the Dockerfile copies into the image."""
    copied = set()
    packages = local_packages()
    for line in DOCKERFILE.read_text().splitlines():
        line = line.strip()
        if not line.upper().startswith('COPY'):
            continue
        if '--from=' in line:
            continue
        # Drop the COPY keyword and the destination (the last token).
        parts = line.split()[1:-1]
        for token in parts:
            m = re.match(r'^([\w\-.]+)\.py$', token)
            if m:
                copied.add(m.group(1))
            elif token.rstrip('/') in packages:
                copied.add(token.rstrip('/'))
    return copied


def reachable_local_modules():
    """Local modules and packages reachable from main.py, following imports."""
    known = local_modules() | local_packages()

    def source_of(name: str):
        for candidate in (HERE / f'{name}.py', HERE / name / '__init__.py'):
            if candidate.exists():
                return candidate
        return None

    seen, queue = set(), ['main']
    while queue:
        name = queue.pop()
        if name in seen:
            continue
        seen.add(name)
        source = source_of(name)
        if source is None:
            continue
        for imported in imports_of(source):
            if imported in known:
                queue.append(imported)

    # Sub-modules of a package import local code too, and walking `__init__.py`
    # does not reach them: the module that imports `asic` here is
    # collectors/pyasic_collector.py, not collectors/__init__.py (DMI-207).
    for pkg in local_packages():
        for py in (HERE / pkg).rglob('*.py'):
            for imported in imports_of(py):
                if imported in known:
                    seen.add(imported)
    return seen


class TestDockerfileCompleteness(unittest.TestCase):

    def test_every_imported_local_module_is_copied(self):
        copied = copied_modules()
        # A package has no top-level .py, which is the filter that hid `asic`
        # for the life of DMI-136 phase 1 (DMI-207).
        reachable = {m for m in reachable_local_modules()
                     if (HERE / f'{m}.py').exists() or (HERE / m).is_dir()}
        missing = sorted(reachable - copied)
        self.assertEqual(
            missing, [],
            f"These modules and packages are imported but never COPYed into the "
            f"image, so the container will crash on startup: {missing}. Add them "
            f"to python-scheduler/Dockerfile.")

    def test_the_check_would_have_caught_the_dmi81_regression(self):
        # Guard the guard: with rated_hashrate removed from the copied set, the
        # check must fail. Otherwise a broken test would pass silently.
        copied = copied_modules() - {'rated_hashrate'}
        reachable = reachable_local_modules()
        self.assertIn('rated_hashrate', reachable,
                      'rated_hashrate should be reachable from main.py')
        self.assertNotIn('rated_hashrate', copied)

    def test_the_check_would_have_caught_a_missing_v3_telemetry_copy(self):
        # DMI-108: v3_telemetry.py sits at top level beside rated_hashrate,
        # exactly the shape that shipped un-COPYed once already.
        copied = copied_modules() - {'v3_telemetry'}
        reachable = reachable_local_modules()
        self.assertIn('v3_telemetry', reachable,
                      'v3_telemetry should be reachable from main.py')
        self.assertNotIn('v3_telemetry', copied)

    def test_the_check_would_have_caught_a_missing_package_copy(self):
        # DMI-207: a package is the shape this file used to be blind to. With
        # the `COPY asic/` line removed -- the state `main` was actually in --
        # the check must fail, and `asic` must be named as reachable.
        copied = copied_modules() - {'asic'}
        reachable = reachable_local_modules()
        self.assertIn('asic', reachable,
                      'asic should be reachable from main.py')
        self.assertNotIn('asic', copied)


if __name__ == '__main__':
    unittest.main(verbosity=2)
