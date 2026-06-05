# Implementation Plan: Enhanced Admin Dashboard

## Overview

This implementation plan breaks down the Enhanced Admin Dashboard feature into discrete, incremental coding tasks. The approach follows a layered implementation strategy: backend services and API endpoints first, followed by frontend components and integration. Each task builds on previous work, with property-based tests integrated close to implementation to catch errors early.

## Tasks

- [x] 1. Set up backend infrastructure and database indexes
  - Create analytics and reports service files with TypeScript interfaces
  - Add database indexes for orders (createdAt, status, userId), products (categoryId, stock), and users (createdAt, lastLoginAt)
  - Set up node-cache for in-memory caching
  - Install csv-stringify for CSV generation
  - _Requirements: 16.1, 17.1_

- [x] 2. Implement date range utilities and validation
  - [x] 2.1 Create date range validation and calculation utilities
    - Write functions for validating date ranges (start <= end, max 365 days)
    - Implement preset date range calculations (Today, Last 7 days, Last 30 days)
    - Add UTC timezone handling
    - Add default date range logic (last 30 days)
    - _Requirements: 12.1, 12.2, 12.3, 12.6, 23.1, 23.2, 23.3, 23.4, 23.5_
  
  - [ ]* 2.2 Write property tests for date range utilities
    - **Property 16: Date range validation**
    - **Property 17: Date range preset calculations**
    - **Property 18: Date range limits**
    - **Property 19: Default date range**
    - **Property 20: Invalid date handling**
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.6, 23.1, 23.2, 23.3, 23.4, 23.5**

- [x] 3. Implement cache service
  - [x] 3.1 Create CacheService with get, set, invalidate, and clear methods
    - Implement TTL-based caching using node-cache
    - Add cache key pattern generators
    - Implement cache invalidation by pattern matching
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_
  
  - [ ]* 3.2 Write property tests for cache service
    - **Property 33: Cache TTL enforcement**
    - **Property 34: Cache invalidation on data change**
    - **Validates: Requirements 17.1, 17.3, 17.4, 17.5**

- [x] 4. Implement sales trends analytics
  - [x] 4.1 Create sales trends aggregation pipeline and service method
    - Write MongoDB aggregation for daily/weekly/monthly sales trends
    - Implement previous period comparison calculation
    - Add category filtering support
    - Integrate caching with appropriate TTL
    - _Requirements: 1.1, 1.3, 2.3_
  
  - [x] 4.2 Create GET /api/admin/analytics/sales-trends endpoint
    - Add request validation for date range and granularity
    - Call service method and format response
    - Handle errors and return appropriate status codes
    - _Requirements: 1.1, 1.3_
  
  - [ ]* 4.3 Write property tests for sales trends
    - **Property 1: Sales trends data completeness**
    - **Validates: Requirements 1.1, 1.3**

- [x] 5. Implement category performance analytics
  - [x] 5.1 Create category performance aggregation pipeline and service method
    - Write MongoDB aggregation with $lookup for products and categories
    - Calculate revenue and percentage for each category
    - Implement descending sort by revenue
    - Include categories with zero sales
    - Integrate caching
    - _Requirements: 2.1, 2.2, 2.4, 2.5_
  
  - [x] 5.2 Create GET /api/admin/analytics/category-performance endpoint
    - Add request validation
    - Call service method and format response
    - Handle errors
    - _Requirements: 2.1, 2.2, 2.4, 2.5_
  
  - [ ]* 5.3 Write property tests for category performance
    - **Property 2: Category performance completeness**
    - **Property 3: Category sorting invariant**
    - **Validates: Requirements 2.1, 2.2, 2.4, 2.5**

- [x] 6. Implement customer metrics analytics
  - [x] 6.1 Create customer metrics aggregation pipelines and service method
    - Write aggregation for new customers count
    - Write aggregation for repeat customer rate
    - Write aggregation for churn rate (90-day threshold)
    - Write aggregation for acquisition trend over time
    - Calculate previous period comparison
    - Integrate caching
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  
  - [x] 6.2 Create GET /api/admin/analytics/customer-metrics endpoint
    - Add request validation
    - Call service method and format response
    - Handle errors
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  
  - [ ]* 6.3 Write property tests for customer metrics
    - **Property 4: Customer metrics data structure**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

