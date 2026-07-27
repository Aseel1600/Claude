import Link from 'next/link';
import { LogOut, Settings, BarChart3, Package, ShoppingCart, Users, CreditCard } from 'lucide-react';

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <Link href="/merchant/dashboard" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-vendo-primary rounded-lg flex items-center justify-center">
              <span className="text-white font-bold">V</span>
            </div>
            <span className="text-xl font-bold text-gray-900">Vendo</span>
          </Link>
          <div className="flex items-center gap-4">
            <button className="text-gray-600 hover:text-gray-900">
              <Settings size={20} />
            </button>
            <button className="text-gray-600 hover:text-gray-900">
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 bg-white border-r border-gray-200 min-h-screen">
          <nav className="p-4 space-y-2">
            <Link
              href="/merchant/dashboard"
              className="flex items-center gap-3 px-4 py-2 rounded-lg bg-vendo-primary-light text-vendo-primary font-medium"
            >
              <BarChart3 size={20} />
              Overview
            </Link>
            <Link
              href="/merchant/orders"
              className="flex items-center gap-3 px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100"
            >
              <ShoppingCart size={20} />
              Orders
            </Link>
            <Link
              href="/merchant/products"
              className="flex items-center gap-3 px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100"
            >
              <Package size={20} />
              Products
            </Link>
            <Link
              href="/merchant/customers"
              className="flex items-center gap-3 px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100"
            >
              <Users size={20} />
              Customers
            </Link>
            <Link
              href="/merchant/payments"
              className="flex items-center gap-3 px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100"
            >
              <CreditCard size={20} />
              Payments
            </Link>
          </nav>

          <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-200 bg-gray-50">
            <div className="text-sm">
              <p className="font-semibold text-gray-900">John Doe</p>
              <p className="text-gray-600">john@example.com</p>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
