import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const PhotoboothInterface = ({ user, onLogout }) => {
  const [countdown, setCountdown] = useState(null);
  const [photosTaken, setPhotosTaken] = useState(0);
  const maxPhotos = 4;

  const startPhotoshoot = () => {
    let count = 3;
    setCountdown(count);

    const timer = setInterval(() => {
      count--;
      if (count > 0) {
        setCountdown(count);
      } else {
        setCountdown("📸");
        setTimeout(() => {
          setCountdown(null);
          setPhotosTaken((prev) => prev + 1);
        }, 500);
        clearInterval(timer);
      }
    }, 1000);
  };

  const resetSession = () => {
    setPhotosTaken(0);
    setCountdown(null);
  };

  return (
    <Card className="w-96 h-[600px]">
      <CardContent className="flex flex-col gap-4 p-6 h-full">
        <div className="flex justify-between items-center">
          <CardTitle className="text-xl">Welcome!</CardTitle>
          <Button variant="outline" onClick={onLogout} className="text-sm">
            Logout
          </Button>
        </div>

        <CardDescription>Phone: {user.phone}</CardDescription>

        <div className="flex-1 flex flex-col justify-center items-center gap-6">
          {countdown ? (
            <div className="text-8xl font-bold text-center">{countdown}</div>
          ) : (
            <>
              <div className="text-center">
                <div className="text-6xl mb-4">📷</div>
                <div className="text-xl font-semibold">
                  Photos taken: {photosTaken}/{maxPhotos}
                </div>
              </div>

              <div className="w-full space-y-3">
                {photosTaken < maxPhotos ? (
                  <Button
                    onClick={startPhotoshoot}
                    className="w-full h-16 text-2xl font-bold"
                  >
                    Take Photo {photosTaken + 1}
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <div className="text-center text-green-600 font-bold text-xl">
                      ✅ Session Complete!
                    </div>
                    <Button
                      onClick={resetSession}
                      className="w-full h-12 text-xl"
                    >
                      Start New Session
                    </Button>
                  </div>
                )}

                {photosTaken > 0 && photosTaken < maxPhotos && (
                  <Button
                    variant="outline"
                    onClick={resetSession}
                    className="w-full h-12"
                  >
                    Reset Session
                  </Button>
                )}
              </div>
            </>
          )}
        </div>

        <div className="text-center text-sm text-gray-500">
          Session: ฿50 • {maxPhotos} photos included
        </div>
      </CardContent>
    </Card>
  );
};

export default PhotoboothInterface;