- [x] 7. Implement AOV and conversion rate analytics
  - [x] 7.1 Create AOV metrics aggregation pipeline and service method
    - Write aggregation to calculate average order value (revenue / order count)
    - Calculate previous period AOV
    - Generate AOV trend over time
    - Integrate caching
    - _Requirements: 4.1, 4.2, 4.5_
  
  - [x] 7.2 Create GET /api/admin/analytics/aov-metrics endpoint
    - Add request validation
    - Call service method and format response
    - Handle errors
    - _Requirements: 4.1, 4.2, 4.5_
  
  - [x] 7.3 Create conversion rate metrics aggregation pipeline and service method
    - Write aggregation to calculate conversion rate (orders / visitors * 100)
    - Format to 2 decimal places
    - Calculate previous period comparison
    - Generate conversion trend over time
    - Handle missing visitor data gracefully
    - Integrate caching
    - _Requirements: 5.1, 5.2, 5.3, 5.5_
  
  - [x] 7.4 Create GET /api/admin/analytics/conversion-metrics endpoint
    - Add request validation
    - Call service method and format response
    - Handle errors and insufficient data cases
    - _Requirements: 5.1, 5.2, 5.3, 5.5_
  
  - [ ]* 7.5 Write property tests for AOV and conversion metrics
    - **Property 5: AOV calculation correctness**
    - **Property 6: Conversion rate calculation**
    - **Validates: Requirements 4.1, 4.2, 4.5, 5.1, 5.2, 5.3, 5.5**

- [x] 8. Implement real-time metrics
  - [x] 8.1 Create today's metrics service method
    - Calculate today's revenue (sum of completed orders today)
    - Calculate today's order count
    - Calculate active users (logged in within 24 hours)
    - Calculate yesterday's metrics for comparison
    - Calculate percentage changes
    - Integrate caching with 5-minute TTL
    - _Requirements: 9.1, 9.2, 9.5, 10.1_
  
  - [x] 8.2 Create GET /api/admin/analytics/today-metrics endpoint
    - Call service method and format response
    - Handle errors
    - _Requirements: 9.1, 9.2, 9.5, 10.1_
  
  - [x] 8.3 Create recent orders service method
    - Query most recent orders sorted by createdAt descending
    - Limit to specified count (default 10, max 50)
    - Calculate relative time for each order
    - Integrate caching with 1-minute TTL
    - _Requirements: 10.2, 10.3, 10.4, 10.5_
  
  - [x] 8.4 Create GET /api/admin/analytics/recent-orders endpoint
    - Add request validation for limit parameter
    - Call service method and format response
    - Handle errors
    - _Requirements: 10.2, 10.3, 10.4, 10.5_
  
  - [ ]* 8.5 Write property tests for real-time metrics
    - **Property 12: Today's metrics calculation**
    - **Property 13: Recent orders limit and ordering**
    - **Property 14: Active users counting**
    - **Validates: Requirements 9.1, 9.2, 9.5, 10.1, 10.2, 10.3, 10.4, 10.5**

- [x] 9. Implement revenue goal tracking
  - [x] 9.1 Create revenue goal service method
    - Query current period revenue based on period type (daily/weekly/monthly)
    - Retrieve goal amount from configuration or database
    - Calculate progress percentage (capped at 100%)
    - Set overflow indicator when exceeded
    - Integrate caching with 5-minute TTL
    - _Requirements: 11.1, 11.2, 11.3_
  
  - [x] 9.2 Create GET /api/admin/analytics/revenue-goal endpoint
    - Add request validation for period parameter
    - Call service method and format response
    - Handle missing goal configuration
    - _Requirements: 11.1, 11.2, 11.3_
  
  - [ ]* 9.3 Write property tests for revenue goal
    - **Property 15: Revenue goal progress calculation**
    - **Validates: Requirements 11.1, 11.2, 11.3**
  
  - [ ]* 9.4 Write unit tests for edge cases
    - Test missing goal configuration
    - Test goal exceeded scenario
    - _Requirements: 11.4_

