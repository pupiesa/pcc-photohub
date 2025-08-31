"use client";

import { useState } from "react";
import { WarpBackground } from "@/components/ui/shadcn-io/warp-background";
import { GradientText } from "@/components/ui/shadcn-io/gradient-text";
import StartCard from "@/components/IndexCard";
import PhoneLoginCard from "@/components/PhoneLoginCard";
import PhotoboothInterface from "@/components/PhotoboothInterface";

const WARP_CONFIG = {
  perspective: 150,
  beamsPerSide: 4,
  beamSize: 5,
  beamDuration: 1,
};

export default function BoothApp() {
  const [currentView, setCurrentView] = useState("start"); // "start", "login", "photobooth"
  const [user, setUser] = useState(null);

  const handleStartClick = () => {
    setCurrentView("login");
  };

  const handleLoginSuccess = (userData) => {
    setUser(userData);
    setCurrentView("photobooth");
  };

  const handleBackToStart = () => {
    setCurrentView("start");
  };

  const handleLogout = () => {
    setUser(null);
    setCurrentView("start");
  };

  const renderCurrentView = () => {
    switch (currentView) {
      case "login":
        return (
          <PhoneLoginCard
            onBack={handleBackToStart}
            onLogin={handleLoginSuccess}
          />
        );
      case "photobooth":
        return <PhotoboothInterface user={user} onLogout={handleLogout} />;
      default:
        return <StartCard onStartClick={handleStartClick} />;
    }
  };

  return (
    <WarpBackground className="min-h-screen flex flex-col" {...WARP_CONFIG}>
      <div className="text-center pt-8 float-none">
        <GradientText
          className="text-4xl font-bold text-center"
          text="Pcc-Photohub"
          neon
          gradient="linear-gradient(90deg, #00ff00 0%, #00ffff 25%, #ff00ff 50%, #00ffff 75%, #00ff00 100%)"
        />
      </div>
      <div className="flex-1 flex justify-center mt-10">
        {renderCurrentView()}
      </div>
    </WarpBackground>
  );
}
