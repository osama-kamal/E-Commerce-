import React, { useState, lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { subDays, startOfDay, endOfDay } from 'date-fns';
import { useDebounce } from '../../hooks/useDebounce';
import { FilterPanel, FilterState } from './FilterPanel';
import { MetricsGrid } from './MetricsGrid';
import { InventoryTable } from './InventoryTable';
import { SalesTable } from './SalesTable';
import { ProductPerformanceTable } from './ProductPerformanceTable';
import { TodayMetricsCard } from './TodayMetricsCard';
import { ActiveUsersCard } from './ActiveUsersCard';
import { RecentOrdersFeed } from './RecentOrdersFeed';
import { RevenueGoalProgress } from './RevenueGoalProgress';
import { analyticsApi } from '../../api/analytics';
import { reportsApi } from '../../api/reports';
import { categoriesApi } from '../../api/categories';

// Heavy Recharts chart components — each is only loaded when the dashboard renders
const SalesTrendChart        = lazy(() => import('./SalesTrendChart').then(m => ({ default: m.SalesTrendChart })));
const CategoryPerformanceChart = lazy(() => import('./CategoryPerformanceChart').then(m => ({ default: m.CategoryPerformanceChart })));
const CustomerAcquisitionChart = lazy(() => import('./CustomerAcquisitionChart').then(m => ({ default: m.CustomerAcquisitionChart })));
const AOVTrendChart          = lazy(() => import('./AOVTrendChart').then(m => ({ default: m.AOVTrendChart })));
const ConversionRateChart    = lazy(() => import('./ConversionRateChart').then(m => ({ default: m.ConversionRateChart })));

function ChartSkeleton() {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 animate-pulse">
      <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4" />
      <div className="h-80 bg-gray-100 dark:bg-gray-700 rounded" />
    </div>
  );
}