- [x] 10. Checkpoint - Ensure all analytics endpoints work
  - Test all analytics endpoints with Postman or similar tool
  - Verify caching behavior
  - Check error handling
  - Ensure all tests pass, ask the user if questions arise

- [x] 11. Implement inventory reports
  - [x] 11.1 Create inventory report aggregation pipeline and service method
    - Write aggregation with $lookup for categories
    - Add $addFields to classify inventory status (out/low/overstocked/normal)
    - Filter by status if specified
    - Implement pagination (skip/limit)
    - Calculate total count for pagination metadata
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 18.1, 18.2_
  
  - [x] 11.2 Create GET /api/admin/reports/inventory endpoint
    - Add request validation for status, page, and limit parameters
    - Call service method and format response with pagination metadata
    - Handle errors
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 18.1, 18.2_
  
  - [ ]* 11.3 Write property tests for inventory reports
    - **Property 7: Inventory status classification**
    - **Property 8: Inventory report data structure**
    - **Property 35: Inventory status update reflection**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**

- [x] 12. Implement sales reports
  - [x] 12.1 Create sales report aggregation pipeline and service method
    - Write aggregation to fetch orders with customer details
    - Filter by date range and optional status
    - Implement pagination
    - Calculate summary totals (totalRevenue, totalOrders)
    - _Requirements: 7.1, 18.1, 18.2_
  
  - [x] 12.2 Create GET /api/admin/reports/sales endpoint
    - Add request validation for date range, page, and limit
    - Call service method and format response with pagination metadata
    - Handle errors
    - _Requirements: 7.1, 18.1, 18.2_
  
  - [x] 12.3 Create CSV export service method
    - Fetch all sales records for date range (no pagination)
    - Format data as CSV with proper escaping (commas, quotes)
    - Add column headers as first row
    - Handle special characters and encoding
    - Generate filename with report type and date range
    - _Requirements: 7.2, 7.3, 7.5, 21.1, 21.2, 21.3, 21.4, 21.5_
  
  - [x] 12.4 Create GET /api/admin/reports/sales/export endpoint
    - Add request validation for date range
    - Call CSV export service method
    - Set Content-Type header to text/csv
    - Set Content-Disposition header with filename
    - Stream CSV response
    - _Requirements: 7.2, 7.3, 7.5, 21.5_
  
  - [ ]* 12.5 Write property tests for sales reports
    - **Property 9: Sales report data completeness**
    - **Property 10: CSV export completeness**
    - **Property 36: CSV field escaping**
    - **Property 37: CSV special character encoding**
    - **Property 38: CSV filename format**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.5, 21.1, 21.2, 21.3, 21.4, 21.5**
  
  - [ ]* 12.6 Write unit tests for CSV edge cases
    - Test empty data export (headers only)
    - Test large dataset export
    - _Requirements: 7.4_

- [x] 13. Implement product performance reports
  - [x] 13.1 Create product performance aggregation pipeline and service method
    - Write aggregation to calculate units sold and total revenue per product
    - Sort by revenue (descending for best, ascending for worst)
    - Limit to specified count (default 10, max 50)
    - Include products with zero sales in worst sellers
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  
  - [x] 13.2 Create GET /api/admin/reports/product-performance endpoint
    - Add request validation for date range, type, and limit
    - Call service method and format response
    - Handle errors
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  
  - [ ]* 13.3 Write property tests for product performance
    - **Property 11: Product performance ranking**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.5**
  
  - [ ]* 13.4 Write unit tests for edge cases
    - Test zero-sales products in worst sellers
    - _Requirements: 8.4_

- [x] 14. Implement pagination utilities
  - [ ]* 14.1 Write property tests for pagination
    - **Property 30: Pagination trigger**
    - **Property 31: Page data isolation**
    - **Property 32: Pagination button states**
    - **Validates: Requirements 18.1, 18.2, 18.3, 18.4, 18.5**

- [x] 15. Implement filter utilities
  - [x] 15.1 Create filter application utilities
    - Write functions to apply category filters to queries
    - Write functions to apply status filters to queries
    - Write function to combine multiple filters with AND logic
    - _Requirements: 13.1, 13.2, 13.3, 13.4_
  
  - [ ]* 15.2 Write property tests for filtering
    - **Property 21: Category filtering**
    - **Property 22: Status filtering**
    - **Property 23: Multiple filter combination**
    - **Property 24: Filter clearing**
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4**

