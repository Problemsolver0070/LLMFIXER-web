import CosmosBackground from "@/components/canvas/CosmosBackground";
import GetKeyForm from "@/components/GetKeyForm";

export const metadata = {
  title: "Get an API key — The Fixer",
  description:
    "Generate an opto_ API key. During preview access, no payment required — full PayPal subscription integration arrives next.",
};

export default function GetKeyPage() {
  return (
    <>
      <CosmosBackground />
      <main className="content-layer min-h-screen flex items-center justify-center px-6 py-32">
        <GetKeyForm />
      </main>
    </>
  );
}
