import CosmosBackground from "@/components/canvas/CosmosBackground";

export default function Home() {
  return (
    <>
      <CosmosBackground />
      <main className="content-layer min-h-screen flex items-center justify-center p-8">
        <div className="text-center">
          <h1 className="text-5xl sm:text-6xl font-light tracking-tight mb-4">
            The Fixer
          </h1>
          <p className="text-lg text-[color:var(--celestial-dim)] max-w-md mx-auto">
            Light emerges where atoms meet.
          </p>
        </div>
      </main>
    </>
  );
}
