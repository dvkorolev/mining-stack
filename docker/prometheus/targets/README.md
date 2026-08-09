# Prometheus file_sd targets

`pools.json` feeds the `blackbox-tcp` scrape job (see `../prometheus.yml`).

**Keep it to `targets` and `labels` only.** Prometheus parses file_sd JSON with
unknown fields rejected, so an added key — a `_comment`, for instance — makes it
discard the whole file with `json: unknown field`. The target group silently
stops loading; nothing else reports a problem. That is why this explanation
lives here rather than inside the JSON.

## Why the pool list is empty (DMI-56)

It used to hold seven pools, and the farm mines on none of them.

- Six returned exactly 0.0% reachability for a month: two hostnames no longer
  resolve, three point at Cloudflare addresses that do not carry port 3333.
- The seventh, `stratum.slushpool.com`, was actively harmful. It fails roughly
  25% of the time on its own, because pools drop repeated bare TCP connects from
  an address that never speaks stratum. Read as connectivity, it produced a
  phantom "535 outages / 75.5% availability" and an entire wrong diagnosis of
  the 2026-08-07 outage — corrected in DMI-46.

The list is empty rather than repointed at the pool the farm actually uses,
because probing that one the same way would recreate exactly the same false
signal on the connection everything depends on.

## What to use instead

- **Pool health** — `miner_pool_alive`, reported by the miners themselves. They
  hold real stratum sessions, so their Alive/Dead verdict cannot be confused
  with a pool penalising a prober. Alerts: `../rules/pool_status_alerts.yml`.
- **Uplink availability** — `sum(rate(miner_pool_accepted_total[5m]))`, the
  fleet's actual share submission, aggregated over ~20 independent devices.

Only add a target here if a plain TCP connect is genuinely meaningful for that
endpoint, and confirm it is not a pool that penalises non-stratum probes.
