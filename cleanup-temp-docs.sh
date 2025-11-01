#!/bin/bash
# Cleanup temporary documentation files
# Keep only essential and feature documentation

echo "🧹 Cleaning up temporary documentation files..."

# Remove temporary fix/debug documents
rm -f ALL_FIXES_SUMMARY.md
rm -f CLEANUP_REPORT.md
rm -f DEBUG_MINERS.md
rm -f DEBUG_PYASIC_EXCEPTIONS.md
rm -f DEPLOY_FIXES_NOW.md
rm -f DEPLOY_NOW.md
rm -f ERROR_TRACKING_FEATURE.md
rm -f FILESYSTEM_FIX.md
rm -f FIXES_APPLIED.md
rm -f IMMEDIATE_FIX.md
rm -f QUICK_FIX.md
rm -f REAL_DATA_INTEGRATION.md
rm -f THRESHOLD_SAVE_FIX.md
rm -f TODAYS_CHANGES.md

echo "✅ Removed temporary documentation files"

# List remaining documentation
echo ""
echo "📚 Remaining documentation:"
echo ""
echo "Essential:"
ls -1 README.md CHANGELOG.md DOCS_INDEX.md IMPLEMENTATION_SUMMARY.md TELEGRAM_SETUP.md 2>/dev/null
echo ""
echo "Feature Documentation:"
ls -1 THRESHOLD_*.md DUAL_COLLECTOR_SETUP.md UNIVERSAL_COLLECTOR.md PYASIC_SETUP.md 2>/dev/null
echo ""
echo "Documentation Directory:"
ls -1 docs/*.md 2>/dev/null | head -5
echo "  ... and more in docs/"
echo ""
echo "✨ Documentation organized!"
