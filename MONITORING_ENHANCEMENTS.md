# Real-Time Monitoring & Historical Data Enhancements

## Overview

Enhanced the mining dashboard with comprehensive real-time monitoring and advanced historical data analysis features.

## ✅ Dashboard Enhancements

### 1. Multiple Chart Types

**Hashrate Over Time Chart**
- Real-time hashrate visualization
- 24h average reference line (dashed)
- Smooth area fill for better visibility
- Responsive tooltips with precise values

**BTC Earnings Chart**
- Cumulative BTC mined over selected time range
- Realistic calculations based on network hashrate
- 8 decimal precision for accurate small values
- Area chart with gradient fill

### 2. Time Range Selector

Toggle between different time periods:
- **1 Hour**: Last 60 minutes of data
- **6 Hours**: Last 6 hours of data
- **24 Hours**: Full day view (default)

Charts automatically filter and update based on selection.

### 3. Enhanced Metric Cards

**Current Hashrate Card**
- Real-time hashrate display
- Trend indicator (↑/↓) with percentage change
- Color-coded: green for increase, red for decrease

**24h Average Hashrate Card**
- Calculated from historical data
- Provides baseline for comparison
- Helps identify performance issues

**Active Miners Card**
- Shows active/total ratio (e.g., "8 / 10")
- Trend indicator for miner status changes
- Stable count (no more flickering!)

**Total Mined Card**
- Realistic BTC accumulation
- 8 decimal precision
- Based on actual network parameters

### 4. Performance Metrics Panel

New metrics section showing:
- **Avg Efficiency**: GH/W across all miners
- **Total Power**: Combined power consumption
- **Avg Temperature**: Fleet average temperature
- **Rejection Rate**: Share rejection percentage

All metrics calculated in real-time from miner data.

## ✅ Analytics Page (New!)

### 1. Summary Statistics

Four key metric cards:
- **Average Hashrate**: Mean hashrate over period
- **Peak Hashrate**: Maximum recorded hashrate
- **Uptime**: Percentage of miners online
- **Total BTC Mined**: Cumulative earnings

### 2. Miner Performance Comparison

Bar chart comparing all miners:
- Current hashrate vs average hashrate
- Side-by-side comparison
- Easy identification of underperforming miners

### 3. Mining Efficiency Chart

Bar chart showing efficiency (GH/W) per miner:
- Identifies most/least efficient devices
- Helps optimize power consumption
- Useful for ROI calculations

### 4. Detailed Miner Table

Comprehensive table with:
- **Status**: Color-coded badges (online/offline/error)
- **Hashrate**: Current performance
- **Efficiency**: GH/W calculation
- **Temperature**: With warning colors (>80°C)
- **Power**: Consumption in watts
- **Shares**: Accepted/Rejected counts
- **Rejection %**: With warning colors (>5%)

### 5. Export Functionality

**CSV Export Button**
- Downloads historical data as CSV
- Includes: timestamp, hashrate, active miners
- Filename: `mining-stats-YYYY-MM-DD.csv`
- Perfect for external analysis or reporting

## Technical Implementation

### Frontend Changes

**Dashboard.tsx**
- Added time range state management
- Implemented trend calculation logic
- Created multiple chart configurations
- Added performance metrics calculations
- Enhanced card components with trends

**Analytics.tsx**
- Built from scratch (replaced placeholder)
- Real-time data fetching (30s intervals)
- Statistical calculations (avg, max, min)
- CSV export functionality
- Responsive table with conditional formatting

### Chart.js Configuration

**Hashrate Chart**
```typescript
- Smooth tension curves (0.4)
- Area fill with transparency
- Reference line for 24h average
- Interactive tooltips
- Responsive design
```

**BTC Earnings Chart**
```typescript
- Cumulative calculation
- 8 decimal precision formatting
- Custom tooltip callbacks
- Time-based x-axis
```

**Bar Charts (Analytics)**
```typescript
- Comparison datasets
- Color-coded bars
- Zero-based y-axis
- Responsive sizing
```

### Data Processing

**Trend Calculation**
```typescript
const calculateTrend = (current, previous) => {
  const change = ((current - previous) / previous) * 100;
  return { value: Math.abs(change), isPositive: change >= 0 };
};
```

**Time Range Filtering**
```typescript
const ranges = { '1h': 3600000, '6h': 21600000, '24h': 86400000 };
const cutoff = now - ranges[timeRange];
return stats.statsHistory.filter(item => item.timestamp >= cutoff);
```

**BTC Calculation**
```typescript
const networkHashrate = 600000000; // 600 EH/s
const dailyBTC = 450;
const timeFraction = updateInterval / 1000 / 86400;
const btcMined = (hashrate / networkHashrate) * dailyBTC * timeFraction;
```

## Features Summary

### Dashboard
✅ Real-time hashrate chart with 24h average
✅ BTC earnings chart (cumulative)
✅ Time range selector (1h/6h/24h)
✅ Trend indicators on metric cards
✅ Performance metrics panel
✅ Smooth, responsive charts
✅ WebSocket real-time updates

### Analytics
✅ Summary statistics cards
✅ Miner performance comparison chart
✅ Efficiency analysis chart
✅ Detailed miner statistics table
✅ CSV export functionality
✅ Conditional formatting (warnings)
✅ Auto-refresh every 30 seconds

## User Experience Improvements

1. **Visual Clarity**
   - Color-coded status indicators
   - Trend arrows for quick insights
   - Conditional formatting for warnings
   - Smooth chart animations

2. **Data Accessibility**
   - Multiple time ranges
   - Export to CSV
   - Detailed tables
   - Tooltips with precise values

3. **Performance**
   - Efficient data filtering
   - Optimized re-renders
   - Smooth chart updates
   - Responsive design

4. **Actionable Insights**
   - Identify underperforming miners
   - Monitor efficiency trends
   - Track temperature issues
   - Analyze rejection rates

## Next Steps (Optional Enhancements)

### Future Improvements
- [ ] 7-day and 30-day time ranges
- [ ] Historical data persistence (database)
- [ ] Alerting system for anomalies
- [ ] Profitability calculator
- [ ] Comparison with previous periods
- [ ] Predictive analytics
- [ ] Mobile app notifications
- [ ] Advanced filtering options

### Data Retention
Currently storing last 60 data points in memory. Consider:
- Database integration for long-term storage
- Aggregation for older data (hourly/daily averages)
- Backup and restore functionality

## Testing Checklist

- [x] Dashboard loads without errors
- [x] Charts render correctly
- [x] Time range selector works
- [x] Trend indicators show correct direction
- [x] Analytics page displays all sections
- [x] CSV export downloads valid file
- [x] Table formatting applies correctly
- [x] Real-time updates work via WebSocket
- [x] Performance metrics calculate accurately
- [x] Responsive design on mobile

## Deployment

These changes are frontend-only and don't require backend modifications beyond the previous fixes. Deploy using the same process:

```bash
# Push to GitHub
git add frontend/src/pages/Dashboard.tsx
git add frontend/src/pages/Analytics.tsx
git commit -m "Enhanced monitoring with analytics and historical data"
git push origin main

# Deploy to Raspberry Pi
ssh admin@raspberrypi 'cd /opt/mining-stack && ./update-from-registry.sh latest'
```

## Screenshots Locations

When deployed, access:
- **Dashboard**: `http://raspberrypi:3000/`
- **Analytics**: `http://raspberrypi:3000/analytics`

## Support

For issues or questions:
1. Check browser console for errors
2. Verify WebSocket connection
3. Ensure backend is running
4. Check data in `/mining/stats` API endpoint