export const DashboardContainer: React.FC = () => {
  // Initialize filters with last 30 days
  const now = new Date();
  const [filters, setFilters] = useState<FilterState>({
    startDate: startOfDay(subDays(now, 29)).toISOString(),
    endDate: endOfDay(now).toISOString(),
    showComparison: true,
  });

  const [granularity, setGranularity] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [inventoryStatus, setInventoryStatus] = useState<'low' | 'out' | 'overstocked' | 'all'>('all');
  const [inventoryPage, setInventoryPage] = useState(1);
  const [inventorySearch, setInventorySearch] = useState('');
  const [isExportingInventory, setIsExportingInventory] = useState(false);
  const debouncedInventorySearch = useDebounce(inventorySearch, 500); // 500ms delay
  const [salesPage, setSalesPage] = useState(1);
  const [salesSearch, setSalesSearch] = useState('');
  const debouncedSalesSearch = useDebounce(salesSearch, 500); // 500ms delay
  const [productPerformanceType, setProductPerformanceType] = useState<'best' | 'worst'>('best');

  // Export handlers
  const handleInventoryExport = async () => {
    try {
      setIsExportingInventory(true);
      const response = await reportsApi.exportInventoryReport({
        status: inventoryStatus,
        search: debouncedInventorySearch || undefined,
      });
      
      // Create download link
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      
      // Generate filename
      const timestamp = new Date().toISOString().split('T')[0];
      const statusSuffix = inventoryStatus !== 'all' ? `-${inventoryStatus}` : '';
      link.setAttribute('download', `inventory-report${statusSuffix}-${timestamp}.csv`);
      
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export inventory report:', error);
      alert('Failed to export inventory report. Please try again.');
    } finally {
      setIsExportingInventory(false);
    }
  };

  // Fetch categories for filter
  const { data: categoriesData } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const response = await categoriesApi.list();
      return response.data.data;
    },
  });

  // Fetch sales trends
  const { data: salesTrends, isLoading: salesTrendsLoading, error: salesTrendsError, refetch: refetchSalesTrends } = useQuery({
    queryKey: ['salesTrends', filters.startDate, filters.endDate, granularity, filters.categoryId],
    queryFn: async () => {
      const response = await analyticsApi.getSalesTrends({
        startDate: filters.startDate,
        endDate: filters.endDate,
        granularity,
        categoryId: filters.categoryId,
      });
      return response.data.data;
    },
  });

  // Fetch category performance
  const { data: categoryPerformance, isLoading: categoryPerformanceLoading, error: categoryPerformanceError, refetch: refetchCategoryPerformance } = useQuery({
    queryKey: ['categoryPerformance', filters.startDate, filters.endDate],
    queryFn: async () => {
      const response = await analyticsApi.getCategoryPerformance({
        startDate: filters.startDate,
        endDate: filters.endDate,
      });
      return response.data.data;
    },
  });

  // Fetch customer metrics
  const { data: customerMetrics, isLoading: customerMetricsLoading, error: customerMetricsError, refetch: refetchCustomerMetrics } = useQuery({
    queryKey: ['customerMetrics', filters.startDate, filters.endDate],
    queryFn: async () => {
      const response = await analyticsApi.getCustomerMetrics({
        startDate: filters.startDate,
        endDate: filters.endDate,
      });
      return response.data.data;
    },
  });

  // Fetch AOV metrics
  const { data: aovMetrics, isLoading: aovMetricsLoading, error: aovMetricsError, refetch: refetchAOVMetrics } = useQuery({
    queryKey: ['aovMetrics', filters.startDate, filters.endDate],
    queryFn: async () => {
      const response = await analyticsApi.getAOVMetrics({
        startDate: filters.startDate,
        endDate: filters.endDate,
      });
      return response.data.data;
    },
  });

  // Fetch conversion metrics
  const { data: conversionMetrics, isLoading: conversionMetricsLoading, error: conversionMetricsError, refetch: refetchConversionMetrics } = useQuery({
    queryKey: ['conversionMetrics', filters.startDate, filters.endDate],
    queryFn: async () => {
      const response = await analyticsApi.getConversionMetrics({
        startDate: filters.startDate,
        endDate: filters.endDate,
      });
      return response.data.data;
    },
  });

  // Fetch today's metrics
  const { data: todayMetrics, isLoading: todayMetricsLoading, error: todayMetricsError, refetch: refetchTodayMetrics } = useQuery({
    queryKey: ['todayMetrics'],
    queryFn: async () => {
      const response = await analyticsApi.getTodayMetrics();
      return response.data.data;
    },
    refetchInterval: 60000, // Refetch every minute
  });

  // Fetch recent orders
  const { data: recentOrders, isLoading: recentOrdersLoading, error: recentOrdersError, refetch: refetchRecentOrders } = useQuery({
    queryKey: ['recentOrders'],
    queryFn: async () => {
      const response = await analyticsApi.getRecentOrders({ limit: 10 });
      return response.data.data;
    },
    refetchInterval: 60000, // Refetch every minute
  });

  // Fetch revenue goal
  const { data: revenueGoal, isLoading: revenueGoalLoading, error: revenueGoalError, refetch: refetchRevenueGoal } = useQuery({
    queryKey: ['revenueGoal', 'monthly'],
    queryFn: async () => {
      const response = await analyticsApi.getRevenueGoal({ period: 'monthly' });
      return response.data.data;
    },
  });

  // Fetch inventory report
  const { data: inventoryReport, isLoading: inventoryReportLoading, error: inventoryReportError, refetch: refetchInventoryReport } = useQuery({
    queryKey: ['inventoryReport', inventoryStatus, inventoryPage, debouncedInventorySearch],
    queryFn: async () => {
      const response = await reportsApi.getInventoryReport({
        status: inventoryStatus,
        page: inventoryPage,
        limit: 50,
        search: debouncedInventorySearch || undefined,
      });
      return response.data.data;
    },
  });

  // Fetch sales report
  const { data: salesReport, isLoading: salesReportLoading, error: salesReportError, refetch: refetchSalesReport } = useQuery({
    queryKey: ['salesReport', filters.startDate, filters.endDate, salesPage, debouncedSalesSearch],
    queryFn: async () => {
      const response = await reportsApi.getSalesReport({
        startDate: filters.startDate,
        endDate: filters.endDate,
        page: salesPage,
        limit: 50,
        search: debouncedSalesSearch || undefined,
      });
      return response.data.data;
    },
  });

  // Fetch product performance
  const { data: productPerformance, isLoading: productPerformanceLoading, error: productPerformanceError, refetch: refetchProductPerformance } = useQuery({
    queryKey: ['productPerformance', filters.startDate, filters.endDate, productPerformanceType],
    queryFn: async () => {
      const response = await reportsApi.getProductPerformance({
        startDate: filters.startDate,
        endDate: filters.endDate,
        type: productPerformanceType,
        limit: 10,
      });
      return response.data.data;
    },
  });

  // Calculate metrics for MetricsGrid
  const metricsGridData = {
    revenue: salesTrends ? {
      current: salesTrends.trends.reduce((sum, t) => sum + t.revenue, 0),
      previous: salesTrends.previousPeriod.revenue,
      change: salesTrends.previousPeriod.percentageChange,
    } : undefined,
    orders: salesTrends ? {
      current: salesTrends.trends.reduce((sum, t) => sum + t.orderCount, 0),
      previous: salesTrends.previousPeriod.orderCount,
      change: salesTrends.previousPeriod.percentageChange,
    } : undefined,
    aov: aovMetrics ? {
      current: aovMetrics.currentAOV,
      previous: aovMetrics.previousAOV,
      change: aovMetrics.percentageChange,
    } : undefined,
    conversionRate: conversionMetrics ? {
      current: conversionMetrics.conversionRate,
      previous: conversionMetrics.previousConversionRate,
      change: conversionMetrics.percentageChange,
    } : undefined,
  };

  const isMetricsLoading = salesTrendsLoading || aovMetricsLoading || conversionMetricsLoading;
  const metricsError = salesTrendsError || aovMetricsError || conversionMetricsError;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <FilterPanel
        filters={filters}
        onFiltersChange={setFilters}
        categories={categoriesData}
        showCategoryFilter={true}
        showComparisonToggle={true}
      />

      {/* KPI Metrics */}
      <MetricsGrid
        {...metricsGridData}
        isLoading={isMetricsLoading}
        error={metricsError as Error}
        onRetry={() => {
          refetchSalesTrends();
          refetchAOVMetrics();
          refetchConversionMetrics();
        }}
      />

      {/* Real-time Metrics Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <TodayMetricsCard
          data={todayMetrics}
          isLoading={todayMetricsLoading}
          error={todayMetricsError as Error}
          onRetry={refetchTodayMetrics}
        />
        <ActiveUsersCard
          data={todayMetrics}
          isLoading={todayMetricsLoading}
          error={todayMetricsError as Error}
          onRetry={refetchTodayMetrics}
        />
        <RevenueGoalProgress
          data={revenueGoal}
          period="monthly"
          isLoading={revenueGoalLoading}
          error={revenueGoalError as Error}
          onRetry={refetchRevenueGoal}
        />
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="lg:col-span-2">
          <Suspense fallback={<ChartSkeleton />}>
            <SalesTrendChart
              data={salesTrends}
              granularity={granularity}
              onGranularityChange={setGranularity}
              isLoading={salesTrendsLoading}
              error={salesTrendsError as Error}
              onRetry={refetchSalesTrends}
            />
          </Suspense>
        </div>

        <Suspense fallback={<ChartSkeleton />}>
          <CategoryPerformanceChart
            data={categoryPerformance}
            isLoading={categoryPerformanceLoading}
            error={categoryPerformanceError as Error}
            onRetry={refetchCategoryPerformance}
          />
        </Suspense>

        <Suspense fallback={<ChartSkeleton />}>
          <CustomerAcquisitionChart
            data={customerMetrics}
            isLoading={customerMetricsLoading}
            error={customerMetricsError as Error}
            onRetry={refetchCustomerMetrics}
          />
        </Suspense>

        <Suspense fallback={<ChartSkeleton />}>
          <AOVTrendChart
            data={aovMetrics}
            isLoading={aovMetricsLoading}
            error={aovMetricsError as Error}
            onRetry={refetchAOVMetrics}
          />
        </Suspense>

        <Suspense fallback={<ChartSkeleton />}>
          <ConversionRateChart
            data={conversionMetrics}
            isLoading={conversionMetricsLoading}
            error={conversionMetricsError as Error}
            onRetry={refetchConversionMetrics}
          />
        </Suspense>
      </div>

      {/* Recent Orders Feed */}
      <RecentOrdersFeed
        data={recentOrders}
        isLoading={recentOrdersLoading}
        error={recentOrdersError as Error}
        onRetry={refetchRecentOrders}
      />

      {/* Reports Section */}
      <div className="grid grid-cols-1 gap-6">
        <InventoryTable
          data={inventoryReport}
          statusFilter={inventoryStatus}
          onStatusFilterChange={setInventoryStatus}
          searchQuery={inventorySearch}
          onSearchChange={(search) => {
            setInventorySearch(search);
            setInventoryPage(1); // Reset to first page on search
          }}
          currentPage={inventoryPage}
          onPageChange={setInventoryPage}
          onExport={handleInventoryExport}
          isExporting={isExportingInventory}
          isLoading={inventoryReportLoading}
          error={inventoryReportError as Error}
          onRetry={refetchInventoryReport}
        />

        <SalesTable
          data={salesReport}
          currentPage={salesPage}
          onPageChange={setSalesPage}
          startDate={filters.startDate}
          endDate={filters.endDate}
          searchQuery={salesSearch}
          onSearchChange={(search) => {
            setSalesSearch(search);
            setSalesPage(1); // Reset to first page on search
          }}
          isLoading={salesReportLoading}
          error={salesReportError as Error}
          onRetry={refetchSalesReport}
        />

        <ProductPerformanceTable
          data={productPerformance}
          type={productPerformanceType}
          onTypeChange={setProductPerformanceType}
          isLoading={productPerformanceLoading}
          error={productPerformanceError as Error}
          onRetry={refetchProductPerformance}
        />
      </div>
    </div>
  );
};
