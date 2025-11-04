# Frontend Service

React-based web interface for the Mining Stack monitoring system.

## Overview

The frontend provides:
- Real-time miner monitoring dashboard
- Interactive charts and visualizations
- Miner control interface
- Pool management UI
- Alert notifications
- Analytics and reporting
- Responsive design for mobile/desktop

## Architecture

```
frontend/
├── public/              # Static assets
├── src/
│   ├── components/      # Reusable components
│   │   ├── pools/               # Pool management components
│   │   │   ├── PoolsList.tsx
│   │   │   ├── PoolForm.tsx
│   │   │   └── PoolConfigPanel.tsx
│   │   ├── Navbar.tsx
│   │   ├── Sidebar.tsx
│   │   └── ErrorBoundary.tsx
│   ├── pages/           # Page components
│   │   ├── Dashboard.tsx        # Main dashboard
│   │   ├── Miners.tsx           # Miner management
│   │   ├── PoolsManagement.tsx  # Pool management
│   │   ├── Analytics.tsx        # Analytics
│   │   ├── Alerts.tsx           # Alerts
│   │   └── Settings.tsx         # Settings
│   ├── services/        # API clients
│   │   ├── api.ts               # Base API client
│   │   └── poolsApi.ts          # Pools API client
│   ├── store/           # Redux store
│   ├── context/         # React contexts
│   ├── App.tsx          # Main app component
│   └── index.tsx        # Entry point
├── package.json         # Dependencies
└── tsconfig.json        # TypeScript config
```

## Features

### Dashboard
- Real-time hashrate monitoring
- Active miner count
- Temperature monitoring
- Power consumption tracking
- Pool distribution
- Alert summary

### Miner Management
- List all miners
- View miner details
- Restart/reboot miners
- Configure miner settings
- Monitor miner health

### Pool Management
- View configured pools
- Add/edit/delete pools
- Test pool connections
- Configure monitoring settings
- Real-time status updates

### Analytics
- Historical hashrate charts
- Performance trends
- Efficiency metrics
- Comparative analysis

### Alerts
- Real-time alert notifications
- Alert history
- Alert filtering
- Acknowledgment tracking

## Technology Stack

### Core
- **React** 18.2+ - UI framework
- **TypeScript** 5.1+ - Type safety
- **Material-UI** 5.13+ - UI components
- **Redux Toolkit** - State management
- **React Router** - Routing

### Visualization
- **Recharts** - Charts and graphs
- **@mui/x-charts** - Advanced charts

### Communication
- **Axios** - HTTP client
- **WebSocket** - Real-time updates

## Development

### Install Dependencies
```bash
npm install
```

### Run Development Server
```bash
npm start
```

The app will open at `http://localhost:3000`

### Build for Production
```bash
npm run build
```

### Run Tests
```bash
npm test
```

## Configuration

### Environment Variables

Create `.env` file:

```bash
# API Configuration
REACT_APP_API_URL=http://localhost:5000/api
REACT_APP_WS_URL=ws://localhost:5000

# Feature Flags
REACT_APP_ENABLE_ANALYTICS=true
REACT_APP_ENABLE_TELEGRAM=true
```

## Components

### Pool Management Components

#### PoolsManagement
Main page for pool management with tabbed interface.

**Features**:
- Pool list view
- Configuration panel
- Add/edit/delete operations
- Real-time notifications

#### PoolsList
Table view of all configured pools.

**Features**:
- Color-coded algorithm chips
- Priority indicators
- Action buttons (Test, Edit, Delete)
- Empty state handling

#### PoolForm
Dialog for adding/editing pools.

**Features**:
- Form validation
- URL format checking
- Algorithm selection
- Priority selection
- Real-time error feedback

#### PoolConfigPanel
Configuration settings panel.

**Features**:
- Test interval configuration
- Timeout settings
- ICMP ping toggle
- Unsaved changes indicator

## State Management

### Redux Store

```typescript
{
  miners: {
    list: Miner[],
    loading: boolean,
    error: string | null
  },
  stats: {
    totalHashrate: number,
    activeMinerCount: number,
    // ...
  },
  alerts: {
    active: Alert[],
    history: Alert[]
  }
}
```

### Context

