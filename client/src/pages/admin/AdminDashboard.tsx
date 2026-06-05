import React from 'react';
import { DashboardContainer } from '../../components/dashboard/DashboardContainer';

export default function AdminDashboard() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Analytics Dashboard
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Comprehensive insights into your business performance
          </p>
        </div>
        
        <DashboardContainer />
      </div>
    </div>
  );
}
