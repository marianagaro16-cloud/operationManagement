/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    /**
     * exceljs is a large CommonJS package that reaches for Node streams and
     * zlib. Bundling it into the server action that reads an Order Request
     * workbook produces a broken build; left external it is required at run
     * time from node_modules, which is what it expects.
     *
     * It is loaded with a dynamic import inside the action, so it stays out
     * of every request that is not an import.
     */
    serverComponentsExternalPackages: ['exceljs'],
  },
  /**
   * Notes, the inbox and personal tasks moved into "Mi espacio". Their old
   * addresses are in bookmarks and in notifications already sent, so they
   * still arrive. Done here rather than in a page, so the answer is a plain
   * redirect before anything is rendered.
   */
  redirects: async () => [
    { source: '/notes', has: [{ type: 'query', key: 'archived', value: '1' }], destination: '/space/notes/archived', permanent: false },
    { source: '/notes', destination: '/space', permanent: false },
    { source: '/inbox', destination: '/space/inbox', permanent: false },
    { source: '/reminders/tasks', destination: '/space/tasks', permanent: false },
  ],
  headers: async () => [
    {
      source: '/sw.js',
      headers: [
        { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        { key: 'Service-Worker-Allowed', value: '/' },
      ],
    },
  ],
};

export default nextConfig;