- **NotificationContext** - Toast notifications
- **ThemeContext** - Dark/light theme

## Routing

```typescript
/                    → Dashboard
/dashboard           → Dashboard
/miners              → Miners Management
/pools               → Pool Management
/analytics           → Analytics
/alerts              → Alerts
/settings            → Settings
```

## API Integration

### Base API Client

```typescript
import api from './services/api';

// GET request
const response = await api.get('/miners');

// POST request
const response = await api.post('/pools', poolData);

// PUT request
const response = await api.put(`/pools/${url}`, updatedPool);

// DELETE request
await api.delete(`/pools/${url}`);
```

### Pools API

```typescript
import { getPoolsConfig, addPool, testPool } from './services/poolsApi';

// Get configuration
const config = await getPoolsConfig();

// Add pool
const pool = await addPool({
  url: 'stratum.example.com:3333',
  name: 'Example Pool',
  algorithm: 'sha256',
  priority: 'high'
});

// Test connection
const result = await testPool('stratum.example.com:3333');
```

## WebSocket Integration

```typescript
const ws = new WebSocket('ws://localhost:5000');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch (data.type) {
    case 'miners_update':
      // Update miners state
      break;
    case 'stats_update':
      // Update stats state
      break;
    case 'alert':
      // Show alert notification
      break;
  }
};
```

## Styling

### Material-UI Theme

```typescript
const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#90caf9',
    },
    secondary: {
      main: '#f48fb1',
    },
  },
});
```

### Custom Styles

Use Material-UI's `sx` prop or `styled` components:

```typescript
<Box sx={{ mt: 4, mb: 4 }}>
  <Typography variant="h4">Title</Typography>
</Box>
```

## Error Handling

### Error Boundary

Catches React errors and displays fallback UI:

```typescript
<ErrorBoundary>
  <App />
</ErrorBoundary>
```

### API Error Handling

```typescript
try {
  const data = await api.get('/endpoint');
} catch (error) {
  if (error.response) {
    // Server responded with error
    console.error(error.response.data.message);
  } else if (error.request) {
    // No response received
    console.error('Network error');
  } else {
    // Request setup error
    console.error(error.message);
  }
}
```

## Notifications

### Snackbar Notifications

```typescript
const [snackbar, setSnackbar] = useState({
  open: false,
  message: '',
  severity: 'success'
});

// Show notification
setSnackbar({
  open: true,
  message: 'Operation successful',
  severity: 'success'
});
```

## Performance

### Code Splitting

Pages are lazy-loaded for better performance:

```typescript
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Miners = lazy(() => import('./pages/Miners'));
const PoolsManagement = lazy(() => import('./pages/PoolsManagement'));
```

### Memoization

Use `React.memo` for expensive components:

```typescript
const MinerCard = React.memo(({ miner }) => {
  // Component logic
});
```

## Docker

### Build Image
```bash
docker build -t mining-stack-frontend .
```

### Run Container
```bash
docker run -p 3000:80 mining-stack-frontend
```

## Dependencies

### Production
- `react` - UI framework
- `react-dom` - React DOM renderer
- `react-router-dom` - Routing
- `@mui/material` - UI components
- `@mui/icons-material` - Material icons
- `@reduxjs/toolkit` - State management
- `axios` - HTTP client
- `recharts` - Charts

### Development
- `typescript` - TypeScript compiler
- `@types/react` - React types
- `@types/react-dom` - React DOM types
- `react-scripts` - Build tools

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Accessibility

- ARIA labels on interactive elements
- Keyboard navigation support
- Screen reader compatible
- Color contrast compliance

## Troubleshooting

### Build Errors
- Clear `node_modules` and reinstall
- Check TypeScript errors
- Verify all imports are correct

### WebSocket Connection Failed
- Check backend is running
- Verify WebSocket URL
- Check CORS configuration

### API Requests Failing
- Verify backend URL in `.env`
- Check network tab in browser
- Review CORS settings

### Styling Issues
- Clear browser cache
- Check Material-UI theme
- Verify CSS imports

## See Also

- [Deployment Guide](../docs/DEPLOYMENT.md)
- [API Documentation](../docs/API.md)
- [Troubleshooting](../docs/TROUBLESHOOTING.md)
