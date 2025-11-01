#!/bin/bash
# Unified Metrics Collection Script
# Runs both pyasic and universal collectors in parallel with synchronized timestamps

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
VENV_PYTHON="$PROJECT_ROOT/venv/bin/python3"
LOG_DIR="$PROJECT_ROOT/logs"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Timestamp for this collection run
TIMESTAMP=$(date +%s)
echo "[$(date)] Starting metrics collection (timestamp: $TIMESTAMP)"

# Function to run collector with timeout
run_collector() {
    local name=$1
    local script=$2
    local timeout=$3
    local log_file="$LOG_DIR/${name}_$(date +%Y%m%d).log"
    
    echo "[$(date)] Running $name collector..."
    
    # Run with timeout and capture output
    if timeout "$timeout" "$VENV_PYTHON" "$script" >> "$log_file" 2>&1; then
        echo "[$(date)] ✓ $name completed successfully"
        return 0
    else
        local exit_code=$?
        if [ $exit_code -eq 124 ]; then
            echo "[$(date)] ✗ $name timed out after ${timeout}s" | tee -a "$log_file"
        else
            echo "[$(date)] ✗ $name failed with exit code $exit_code" | tee -a "$log_file"
        fi
        return $exit_code
    fi
}

# Run both collectors in parallel
echo "[$(date)] Starting parallel collection..."

# Start pyasic collector in background
run_collector "pyasic" "$SCRIPT_DIR/pyasic_textfile.py" 60 &
PYASIC_PID=$!

# Start universal collector in background
run_collector "universal" "$SCRIPT_DIR/universal_miner_collector.py" 60 &
UNIVERSAL_PID=$!

# Wait for both to complete
wait $PYASIC_PID
PYASIC_EXIT=$?

wait $UNIVERSAL_PID
UNIVERSAL_EXIT=$?

# Summary
echo ""
echo "=== Collection Summary ==="
echo "Timestamp: $TIMESTAMP"
echo "pyasic collector: $([ $PYASIC_EXIT -eq 0 ] && echo '✓ SUCCESS' || echo '✗ FAILED')"
echo "universal collector: $([ $UNIVERSAL_EXIT -eq 0 ] && echo '✓ SUCCESS' || echo '✗ FAILED')"

# Check output files
if [ -f "$PROJECT_ROOT/textfile/pyasic_metrics.prom" ]; then
    PYASIC_LINES=$(wc -l < "$PROJECT_ROOT/textfile/pyasic_metrics.prom")
    echo "pyasic metrics: $PYASIC_LINES lines"
fi

if [ -f "$PROJECT_ROOT/textfile/universal_metrics.prom" ]; then
    UNIVERSAL_LINES=$(wc -l < "$PROJECT_ROOT/textfile/universal_metrics.prom")
    echo "universal metrics: $UNIVERSAL_LINES lines"
fi

echo "=========================="

# Exit with error if either collector failed
if [ $PYASIC_EXIT -ne 0 ] || [ $UNIVERSAL_EXIT -ne 0 ]; then
    exit 1
fi

exit 0