- [x] 16. Implement period comparison utilities
  - [x] 16.1 Create period comparison calculation utilities
    - Write function to calculate previous period date range
    - Write function to calculate percentage change
    - Handle division by zero (return "N/A")
    - _Requirements: 14.1, 14.2, 14.3_
  
  - [ ]* 16.2 Write property tests for period comparison
    - **Property 25: Period comparison date calculation**
    - **Validates: Requirements 14.1, 14.2**
  
  - [ ]* 16.3 Write unit tests for edge cases
    - Test zero previous value (N/A result)
    - _Requirements: 14.3_

- [x] 17. Checkpoint - Ensure all backend services and endpoints work
  - Run all backend tests
  - Test all report endpoints with various filters
  - Verify CSV export functionality
  - Test pagination with large datasets
  - Ensure all tests pass, ask the user if questions arise

- [x] 18. Set up frontend infrastructure
  - Install Recharts, date-fns, and React Query
  - Create API client functions for all analytics and report endpoints
  - Set up React Query configuration with caching
  - Create TypeScript types for all API responses
  - _Requirements: 1.1, 2.1_

- [x] 19. Implement formatting utilities
  - [x] 19.1 Create monetary value formatting utility
    - Format with USD symbol, 2 decimal places, thousand separators
    - Handle negative values (minus before dollar sign)
    - Handle zero values
    - _Requirements: 24.1, 24.2, 24.3, 24.5_
  
  - [x] 19.2 Create relative time formatting utility
    - Format timestamps as relative time (e.g., "5 minutes ago")
    - Handle various time ranges (minutes, hours, days)
    - _Requirements: 10.5_
  
  - [ ]* 19.3 Write property tests for formatting
    - **Property 39: Monetary value formatting**
    - **Property 40: Relative time formatting**
    - **Validates: Requirements 24.1, 24.2, 24.3, 24.5, 10.5**
  
  - [ ]* 19.4 Write unit tests for edge cases
    - Test zero monetary value
    - _Requirements: 24.4_

- [x] 20. Implement filter panel component
  - [x] 20.1 Create FilterPanel component
    - Add date range picker with presets (Today, Last 7 days, Last 30 days, Custom)
    - Add category selector dropdown
    - Add order status selector dropdown
    - Add period comparison toggle
    - Emit filter change events to parent
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 13.1, 13.2, 14.1_
  
  - [ ]* 20.2 Write unit tests for FilterPanel
    - Test preset date range selection
    - Test custom date range picker display
    - Test filter change events
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [x] 21. Implement KPI metrics cards
  - [x] 21.1 Create MetricsGrid component with KPI cards
    - Create cards for revenue, orders, AOV, conversion rate
    - Display current value and previous period comparison
    - Show percentage change with color coding (green/red)
    - Add loading skeletons
    - Add error states with retry button
    - _Requirements: 1.4, 1.5, 4.3, 4.4, 9.3, 9.4, 20.1, 20.2, 20.3_
  
  - [ ]* 21.2 Write property tests for comparison color coding
    - **Property 26: Comparison color coding**
    - **Validates: Requirements 1.4, 1.5, 4.3, 4.4, 9.3, 9.4, 14.5, 14.6, 15.5**
  
  - [ ]* 21.3 Write unit tests for UI states
    - Test loading state display
    - Test error state display
    - Test retry functionality
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5_

- [x] 22. Implement sales trend chart
  - [x] 22.1 Create SalesTrendChart component
    - Use Recharts LineChart for visualization
    - Display daily/weekly/monthly sales based on granularity
    - Add interactive tooltips with exact values and dates
    - Show previous period comparison data
    - Implement responsive layout (single column on mobile)
    - Add loading and error states
    - Handle empty data state
    - _Requirements: 1.1, 1.2, 1.6, 15.1, 15.2, 15.3, 15.4_
  
  - [ ]* 22.2 Write property tests for tooltips
    - **Property 27: Interactive tooltips**
    - **Validates: Requirements 1.6, 15.3, 22.3**
  
  - [ ]* 22.3 Write unit tests for chart states
    - Test granularity options display
    - Test empty data message
    - Test responsive layout
    - _Requirements: 1.2, 15.1, 15.2, 15.4_

