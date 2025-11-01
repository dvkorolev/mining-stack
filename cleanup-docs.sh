#!/bin/bash
# Cleanup temporary documentation files on Raspberry Pi
# These files were working documents that have been consolidated into proper documentation

set -e

echo "🧹 Cleaning up temporary documentation files..."
echo ""

# List of temporary files to remove
TEMP_DOCS=(
    "ASIC_CONFIG_COMPLETE.md"
    "DASHBOARD_FIXES.md"
    "DATABASE_STORAGE.md"
    "DEPLOY_FIXES.md"
    "DEPLOYMENT_SUMMARY.md"
    "DOCUMENTATION_UPDATE.md"
    "MINERS_MANAGEMENT.md"
    "MONITORING_ENHANCEMENTS.md"
    "RESOURCE_OPTIMIZATION.md"
)

# Remove temporary documentation files
for file in "${TEMP_DOCS[@]}"; do
    if [ -f "$file" ]; then
        echo "  Removing: $file"
        rm -f "$file"
    fi
done

echo ""
echo "✅ Cleanup complete!"
echo ""
echo "📚 Essential documentation kept:"
echo "  - README.md"
echo "  - CHANGELOG.md"
echo "  - TELEGRAM_SETUP.md"
echo "  - IMPLEMENTATION_SUMMARY.md"
echo "  - docs/ directory (all guides)"
echo ""
