export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-vendo-primary-light to-blue-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-xl overflow-hidden max-w-md w-full">
        <div className="bg-gradient-to-r from-vendo-primary to-vendo-primary-dark p-6 text-white">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
              <span className="text-vendo-primary font-bold">V</span>
            </div>
            <span className="text-2xl font-bold">Vendo</span>
          </div>
          <p className="text-green-100">Everything your business needs.</p>
        </div>
        <div className="p-8">{children}</div>
      </div>
    </div>
  );
}
