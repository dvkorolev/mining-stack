# WAN watchdog (DMI-49): restarts the router when the uplink stays down.
#
# Containerised so a clean install is a `docker compose up` rather than a host
# script plus a systemd unit that has to be remembered and reinstated by hand.
#
# The build context is the repository root, because this image needs two files
# that live apart: the watchdog itself and the RCI client it shares with
# router-exporter. Copying rci.py rather than vendoring a second copy keeps one
# canonical implementation of the router's challenge-auth flow.
FROM python:3.11-slim

WORKDIR /app

# Stdlib only. Listed explicitly so the absence of a requirements.txt reads as
# a decision rather than an omission.

COPY router-exporter/rci.py /app/router-exporter/rci.py
COPY bin/wan_watchdog.py /app/bin/wan_watchdog.py

# wan_watchdog.py resolves rci.py relative to its own parent's parent, so the
# layout above has to mirror the repository. Kept identical on purpose.

# State lives on a volume so the action budget survives a restart. Without it a
# crash-looping container would get a fresh budget every time and could reboot
# the router repeatedly -- the exact failure that made ping-check intolerable.
RUN mkdir -p /var/lib/mining-stack \
    && useradd --system --no-create-home watchdog \
    && chown watchdog:watchdog /var/lib/mining-stack
USER watchdog

VOLUME ["/var/lib/mining-stack"]

# Disarmed unless WAN_WATCHDOG_ARM says otherwise. A container that starts armed
# by default is one `docker compose up` away from rebooting a production router.
ENV WAN_WATCHDOG_ARM=false

# No HEALTHCHECK: the process is a sleep loop between probes, so liveness says
# nothing useful, and an unhealthy mark would invite a restart that resets state.

ENTRYPOINT ["python", "-u", "/app/bin/wan_watchdog.py"]
