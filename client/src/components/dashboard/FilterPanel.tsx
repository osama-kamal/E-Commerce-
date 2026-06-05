import React, { useState } from 'react';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';

export interface FilterState {
  startDate: string;
  endDate: string;
  categoryId?: string;
  status?: string;
  showComparison: boolean;
}

interface FilterPanelProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  categories?: Array<{ _id: string; name: string }>;
  showCategoryFilter?: boolean;
  showStatusFilter?: boolean;
  showComparisonToggle?: boolean;
}

type DatePreset = 'today' | 'last7days' | 'last30days' | 'custom';

export const FilterPanel: React.FC<FilterPanelProps> = ({
  filters,
  onFiltersChange,
  categories = [],
  showCategoryFilter = false,
  showStatusFilter = false,
  showComparisonToggle = false,
}) => {
  const [selectedPreset, setSelectedPreset] = useState<DatePreset>('last30days');
  const [showCustomPicker, setShowCustomPicker] = useState(false);

  const handlePresetChange = (preset: DatePreset) => {
    setSelectedPreset(preset);
    
    if (preset === 'custom') {
      setShowCustomPicker(true);
      return;
    }

    setShowCustomPicker(false);
    
    const now = new Date();
    let startDate: Date;
    let endDate: Date = endOfDay(now);

    switch (preset) {
      case 'today':
        startDate = startOfDay(now);
        endDate = endOfDay(now);
        break;
      case 'last7days':
        startDate = startOfDay(subDays(now, 6)); // Last 7 days including today
        break;
      case 'last30days':
        startDate = startOfDay(subDays(now, 29)); // Last 30 days including today
        break;
      default:
        return;
    }

    onFiltersChange({
      ...filters,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    });
  };

  const handleCustomDateChange = (field: 'startDate' | 'endDate', value: string) => {
    const date = new Date(value);
    const isoDate = field === 'startDate' 
      ? startOfDay(date).toISOString()
      : endOfDay(date).toISOString();

    onFiltersChange({
      ...filters,
      [field]: isoDate,
    });
  };

  const handleCategoryChange = (categoryId: string) => {
    onFiltersChange({
      ...filters,
      categoryId: categoryId === 'all' ? undefined : categoryId,
    });
  };

  const handleStatusChange = (status: string) => {
    onFiltersChange({
      ...filters,
      status: status === 'all' ? undefined : status,
    });
  };

  const handleComparisonToggle = () => {
    onFiltersChange({
      ...filters,
      showComparison: !filters.showComparison,
    });
  };

  const formatDateForInput = (isoDate: string) => {
    return format(new Date(isoDate), 'yyyy-MM-dd');
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
      <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Filters</h3>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Date Range Preset */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Date Range
          </label>
          <select
            value={selectedPreset}
            onChange={(e) => handlePresetChange(e.target.value as DatePreset)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="today">Today</option>
            <option value="last7days">Last 7 Days</option>
            <option value="last30days">Last 30 Days</option>
            <option value="custom">Custom Range</option>
          </select>
        </div>

        {/* Custom Date Pickers */}
        {showCustomPicker && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Start Date
              </label>
              <input
                type="date"
                value={formatDateForInput(filters.startDate)}
                onChange={(e) => handleCustomDateChange('startDate', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                End Date
              </label>
              <input
                type="date"
                value={formatDateForInput(filters.endDate)}
                onChange={(e) => handleCustomDateChange('endDate', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              />
            </div>
          </>
        )}

        {/* Category Filter */}
        {showCategoryFilter && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Category
            </label>
            <select
              value={filters.categoryId || 'all'}
              onChange={(e) => handleCategoryChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            >
              <option value="all">All Categories</option>
              {categories.map((category) => (
                <option key={category._id} value={category._id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Status Filter */}
        {showStatusFilter && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Order Status
            </label>
            <select
              value={filters.status || 'all'}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="shipped">Shipped</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        )}

        {/* Period Comparison Toggle */}
        {showComparisonToggle && (
          <div className="flex items-end">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.showComparison}
                onChange={handleComparisonToggle}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Show Period Comparison
              </span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
};