- [x] 23. Implement category performance chart
  - [x] 23.1 Create CategoryPerformanceChart component
    - Use Recharts PieChart for visualization
    - Group categories < 2% into "Other"
    - Use distinct colors for each category
    - Add interactive tooltips with category name, revenue, and percentage
    - Implement responsive layout
    - Add loading and error states
    - Handle empty data state
    - _Requirements: 2.1, 22.1, 22.2, 22.3, 22.4, 22.5, 15.1, 15.2_
  
  - [ ]* 23.2 Write property tests for category grouping
    - **Property 28: Small category grouping**
    - **Property 29: Distinct category colors**
    - **Validates: Requirements 22.2, 22.4**
  
  - [ ]* 23.3 Write unit tests for edge cases
    - Test empty revenue data message
    - _Requirements: 22.5_

- [x] 24. Implement customer acquisition and AOV charts
  - [x] 24.1 Create CustomerAcquisitionChart component
    - Use Recharts LineChart for visualization
    - Display new customers over time
    - Add interactive tooltips
    - Implement responsive layout
    - Add loading and error states
    - _Requirements: 3.4, 15.1, 15.2, 15.3_
  
  - [x] 24.2 Create AOVTrendChart component
    - Use Recharts LineChart for visualization
    - Display AOV changes over time
    - Add interactive tooltips
    - Implement responsive layout
    - Add loading and error states
    - _Requirements: 4.5, 15.1, 15.2, 15.3_

- [x] 25. Implement conversion rate chart
  - [x] 25.1 Create ConversionRateChart component
    - Use Recharts LineChart for visualization
    - Display conversion rate over time
    - Add interactive tooltips
    - Implement responsive layout
    - Add loading and error states
    - Handle insufficient data message
    - _Requirements: 5.5, 15.1, 15.2, 15.3, 5.4_
  
  - [ ]* 25.2 Write unit tests for edge cases
    - Test insufficient data message
    - _Requirements: 5.4_

- [x] 26. Implement inventory report table
  - [x] 26.1 Create InventoryTable component
    - Display products with name, category, stock, and status
    - Add status filter (low/out/overstocked/all)
    - Implement pagination controls
    - Disable Previous button on first page
    - Disable Next button on last page
    - Show current page and total pages
    - Add loading and error states
    - Handle empty results message
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 18.1, 18.2, 18.3, 18.4, 18.5, 13.5_
  
  - [ ]* 26.2 Write unit tests for pagination
    - Test pagination button states
    - Test page navigation
    - _Requirements: 18.3, 18.4_
  
  - [ ]* 26.3 Write unit tests for edge cases
    - Test empty results message
    - _Requirements: 13.5_

- [x] 27. Implement sales report table with export
  - [x] 27.1 Create SalesTable component
    - Display orders with date, ID, customer, amount, and status
    - Implement pagination controls
    - Add export to CSV button
    - Handle CSV download with proper filename
    - Add loading and error states
    - Handle empty results message
    - _Requirements: 7.1, 7.2, 18.1, 18.2, 18.3, 18.4, 18.5, 13.5_
  
  - [ ]* 27.2 Write unit tests for export functionality
    - Test CSV download trigger
    - Test filename format
    - _Requirements: 7.2, 21.4_

- [x] 28. Implement product performance table
  - [x] 28.1 Create ProductPerformanceTable component
    - Display products with name, units sold, and revenue
    - Add type selector (best/worst sellers)
    - Limit to 10 products by default
    - Add loading and error states
    - _Requirements: 8.1, 8.2, 8.3, 8.5_

