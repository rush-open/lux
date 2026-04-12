export default function DashboardPage() {
  return (
    <div className="flex min-h-screen">
      <aside className="w-64 border-r border-gray-200 dark:border-gray-800 p-4">
        <h2 className="text-lg font-semibold mb-4">Projects</h2>
        <p className="text-sm text-gray-500">No projects yet.</p>
      </aside>
      <main className="flex-1 p-8">
        <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
        <p className="text-gray-600 dark:text-gray-400">Create a project to get started.</p>
      </main>
    </div>
  );
}
