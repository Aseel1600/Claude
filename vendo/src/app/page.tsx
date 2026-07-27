import Link from 'next/link';
import { ArrowRight, Zap, Lock, Globe, Smartphone } from 'lucide-react';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-white">
      {/* Navigation */}
      <nav className="fixed top-0 w-full bg-white border-b border-gray-200 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-vendo-primary rounded-lg flex items-center justify-center">
              <span className="text-white font-bold">V</span>
            </div>
            <span className="text-xl font-bold text-gray-900">Vendo</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/auth/login" className="text-gray-600 hover:text-gray-900">
              Login
            </Link>
            <Link
              href="/auth/register"
              className="bg-vendo-primary text-white px-6 py-2 rounded-lg hover:bg-vendo-primary-dark transition"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-5xl sm:text-6xl font-bold text-gray-900 mb-6">
            Everything Your Business Needs
          </h1>
          <p className="text-xl text-gray-600 mb-8 leading-relaxed">
            Vendo is an African commerce platform that helps you build an online store, accept payments, and manage your business with zero setup fees.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
            <Link
              href="/auth/register"
              className="bg-vendo-primary text-white px-8 py-3 rounded-lg hover:bg-vendo-primary-dark transition flex items-center justify-center gap-2"
            >
              Launch Your Store <ArrowRight size={20} />
            </Link>
            <Link
              href="#features"
              className="border-2 border-gray-300 text-gray-900 px-8 py-3 rounded-lg hover:border-gray-400 transition"
            >
              Learn More
            </Link>
          </div>

          {/* Hero Image Placeholder */}
          <div className="bg-gradient-to-br from-vendo-primary-light to-blue-50 rounded-2xl h-96 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <Smartphone size={64} className="mx-auto mb-4 opacity-50" />
              <p>Vendo Platform Preview</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 bg-gray-50 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl font-bold text-center text-gray-900 mb-16">Powerful Features</h2>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {/* Feature 1 */}
            <div className="bg-white p-8 rounded-xl border border-gray-200 hover:border-vendo-primary transition">
              <div className="w-12 h-12 bg-vendo-primary-light rounded-lg flex items-center justify-center mb-4">
                <Zap className="text-vendo-primary" size={24} />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Store Builder</h3>
              <p className="text-gray-600">Create a beautiful online store without coding. Drag-and-drop templates and instant customization.</p>
            </div>

            {/* Feature 2 */}
            <div className="bg-white p-8 rounded-xl border border-gray-200 hover:border-vendo-primary transition">
              <div className="w-12 h-12 bg-vendo-primary-light rounded-lg flex items-center justify-center mb-4">
                <Lock className="text-vendo-primary" size={24} />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Secure Payments</h3>
              <p className="text-gray-600">Accept payments via Ozow, Paystack, cards, and bank transfers. PCI-DSS Level 1 compliant.</p>
            </div>

            {/* Feature 3 */}
            <div className="bg-white p-8 rounded-xl border border-gray-200 hover:border-vendo-primary transition">
              <div className="w-12 h-12 bg-vendo-primary-light rounded-lg flex items-center justify-center mb-4">
                <Globe className="text-vendo-primary" size={24} />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Merchant Dashboard</h3>
              <p className="text-gray-600">Track orders, manage inventory, view analytics, and handle payouts from one dashboard.</p>
            </div>

            {/* Feature 4 */}
            <div className="bg-white p-8 rounded-xl border border-gray-200 hover:border-vendo-primary transition">
              <div className="w-12 h-12 bg-vendo-primary-light rounded-lg flex items-center justify-center mb-4">
                <ArrowRight className="text-vendo-primary" size={24} />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Zero Setup Fees</h3>
              <p className="text-gray-600">No setup costs. You only pay when you make a sale. Start today, grow tomorrow.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl font-bold text-center text-gray-900 mb-16">Simple Pricing</h2>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Plan 1 */}
            <div className="border border-gray-200 rounded-xl p-8 hover:shadow-lg transition">
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Starter</h3>
              <p className="text-gray-600 mb-6">Perfect for new sellers</p>
              <div className="mb-6">
                <span className="text-4xl font-bold text-gray-900">2.9%</span>
                <span className="text-gray-600">  + $0.30 per transaction</span>
              </div>
              <Link href="/auth/register" className="block w-full bg-vendo-primary text-white py-2 rounded-lg text-center hover:bg-vendo-primary-dark transition mb-6">
                Get Started
              </Link>
              <ul className="space-y-3 text-gray-600">
                <li>✓ Unlimited products</li>
                <li>✓ Payment processing</li>
                <li>✓ Basic analytics</li>
                <li>✓ Email support</li>
              </ul>
            </div>

            {/* Plan 2 */}
            <div className="border-2 border-vendo-primary rounded-xl p-8 hover:shadow-lg transition bg-vendo-primary-light">
              <div className="bg-vendo-primary text-white px-3 py-1 rounded-full inline-block mb-4 text-sm font-semibold">
                POPULAR
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Growth</h3>
              <p className="text-gray-600 mb-6">For growing businesses</p>
              <div className="mb-6">
                <span className="text-4xl font-bold text-gray-900">2.49%</span>
                <span className="text-gray-600">  + $0.25 per transaction</span>
              </div>
              <Link href="/auth/register" className="block w-full bg-vendo-primary text-white py-2 rounded-lg text-center hover:bg-vendo-primary-dark transition mb-6">
                Get Started
              </Link>
              <ul className="space-y-3 text-gray-600">
                <li>✓ Everything in Starter</li>
                <li>✓ Advanced analytics</li>
                <li>✓ Invoicing</li>
                <li>✓ Priority support</li>
                <li>✓ API access</li>
              </ul>
            </div>

            {/* Plan 3 */}
            <div className="border border-gray-200 rounded-xl p-8 hover:shadow-lg transition">
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Enterprise</h3>
              <p className="text-gray-600 mb-6">For large operations</p>
              <div className="mb-6">
                <span className="text-4xl font-bold text-gray-900">Custom</span>
                <span className="text-gray-600">  pricing</span>
              </div>
              <button className="block w-full border-2 border-vendo-primary text-vendo-primary py-2 rounded-lg hover:bg-vendo-primary-light transition mb-6">
                Contact Sales
              </button>
              <ul className="space-y-3 text-gray-600">
                <li>✓ Everything in Growth</li>
                <li>✓ Dedicated account manager</li>
                <li>✓ Custom integrations</li>
                <li>✓ Volume discounts</li>
                <li>✓ SLA guarantee</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-vendo-primary text-white px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl font-bold mb-6">Ready to Launch Your Store?</h2>
          <p className="text-xl mb-8 opacity-90">Join hundreds of African merchants already selling online with Vendo.</p>
          <Link
            href="/auth/register"
            className="inline-block bg-white text-vendo-primary px-8 py-3 rounded-lg font-semibold hover:bg-gray-100 transition"
          >
            Start Selling Today
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto grid md:grid-cols-4 gap-8 mb-8">
          <div>
            <h4 className="text-white font-semibold mb-4">Vendo</h4>
            <p className="text-sm">African commerce platform for every business.</p>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-4">Product</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="#" className="hover:text-white transition">Features</a></li>
              <li><a href="#" className="hover:text-white transition">Pricing</a></li>
              <li><a href="#" className="hover:text-white transition">Security</a></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-4">Company</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="#" className="hover:text-white transition">About</a></li>
              <li><a href="#" className="hover:text-white transition">Blog</a></li>
              <li><a href="#" className="hover:text-white transition">Careers</a></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-4">Support</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="#" className="hover:text-white transition">Help Center</a></li>
              <li><a href="#" className="hover:text-white transition">Contact</a></li>
              <li><a href="#" className="hover:text-white transition">Status</a></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-gray-800 pt-8 text-center text-sm">
          <p>&copy; 2026 Vendo. All rights reserved.</p>
        </div>
      </footer>
    </main>
  );
}
