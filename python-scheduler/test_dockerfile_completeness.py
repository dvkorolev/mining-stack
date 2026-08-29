#!/usr/bin/env python3
"""
Every top-level module the scheduler imports must be COPYed into the image.

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
"""

import ast
import re
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).parent
DOCKERFILE = HERE / 'Dockerfile'

# Packages copied wholesale as directories.
COPIED_DIRS = ('collectors', 'parsers')


def local_modules():
    """Top-level .py files that could be imported as local modules."""
    return {p.stem for p in HERE.glob('*.py') if not p.name.startswith('test_')}


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
    """Module names the Dockerfile copies into the image."""
    copied = set()
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
            elif token.rstrip('/') in COPIED_DIRS:
                copied.add(token.rstrip('/'))
    return copied


def reachable_local_modules():
    """Local modules reachable from main.py, following local imports."""
    local = local_modules()
    seen, queue = set(), ['main']
    while queue:
        name = queue.pop()
        if name in seen:
            continue
        seen.add(name)
        for candidate in (HERE / f'{name}.py', HERE / name / '__init__.py'):
            if candidate.exists():
                for imported in imports_of(candidate):
                    if imported in local or (HERE / imported).is_dir():
                        queue.append(imported)
                break
    # Package sub-modules import local modules too.
    for pkg in COPIED_DIRS:
        for py in (HERE / pkg).glob('*.py'):
            for imported in imports_of(py):
                if imported in local:
                    seen.add(imported)
    return seen


class TestDockerfileCompleteness(unittest.TestCase):

    def test_every_imported_local_module_is_copied(self):
        copied = copied_modules()
        missing = sorted(m for m in reachable_local_modules()
                         if m not in copied and (HERE / f'{m}.py').exists())
        self.assertEqual(
            missing, [],
            f"These modules are imported but never COPYed into the image, so the "
            f"container will crash on startup: {missing}. Add them to "
            f"python-scheduler/Dockerfile.")

    def test_the_check_would_have_caught_the_dmi81_regression(self):
        # Guard the guard: with rated_hashrate removed from the copied set, the
        # check must fail. Otherwise a broken test would pass silently.
        copied = copied_modules() - {'rated_hashrate'}
        reachable = reachable_local_modules()
        self.assertIn('rated_hashrate', reachable,
                      'rated_hashrate should be reachable from main.py')
        self.assertNotIn('rated_hashrate', copied)


if __name__ == '__main__':
    unittest.main(verbosity=2)
