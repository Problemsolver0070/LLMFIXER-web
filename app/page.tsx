import CosmosBackground from "@/components/canvas/CosmosBackground";
import HeroSection from "@/components/HeroSection";
import SiteSections from "@/components/SiteSections";
import ScrollBridge from "@/components/ScrollBridge";

export default function Home() {
  return (
    <>
      <CosmosBackground />
      <ScrollBridge />
      <HeroSection />
      <SiteSections />
    </>
  );
}
