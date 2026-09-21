"""
Every public function in asic/parity.py must state the evidence behind it.

DMI-201: the module presented itself as reproducing "pyasic 0.60.0's field
selection, reproduced exactly", which is what made phase 1's offline evidence
("fixture replay agrees") mean anything — while part of that mirroring was
measured against live pyasic on this fleet and part was only read out of
pyasic's source, and the two were indistinguishable. Reading the source had
already produced a wrong model of pyasic three times (the two-shape finding,
`uptime_seconds`, the fans), each time corrected from the fleet.

The fix is a mark per function, and this is the guard that keeps a *new*
function from arriving without one. Same principle as DMI-59/DMI-211, applied
to evidence instead of to metrics, and with the same rule about lists: the set
of functions is discovered from parity.py's syntax, never maintained by hand.
A hand-written list of "functions I have marked" would be validated by itself.

What this can and cannot see, so it is not trusted for more than it is:
  * it reads *text*, not truth. A function marked "measured on the fleet" whose
    cited record says something else passes this, because no test can read a
    real log from 2026-09-18. The mark's meaning is deliberately narrower than
    "verified" -- the module header defines it as "a dated record of an
    observation exists in this repository", and this test can only check that a
    mark of the right shape is present;
  * it says nothing about module-private helpers, which are exempt by design
    (a leading underscore means no claim about pyasic's behaviour);
  * it does not check that the *right* one of the two marks was chosen. That
    judgement is auditable in the diff, not testable here.

Run standalone (no pytest, no pyasic, no scheduler import):
    python python-scheduler/test_parity_evidence.py
"""

import ast
import unittest
from pathlib import Path

PARITY = Path(__file__).parent / 'asic' / 'parity.py'

# The two-word vocabulary, in the order the header defines it. Anything else is
# a mark this project has not agreed on.
MEASURED = 'measured on the fleet'
SOURCE_ONLY = 'source-only'
MARK_PREFIX = 'Evidence:'


def module_tree():
    return ast.parse(PARITY.read_text())


def public_functions(tree=None):
    """Module-level functions that are not exempt (no leading underscore)."""
    tree = tree if tree is not None else module_tree()
    return [node for node in tree.body
            if isinstance(node, ast.FunctionDef)
            and not node.name.startswith('_')]


def mark_of(node):
    """
    The text after `Evidence:` in this function's docstring, or None.

    The docstring is read through `ast`, so the mark has to be inside it -- a
    mark written as a stray `#` comment above the function does not count.
    """
    docstring = ast.get_docstring(node) or ''
    for line in docstring.splitlines():
        stripped = line.strip()
        if stripped.startswith(MARK_PREFIX):
            return stripped[len(MARK_PREFIX):].strip()
    return None


class EvidenceMarks(unittest.TestCase):
    def test_every_public_function_carries_an_evidence_mark(self):
        # One assertion listing every offender, so an unmarked function fails
        # by name rather than as a count.
        unmarked = [node.name for node in public_functions()
                    if mark_of(node) is None]
        self.assertEqual(
            unmarked, [],
            'public functions with no "Evidence:" line in their docstring: '
            f'{unmarked}. Both marks are defined in the parity.py module '
            'header; mark the function rather than dropping it from the scan.')

    def test_every_mark_uses_the_two_word_vocabulary(self):
        unexpected = []
        for node in public_functions():
            mark = mark_of(node)
            if mark is not None and not mark.startswith(
                    (MEASURED, SOURCE_ONLY)):
                unexpected.append((node.name, mark[:60]))
        self.assertEqual(
            unexpected, [],
            'marks that are neither "measured on the fleet" nor "source-only":'
            f' {unexpected}. A third vocabulary would make the two states this'
            ' test exists to distinguish indistinguishable again.')

    def test_the_scan_sees_the_module(self):
        # Guard the guard: a scan that silently matches nothing would let every
        # function above pass. `fan_speeds` is a sentinel because its mark is
        # the one DMI-201 was opened over.
        functions = public_functions()
        names = [node.name for node in functions]
        self.assertGreaterEqual(len(functions), 15, names)
        self.assertIn('fan_speeds', names)
        marked = [node for node in functions if mark_of(node) is not None]
        self.assertGreaterEqual(len(marked), 15, names)

    def test_the_header_states_the_vocabulary(self):
        # The marks are read as a claim about the repository, so the header has
        # to be where a reader meets the definition of what they mean.
        header = ast.get_docstring(module_tree()) or ''
        self.assertIn(MEASURED, header)
        self.assertIn(SOURCE_ONLY, header)


if __name__ == '__main__':
    unittest.main(verbosity=2)
