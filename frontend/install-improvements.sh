#!/bin/bash

# Frontend Improvements Installation Script
# Installs required packages for RTK Query and virtualization

echo "🚀 Installing Frontend Performance Improvements..."
echo ""

# Check if we're in the frontend directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run this script from the frontend directory."
    exit 1
fi

echo "📦 Installing react-window and react-virtualized-auto-sizer..."
npm install react-window react-virtualized-auto-sizer

echo "📦 Installing TypeScript types..."
npm install --save-dev @types/react-window

echo ""
echo "✅ Installation complete!"
echo ""
echo "📚 Next steps:"
echo "1. Read FRONTEND_IMPROVEMENTS.md for usage guide"
echo "2. Update components to use RTK Query hooks"
echo "3. Replace large lists with VirtualizedMinerList"
echo ""
echo "🎉 Your frontend is now ready for better performance!"
