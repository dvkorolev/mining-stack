"""
Every metric family the scheduler defines must have a writer that can run.

DMI-59 and DMI-211 are one shape: a metric exists, is registered, passes every
"is the rule healthy" check, and can never report. `publish_collection_path()`
had no caller anywhere in the repository, so the family it writes was published
as HELP and TYPE with no sample -- and the sentence it existed to satisfy, "a
mode that runs must not be invisible", was false because of the metric itself.

The list of things checked here is discovered from metrics.py's source, never
maintained by hand. A hand-written list of "known writers" is what DMI-207's
broken COPIED_DIRS check was, and it validated itself.

What this can and cannot see, so it is not trusted for more than it is:
  * it reads references, not execution -- a call in a dead branch, or in a
    function nothing ever calls, satisfies it while never running;
  * it resolves only bare `Name` calls, so a call through getattr, a dict, a
    decorator or an import alias is invisible to it. That direction is
    deliberate: it errs towards calling a wired family unwired, never towards
    passing a dead one silently;
  * it says nothing about the *value* published -- a computed zero and a
    registration default look exactly alike to it. test_collection_path.py
    covers that half.

Run standalone (no pytest, no pyasic, no scheduler import):
    python python-scheduler/test_metric_wiring.py
"""

import ast
import unittest
from pathlib import Path

HERE = Path(__file__).parent
METRICS = HERE / 'metrics.py'

METRIC_CTORS = ('Gauge', 'Counter', 'Histogram', 'Summary')


def parse(path):
    return ast.parse(Path(path).read_text())


def called_names(node):
    """Names this syntax tree calls: `foo(...)`."""
    return {t.func.id for t in ast.walk(node)
            if isinstance(t, ast.Call) and isinstance(t.func, ast.Name)}


def loaded_names(node):
    """Every name this syntax tree reads, at any depth."""
    return {t.id for t in ast.walk(node) if isinstance(t, ast.Name)}


def module_level_calls(tree):
    """
    Calls made at import time, which are roots like any other caller.

    Only calls, not name loads: `_BOARD_FIELDS = (..., miner_board_hashrate)`
    is a module-level load, and counting those would mark every family that
    merely appears in a table as wired.
    """
    names = set()
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            continue
        names |= called_names(node)
    return names


def definitions(metrics_tree):
    """(family names, {function name: node}, {module-level name: names read})."""
    families, funcs, constants = [], {}, {}
    for node in metrics_tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    constants[target.id] = loaded_names(node.value)
            if isinstance(node.value, ast.Call):
                ctor = getattr(node.value.func, 'id', '')
                if ctor in METRIC_CTORS:
                    families += [t.id for t in node.targets if isinstance(t, ast.Name)]
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            funcs[node.name] = node
    return families, funcs, constants


def source_modules(metrics_path=METRICS, root=HERE):
    """Every module that could wire a family: not metrics.py, not a test."""
    for path in sorted(Path(root).rglob('*.py')):
        if '__pycache__' in path.parts:
            continue
        if path == Path(metrics_path) or path.name.startswith('test_'):
            continue
        yield path


def reachable_functions(funcs, external_calls, constants):
    """
    metrics.py functions reachable from a call made outside metrics.py.

    Transitive: a helper written by a publisher counts as wired, which is why
    remove_miner_error_series() and known_miner_ips() are not reported -- they
    are called by forget_miner()/forget_unconfigured_miners(), which main.py
    calls.
    """
    reachable = set(external_calls) & set(funcs)
    while True:
        added = set()
        for name in reachable:
            added |= called_names(funcs[name]) & set(funcs)
        if added <= reachable:
            return reachable
        reachable |= added


def touched_names(funcs, constants, external_calls):
    """
    Names read by a reachable function, closed over metrics.py's own tables.

    The closure is load-bearing rather than a nicety: the board, PSU and v3
    families are never written by name inside a function, they are held in
    module-level tuples (`_BOARD_FIELDS = (('hashrate', miner_board_hashrate),
    ...)`) that set_miner_boards() iterates. A check that stopped at the
    function body reported 13 healthy families as dead on the way to this one.
    """
    touched = set()
    for name in reachable_functions(funcs, external_calls, constants):
        touched |= loaded_names(funcs[name])
    while True:
        added = set()
        for name in touched:
            added |= constants.get(name, set())
        if added <= touched:
            return touched
        touched |= added


def unwired_families(metrics_tree, outside_trees):
    """Families with no writer that a reachable path or another module names."""
    families, funcs, constants = definitions(metrics_tree)
    external_calls, outside_names = module_level_calls(metrics_tree), set()
    for tree in outside_trees:
        external_calls |= called_names(tree)
        outside_names |= loaded_names(tree)
    touched = touched_names(funcs, constants, external_calls)
    return sorted(f for f in families if f not in touched and f not in outside_names)


def analyse(metrics_path=METRICS, root=HERE):
    """(all family names, unwired family names) for the tree on disk."""
    outside = [parse(p) for p in source_modules(metrics_path, root)]
    return (sorted(definitions(parse(metrics_path))[0]),
            unwired_families(parse(metrics_path), outside))


# A family written only from a function nothing calls -- the DMI-211 shape,
# small enough to read. This is the positive control: without it, a check that
# silently fails to analyse anything would pass, and a check that has only ever
# passed has not been shown to catch anything (DMI-207).
DEAD_PUBLISHER = '''
from prometheus_client import Gauge

thing_gauge = Gauge('thing_gauge', 'a family nothing publishes', ['path'])


def publish_thing(path, known_paths):
    for known in known_paths:
        thing_gauge.labels(path=known).set(1 if known == path else 0)
'''

WIRED_PUBLISHER = DEAD_PUBLISHER + '''
publish_thing('a', ('a', 'b'))
'''


class TheAnalysisItself(unittest.TestCase):
    """The check must be able to fail, and must not be fooled by tables."""

    def test_a_family_whose_only_writer_is_never_called_is_reported(self):
        self.assertEqual(unwired_families(ast.parse(DEAD_PUBLISHER), []),
                         ['thing_gauge'])

    def test_a_family_whose_publisher_is_called_is_not_reported(self):
        self.assertEqual(unwired_families(ast.parse(WIRED_PUBLISHER), []), [])

    def test_a_family_held_in_a_module_level_table_is_not_reported(self):
        """How the board and PSU families are actually written."""
        tree = ast.parse('''
from prometheus_client import Gauge

board_gauge = Gauge('board_gauge', 'held in a table', ['slot'])
TABLE = (('slot', board_gauge),)


def set_boards(boards):
    for slot, gauge in TABLE:
        gauge.labels(slot=slot).set(boards[slot])
''')
        outside = [ast.parse('set_boards({})')]
        self.assertEqual(unwired_families(tree, outside), [])


class EveryFamilyIsWired(unittest.TestCase):

    def test_no_family_is_left_without_a_reachable_writer(self):
        families, unwired = analyse()

        self.assertGreater(len(families), 0,
                           f'no families were found in {METRICS} -- the '
                           f'analysis is broken, not the tree')
        self.assertEqual(
            unwired, [],
            'these metric families have no writer reachable from outside '
            'metrics.py, so they are published as HELP and TYPE with no '
            'sample (DMI-211, DMI-59): ' + ', '.join(unwired))


if __name__ == '__main__':
    unittest.main(verbosity=2)
