# Enhanced Admin Dashboard Components

This directory contains all React components for the enhanced admin dashboard feature.

## Components Overview

### Main Container
- **DashboardContainer.tsx** - Main orchestrator component that manages state and data fetching for all dashboard sections

### Filters
- **FilterPanel.tsx** - Date range picker with presets (Today, Last 7 days, Last 30 days, Custom), category filter, status filter, and period comparison toggle

### KPI Metrics
- **MetricsGrid.tsx** - Grid of 4 KPI cards showing Revenue, Orders, AOV, and Conversion Rate with period-over-period comparison

### Charts
- **SalesTrendChart.tsx** - Line chart showing sales trends with daily/weekly/monthly granularity options
- **CategoryPerformanceChart.tsx** - Pie chart showing revenue distribution by category (groups categories < 2% into "Other")
- **CustomerAcquisitionChart.tsx** - Line chart showing new customer acquisition over time with repeat rate and churn metrics
- **AOVTrendChart.tsx** - Line chart showing average order value trends
- **ConversionRateChart.tsx** - Line chart showing conversion rate trends

### Tables
- **InventoryTable.tsx** - Paginated table showing inventory status (out/low/overstocked/normal) with filtering
- **SalesTable.tsx** - Paginated sales report table with CSV export functionality
- **ProductPerformanceTable.tsx** - Table showing best/worst selling products by revenue

### Real-time Metrics
- **TodayMetricsCard.tsx** - Today's revenue and orders vs yesterday with percentage changes
- **ActiveUsersCard.tsx** - Count of users logged in within last 24 hours
- **RecentOrdersFeed.tsx** - Feed of 10 most recent orders with relative timestamps
- **RevenueGoalProgress.tsx** - Progress bar showing current revenue vs goal with overflow indicator

## Features

### Responsive Design
- Mobile-first approach with Tailwind CSS
- Single column layout on mobile (< 768px)
- Multi-column grid layout on desktop (>= 768px)
- All charts and tables are fully responsive

### Dark Mode Support
- All components support dark mode via Tailwind's dark: classes
- Automatic theme switching based on system preferences

### Loading States
- Skeleton loaders for all components during data fetching
- Smooth transitions between loading and loaded states

### Error Handling
- Error states with retry buttons for all data-dependent components
- User-friendly error messages
- Graceful degradation when data is unavailable

### Interactive Features
- Hover tooltips on all charts showing exact values
- Color-coded comparison indicators (green for positive, red for negative)
- Pagination controls for large datasets
- CSV export for sales reports
- Real-time data refresh (every minute for today's metrics and recent orders)

## Data Flow

1. **DashboardContainer** manages global filter state and coordinates data fetching
2. Uses React Query for data fetching, caching, and automatic refetching
3. Each component receives data as props and handles its own loading/error states
4. Filter changes trigger automatic refetch of all dependent queries

## API Integration

Components consume data from:
- `analyticsApi` - Sales trends, category performance, customer metrics, AOV, conversion rate, today's metrics, recent orders, revenue goal
- `reportsApi` - Inventory report, sales report, sales export, product performance
- `categoriesApi` - Category list for filters

## Styling

- Uses Tailwind CSS utility classes
- Consistent color palette:
  - Blue (#3B82F6) - Primary actions, revenue
  - Green (#10B981) - Positive changes, orders
  - Red (#EF4444) - Negative changes, alerts
  - Purple (#8B5CF6) - Conversion metrics
  - Yellow (#F59E0B) - Warnings
- Consistent spacing and typography
- Smooth transitions and animations

## Usage Example

```tsx
import { DashboardContainer } from './components/dashboard';

function AdminDashboard() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          Analytics Dashboard
        </h1>
        <DashboardContainer />
      </div>
    </div>
  );
}
```

## Dependencies

- React 18+
- TypeScript 5+
- Recharts 2.x - Chart library
- date-fns - Date manipulation
- @tanstack/react-query - Data fetching and caching
- Tailwind CSS - Styling

## Performance Optimizations

- React Query caching reduces unnecessary API calls
- Lazy loading for chart components (handled by React Query)
- Debounced filter changes (300ms)
- Pagination for large datasets (50 items per page)
- Optimized re-renders with proper dependency arrays
