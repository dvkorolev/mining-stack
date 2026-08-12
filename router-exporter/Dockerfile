# Prometheus exporter for the Keenetic router (DMI-47).
#
# net-snmp is needed because the router's RCI API exposes no byte counters at all;
# IF-MIB over SNMP is the only way to measure traffic volume. The `snmp` package is
# a few MB and avoids taking a Python SNMP library as a dependency.
FROM python:3.11-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends snmp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY rci.py router_exporter.py ./

# Nothing here needs root, and the container talks to the LAN.
RUN useradd --system --no-create-home exporter
USER exporter

EXPOSE 9101

HEALTHCHECK --interval=60s --timeout=10s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:9101/metrics', timeout=8)"

CMD ["python", "-u", "router_exporter.py"]
