#!/bin/bash
# Organize scripts into proper structure

echo "🗂️  Organizing scripts..."

# Create scripts directory if it doesn't exist
mkdir -p scripts

# Move utility scripts to scripts/ directory
echo "Moving utility scripts to scripts/..."
mv -f cleanup-docs.sh scripts/ 2>/dev/null
mv -f cleanup-temp-docs.sh scripts/ 2>/dev/null
mv -f fix-permissions.sh scripts/ 2>/dev/null

# Remove duplicate fix-permissions.sh from bin/
rm -f bin/fix-permissions.sh

# Keep deployment scripts in root (frequently used)
echo "Keeping deployment scripts in root:"
ls -1 deploy-from-registry.sh update-from-registry.sh health-check.sh 2>/dev/null

# List bin/ scripts (collector and setup scripts)
echo ""
echo "Collector scripts in bin/:"
ls -1 bin/*.py bin/*.sh 2>/dev/null | grep -E "(collect|setup|pyasic|universal|farm_init|generate)"

echo ""
echo "✅ Scripts organized!"
echo ""
echo "Structure:"
echo "  Root:"
echo "    - deploy-from-registry.sh (deployment)"
echo "    - update-from-registry.sh (deployment)"
echo "    - health-check.sh (monitoring)"
echo ""
echo "  scripts/:"
echo "    - cleanup-docs.sh (maintenance)"
echo "    - cleanup-temp-docs.sh (maintenance)"
echo "    - fix-permissions.sh (maintenance)"
echo ""
echo "  bin/:"
echo "    - Collector scripts (collect_all_metrics.sh, pyasic_textfile.py, etc.)"
echo "    - Setup scripts (setup-*.sh)"
echo "    - Discovery scripts (farm_init.py)"
echo "    - Utility scripts (test_single_miner.py, generate_prometheus_rules.py)"
