import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-5xl font-bold mb-4">Rush</h1>
      <p className="text-xl text-gray-600 dark:text-gray-400 mb-8">
        Enterprise AI Agent Infrastructure
      </p>
      <div className="flex gap-4">
        <Link
          href="/login"
          className="rounded-lg bg-blue-600 px-6 py-3 text-white font-medium hover:bg-blue-700"
        >
          Sign In
        </Link>
        <Link
          href="/dashboard"
          className="rounded-lg border border-gray-300 dark:border-gray-700 px-6 py-3 font-medium hover:bg-gray-50 dark:hover:bg-gray-900"
        >
          Dashboard
        </Link>
      </div>
    </main>
  );
}