- [x] 29. Implement real-time metrics section
  - [x] 29.1 Create TodayMetricsCard component
    - Display today's revenue and order count
    - Show comparison to yesterday with color coding
    - Add loading and error states
    - _Requirements: 9.1, 9.2, 9.5, 9.3, 9.4_
  
  - [x] 29.2 Create ActiveUsersCard component
    - Display active users count (logged in within 24 hours)
    - Add loading and error states
    - _Requirements: 10.1_
  
  - [x] 29.3 Create RecentOrdersFeed component
    - Display 10 most recent orders
    - Show order ID, customer, amount, and relative time
    - Add loading and error states
    - _Requirements: 10.2, 10.3, 10.5_
  
  - [x] 29.4 Create RevenueGoalProgress component
    - Display progress bar with current revenue vs goal
    - Show percentage and absolute values
    - Cap progress at 100% with overflow indicator
    - Handle missing goal configuration
    - Add loading and error states
    - _Requirements: 11.1, 11.2, 11.3, 11.4_
  
  - [ ]* 29.5 Write unit tests for edge cases
    - Test missing goal message
    - Test goal exceeded scenario
    - _Requirements: 11.4_

- [x] 30. Implement main dashboard container
  - [x] 30.1 Create DashboardContainer component
    - Integrate FilterPanel for global filter state
    - Integrate MetricsGrid with KPI cards
    - Integrate all chart components (sales, category, customer, AOV, conversion)
    - Integrate all report tables (inventory, sales, product performance)
    - Integrate real-time metrics section
    - Implement lazy loading for chart components
    - Handle global error boundary
    - Coordinate data fetching with React Query
    - Apply filters to all data requests
    - _Requirements: 12.5, 19.1, 19.2_
  
  - [ ]* 30.2 Write property tests for UI state management
    - **Property 41: Loading state indicators**
    - **Property 42: Error state display**
    - **Property 43: State transition on retry**
    - **Property 44: Successful load state**
    - **Validates: Requirements 19.3, 19.4, 19.5, 20.1, 20.2, 20.3, 20.4, 20.5**

- [x] 31. Implement responsive layout
  - [x] 31.1 Add responsive CSS and media queries
    - Single column layout for mobile (< 768px)
    - Multi-column grid layout for desktop (>= 768px)
    - Ensure all charts and tables are responsive
    - Test on various screen sizes
    - _Requirements: 15.1, 15.2_
  
  - [ ]* 31.2 Write unit tests for responsive layout
    - Test mobile layout (single column)
    - Test desktop layout (multi-column)
    - _Requirements: 15.1, 15.2_

- [ ] 32. Add cache invalidation hooks
  - [ ] 32.1 Add cache invalidation on order mutations
    - Hook into order creation events
    - Hook into order update events
    - Invalidate relevant cached metrics (today's metrics, sales trends, etc.)
    - _Requirements: 17.4, 17.5_
  
  - [ ]* 32.2 Write integration tests for cache invalidation
    - Test cache invalidation on order creation
    - Test cache invalidation on order update
    - Test cache regeneration after invalidation
    - _Requirements: 17.4, 17.5_

- [ ] 33. Final checkpoint - Integration testing
  - Test complete user flows (select filters → view updated data)
  - Test CSV export end-to-end
  - Test pagination across all tables
  - Test responsive layout on mobile and desktop
  - Test error handling and retry functionality
  - Verify all property-based tests pass with 100+ iterations
  - Ensure all tests pass, ask the user if questions arise

- [ ] 34. Performance optimization and monitoring
  - [ ] 34.1 Optimize database queries
    - Verify all indexes are being used
    - Profile slow queries and optimize
    - Test with large datasets (100k+ orders)
    - _Requirements: 16.4_
  
  - [ ] 34.2 Optimize frontend performance
    - Implement code splitting for dashboard sections
    - Add debouncing to filter changes (300ms)
    - Use React.memo for expensive components
    - Test lazy loading behavior
    - _Requirements: 19.1, 19.2_
  
  - [ ]* 34.3 Write performance tests
    - Test aggregation query completion time (< 2 seconds)
    - Test cache effectiveness under load
    - _Requirements: 16.4_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property-based tests are placed close to implementation to catch errors early
- Checkpoints ensure incremental validation at key milestones
- All monetary values must be formatted in USD with proper formatting
- All dates must use UTC timezone for consistency
- Minimum 100 iterations for all property-based tests using fast-check library
