import CosmosBackground from "@/components/canvas/CosmosBackground";
import HeroSection from "@/components/HeroSection";
import SiteSections from "@/components/SiteSections";
import ScrollBridge from "@/components/ScrollBridge";
import GyroPrompt from "@/components/GyroPrompt";

export default function Home() {
  return (
    <>
      <CosmosBackground />
      <ScrollBridge />
      <HeroSection />
      <SiteSections />
      <GyroPrompt />
    </>
  );
}
