"""
Our own ASIC layer (DMI-135).

Phase 1 (DMI-136) puts the 4028 transport and the WhatsMiner driver here and
makes them the primary path for WhatsMiner-class machines, without changing a
single published value. pyasic is still installed and still used for the
machines whose published values depend on its model registry -- see
asic/parity.py.
"""
