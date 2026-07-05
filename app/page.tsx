import { siteDescription, siteTitle } from './site-content';

export const dynamic = 'force-dynamic';

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">{siteTitle}</h1>
        <p className="mt-2 text-sm text-neutral-600">{siteDescription}</p>
      </div>
    </main>
  );
}
