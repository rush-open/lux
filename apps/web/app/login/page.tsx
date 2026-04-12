export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 p-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Sign In</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2">Sign in to your Rush account</p>
        </div>
        <form className="space-y-4">
          <button
            type="button"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-3 font-medium hover:bg-gray-50 dark:hover:bg-gray-900 flex items-center justify-center gap-2"
          >
            Continue with GitHub
          </button>
        </form>
      </div>
    </main>
  );
}
