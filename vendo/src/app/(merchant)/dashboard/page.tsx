'use client';

import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, ShoppingCart, Users, DollarSign } from 'lucide-react';

const data = [
  { name: 'Jan', orders: 400, revenue: 2400 },
  { name: 'Feb', orders: 300, revenue: 1398 },
  { name: 'Mar', orders: 200, revenue: 9800 },
  { name: 'Apr', orders: 278, revenue: 3908 },
  { name: 'May', orders: 189, revenue: 4800 },
  { name: 'Jun', orders: 239, revenue: 3800 },
];

const topProducts = [
  { name: 'Product A', value: 40 },
  { name: 'Product B', value: 30 },
  { name: 'Product C', value: 20 },
  { name: 'Product D', value: 10 },
];

const COLORS = ['#1DB849', '#7F77DD', '#EF9F27', '#D85A30'];

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      {/* Welcome Section */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome back, John!</h1>
        <p className="text-gray-600">Here's what's happening with your store today.</p>
      </div>

      {/* KPI Cards */}
      <div className="grid md:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-sm text-gray-600 mb-1">Total Revenue</p>
              <h3 className="text-2xl font-bold text-gray-900">R 45,231.89</h3>
            </div>
            <div className="w-10 h-10 bg-vendo-primary-light rounded-lg flex items-center justify-center">
              <DollarSign className="text-vendo-primary" size={20} />
            </div>
          </div>
          <p className="text-sm text-green-600">↑ 20.1% from last month</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-sm text-gray-600 mb-1">Total Orders</p>
              <h3 className="text-2xl font-bold text-gray-900">1,234</h3>
            </div>
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <ShoppingCart className="text-blue-600" size={20} />
            </div>
          </div>
          <p className="text-sm text-green-600">↑ 12.5% from last month</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-sm text-gray-600 mb-1">Total Customers</p>
              <h3 className="text-2xl font-bold text-gray-900">456</h3>
            </div>
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <Users className="text-purple-600" size={20} />
            </div>
          </div>
          <p className="text-sm text-green-600">↑ 8.3% from last month</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-sm text-gray-600 mb-1">Conversion Rate</p>
              <h3 className="text-2xl font-bold text-gray-900">3.24%</h3>
            </div>
            <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
              <TrendingUp className="text-orange-600" size={20} />
            </div>
          </div>
          <p className="text-sm text-green-600">↑ 2.1% from last month</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Revenue & Orders Chart */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Revenue & Orders</h2>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="revenue" stroke="#1DB849" strokeWidth={2} name="Revenue (R)" />
              <Line type="monotone" dataKey="orders" stroke="#7F77DD" strokeWidth={2} name="Orders" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Top Products */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Top Products</h2>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie data={topProducts} cx="50%" cy="50%" labelLine={false} label={({ name, value }) => `${name}: ${value}%`} outerRadius={80} fill="#8884d8" dataKey="value">
                {topProducts.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Orders */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Orders</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4 font-medium text-gray-700">Order ID</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">Customer</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">Amount</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">Status</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">Date</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-200 hover:bg-gray-50">
                <td className="py-3 px-4 text-gray-900 font-medium">#1001</td>
                <td className="py-3 px-4 text-gray-600">Jane Doe</td>
                <td className="py-3 px-4 text-gray-900 font-medium">R 1,250.00</td>
                <td className="py-3 px-4">
                  <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium">Completed</span>
                </td>
                <td className="py-3 px-4 text-gray-600">2026-07-25</td>
              </tr>
              <tr className="border-b border-gray-200 hover:bg-gray-50">
                <td className="py-3 px-4 text-gray-900 font-medium">#1002</td>
                <td className="py-3 px-4 text-gray-600">John Smith</td>
                <td className="py-3 px-4 text-gray-900 font-medium">R 2,100.00</td>
                <td className="py-3 px-4">
                  <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">Processing</span>
                </td>
                <td className="py-3 px-4 text-gray-600">2026-07-24</td>
              </tr>
              <tr className="hover:bg-gray-50">
                <td className="py-3 px-4 text-gray-900 font-medium">#1003</td>
                <td className="py-3 px-4 text-gray-600">Mary Johnson</td>
                <td className="py-3 px-4 text-gray-900 font-medium">R 850.50</td>
                <td className="py-3 px-4">
                  <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-sm font-medium">Pending</span>
                </td>
                <td className="py-3 px-4 text-gray-600">2026-07-23</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
